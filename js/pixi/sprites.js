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
    return { texture: PIXI.Texture.from(oc), ax, ay, w, h };
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
  let treePool = [];
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
    treeBuiltVersion = terrainVersion; treeBuiltRot = rot; treeBuiltN = N;
  }

  function updateTrees(layer){
    if(!treeTex) bakeTrees();
    if(treeBuiltVersion !== terrainVersion || treeBuiltRot !== rot || treeBuiltN !== N)
      rebuildTrees(layer);
  }

  // --- Bouches de tunnel (demi-cylindre baké par direction) ---------------
  // Une bouche par arête rail↔tunnel. Texture bakée par direction écran (dirIndex)
  // via drawTunnelPortalCore ; sprite posé sur l'arête basse réelle (niveau tuile
  // plate). zIndex biaisé au-dessus des trains → un train « disparaît » sous l'arche.
  const TUN = { w:128, h:112, ax:64, ay:70 };
  const tunnelTexCache = new Map(); // dirIndex -> baked
  let tunnelPool = [];
  let tunnelBuiltVersion = -1, tunnelBuiltRot = -1, tunnelBuiltN = -1, tunnelBuiltPack = '';
  function tunnelStyle(){
    const grass = graphicBasePack()?.grass || [];
    return {
      opening: '#13181d',
      roof: grass[Math.min(1, Math.max(0, grass.length - 1))] || grass[0] || '#6fa44a',
      stone: '#6f7780',
    };
  }
  function tunnelTexture(du, dv){
    const style = tunnelStyle();
    const key = [dirIndex(du, dv), style.roof, style.stone].join(':');
    let t = tunnelTexCache.get(key);
    if(t) return t;
    const [cx, cy] = tunnelPortalAnchor(du, dv);
    t = bake(TUN.w, TUN.h, TUN.ax, TUN.ay, cx, cy,
             () => drawTunnelPortalCore(du, dv, style.opening, style.roof, style.stone));
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
        const [du, dv] = rotDir(def.dx, def.dy);
        const [sx, sy] = iso(du, dv);
        // Arête basse réelle : centre tuile plate (côté rail = -d) + demi-pas vers pente.
        const fux = x - def.dx, fuy = y - def.dy;
        let px, py;
        if(inMap(fux, fuy)){
          const fc = tileCenterIso(rx - du, ry - dv, fux, fuy);
          px = fc[0] + sx * 0.5; py = fc[1] + sy * 0.5;
        } else {
          const c = tileCenterIso(rx, ry, x, y);
          px = c[0] - sx * 0.5; py = c[1] - sy * 0.5;
        }
        const s = getPool(tunnelPool, n, layer);
        applyBaked(s, tunnelTexture(du, dv));
        s.visible = true;
        s.position.set(px, py);
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
  };
  const dirCache = { truck:new Map(), car:new Map(), loco:new Map(), wagon:new Map() };

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
  function placeDir(pool, n, layer, kind, coreFn, col, u, v, du, dv, depthBias){
    const s = getPool(pool, n, layer);
    applyBaked(s, dirTextures(kind, coreFn, col)[dirIndex(du, dv)]);
    s.visible = true;
    const pos = entityIso(u, v);
    s.position.set(pos[0], pos[1]);
    s.zIndex = spriteDepthKey(u, v, depthBias);
    return n + 1;
  }

  let truckPool = [], carPool = [], locoPool = [], wagonPool = [];
  function updateTrucks(layer){
    if(typeof trucks === 'undefined') return;
    let n = 0;
    for(const tk of trucks){
      const p = truckPose(tk); if(!p) continue;
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
    let nc = 0, nl = 0, nw = 0, nov = 0;
    for(const veh of vehicles){
      const rs = typeof mpVehicleRenderState === 'function' ? mpVehicleRenderState(veh) : veh;
      if(veh.state === 'idle' || !rs.pts || !rs.pts.length) continue;
      if(veh.vtype === 'train'){
        for(let i = 0; i < (veh.wagons?.length || 0); i++){
          const wp = trainWagonPose(veh, i); if(!wp) continue;
          const wagon = veh.wagons[i];
          nw = placeDir(wagonPool, nw, layer, 'wagon', drawWagonCore, trainWagonDef(wagon)?.color || '#888', wp.u, wp.v, wp.du, wp.dv, 0.52);
          // badge ressource sélectionnée
          const selRes = typeof trainWagonSelectedResource === 'function' ? trainWagonSelectedResource(wagon) : null;
          if(selRes && RES[selRes]?.ic){
            const c = entityIso(wp.u, wp.v), by = c[1]-11, s = getVehOv(ovLayer, nov++);
            s.g.ellipse(c[0], by, 8.5, 7).fill({ color:0x0c1826, alpha:0.92 }).stroke({ color: RES[selRes].c || '#ffe082', width:1.2 });
            s.label.text = RES[selRes].ic; s.label.position.set(c[0], by+0.5); s.label.visible = true;
          }
        }
        const tp = trainPose(veh); if(!tp) continue;
        nl = placeDir(locoPool, nl, layer, 'loco', drawTrainLocoCore, vehicleColor(veh), tp.u, tp.v, tp.du, tp.dv, 0.52);
      } else {
        const p = vehiclePose(veh); if(!p) continue;
        const vt = VEHICLE_TYPES[veh.vtype];
        nc = placeDir(carPool, nc, layer, 'car', drawCarCore, vt.color, p.u, p.v, p.du, p.dv, 0.52);
        if(veh.cargo > 0){
          const c = entityIso(p.u, p.v), s = getVehOv(ovLayer, nov++);
          s.label.text = vt.icone + ' ' + veh.cargo; s.label.position.set(c[0], c[1]-TH); s.label.visible = true;
        }
      }
    }
    hidePool(carPool, nc); hidePool(locoPool, nl); hidePool(wagonPool, nw);
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
      n = placeWalker(walkerPool, n, layer, wk.col, p, 0.6); }
    hidePool(walkerPool, n);
  }
  function updateHomeless(layer){
    if(typeof homeless === 'undefined') return;
    let n = 0;
    for(const h of homeless){ const p = homelessPose(h);
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
  const bldNodes = new Map();   // b → { body, sig, geom, baked }
  const bldOvPool = [];         // slots d'overlays réutilisés chaque frame

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
  function bldSelected(b){ return b === selected || (typeof trainStationSelectionMatches === 'function' && trainStationSelectionMatches(selected, b)); }

  // Signature de ce qui affecte le CORPS (pas les overlays dynamiques). En mode
  // diagnostic, le corps EST le diagnostic (+ contour blanc si sélectionné) → on
  // inclut ces états.
  function bldSig(b){
    const diag = diagMode();
    return [b.type, b.w, b.h, b.ore||'', b.owner==null?'':b.owner, b.paused?1:0,
      rot, (typeof UI_OPTIONS!=='undefined' ? UI_OPTIONS.graphicPack : ''),
      GRAPHIC_PACK_IMAGES_GEN, diag?1:0, (diag && bldSelected(b))?1:0].join('|');
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
    return [b.type, b.owner==null?'':b.owner, rot, terrainVersion + '.' + railVersion,
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

  function drawBuildingOv(b, geom, ovLayer, idx){
    const d = BUILD[b.type];
    const { tc, rx0, ry0, rw, rh, lift } = geom;
    let s = bldOvPool[idx];
    if(!s){ s = makeOvSlot(ovLayer); bldOvPool[idx] = s; }
    s.container.visible = true;
    s.g.clear();
    for(const t of s.texts) t.visible = false;

    // barre de progression
    const r = recipeOf(b);
    const prog = typeof buildingRenderProg === 'function' ? buildingRenderProg(b) : (b.prog||0);
    if(r && prog > 0){
      const bw = TW*0.42*b.w;
      s.g.rect(tc[0]-bw/2, tc[1]+TH*0.36, bw, 4).fill({ color:0x000000, alpha:0.45 });
      s.g.rect(tc[0]-bw/2, tc[1]+TH*0.36, bw*Math.min(1, prog/r.time), 4).fill({ color:0x7fd96a });
    }
    // habitants
    if(d.resid && b.pop > 0){
      s.pop.text = '👤'+b.pop; s.pop.position.set(tc[0], tc[1]-TH*0.55); s.pop.visible = true;
      if((b.workersIdle||0) > 0){
        s.work.text = '💤'+b.workersIdle; s.work.position.set(tc[0], tc[1]-TH*0.32); s.work.visible = true;
      }
    }
    // contour propriétaire (MP) + drapeau, ou sélection solo
    const sel = (b===selected || (typeof trainStationSelectionMatches==='function' && trainStationSelectionMatches(selected,b)));
    if(!(typeof UI_OPTIONS!=='undefined' && UI_OPTIONS.hideColorMarkers) && b.owner){
      const col = playerColor(b.owner);
      diamondPath(s.g, rx0, ry0, rw, rh, lift); s.g.stroke({ color:col, width: sel?3:1.5 });
      s.g.circle(tc[0]-TW*rw*0.28, tc[1]-4, 4).fill({ color:col });
    } else if(sel){
      diamondPath(s.g, rx0, ry0, rw, rh, lift); s.g.stroke({ color:0xffffff, width:2 });
    }
    // badge pausé (industrie en pause)
    if(d.ind && b.paused){
      const px = tc[0]+TW*rw*0.24, py = tc[1]-TH*rh*0.32;
      s.g.circle(px, py, 14).fill({ color:0x000000, alpha:0.78 });
      s.g.circle(px, py, 11).fill({ color:0xffcc00 }).stroke({ color:0xffffff, width:2 });
      s.pause.text = 'Ⅱ'; s.pause.position.set(px, py); s.pause.visible = true;
    }
    // alerte : pas d'accès route/rail
    const lacksRoad = b.type !== 'train_depot' && typeof adjRoadTiles === 'function' && !adjRoadTiles(b).length;
    const lacksRail = b.type === 'train_depot' && typeof adjRailTiles === 'function' && !adjRailTiles(b).length;
    if(lacksRoad || lacksRail){ s.warn.text = '⚠️'; s.warn.position.set(tc[0], tc[1]-TH*0.95); s.warn.visible = true; }
    // indicateur "en vente"
    if(BUILD[b.type]?.storageHub && b.type !== 'tank' && b.sellTo && Object.values(b.sellTo).some(v=>v)){
      s.sale.text = '$'; s.sale.position.set(tc[0]+TW*rw*0.3, tc[1]-3); s.sale.visible = true;
    }
    // passagers (arrêts de bus)
    if(b.type === 'bus_stop' && (b.passengersMax||0) > 0){
      const pDisp = Math.floor(b.passengers||0);
      s.pass.text = '👥'+pDisp;
      s.pass.style.fill = pDisp < (b.passengersMax||0) ? 0xa0c8e8 : 0x7dd8ff;
      s.pass.position.set(tc[0], tc[1]-TH*0.75); s.pass.visible = true;
    }
    // surbrillance lors de l'assignation de route (traits pleins, sans pointillés)
    if(typeof vehicleRouteMode !== 'undefined' && vehicleRouteMode
       && typeof vehicleRouteEndpointOk === 'function' && vehicleRouteEndpointOk(b)){
      const isBus = vehicleRouteMode.vehicle?.vtype === 'bus';
      const myOid = (typeof MP !== 'undefined' && MP.connected) ? MP.myId : null;
      let rc = null;
      if(isBus) rc = 0x7dd8ff;
      else if(vehicleRouteMode.step === 'dest' || b.owner == null || b.owner === myOid || b.type === 'tank') rc = 0x9fe8a0;
      else if(b.owner != null && b.owner !== myOid && b.type === 'market'){
        const vt = VEHICLE_TYPES[vehicleRouteMode.vehicle.vtype];
        if(vt.resources.some(rr => b.sellTo?.[rr])) rc = 0xf0c060;
      }
      if(rc != null){ diamondPath(s.g, rx0, ry0, rw, rh, lift); s.g.stroke({ color:rc, width:1.5 }); }
    }
    return idx + 1;
  }

  function updateBuildings(sortLayer, ovLayer){
    if(typeof buildings === 'undefined') return;
    const seen = new Set();
    let ovN = 0;
    for(const b of buildings){
      if(b.dead) continue;
      seen.add(b);
      const station = isTrainStationPiece(b);
      let node = bldNodes.get(b);
      const sig = station ? stationSig(b) : bldSig(b);
      if(!node){ node = { body:new PIXI.Sprite(), sig:null, geom:null };
                 node.body.scale.set(1/SS); sortLayer.addChild(node.body); bldNodes.set(b, node); }
      if(node.sig !== sig){
        const { baked, geom, diag } = station ? bakeStationPiece(b) : bakeBuildingBody(b);
        applyBaked(node.body, baked);
        node.geom = geom; node.sig = sig; node.diag = diag; node.station = station;
        const R = liftedIso(geom.rx0, geom.ry0, geom.lift);
        node.body.position.set(R[0], R[1]);
        node.body.zIndex = buildingDepthKey(b);
      }
      node.body.visible = true;
      // Gares : contours/marqueurs déjà bakés. Sinon overlays live (sauf mode diagnostic).
      if(!station && !node.diag) ovN = drawBuildingOv(b, node.geom, ovLayer, ovN);
    }
    for(const [b, node] of bldNodes){ if(!seen.has(b)) node.body.visible = false; }
    for(let i = ovN; i < bldOvPool.length; i++) bldOvPool[i].container.visible = false;
  }

  // --- Boucle par frame ---------------------------------------------------
  function update(){
    const layer = PixiScene.layers.sprites;
    const ov = PixiScene.layers.overlaysOver;
    if(!layer || typeof terrain === 'undefined') return;
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
  return { init, bake, dirIndex };
})();

if(typeof PixiScene !== 'undefined') PixiSprites.init();
