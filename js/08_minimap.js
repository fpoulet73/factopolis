// ---------- mini-carte ----------
// Vue d'ensemble isométrique (même orientation que la caméra) de la zone jouable :
// relief, eau, forêts, champs, routes, rails, bâtiments (couleur du propriétaire
// en multijoueur), trains en mouvement, et cadre de la vue courante. Un clic (ou
// glisser) recentre la caméra. Affichage activable dans le menu Panneaux.
const Minimap = (function(){
  const CW = 232, CH = 136;          // taille du canevas (px CSS)
  let panel = null, canvas = null, g = null;
  let tileCanvas = null, tileCtx = null, tileImg = null;
  let builtKey = '', lastBuildingsAt = 0, lastDraw = 0;
  let fit = null;                    // { cx, cy, k } : centre (tuiles) et échelle

  function ensureDom(){
    if(panel) return;
    panel = document.createElement('div');
    panel.id = 'minimapPanel';
    panel.className = 'panel';
    panel.style.cssText = 'right:12px;bottom:calc(12px + env(safe-area-inset-bottom));padding:6px;z-index:9;display:none;line-height:0';
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:'+CW+'px;height:'+CH+'px;cursor:pointer;display:block;border-radius:8px';
    panel.appendChild(canvas);
    document.body.appendChild(panel);
    g = canvas.getContext('2d');
    let dragging = false;
    const jump = e => {
      if(!fit) return;
      const r = canvas.getBoundingClientRect();
      const t = screenToTile(e.clientX - r.left, e.clientY - r.top);
      if(!t) return;
      camTracking = false;
      centerOn(t[0] * TILE, t[1] * TILE);
    };
    canvas.addEventListener('pointerdown', e => { dragging = true; canvas.setPointerCapture(e.pointerId); jump(e); e.preventDefault(); });
    canvas.addEventListener('pointermove', e => { if(dragging) jump(e); });
    canvas.addEventListener('pointerup', e => { dragging = false; try { canvas.releasePointerCapture(e.pointerId); } catch(_){} });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  // Transformation tuile monde (x,y) → pixel mini-carte, identique à la vue iso.
  function tileToScreen(x, y){
    const [u, v] = rotF(x, y);
    const [cu, cv] = rotF(fit.cx, fit.cy);
    const du = u - cu, dv = v - cv;
    return [CW / 2 + (du - dv) * fit.k, CH / 2 + (du + dv) * fit.k * (TH2 / TW2)];
  }
  function screenToTile(px, py){
    if(!fit) return null;
    const a = (px - CW / 2) / fit.k, b = (py - CH / 2) / (fit.k * (TH2 / TW2));
    const du = (a + b) / 2, dv = (b - a) / 2;
    const [cu, cv] = rotF(fit.cx, fit.cy);
    return invRotF(cu + du, cv + dv);
  }

  function computeFit(){
    const m = EXP_DEPTH;
    const x0 = Math.max(0, mapBounds.x0 - m), y0 = Math.max(0, mapBounds.y0 - m);
    const x1 = Math.min(N, mapBounds.x1 + m), y1 = Math.min(N, mapBounds.y1 + m);
    const w = x1 - x0, h = y1 - y0;
    // Diamant iso de la boîte : largeur (w+h)·k, hauteur (w+h)·k·TH2/TW2.
    const k = Math.min((CW - 8) / (w + h), (CH - 8) / ((w + h) * (TH2 / TW2)));
    fit = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, k, x0, y0, x1, y1 };
  }

  function tileColor(i, x, y){
    if(!mapMask || mapMask[i] !== 1) return null;
    const t = terrain[i];
    const lv = terrainHeightMap ? terrainHeightMap[i] : 0;
    if(t === T.WATER) return [52 - lv * 2, 130, 196];
    if(road[i]) return [96, 101, 109];
    if(rail[i]) return [86, 62, 40];
    const lift = Math.min(40, lv * 6);
    switch(t){
      case T.TREE:   return [44 + lift / 3, 106 + lift / 2, 46];
      case T.WHEAT:  return [196, 172, 76];
      case T.COTTON: return [226, 222, 204];
      case T.IRON:   return [176, 112, 70];
      case T.COAL:   return [62, 62, 70];
      case T.SAND:   return [214, 196, 132];
      case T.CLAY:   return [160, 110, 86];
      case T.COPPER: return [72, 150, 122];
      case T.GOLD:   return [232, 196, 64];
      case T.LIMESTONE: return [222, 218, 202];
      case T.OIL:    return [36, 30, 44];
    }
    return [92 + lift, 156 + lift / 2, 72 + lift / 3];
  }

  function buildingColor(b){
    if(b.owner != null && MP.connected) return playerColor(b.owner);
    const d = BUILD[b.type];
    if(d?.resid) return '#e8a35a';
    if(d?.ind) return '#c0613c';
    if(isTrainStationPiece(b) || b.type === 'train_depot') return '#e8d27a';
    if(isVehicleDepot(b)) return '#5aa2e8';
    return '#cfd5da';
  }

  function rebuildTiles(){
    if(!tileCanvas){ tileCanvas = document.createElement('canvas'); }
    if(tileCanvas.width !== N || tileCanvas.height !== N){
      tileCanvas.width = N; tileCanvas.height = N;
      tileCtx = tileCanvas.getContext('2d');
      tileImg = tileCtx.createImageData(N, N);
    }
    const data = tileImg.data;
    for(let i = 0; i < N * N; i++){
      const c = tileColor(i, i % N, (i / N) | 0);
      const o = i * 4;
      if(!c){ data[o] = 14; data[o + 1] = 20; data[o + 2] = 30; data[o + 3] = 255; continue; }
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
    }
    tileCtx.putImageData(tileImg, 0, 0);
    // bâtiments par-dessus (1 px par tuile couverte)
    for(const b of buildings){
      if(b.dead) continue;
      tileCtx.fillStyle = buildingColor(b);
      tileCtx.fillRect(b.x, b.y, b.w || 1, b.h || 1);
    }
  }

  function draw(){
    if(!panel || panel.style.display === 'none') return;
    const now = performance.now();
    if(now - lastDraw < 120) return;     // ~8 images/s suffisent
    lastDraw = now;
    const dpr = window.devicePixelRatio || 1;
    if(canvas.width !== Math.round(CW * dpr)){ canvas.width = Math.round(CW * dpr); canvas.height = Math.round(CH * dpr); }
    const key = N + '|' + terrainVersion + '|' + groundVersion + '|' + railVersion + '|' + buildings.length + '|' + mapBounds.x0 + ',' + mapBounds.y0 + ',' + mapBounds.x1 + ',' + mapBounds.y1;
    if(key !== builtKey || now - lastBuildingsAt > 3000){
      rebuildTiles();
      builtKey = key; lastBuildingsAt = now;
    }
    computeFit();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0b1018';
    g.fillRect(0, 0, CW, CH);
    // image tuiles projetée en iso : centre → rotation (rot) → 45° → aplatissement
    g.save();
    g.translate(CW / 2, CH / 2);
    g.scale(fit.k * Math.SQRT2, fit.k * Math.SQRT2 * (TH2 / TW2));
    g.rotate(Math.PI / 4);
    g.rotate(-rot * Math.PI / 2);
    g.translate(-fit.cx, -fit.cy);
    g.imageSmoothingEnabled = false;
    g.drawImage(tileCanvas, 0, 0);
    g.restore();
    // trains en mouvement
    g.fillStyle = '#ffffff';
    for(const v of vehicles){
      if(v.state === 'idle') continue;
      const p = vehicleWorldPos(v);
      if(!p) continue;
      const [sx, sy] = tileToScreen(p.x / TILE, p.y / TILE);
      g.fillStyle = v.vtype === 'train' ? '#ffffff' : (VEHICLE_TYPES[v.vtype]?.mode === 'air' ? '#7fd8ff' : '#ffe082');
      g.fillRect(sx - 1.5, sy - 1.5, 3, 3);
    }
    // cadre de la vue courante
    const z = cam.z || 1;
    const corners = [[0, 0], [W, 0], [W, H], [0, H]].map(([px, py]) => {
      const ix = cam.x + px / z, iy = cam.y + py / z;
      const u = (ix / TW2 + iy / TH2) / 2, v = (iy / TH2 - ix / TW2) / 2;
      const [tx, ty] = invRotF(u, v);
      return tileToScreen(tx, ty);
    });
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1.2;
    g.beginPath();
    corners.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
    g.closePath(); g.stroke();
  }

  function setVisible(on){
    ensureDom();
    panel.style.display = on ? 'block' : 'none';
    lastDraw = 0;
  }

  return { draw, setVisible, ensureDom };
})();
