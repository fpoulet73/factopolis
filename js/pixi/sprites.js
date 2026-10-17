// ===========================================================================
// Migration PixiJS — Couche sprites (Phase 1)
// ---------------------------------------------------------------------------
// Bakery de textures (réutilise les fonctions de dessin Canvas2D comme
// générateurs de textures) + rendu des sprites sur Pixi.
//   - Arbres : statiques, reconstruits sur changement sol/rotation.
//   - Camions : mobiles, textures DIRECTIONNELLES (bakées à K angles), placés
//     chaque frame. Texture choisie selon la direction ; teinte cargo par
//     couleur (une série de K textures bakée/cachée par couleur).
//
// Bakery : une drawX() dessine autour d'un point centre monde (c). On la rend
// dans un canvas offscreen en translatant pour que c tombe sur l'ancre (ax,ay).
// Le sprite Pixi utilise anchor=(ax/w,ay/h) et se positionne au c monde réel
// → parité pixel + gestion automatique du lift (c inclut déjà le lift).
// ===========================================================================
const PixiSprites = (function(){
  const SS = 2;       // suréchantillonnage textures (≠ RES global = table des ressources)
  const KDIRS = 24;   // nombre d'orientations bakées pour les entités directionnelles

  // --- Bakery -------------------------------------------------------------
  // (cx,cy) = point centre monde de la fonction ; placé sur l'ancre (ax,ay).
  function bake(w, h, ax, ay, cx, cy, drawFn){
    const oc = document.createElement('canvas');
    oc.width = Math.ceil(w * SS); oc.height = Math.ceil(h * SS);
    const octx = oc.getContext('2d');
    const saved = ctx;
    ctx = octx; // ctx est `let` (02_world_state.js) → redirection temporaire
    try {
      octx.setTransform(SS, 0, 0, SS, (ax - cx) * SS, (ay - cy) * SS);
      drawFn();
    } finally {
      ctx = saved;
    }
    // Source explicite (hors cache Pixi) : une texture bakée peut ainsi être
    // détruite proprement quand elle est remplacée (re-bake d'un bâtiment).
    return { texture: new PIXI.Texture({ source: new PIXI.CanvasSource({ resource: oc }) }), ax, ay, w, h };
  }
  function destroyBaked(baked){
    if(!baked?.texture) return;
    try { baked.texture.destroy(true); } catch(e){}
  }

  // --- Fenêtre visible (culling) ------------------------------------------
  // Rectangle monde iso visible, élargi d'une marge. Tout ce qui est dehors n'est
  // ni mis à jour (overlays, bakes) ni envoyé au GPU.
  let viewL = 0, viewT = 0, viewR = 0, viewB = 0;
  function computeView(){
    const z = cam.z || 1, m = 96 / z;
    viewL = cam.x - m; viewT = cam.y - m; viewR = cam.x + W / z + m; viewB = cam.y + H / z + m;
  }
  function inView(px, py, padX = 0, padTop = 0, padBottom = 0){
    return px >= viewL - padX && px <= viewR + padX && py >= viewT - padBottom && py <= viewB + padTop;
  }

  function applyBaked(s, baked){
    s.texture = baked.texture;
    s.anchor.set(baked.ax / baked.w, baked.ay / baked.h);
  }

  // Direction (du,dv) → index de texture directionnelle [0..KDIRS).
  function dirIndex(du, dv){
    let a = Math.atan2(dv, du);
    if(a < 0) a += Math.PI * 2;
    return Math.round(a / (Math.PI * 2) * KDIRS) % KDIRS;
  }

  // --- Arbres -------------------------------------------------------------
  const TREE_W = 36, TREE_H = 48, TREE_AX = 18, TREE_AY = 40;
  let treeTex = null;
  let treePool = [], treeCount = 0;
  // Les arbres ne dépendent QUE du terrain/mapMask → gate sur terrainVersion (pas
  // groundVersion) pour ne PAS rescanner toute la carte à chaque pose de route/rail.
  let treeBuiltVersion = -1, treeBuiltRot = -1, treeBuiltN = -1;

  function bakeTrees(){
    const seeds = new Array(8).fill(null);
    let found = 0;
    for(let y = 0; y < N && found < 8; y++) for(let x = 0; x < N; x++){
      const r = hash(x, y) & 7;
      if(!seeds[r]){ seeds[r] = { x, y }; if(++found === 8) break; }
    }
    treeTex = seeds.map((s) => {
      const sx = s ? s.x : 0, sy = s ? s.y : 0;
      const c = tileCenterIso(0, 0, sx, sy);
      return bake(TREE_W, TREE_H, TREE_AX, TREE_AY, c[0], c[1], () => drawTree(0, 0, sx, sy));
    });
  }

  function rebuildTrees(layer){
    let n = 0;
    for(let y = 0; y < N; y++) for(let x = 0; x < N; x++){
      const i = y * N + x;
      if(terrain[i] !== T.TREE) continue;
      if(typeof mapMask !== 'undefined' && mapMask && mapMask[i] !== 1) continue; // hors zone jouable
      const [rx, ry] = rotIdx(x, y);
      const pos = tileCenterIso(rx, ry, x, y);
      let s = treePool[n];
      if(!s){ s = new PIXI.Sprite(); s.scale.set(1 / SS); layer.addChild(s); treePool[n] = s; }
      applyBaked(s, treeTex[hash(x, y) & 7]);
      s.visible = true;
      s.position.set(pos[0], pos[1]);
      s.zIndex = spriteDepthKey(rx + 0.5, ry + 0.5);
      n++;
    }
    for(let i = n; i < treePool.length; i++) treePool[i].visible = false;
    treeCount = n;
    treeBuiltVersion = terrainVersion; treeBuiltRot = rot; treeBuiltN = N;
  }

  function updateTrees(layer){
    if(!treeTex) bakeTrees();
    if(treeBuiltVersion !== terrainVersion || treeBuiltRot !== rot || treeBuiltN !== N)
      rebuildTrees(layer);
    // Culling : seuls les arbres à l'écran restent rendus.
    for(let i = 0; i < treeCount; i++){
      const s = treePool[i];
      s.visible = inView(s.position.x, s.position.y, 24, 48, 8);
    }
  }

  // --- Bouches de tunnel (PNG par direction) ------------------------------
  // Une bouche par arête rail↔tunnel. Texture PNG par direction écran (dirIndex)
  // ; sprite posé sur l'arête basse réelle (niveau tuile plate). zIndex biaisé
  // au-dessus des trains → un train « disparaît » sous l'arche.
  // Les galeries étant toujours cardinales, dirIndex ∈ {12, 18} après retournement
  // back/front (12 = dir (-1,0), 18 = dir (0,-1)) → 4 PNG suffisent.
  // PNG 256×224 = TUN(128×112) × SS(2) : même ancre normalisée (0.5, 0.625).
  const TUN = { w:128, h:112, ax:64, ay:70 };
  const TUN_PNG_DIR = { 12:'12', 18:'18' };
  const tunnelTexCache = new Map(); // "dir-back/front" -> { texture, ax, ay, w, h }
  let tunnelPool = [];
  let tunnelBuiltVersion = -1, tunnelBuiltRot = -1, tunnelBuiltN = -1, tunnelBuiltPack = '';
  // Précharge les 4 PNG pour éviter le pop au 1er portal.
  for(const num of Object.values(TUN_PNG_DIR))
    for(const side of ['front','back'])
      PIXI.Assets.load('assets/tunnels/portal-' + num + '-' + side + '.png')
        .then(() => {}, () => {});
  function tunnelTexture(du, dv, backView = false){
    const idx = dirIndex(du, dv);
    const num = TUN_PNG_DIR[idx] || '18'; // tolérant : défaut 18
    const side = backView ? 'back' : 'front';
    const key = num + '-' + side;
    let t = tunnelTexCache.get(key);
    if(t) return t;
    const url = 'assets/tunnels/portal-' + key + '.png';
    t = { texture: PIXI.Texture.from(url), ax: TUN.ax, ay: TUN.ay, w: TUN.w, h: TUN.h };
    tunnelTexCache.set(key, t);
    return t;
  }
  function updateTunnels(layer){
    if(typeof rail === 'undefined' || typeof railTunnel === 'undefined' || !railTunnel){
      hidePool(tunnelPool, 0); return;
    }
    const packKey = UI_OPTIONS?.graphicPack || 'classic';
    // Portails statiques, dépendent des rails : ne re-scanner que si rail/rotation change.
    if(tunnelBuiltVersion === railVersion && tunnelBuiltRot === rot && tunnelBuiltN === N && tunnelBuiltPack === packKey) return;
    let n = 0;
    for(let y = 0; y < N; y++) for(let x = 0; x < N; x++){
      const i = y * N + x;
      if(!rail[i] || railTunnel[i]) continue;
      const mask = rail[i];
      for(const def of RAIL_DIRS){
        if(!(mask & def.bit)) continue;
        const nx = x + def.dx, ny = y + def.dy;
        if(!inMap(nx, ny) || !railTunnel[ny * N + nx]) continue;
        const [rx, ry] = rotIdx(x, y);
        const pose = tunnelPortalPose(rx, ry, x, y, def.dx, def.dy);
        const s = getPool(tunnelPool, n, layer);
        applyBaked(s, tunnelTexture(pose.du, pose.dv, pose.backView));
        s.visible = true;
        s.position.set(pose.px, pose.py);
        s.zIndex = spriteDepthKey(rx + 0.5, ry + 0.5, 0.6);
        n++;
      }
    }
    hidePool(tunnelPool, n);
    tunnelBuiltVersion = railVersion; tunnelBuiltRot = rot; tunnelBuiltN = N; tunnelBuiltPack = packKey;
  }

  // --- Entités directionnelles (camions / voitures / locos / wagons) ------
  // Corps = prisme iso orienté par la direction. Bake du corps (drawXCore) à
  // KDIRS angles par couleur ; texture choisie par frame selon la direction.
  const DIM = {
    truck: { w:44, h:44, ax:22, ay:28 },
    car:   { w:44, h:44, ax:22, ay:28 },
    loco:  { w:60, h:56, ax:30, ay:36 },
    wagon: { w:52, h:48, ax:26, ay:30 },
    ship:  { w:72, h:56, ax:36, ay:34 },
    plane: { w:72, h:52, ax:36, ay:30 },
  };
  const dirCache = { truck:new Map(), car:new Map(), loco:new Map(), wagon:new Map(), ship:new Map(), plane:new Map() };

  function getPool(pool, i, layer){
    let s = pool[i];
    if(!s){ s = new PIXI.Sprite(); s.scale.set(1/SS); layer.addChild(s); pool[i] = s; }
    return s;
  }
  function hidePool(pool, n){ for(let i=n; i<pool.length; i++) pool[i].visible = false; }

  function dirTextures(kind, coreFn, col){
    const cache = dirCache[kind];
    let arr = cache.get(col);
    if(arr) return arr;
    const d = DIM[kind], c = entityIso(0, 0); // lift de la tuile 0,0 s'annule
    arr = [];
    for(let k = 0; k < KDIRS; k++){
      const a = k / KDIRS * Math.PI * 2, du = Math.cos(a), dv = Math.sin(a);
      arr.push(bake(d.w, d.h, d.ax, d.ay, c[0], c[1], () => coreFn(0, 0, du, dv, col)));
    }
    cache.set(col, arr);
    return arr;
  }
  function placeDir(pool, n, layer, kind, coreFn, col, u, v, du, dv, depthBias, alpha=1){
    const s = getPool(pool, n, layer);
    applyBaked(s, dirTextures(kind, coreFn, col)[dirIndex(du, dv)]);
    s.visible = true;
    s.alpha = alpha;
    const pos = entityIso(u, v);
    s.position.set(pos[0], pos[1]);
    s.zIndex = spriteDepthKey(u, v, depthBias);
    return n + 1;
  }

  let truckPool = [], carPool = [], locoPool = [], wagonPool = [];
  let shipPool = [], planePool = [], planeShadowPool = [];
  // Ombre d'avion : silhouette floue en croix (texture unique).
  let _planeShadowTex = null;
  function planeShadowTexture(){
    if(_planeShadowTex) return _planeShadowTex;
    const oc = document.createElement('canvas'); oc.width = 64; oc.height = 40;
    const g = oc.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,1)';
    g.beginPath(); g.ellipse(32, 20, 22, 4, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(34, 20, 5, 17, 0, 0, Math.PI * 2); g.fill();
    _planeShadowTex = new PIXI.Texture({ source: new PIXI.CanvasSource({ resource: oc }) });
    return _planeShadowTex;
  }
  // Découpe d'un train à une bouche de tunnel. Chaque sprite possède SON masque
  // dédié (s.__clip) : indispensable car Pixi remet renderable=true sur le masque
  // quand on fait `s.mask = null` — un pool partagé réassigné entre sprites ferait
  // alors clignoter le polygone blanc plein écran. clip=null → on cache le masque.
  function applyTunnelClip(s, clip, layer){
    if(!clip){
      if(s.mask) s.mask = null;      // Pixi remet s.__clip.renderable = true …
      if(s.__clip) s.__clip.visible = false; // … donc on le cache explicitement.
      return;
    }
    let g = s.__clip;
    if(!g){ g = new PIXI.Graphics(); g.eventMode = 'none'; layer.addChild(g); s.__clip = g; }
    const { px, py, dirx, diry } = clip;
    const L = 8000, ax = -diry * L, ay = dirx * L, bx = -dirx * L, by = -diry * L;
    g.clear();
    g.poly([ px + ax, py + ay, px - ax, py - ay, px - ax + bx, py - ay + by, px + ax + bx, py + ay + by ]).fill(0xffffff);
    g.visible = true;
    if(s.mask !== g) s.mask = g;
  }
  function updateTrucks(layer){
    if(typeof trucks === 'undefined') return;
    let n = 0;
    for(const tk of trucks){
      const p = truckPose(tk); if(!p) continue;
      { const c = iso(p.u, p.v); if(!inView(c[0], c[1], 40, 60, 200)) continue; }
      const col = (typeof RES !== 'undefined' && RES[tk.res]?.c) ? RES[tk.res].c : '#aaa';
      n = placeDir(truckPool, n, layer, 'truck', drawTruckCore, col, p.u, p.v, p.du, p.dv, 0.5);
    }
    hidePool(truckPool, n);
  }
  // Overlays de véhicule (label cargaison, badge ressource wagon) : slots réutilisés.
  const vehOvPool = [];
  function getVehOv(ovLayer, i){
    let s = vehOvPool[i];
    if(!s){ s = { container:new PIXI.Container(), g:new PIXI.Graphics(), label:mkOvText(10,0xffffff,2) };
            s.container.addChild(s.g, s.label); ovLayer.addChild(s.container); vehOvPool[i] = s; }
    s.g.clear(); s.label.visible = false; s.container.visible = true;
    return s;
  }

  function updateVehicles(layer, ovLayer){
    if(typeof vehicles === 'undefined') return;
    if(typeof ensureTunnelFloors === 'function') ensureTunnelFloors();
    let nc = 0, nl = 0, nw = 0, nov = 0, ns = 0, np = 0, nps = 0;
    for(const veh of vehicles){
      const rs = typeof mpVehicleRenderState === 'function' ? mpVehicleRenderState(veh) : veh;
      if(veh.state === 'idle' && VEHICLE_TYPES[veh.vtype]?.mode === 'air'){
        // avion au repos : stationné sur une case de parking de son aéroport (s'il y en a une de libre)
        const slot = parkingSlotOf(veh);
        if(slot){
          const [pu, pv] = rotF(slot.x + 0.5, slot.y + 0.5), [pdu, pdv] = rotDir(1, 0);
          np = placeDir(planePool, np, layer, 'plane', drawPlaneCore, VEHICLE_TYPES[veh.vtype].color, pu, pv, pdu, pdv, 0.6);
          planePool[np - 1].zIndex = 1e15;
        }
        continue;
      }
      if(veh.state === 'idle' || !rs.pts || !rs.pts.length) continue;
      if(veh.vtype === 'train'){
        const wagonLoads = trainWagonLoads(veh); // chargement par wagon : le badge n'apparaît que si le wagon est rempli
        for(let i = 0; i < (veh.wagons?.length || 0); i++){
          const wp = trainWagonPose(veh, i); if(!wp) continue;
          // Wagon encore dans le dépôt (ou derrière, à la sortie) : pas de rail sous lui → masqué.
          { const [wx, wy] = invRotF(wp.u, wp.v), wtx = Math.floor(wx), wty = Math.floor(wy);
            if(wtx < 0 || wty < 0 || wtx >= N || wty >= N || !rail[wty * N + wtx]) continue; }
          // Tranché à l'entrée de la bouche, entièrement masqué dans la galerie.
          const clip = tunnelClipInfo(wp.u, wp.v); if(clip === 'hidden') continue;
          const wagon = veh.wagons[i];
          nw = placeDir(wagonPool, nw, layer, 'wagon', drawWagonCore, trainWagonTypeKey(wagon) || '#888', wp.u, wp.v, wp.du, wp.dv, 0.52);
          applyTunnelClip(wagonPool[nw-1], clip, layer);
          // badge ressource sélectionnée (seulement hors bouche)
          const selRes = (!clip && veh.res && (wagonLoads[i] || 0) > 0 && !trainWagonDef(wagon)?.passenger) ? veh.res : null; // ressource réellement transportée
          if(selRes && RES[selRes]?.ic){
            const c = entityIso(wp.u, wp.v), by = c[1]-11, s = getVehOv(ovLayer, nov++);
            s.g.ellipse(c[0], by, 8.5, 7).fill({ color:0x0c1826, alpha:0.92 }).stroke({ color: RES[selRes].c || '#ffe082', width:1.2 });
            s.label.text = RES[selRes].ic; s.label.position.set(c[0], by+0.5); s.label.visible = true;
          }
        }
        const tp = trainPose(veh); if(!tp) continue;
        const clip = tunnelClipInfo(tp.u, tp.v); if(clip === 'hidden') continue; // loco masquée dans la galerie
        nl = placeDir(locoPool, nl, layer, 'loco', drawTrainLocoCore, vehicleColor(veh), tp.u, tp.v, tp.du, tp.dv, 0.52);
        applyTunnelClip(locoPool[nl-1], clip, layer);
      } else {
        const p = vehiclePose(veh); if(!p) continue;
        const vt = VEHICLE_TYPES[veh.vtype];
        if(vt.mode === 'water'){
          ns = placeDir(shipPool, ns, layer, 'ship', drawShipCore, vt.color, p.u, p.v, p.du, p.dv, 0.5);
          continue;
        }
        if(vt.mode === 'air'){
          // Avion : sprite surélevé de son altitude, toujours au premier plan, et
          // ombre portée au sol qui s'estompe avec la hauteur.
          const alt = planeAltitudePx(veh);
          const g = entityIso(p.u, p.v);
          const sh = getPool(planeShadowPool, nps++, PixiScene.layers.overlaysUnder || ovLayer);
          sh.texture = planeShadowTexture();
          sh.anchor.set(0.5, 0.5);
          sh.position.set(g[0] + alt * 0.25, g[1] + 2);
          sh.alpha = Math.max(0.12, 0.38 - alt / 260);
          sh.rotation = Math.atan2((p.du + p.dv) * TH2, (p.du - p.dv) * TW2);
          sh.visible = true;
          np = placeDir(planePool, np, layer, 'plane', drawPlaneCore, vt.color, p.u, p.v, p.du, p.dv, 0.6);
          const s = planePool[np - 1];
          s.position.y -= alt;
          s.zIndex = 1e15; // toujours devant : au sol aussi, l'avion ne passe pas sous la piste / le taxi
          continue;
        }
        nc = placeDir(carPool, nc, layer, 'car', drawCarCore, vt.color, p.u, p.v, p.du, p.dv, 0.52);
        if(veh.cargo > 0){
          const c = entityIso(p.u, p.v), s = getVehOv(ovLayer, nov++);
          s.label.text = vt.icone + ' ' + veh.cargo; s.label.position.set(c[0], c[1]-TH); s.label.visible = true;
        }
      }
    }
    hidePool(carPool, nc); hidePool(locoPool, nl); hidePool(wagonPool, nw);
    hidePool(shipPool, ns); hidePool(planePool, np); hidePool(planeShadowPool, nps);
    // Sprites masqués mais rendus invisibles ce frame : neutraliser leur découpe
    // (sinon un masque au renderable réactivé pourrait réapparaître plein écran).
    for(let i = nl; i < locoPool.length; i++) if(locoPool[i].__clip) locoPool[i].__clip.visible = false;
    for(let i = nw; i < wagonPool.length; i++) if(wagonPool[i].__clip) wagonPool[i].__clip.visible = false;
    for(let i = nov; i < vehOvPool.length; i++) vehOvPool[i].container.visible = false;
  }

  // --- Piétons / sans-abri (statiques, non directionnels) -----------------
  const WALK = { w:14, h:22, ax:7, ay:16 };
  const walkerCache = new Map();
  let walkerPool = [], homelessPool = [];
  function walkerTexture(col){
    let t = walkerCache.get(col);
    if(t) return t;
    t = bake(WALK.w, WALK.h, WALK.ax, WALK.ay, 0, 0, () => drawWalkerCore([0,0], col, 0));
    walkerCache.set(col, t);
    return t;
  }
  function placeWalker(pool, n, layer, col, p, depthBias){
    const s = getPool(pool, n, layer);
    applyBaked(s, walkerTexture(col));
    s.visible = true;
    s.position.set(p.c[0], p.c[1]);
    s.zIndex = spriteDepthKey(p.u, p.v, depthBias);
    return n + 1;
  }
  function updateWalkers(layer){
    if(typeof walkers === 'undefined') return;
    let n = 0;
    for(const wk of walkers){ const p = walkerPose(wk); if(!p) continue;
      if(!inView(p.c[0], p.c[1], 16, 24, 8)) continue;
      n = placeWalker(walkerPool, n, layer, wk.col, p, 0.6); }
    hidePool(walkerPool, n);
  }
  function updateHomeless(layer){
    if(typeof homeless === 'undefined') return;
    let n = 0;
    for(const h of homeless){ const p = homelessPose(h);
      if(!inView(p.c[0], p.c[1], 16, 24, 8)) continue;
      n = placeWalker(homelessPool, n, layer, h.col || playerColor(h.owner), p, 0.55); }
    hidePool(homelessPool, n);
  }

  // --- Anneaux focus / sélection de véhicule (overlays live) --------------
  let focusRing = null, selRing = null;
  function updateVehicleRings(ovLayer){
    if(!focusRing){ focusRing = new PIXI.Graphics(); ovLayer.addChild(focusRing); }
    if(!selRing){ selRing = new PIXI.Graphics(); ovLayer.addChild(selRing); }
    focusRing.clear(); selRing.clear();
    const ring = (g, veh, color, alpha, rx, ry) => {
      if(!veh) return; const p = vehiclePose(veh); if(!p) return;
      const c = entityIso(p.u, p.v);
      g.ellipse(c[0], c[1], rx, ry).stroke({ color, width:3, alpha });
    };
    if(typeof focusVehicle !== 'undefined' && focusVehicle){
      const isT = focusVehicle.vtype === 'train', pu = 0.6 + 0.4*Math.sin(performance.now()/300);
      ring(focusRing, focusVehicle, 0x4dd9ff, 0.45 + 0.4*pu, (isT?17:15) + 1.5*pu, isT?8:7);
    }
    if(typeof selectedVehicle !== 'undefined' && selectedVehicle){
      const isT = selectedVehicle.vtype === 'train';
      ring(selRing, selectedVehicle, 0xffffff, 0.9, isT?15:13, isT?7:6);
    }
  }

  // --- Bâtiments : corps baké (retenu) + overlays live --------------------
  const bldNodes = new Map();   // b → { body, sig, geom, baked, shareKey }
  const bldOvPool = [];         // slots d'overlays réutilisés chaque frame
  // Textures de corps PARTAGÉES entre bâtiments identiques (même signature et
  // même variante d'art) : clé → { baked, tcRel, usedSprite, chim, refs }.
  // Une grande ville n'a que quelques dizaines de textures distinctes au lieu
  // d'une par bâtiment (centaines de Mo de VRAM, secondes de cuisson au dézoom).
  const sharedBodies = new Map();
  function releaseShared(key){
    const e = sharedBodies.get(key);
    if(!e) return;
    if(--e.refs <= 0){ destroyBaked(e.baked); sharedBodies.delete(key); }
  }
  function releaseNodeBody(node){
    if(node.shareKey){ releaseShared(node.shareKey); node.shareKey = null; }
    else destroyBaked(node.baked);
    node.baked = null;
  }
  // Corps partagé : cuit au premier usage, puis réutilisé. Le point d'ancrage
  // des overlays (tc) et les cheminées sont stockés RELATIFS à l'origine iso
  // du bâtiment, et replacés pour chaque utilisateur.
  function acquireSharedBody(b, sig){
    const key = sig + '|v' + (typeof artVariantOf === 'function' ? artVariantOf(b) : 0);
    let e = sharedBodies.get(key);
    if(!e){
      const { baked, geom } = bakeBuildingBody(b);
      const R0 = liftedIso(geom.rx0, geom.ry0, geom.lift);
      const ch = typeof BUILDING_CHIMNEYS !== 'undefined' ? BUILDING_CHIMNEYS.get(b) : null;
      e = { baked, refs:0, usedSprite: !!geom.usedSprite,
            tcRel: geom.tc ? [geom.tc[0] - R0[0], geom.tc[1] - R0[1]] : [0, 0],
            chim: ch && ch.rot === rot ? ch.pts.map(p => [p[0] - R0[0], p[1] - R0[1], p[2]]) : null };
      sharedBodies.set(key, e);
    }
    e.refs++;
    const gm = bldGeomOf(b);
    const R = liftedIso(gm.rx0, gm.ry0, gm.lift);
    if(typeof BUILDING_CHIMNEYS !== 'undefined'){
      if(e.chim && b.type !== 'plant') BUILDING_CHIMNEYS.set(b, { rot, pts: e.chim.map(p => [R[0] + p[0], R[1] + p[1], p[2]]) });
      else BUILDING_CHIMNEYS.delete(b);
    }
    return { key, baked: e.baked, geom: { ...gm, tc: [R[0] + e.tcRel[0], R[1] + e.tcRel[1]], usedSprite: e.usedSprite } };
  }

  function bldGeomOf(b){
    const d = BUILD[b.type];
    const [r1x,r1y] = rotIdx(b.x, b.y);
    const [r2x,r2y] = rotIdx(b.x+b.w-1, b.y+b.h-1);
    const rx0 = Math.min(r1x,r2x), ry0 = Math.min(r1y,r2y);
    const rw = Math.abs(r1x-r2x)+1, rh = Math.abs(r1y-r2y)+1;
    const lift = buildingLiftPx(b);
    const hgt = d.ind ? d.hgt*(1+0.18*(Math.max(b.w,b.h)-1)) : d.hgt;
    return { rx0, ry0, rw, rh, lift, hgt };
  }

  function diagMode(){ return typeof UI_OPTIONS !== 'undefined' && UI_OPTIONS.highlightUnderstaffedFactories; }
  function bldSelected(b){
    return b === selected || (typeof trainStationSelectionMatches === 'function' && trainStationSelectionMatches(selected, b))
      || (isAirPiece(b) && isAirPiece(selected) && airportOf(b) === airportOf(selected)); // aéroport = une seule entité
  }

  // Signature de ce qui affecte le CORPS (pas les overlays dynamiques). En mode
  // diagnostic, le corps EST le diagnostic (+ contour blanc si sélectionné) → on
  // inclut ces états.
  // Partie commune (rotation, pack graphique, mode diagnostic) recalculée une
  // fois par image dans updateBuildings : la signature par bâtiment n'est plus
  // qu'une concaténation (plus de tableau + join par bâtiment et par image).
  let _sigTail = '', _sigDiag = false;
  function prepareSigTail(){
    _sigDiag = diagMode();
    _sigTail = rot + '|' + (typeof UI_OPTIONS!=='undefined' ? UI_OPTIONS.graphicPack : '') + '|' + GRAPHIC_PACK_IMAGES_GEN + '|' + (_sigDiag ? 1 : 0);
  }
  function bldSig(b){
    return b.type + '|' + b.w + '|' + b.h + '|' + (b.ore||'') + '|' + (b.owner==null?'':b.owner) + '|' + (b.paused?1:0)
      + (AIR_TYPES.includes(b.type) ? '|a' + airNeighborKey(b) : '')
      + (b.type === 'air_terminal' && airportRepresentative(b) === b ? '|R' : '') // badge : gare principale seulement
      + '|' + _sigTail + ((_sigDiag && bldSelected(b)) ? '|s' : '');
  }

  function bakeBuildingBody(b){
    const gm = bldGeomOf(b);
    const leftE = gm.rh*TW2 + 30, topE = Math.max(gm.hgt, 46*Math.max(gm.rw,gm.rh)) + 60;
    const w = leftE + gm.rw*TW2 + 30;
    const h = topE + (gm.rw+gm.rh)*TH2 + 12;
    const R = liftedIso(gm.rx0, gm.ry0, gm.lift);
    const diag = diagMode();
    const savedFast = drawFast; drawFast = false; // baker en pleine résolution
    let geom = null;
    const baked = bake(w, h, leftE, topE, R[0], R[1], () => {
      if(diag){
        // mode "usines en sous-effectif" : le corps est remplacé par le diagnostic
        drawBuildingLayerDiagnostic(b, gm.rx0, gm.ry0, gm.rw, gm.rh, gm.lift);
        if(bldSelected(b)){ ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; diamond(gm.rx0, gm.ry0, gm.rw, gm.rh, gm.lift); ctx.stroke(); }
        geom = { ...gm, diag:true };
      } else {
        geom = drawBuildingBody(b);
      }
    });
    drawFast = savedFast;
    return { baked, geom: geom || gm, diag };
  }

  // --- Pièces de gare (rendu GROUPE : bande de quai / prisme gare / contours) --
  // On bake `drawTrainStationPiece(b)` tel quel (bande multi-tuiles, marqueurs de
  // dalles manquantes, contours sélection/route — les pointillés fonctionnent en
  // bake Canvas2D). Le corps dépend du terrain (géométrie/lift du groupe) et des
  // rails (raccords/quais), PAS des routes → signature sur terrain+railVersion (et
  // non groundVersion) pour ne pas re-baker toutes les gares à chaque pose de route.
  function stationSig(b){
    const routeState = (typeof vehicleRouteMode !== 'undefined' && vehicleRouteMode)
      ? ((vehicleRouteMode.step||'') + '|' + (vehicleRouteMode.vehicle?.vtype||'')) : '';
    return [b.type, b.owner==null?'':b.owner, b.stationGroupId, b.stationAxis, stationLayoutVersion,
      rot, terrainVersion + '.' + railVersion,
      bldSelected(b)?1:0, routeState,
      (typeof UI_OPTIONS!=='undefined' ? UI_OPTIONS.graphicPack : ''), GRAPHIC_PACK_IMAGES_GEN].join('|');
  }
  function bakeStationPiece(b){
    const [brx, bry] = rotIdx(b.x, b.y);
    const lift = terrainLiftPxAt(b.x, b.y);
    const R = liftedIso(brx, bry, lift);
    // étendue écran du groupe (union des tuiles tournées), relative à iso(brx,bry)
    let minRx=brx, minRy=bry, maxRx=brx, maxRy=bry;
    for(const p of buildings){
      if(p.dead || !isTrainStationPiece(p) || p.stationGroupId !== b.stationGroupId) continue;
      const [prx, pry] = rotIdx(p.x, p.y);
      if(prx<minRx)minRx=prx; if(prx>maxRx)maxRx=prx; if(pry<minRy)minRy=pry; if(pry>maxRy)maxRy=pry;
    }
    const baseX=(brx-bry)*TW2, baseY=(brx+bry)*TH2;
    const cx=[(minRx-(maxRy+1))*TW2, ((maxRx+1)-minRy)*TW2, (minRx-minRy)*TW2, ((maxRx+1)-(maxRy+1))*TW2];
    const cy=[(minRx+minRy)*TH2, ((maxRx+1)+(maxRy+1))*TH2, (minRx+(maxRy+1))*TH2, ((maxRx+1)+minRy)*TH2];
    let minX=Math.min(...cx)-baseX-40, maxX=Math.max(...cx)-baseX+40;
    let minY=Math.min(...cy)-baseY-80, maxY=Math.max(...cy)-baseY+44; // marges : prisme/emoji/lift/bande
    const w=maxX-minX, h=maxY-minY, ax=-minX, ay=-minY;
    const savedFast = drawFast; drawFast = false;
    const baked = bake(w, h, ax, ay, R[0], R[1], () => drawTrainStationPiece(b));
    drawFast = savedFast;
    return { baked, geom:{ rx0:brx, ry0:bry, lift }, diag:false };
  }

  function mkOvText(size, fill, strokeW = 3){
    const style = { fontFamily:'"Segoe UI Emoji",sans-serif', fontWeight:'bold', fontSize:size, fill };
    if(strokeW) style.stroke = { color:0x000000, width:strokeW };
    const t = new PIXI.Text({ text:'', style, resolution:3 });
    t.anchor.set(0.5, 0.5);
    return t;
  }
  function makeOvSlot(ovLayer){
    const s = { container:new PIXI.Container(), g:new PIXI.Graphics(),
      pop:mkOvText(11,0xffe9a0), work:mkOvText(10,0xff9a8a), warn:mkOvText(14,0xffffff,0),
      sale:mkOvText(10,0xf0c060,0), pass:mkOvText(11,0xa0c8e8), pause:mkOvText(13,0x111111,0) };
    s.texts = [s.pop, s.work, s.warn, s.sale, s.pass, s.pause];
    s.container.addChild(s.g, ...s.texts);
    ovLayer.addChild(s.container);
    return s;
  }

  function diamondPath(g, rx0, ry0, rw, rh, lift){
    const A=liftedIso(rx0,ry0,lift), B=liftedIso(rx0+rw,ry0,lift),
          C=liftedIso(rx0+rw,ry0+rh,lift), D=liftedIso(rx0,ry0+rh,lift);
    g.moveTo(A[0],A[1]).lineTo(B[0],B[1]).lineTo(C[0],C[1]).lineTo(D[0],D[1]).closePath();
  }

  // Sélection de gare : groupe sélectionné et pièces de gare, calculés une fois
  // par image (avant : chaque entrepôt/arrêt visible rescannait tous les
  // bâtiments → O(n²) sur une grande ville).
  let _selGroup = null, _stationPieces = [], _selHub = null;
  function prepareSelection(){
    _selGroup = null; _stationPieces = []; _selHub = null;
    if(!selected || selected.dead) return;
    const rep = typeof trainStationSelectionRepresentative === 'function' ? trainStationSelectionRepresentative(selected) : null;
    // port / aéroport sélectionné : ses arrêts de bus et entrepôts collés sont mis en évidence
    if(rep && (rep.type === 'boat_depot' || (typeof isAirPiece === 'function' && isAirPiece(rep)))) _selHub = rep;
    if(!rep || !isTrainStationPiece(rep)) return;
    _selGroup = rep.stationGroupId;
    for(const p of buildings) if(isTrainStationPiece(p)) _stationPieces.push(p);
  }
  function inSelectedStation(b){
    if(_selHub && (b.type === 'bus_stop' || b.type === 'depot') && b !== _selHub)
      return transitHubSelectionRepresentative(b) === _selHub;
    if(_selGroup == null) return false;
    if(isTrainStationPiece(b)) return b.stationGroupId === _selGroup;
    if(b.type !== 'bus_stop' && b.type !== 'depot') return false;
    let best = null;
    for(const o of _stationPieces){
      if(buildingEdgeGap(b, o) > 0) continue;
      if(best == null || o.stationGroupId < best) best = o.stationGroupId;
    }
    return best === _selGroup;
  }
  // Accès route/rail : ne change qu'avec le réseau → mis en cache par version.
  function lacksAccess(b){
    const v = groundVersion + ':' + railVersion + ':' + airVersion;
    if(b._accV !== v){
      b._accV = v;
      b._accLack = (AIR_TYPES.includes(b.type) && b.type !== 'air_terminal') ? false // seule la gare d'aéroport doit toucher une route
        : b.type === 'air_terminal' ? !airportHasRoadAccess(b) // une seule gare reliée suffit
        : b.type === 'plane_depot' ? !planeDepotAirport(b)     // dépôt collé à une piste, pas relié à une route
        : b.type === 'train_depot'
        ? (typeof adjRailTiles === 'function' && !adjRailTiles(b).length)
        : (typeof adjRoadTiles === 'function' && !adjRoadTiles(b).length);
    }
    return b._accLack;
  }

  // Overlays d'un bâtiment. Toutes les entrées visuelles forment une clé : si
  // elle n'a pas changé depuis l'image précédente pour ce bâtiment, le slot est
  // laissé tel quel (pas de clear/regéométrie Pixi — c'était le 1er poste CPU).
  // Radar rotatif au sommet d'une tour de contrôle (animé à chaque image, hors texture cuite)
  const towerRadars = new Map();
  function updateTowerRadar(b, geom, ovLayer){
    let g = towerRadars.get(b);
    if(!g){ g = new PIXI.Graphics(); ovLayer.addChild(g); towerRadars.set(b, g); }
    const top = liftedIso(geom.rx0 + 0.5, geom.ry0 + 0.5, geom.lift);
    const cx = top[0], cy = top[1] - 58;
    const a = performance.now() / 650;
    g.clear();
    // mât + socle
    g.rect(cx - 1, cy - 1, 2, 7).fill({ color:0x6b7580 });
    g.ellipse(cx, cy + 6, 4, 2).fill({ color:0x55606b });
    // antenne en barre qui tourne (ellipse écrasée par la perspective)
    const ex = Math.cos(a) * 11, ey = Math.sin(a) * 5.5;
    g.moveTo(cx - ex, cy - ey).lineTo(cx + ex, cy + ey).stroke({ width:2.4, color:0xe8eef4 });
    g.circle(cx + ex, cy + ey, 1.6).fill({ color:0xff5a4a });
    // petit balayage lumineux
    const bx = Math.cos(a + 0.9) * 14, by = Math.sin(a + 0.9) * 7;
    g.moveTo(cx, cy).lineTo(cx + bx, cy + by).stroke({ width:1, color:0x7dffb0, alpha:0.45 });
    g.zIndex = 1e9;
  }

  function drawBuildingOv(b, geom, ovLayer, idx){
    const d = BUILD[b.type];
    const { tc, rx0, ry0, rw, rh, lift } = geom;
    let s = bldOvPool[idx];
    if(!s){ s = makeOvSlot(ovLayer); bldOvPool[idx] = s; }
    s.container.visible = true;

    const r = recipeOf(b);
    const prog = r ? (typeof buildingRenderProg === 'function' ? buildingRenderProg(b) : (b.prog||0)) : 0;
    const bw = TW*0.42*b.w;
    const progPx = (r && prog > 0) ? Math.round(bw*Math.min(1, prog/r.time)) : -1;
    const showPop = d.resid && b.pop > 0 && (cam.z || 1) >= 0.8;
    const idle = showPop && (b.workersIdle || 0) > 0;
    const sel = b === selected || inSelectedStation(b);
    const ownerMark = !(typeof UI_OPTIONS!=='undefined' && UI_OPTIONS.hideColorMarkers) && b.owner ? b.owner : null;
    const ownerCol = ownerMark != null ? playerColor(ownerMark) : null;
    const paused = d.ind && b.paused;
    // gares d'aéroport fusionnées : une seule alerte, sur la gare principale
    const lack = lacksAccess(b) && (b.type !== 'air_terminal' || airportRepresentative(b) === b);
    const noWorkers = !lack && typeof isUnderstaffedOwnFactory === 'function' && isUnderstaffedOwnFactory(b) && workersAllocatedOf(b) === 0;
    const sale = !!(d.storageHub && b.type !== 'tank' && b.sellTo && Object.values(b.sellTo).some(v=>v));
    const pass = b.type === 'bus_stop' && (b.passengersMax||0) > 0 ? Math.floor(b.passengers||0) : -1;
    const passFull = pass >= 0 && pass >= (b.passengersMax||0);
    let rc = null;
    if(typeof vehicleRouteMode !== 'undefined' && vehicleRouteMode
       && typeof vehicleRouteEndpointOk === 'function' && vehicleRouteEndpointOk(b)){
      const isBus = vehicleRouteMode.vehicle?.vtype === 'bus';
      const myOid = (typeof MP !== 'undefined' && MP.connected) ? MP.myId : null;
      if(isBus) rc = 0x7dd8ff;
      else if(vehicleRouteMode.step === 'dest' || b.owner == null || b.owner === myOid || b.type === 'tank') rc = 0x9fe8a0;
      else if(b.owner != null && b.owner !== myOid && b.type === 'market'){
        const vt = VEHICLE_TYPES[vehicleRouteMode.vehicle.vtype];
        if(vt.resources.some(rr => b.sellTo?.[rr])) rc = 0xf0c060;
      }
    }
    const key = progPx + '|' + (showPop ? b.pop : -1) + (idle ? 'i' : '') + '|' + (sel ? 1 : 0) + '|' + ownerCol
      + '|' + (paused ? 1 : 0) + '|' + (lack ? 1 : 0) + '|' + (noWorkers ? workersRequiredOf(b) : -1)
      + '|' + (sale ? 1 : 0) + '|' + pass + (passFull ? 'f' : '') + '|' + rc;
    if(!RENDER_SAFE && s.b === b && s.geom === geom && s.key === key) return idx + 1;
    s.b = b; s.geom = geom; s.key = key;

    s.g.clear();
    for(const t of s.texts) t.visible = false;
    // barre de progression
    if(progPx >= 0){
      s.g.rect(tc[0]-bw/2, tc[1]+TH*0.36, bw, 4).fill({ color:0x000000, alpha:0.45 });
      if(progPx > 0) s.g.rect(tc[0]-bw/2, tc[1]+TH*0.36, progPx, 4).fill({ color:0x7fd96a });
    }
    // habitants : une seule pastille compacte (ambre s'il reste des inactifs),
    // masquée en vue éloignée pour ne pas surcharger la ville.
    if(showPop){
      const label = '👤' + b.pop;
      if(s.pop.text !== label) s.pop.text = label;
      const fill = idle ? 0xffd27a : 0xe8f4ff;
      if(s.pop.style.fill !== fill) s.pop.style.fill = fill;
      const py = tc[1] - TH * 0.62;
      const pw = s.pop.width + 10;
      s.g.roundRect(tc[0] - pw / 2, py - 7.5, pw, 15, 7).fill({ color:0x0c1420, alpha:0.68 });
      s.pop.position.set(tc[0], py); s.pop.visible = true;
    }
    // contour propriétaire (MP) + drapeau, ou sélection solo
    if(ownerCol != null){
      diamondPath(s.g, rx0, ry0, rw, rh, lift); s.g.stroke({ color:ownerCol, width: sel?3:1.5 });
      s.g.circle(tc[0]-TW*rw*0.28, tc[1]-4, 4).fill({ color:ownerCol });
    } else if(sel){
      diamondPath(s.g, rx0, ry0, rw, rh, lift); s.g.stroke({ color:0xffffff, width:2 });
    }
    // badge pausé (industrie en pause)
    if(paused){
      const px = tc[0]+TW*rw*0.24, py = tc[1]-TH*rh*0.32;
      s.g.circle(px, py, 14).fill({ color:0x000000, alpha:0.78 });
      s.g.circle(px, py, 11).fill({ color:0xffcc00 }).stroke({ color:0xffffff, width:2 });
      s.pause.text = 'Ⅱ'; s.pause.position.set(px, py); s.pause.visible = true;
    }
    // alerte : pas d'accès route/rail
    if(lack){ s.warn.text = '⚠️'; s.warn.position.set(tc[0], tc[1]-TH*0.95); s.warn.visible = true; }
    // alerte : usine du joueur sans aucun ouvrier (hors rayon des logements → bus)
    else if(noWorkers){
      const label = '👷 0/' + workersRequiredOf(b);
      if(s.work.text !== label) s.work.text = label;
      const py = tc[1] - TH * 0.95;
      const pw = s.work.width + 10;
      s.g.roundRect(tc[0] - pw / 2, py - 7.5, pw, 15, 7).fill({ color:0x3a0c0c, alpha:0.78 }).stroke({ color:0xff6b5a, width:1 });
      s.work.position.set(tc[0], py); s.work.visible = true;
    }
    // indicateur "en vente"
    if(sale){ s.sale.text = '$'; s.sale.position.set(tc[0]+TW*rw*0.3, tc[1]-3); s.sale.visible = true; }
    // passagers (arrêts de bus)
    if(pass >= 0){
      s.pass.text = '👥'+pass;
      s.pass.style.fill = passFull ? 0x7dd8ff : 0xa0c8e8;
      s.pass.position.set(tc[0], tc[1]-TH*0.75); s.pass.visible = true;
    }
    // surbrillance lors de l'assignation de route (traits pleins, sans pointillés)
    if(rc != null){ diamondPath(s.g, rx0, ry0, rw, rh, lift); s.g.stroke({ color:rc, width:1.5 }); }
    return idx + 1;
  }

  function updateBuildings(sortLayer, ovLayer){
    if(typeof buildings === 'undefined') return;
    const seen = new Set();
    let ovN = 0;
    // En fort dézoom les badges (habitants, ⚠️…) sont illisibles : on les coupe.
    const showOverlays = (cam.z || 1) >= 0.42;
    if(showOverlays) prepareSelection();
    prepareSigTail();
    for(const b of buildings){
      if(b.dead) continue;
      seen.add(b);
      const station = isTrainStationPiece(b);
      let node = bldNodes.get(b);
      // Culling grossier sur l'emprise iso (+ hauteur max/relief au-dessus). Les
      // gares sont dessinées en groupe depuis une pièce : marge plus large.
      const [r1x, r1y] = rotIdx(b.x, b.y);
      const [r2x, r2y] = rotIdx(b.x + b.w - 1, b.y + b.h - 1);
      const rx0 = Math.min(r1x, r2x), ry0 = Math.min(r1y, r2y);
      const rx1 = Math.max(r1x, r2x) + 1, ry1 = Math.max(r1y, r2y) + 1;
      const extra = station ? 8 : 0;
      const left = (rx0 - ry1 - extra) * TW2, right = (rx1 - ry0 + extra) * TW2;
      const top = (rx0 + ry0 - extra) * TH2 - 320, bottom = (rx1 + ry1 + extra) * TH2 + 24;
      const visible = right >= viewL && left <= viewR && bottom >= viewT && top <= viewB;
      if(!visible){ if(node) node.body.visible = false; continue; }
      const sig = station ? stationSig(b) : bldSig(b);
      if(!node){ node = { body:new PIXI.Sprite(), sig:null, geom:null, baked:null };
                 node.body.scale.set(1/SS); sortLayer.addChild(node.body); bldNodes.set(b, node); }
      if(node.sig !== sig){
        // mode diagnostic : corps propre à chaque bâtiment (état d'effectif) ;
        // gares : géométrie de groupe → pas de partage non plus
        const shareable = !station && !diagMode() && !RENDER_SAFE;
        let baked, geom, diag = false, shareKey = null;
        if(shareable) ({ key: shareKey, baked, geom } = acquireSharedBody(b, sig));
        else ({ baked, geom, diag } = station ? bakeStationPiece(b) : bakeBuildingBody(b));
        applyBaked(node.body, baked);
        releaseNodeBody(node);
        node.baked = baked; node.shareKey = shareKey;
        node.geom = geom; node.sig = sig; node.diag = diag; node.station = station;
        const R = liftedIso(geom.rx0, geom.ry0, geom.lift);
        node.body.position.set(R[0], R[1]);
        node.body.zIndex = buildingDepthKey(b);
      }
      node.body.visible = true;
      // Gares : contours/marqueurs déjà bakés. Sinon overlays live (sauf mode diagnostic).
      if(showOverlays && !station && !node.diag) ovN = drawBuildingOv(b, node.geom, ovLayer, ovN);
      if(b.type === 'air_tower') updateTowerRadar(b, node.geom, ovLayer);
    }
    // Radars de tour de contrôle : masquer ceux hors de vue, libérer ceux des tours disparues
    for(const [b, g] of towerRadars){
      if(!seen.has(b)){ g.destroy(); towerRadars.delete(b); }
    }
    // Bâtiments disparus (démolis, fusionnés, snapshot) : libérer sprite + texture.
    for(const [b, node] of bldNodes){
      if(seen.has(b)) continue;
      releaseNodeBody(node);
      node.body.destroy();
      bldNodes.delete(b);
    }
    for(let i = ovN; i < bldOvPool.length; i++){ const sl = bldOvPool[i]; sl.container.visible = false; sl.b = null; }
  }

  // --- Boucle par frame ---------------------------------------------------
  function update(){
    const layer = PixiScene.layers.sprites;
    const ov = PixiScene.layers.overlaysOver;
    if(!layer || typeof terrain === 'undefined') return;
    computeView();
    updateTrees(layer);
    updateTunnels(layer);
    updateBuildings(layer, ov);
    updateTrucks(layer);
    updateVehicles(layer, ov);
    updateWalkers(layer);
    updateHomeless(layer);
    updateVehicleRings(ov);
  }

  function init(){ PixiScene.onFrame(update); }
  // stats : diagnostic / tests (textures de bâtiments distinctes vs nœuds)
  return { init, bake, dirIndex, stats: () => ({ sharedBodies: sharedBodies.size, buildingNodes: bldNodes.size }) };
})();

if(typeof PixiScene !== 'undefined') PixiSprites.init();
