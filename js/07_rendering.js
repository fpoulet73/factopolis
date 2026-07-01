function addFloat(x,y,txt,col){
  if(floats.length > 60) return;
  floats.push({ x:x*TILE+TILE/2, y:y*TILE, txt, col, life:1.3 });
}

// ---------- rendu isométrique ----------
function hash(x,y){ return ((x*73856093) ^ (y*19349663)) >>> 0; }

function liftedIso(u, v, lift){
  const c = iso(u, v);
  return [c[0], c[1] - (lift || 0)];
}

function tileCenterIso(rx, ry, x, y){
  return liftedIso(rx + 0.5, ry + 0.5, terrainLiftPxAt(x, y));
}

function entityIso(u, v){
  return liftedIso(u, v, terrainLiftPxAtRot(u, v));
}

function terrainTilePoints(rx, ry, x, y){
  const h = terrain[y * N + x] === T.WATER
    ? (() => {
        const wl = waterLevelAt(x, y);
        return { nw:wl, ne:wl, se:wl, sw:wl };
      })()
    : terrainTileCornerLevels(x, y);
  const step = terrainReliefStepPx();
  return {
    A: liftedIso(rx, ry, h.nw * step),
    B: liftedIso(rx + 1, ry, h.ne * step),
    C: liftedIso(rx + 1, ry + 1, h.se * step),
    D: liftedIso(rx, ry + 1, h.sw * step),
  };
}

function pathTilePoints(p){
  ctx.beginPath();
  ctx.moveTo(p.A[0], p.A[1]);
  ctx.lineTo(p.B[0], p.B[1]);
  ctx.lineTo(p.C[0], p.C[1]);
  ctx.lineTo(p.D[0], p.D[1]);
  ctx.closePath();
}

function tilePolygon(rx, ry, x, y){
  const p = terrainTilePoints(rx, ry, x, y);
  pathTilePoints(p);
  return p;
}

function drawWaterBankFaces(rx, ry, x, y, t, snowAmount){
  if(t === T.WATER) return;
  const p = terrainTilePoints(rx, ry, x, y);
  const bank = cliffColorForTile(t, snowAmount > 0.55);

  if(ry < N - 1){
    const [nx, ny] = invRotIdx(rx, ry + 1);
    if(nx >= 0 && ny >= 0 && nx < N && ny < N && terrain[ny * N + nx] === T.WATER){
      const wl = waterLevelAt(nx, ny) * terrainReliefStepPx();
      const wC = liftedIso(rx + 1, ry + 1, wl);
      const wD = liftedIso(rx, ry + 1, wl);
      if(Math.abs(p.C[1] - wC[1]) > 0.5 || Math.abs(p.D[1] - wD[1]) > 0.5){
        ctx.fillStyle = shade(bank, -0.15);
        quad(p.C, p.D, wD, wC);
      }
    }
  }
  if(rx < N - 1){
    const [nx, ny] = invRotIdx(rx + 1, ry);
    if(nx >= 0 && ny >= 0 && nx < N && ny < N && terrain[ny * N + nx] === T.WATER){
      const wl = waterLevelAt(nx, ny) * terrainReliefStepPx();
      const wB = liftedIso(rx + 1, ry, wl);
      const wC = liftedIso(rx + 1, ry + 1, wl);
      if(Math.abs(p.B[1] - wB[1]) > 0.5 || Math.abs(p.C[1] - wC[1]) > 0.5){
        ctx.fillStyle = shade(bank, -0.35);
        quad(p.B, p.C, wC, wB);
      }
    }
  }
}

// --- Poissons dans les lacs ---
let _fishTilesCache = null, _fishTerrainRef = null, _fishGroundVersion = -1;

function computeFishTiles(){
  const SHORE_MAX = (CFG.lac?.poissonRayon ?? 4) | 0;
  const THRESH    = Math.round((CFG.lac?.poissonPct ?? 0.05) * 256);
  const fish = new Set();
  for(let y = 0; y < N; y++){
    for(let x = 0; x < N; x++){
      if(terrain[y*N+x] !== T.WATER) continue;
      let near = false;
      outer: for(let dy = -SHORE_MAX; dy <= SHORE_MAX; dy++){
        for(let dx = -SHORE_MAX; dx <= SHORE_MAX; dx++){
          if(Math.abs(dx)+Math.abs(dy) > SHORE_MAX) continue;
          const nx = x+dx, ny = y+dy;
          if(nx < 0 || ny < 0 || nx >= N || ny >= N){ near = true; break outer; }
          if(terrain[ny*N+nx] !== T.WATER){ near = true; break outer; }
        }
      }
      if(near && (hash(x, y) & 0xFF) < THRESH) fish.add(y*N+x);
    }
  }
  return fish;
}

function getFishTiles(){
  if(_fishTerrainRef !== terrain || _fishGroundVersion !== groundVersion){
    _fishTilesCache = computeFishTiles();
    _fishTerrainRef = terrain;
    _fishGroundVersion = groundVersion;
  }
  return _fishTilesCache;
}

function drawFishOnTile(rx, ry, x, y){
  const c = tileCenterIso(rx, ry, x, y);
  const hs = hash(x, y);
  ctx.save();
  for(let k = 0; k < 3; k++){
    const k5 = k * 5;
    const px = c[0] + (((hs >> k5)     & 15) / 15 * TW * 0.54 - TW * 0.27);
    const py = c[1] + (((hs >> (k5+4)) &  7) /  7 * TH * 0.50 - TH * 0.25);
    const sz = 2.6 + ((hs >> (k5+8)) & 3) * 0.45;
    const dir = ((hs >> (k5+13)) & 1) ? 1 : -1;

    // queue
    ctx.fillStyle = 'rgba(150,205,240,0.80)';
    ctx.beginPath();
    ctx.moveTo(px - dir * sz * 0.85, py);
    ctx.lineTo(px - dir * sz * 1.65, py - sz * 0.55);
    ctx.lineTo(px - dir * sz * 1.65, py + sz * 0.55);
    ctx.closePath();
    ctx.fill();

    // corps
    ctx.fillStyle = 'rgba(195,228,255,0.88)';
    ctx.beginPath();
    ctx.ellipse(px, py, sz, sz * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    // oeil
    ctx.fillStyle = 'rgba(10,30,55,0.85)';
    ctx.beginPath();
    ctx.arc(px + dir * sz * 0.45, py, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

const _shadeCache = {};
function shade(hex,f){
  const k = hex+f;
  let c = _shadeCache[k];
  if(c) return c;
  const n = parseInt(hex.slice(1),16);
  let r = n>>16&255, g = n>>8&255, b = n&255;
  if(f>=0){ r += (255-r)*f; g += (255-g)*f; b += (255-b)*f; }
  else    { r *= 1+f; g *= 1+f; b *= 1+f; }
  return _shadeCache[k] = 'rgb('+(r|0)+','+(g|0)+','+(b|0)+')';
}

function quad(a,b,c,d){
  ctx.beginPath();
  ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]);
  ctx.lineTo(c[0],c[1]); ctx.lineTo(d[0],d[1]);
  ctx.closePath(); ctx.fill();
}

// Prisme isométrique orienté selon la direction (du,dv) en tuiles iso.
// Contrairement à prism(), la boîte suit le sens du train (rotation réelle).
function trainPrism(u, v, du, dv, halfLen, halfWid, hp, col, lift){
  lift = lift || 0;
  const d = Math.hypot(du, dv) || 1;
  const fn = du/d, fv = dv/d;    // vecteur unitaire avant
  const rn = fv,  rv = -fn;      // perpendiculaire droite (rotation CW 90°)

  const FR = [u + fn*halfLen + rn*halfWid, v + fv*halfLen + rv*halfWid];
  const FL = [u + fn*halfLen - rn*halfWid, v + fv*halfLen - rv*halfWid];
  const BL = [u - fn*halfLen - rn*halfWid, v - fv*halfLen - rv*halfWid];
  const BR = [u - fn*halfLen + rn*halfWid, v - fv*halfLen + rv*halfWid];

  const bot = ([iu,iv]) => { const [sx,sy]=iso(iu,iv); return [sx, sy-lift]; };
  const top = ([iu,iv]) => { const [sx,sy]=iso(iu,iv); return [sx, sy-lift-hp]; };

  const bf=bot(FR), bfl=bot(FL), bbl=bot(BL), bbr=bot(BR);
  const tf=top(FR), tfl=top(FL), tbl=top(BL), tbr=top(BR);

  // Teinte selon la normale : +u → claire (-0.22), +v → sombre (-0.45)
  const shadeFor = (nx, ny) => {
    const pu=Math.max(0,nx), pv=Math.max(0,ny), t=pu+pv+1e-6;
    return -0.22*pu/t - 0.45*pv/t;
  };

  // Faces latérales visibles (normale · (1,1) > 0), triées arrière→avant
  const faces = [];
  const addF = (p1,p2,p3,p4,nx,ny) => { if(nx+ny > 1e-6) faces.push({p1,p2,p3,p4,nx,ny}); };
  addF(bf,  bfl, tfl, tf,   fn,  fv);   // avant
  addF(bbr, bf,  tf,  tbr,  rn,  rv);   // droite
  addF(bfl, bbl, tbl, tfl, -rn, -rv);   // gauche
  addF(bbl, bbr, tbr, tbl, -fn, -fv);   // arrière
  faces.sort((a,b) => (a.nx+a.ny) - (b.nx+b.ny) || a.ny - b.ny);
  for(const f of faces){
    ctx.fillStyle = shade(col, shadeFor(f.nx, f.ny));
    quad(f.p1, f.p2, f.p3, f.p4);
  }
  // Toit
  ctx.fillStyle = shade(col, 0.20);
  quad(tf, tfl, tbl, tbr);
  // Contour du toit
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(...tf); ctx.lineTo(...tfl); ctx.lineTo(...tbl); ctx.lineTo(...tbr);
  ctx.closePath(); ctx.stroke();
}

// prisme iso : base [u0,v0]-[u1,v1] (tuiles tournées), hauteur hp px, surélévation lift
// renvoie le centre du toit
function prism(u0,v0,u1,v1,hp,col,lift){
  lift = lift||0;
  const lf = p=> [p[0], p[1]-lift];
  const A = lf(iso(u0,v0)), B = lf(iso(u1,v0)), C = lf(iso(u1,v1)), D = lf(iso(u0,v1));
  const up = p=> [p[0], p[1]-hp];
  ctx.fillStyle = shade(col,-0.22); quad(B,C,up(C),up(B));        // face droite
  ctx.fillStyle = shade(col,-0.45); quad(C,D,up(D),up(C));        // face gauche
  ctx.fillStyle = shade(col, 0.20); quad(up(A),up(B),up(C),up(D)); // toit
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(...up(A)); ctx.lineTo(...up(B)); ctx.lineTo(...up(C)); ctx.lineTo(...up(D));
  ctx.closePath(); ctx.stroke();
  return [ (A[0]+C[0])/2, (A[1]+C[1])/2 - hp ];
}

function diamond(rx,ry,w,h){
  w = w||1; h = h||w;
  const lift = arguments[4] || 0;
  const A = liftedIso(rx, ry, lift), B = liftedIso(rx+w, ry, lift), C = liftedIso(rx+w, ry+h, lift), D = liftedIso(rx, ry+h, lift);
  ctx.beginPath();
  ctx.moveTo(A[0],A[1]); ctx.lineTo(B[0],B[1]);
  ctx.lineTo(C[0],C[1]); ctx.lineTo(D[0],D[1]);
  ctx.closePath();
}

function spriteDepthKey(u,v,bias){
  return (u+v)*4096 + (v-u) + (bias||0);
}

function buildingDepthKey(b){
  // Les quais sont au niveau du sol. Les dessiner avant tous les véhicules
  // empêche une extrémité de quai de masquer un train situé plus loin.
  if(b.type === 'train_platform') return -1e12;
  // Une gare multi-tuiles (plusieurs pièces 'train_station' groupées) est dessinée
  // d'un bloc par sa première pièce, à la taille de tout le groupe (cf.
  // drawTrainStationPiece). Trier sur la seule tuile de cette pièce sous-estimerait
  // la profondeur du bâtiment côté opposé, le faisant passer derrière des bâtiments
  // voisins (ex. entrepôt) qui devraient au contraire être masqués par lui.
  if(b.type === 'train_station'){
    const bounds = trainStationGroupBounds(b.stationGroupId, 'train_station');
    if(bounds) return spriteDepthKey(bounds.rx0+bounds.rw*0.5, bounds.ry0+bounds.rh*0.5, 0.2);
  }
  const [r1x,r1y] = rotIdx(b.x, b.y);
  const [r2x,r2y] = rotIdx(b.x+b.w-1, b.y+b.h-1);
  const rx0 = Math.min(r1x,r2x), ry0 = Math.min(r1y,r2y);
  const rw = Math.abs(r1x-r2x)+1, rh = Math.abs(r1y-r2y)+1;
  return spriteDepthKey(rx0+rw*0.5, ry0+rh*0.5, 0.2);
}

function graphicPack(){
  return GRAPHIC_PACKS[UI_OPTIONS.graphicPack] || GRAPHIC_PACKS.classic;
}

function graphicBasePack(){
  const p = graphicPack();
  return GRAPHIC_PACKS[p.fallback] || p;
}

function packTerrain(kind, x, y){
  const p = graphicBasePack();
  const cols = kind === T.WATER ? p.water
    : kind === T.SAND ? (p.sand || p.grass)
    : kind === T.CLAY ? (p.clay || p.grass)
    : p.grass;
  return cols[hash(x,y) % cols.length];
}

function snowAmountForTile(x, y){
  const cfg = reliefCfg();
  if(!cfg.enabled) return 0;
  const level = terrainLevelAt(x, y);
  if(level < cfg.snowLevel) return 0;
  const depth = Math.max(1, cfg.levels - cfg.snowLevel + 1);
  const base = (level - cfg.snowLevel + 1) / depth;
  const grain = (((hash(x + 17, y - 11) >>> 8) & 255) / 255 - 0.5) * cfg.snowBlend;
  return Math.max(0.15, Math.min(1, base + grain));
}

function cliffColorForTile(t, snowy){
  if(snowy) return '#d8e2ea';
  if(t === T.WATER) return '#1c557f';
  if(t === T.SAND) return '#b28f5a';
  if(t === T.CLAY) return '#7b4e3a';
  return '#6f5236';
}

function packBuildingColor(b, d){
  const p = graphicBasePack();
  if(b.type === 'mine' && b.ore) return b.ore === 'iron' ? '#8a5c3a' : '#4a4a5a';
  // Le dépôt de train prend la couleur du joueur, comme les gares et les rails.
  if(b.type === 'train_depot' && b.owner) return playerColor(b.owner);
  if(p.buildings && p.buildings[b.type]) return p.buildings[b.type];
  if(BUILD[b.type]?.transportDepot && p.category?.transport) return p.category.transport;
  if(d.resid && p.category?.resid) return p.category.resid;
  if(d.ind && p.category?.ind) return p.category.ind;
  if(BUILD[b.type]?.storageHub && p.category?.storage)
    return p.category.storage;
  return d.col;
}

function drawRoofAccent(rx0, ry0, rw, rh, hp, col, b, d, lift){
  if(drawFast) return;
  const style = graphicBasePack().roof;
  if(style === 'flat') return;
  const A = liftedIso(rx0, ry0, lift), B = liftedIso(rx0+rw, ry0, lift), C = liftedIso(rx0+rw, ry0+rh, lift), D = liftedIso(rx0, ry0+rh, lift);
  const up = p => [p[0], p[1]-hp];
  const TA = up(A), TB = up(B), TC = up(C), TD = up(D);
  const lerp = (P,Q,t) => [P[0]+(Q[0]-P[0])*t, P[1]+(Q[1]-P[1])*t];
  const line = (P,Q,stroke,width,alpha) => {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width || 1;
    ctx.beginPath(); ctx.moveTo(P[0],P[1]); ctx.lineTo(Q[0],Q[1]); ctx.stroke();
    ctx.restore();
  };

  if(style === 'tiles' && d.resid){
    const n = Math.max(2, Math.min(6, rw + rh + 1));
    for(let i=1; i<n; i++){
      const t = i/n;
      line(lerp(TA, TD, t), lerp(TB, TC, t), shade(col, -0.18), 0.8, 0.65);
    }
    line(lerp(TA, TB, 0.5), lerp(TD, TC, 0.5), shade(col, 0.32), 1.2, 0.5);
    return;
  }

  if(style === 'glass' && d.resid){
    const m1 = lerp(lerp(TA, TB, 0.18), lerp(TD, TC, 0.18), 0.18);
    const m2 = lerp(lerp(TA, TB, 0.82), lerp(TD, TC, 0.82), 0.18);
    const m3 = lerp(lerp(TA, TB, 0.82), lerp(TD, TC, 0.82), 0.82);
    const m4 = lerp(lerp(TA, TB, 0.18), lerp(TD, TC, 0.18), 0.82);
    ctx.save();
    ctx.fillStyle = 'rgba(170,225,255,.22)';
    quad(m1,m2,m3,m4);
    ctx.strokeStyle = 'rgba(215,245,255,.35)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
    return;
  }

  if(style === 'vents' && d.ind){
    const count = Math.min(4, Math.max(1, rw * rh));
    for(let i=0; i<count; i++){
      const t = (i+1)/(count+1);
      const base = lerp(lerp(TA, TB, 0.62), lerp(TD, TC, 0.62), t);
      ctx.fillStyle = shade(col, -0.38);
      ctx.fillRect(base[0]-3, base[1]-5, 6, 5);
      ctx.fillStyle = 'rgba(180,190,190,.34)';
      ctx.beginPath(); ctx.ellipse(base[0]+2, base[1]-8, 5, 2, 0, 0, 7); ctx.fill();
    }
  }
}

function spriteForBuilding(b, rw, rh){
  const pack = graphicPack();
  if(pack.mode !== 'sprite' || !pack.buildings) return null;
  const def = pack.buildings[b.type];
  if(!def) return null;
  const sizeKey = b.w + 'x' + b.h;
  const rotSizeKey = rw + 'x' + rh;
  const areaKey = 'area:' + (b.w * b.h);
  let matchedKey = null;
  if(def.variants){
    const variant = def.variants[sizeKey] && (matchedKey = sizeKey, def.variants[sizeKey])
      || def.variants[rotSizeKey] && (matchedKey = rotSizeKey, def.variants[rotSizeKey])
      || def.variants[areaKey] && (matchedKey = areaKey, def.variants[areaKey])
      || def.variants[String(b.w * b.h)] && (matchedKey = String(b.w * b.h), def.variants[String(b.w * b.h)])
      || def.variants.default && (matchedKey = 'default', def.variants.default)
      || null;
    if(variant){
      const base = viewForSprite(Object.assign({}, def, variant, { variants:undefined }));
      return _annotateDesignSize(base, matchedKey);
    }
  }
  return _annotateDesignSize(viewForSprite(def), null);
}

function _annotateDesignSize(sprite, matchedKey){
  if(!sprite) return sprite;
  const m = matchedKey && /^(\d+)x(\d+)$/.exec(matchedKey);
  if(m){
    sprite._designW = parseInt(m[1]);
    sprite._designH = parseInt(m[2]);
  } else {
    const fm = sprite.src && /[_-](\d+)x(\d+)[_-]/.exec(sprite.src);
    if(fm){
      sprite._designW = parseInt(fm[1]);
      sprite._designH = parseInt(fm[2]);
    }
  }
  return sprite;
}

function viewForSprite(sprite){
  if(!sprite?.views) return sprite;
  const dir = ['N', 'E', 'S', 'W'][rot];
  const view = sprite.views[dir] || sprite.views[dir.toLowerCase()]
    || sprite.views[rot] || sprite.views[String(rot)] || sprite.views.default;
  if(!view) return sprite;
  return Object.assign({}, sprite, view, { views:undefined });
}

function imageForSprite(sprite){
  if(!sprite || !sprite.src) return null;
  let img = GRAPHIC_PACK_IMAGES[sprite.src];
  if(!img){
    img = new Image();
    img.decoding = 'async';
    img.onload = () => { GRAPHIC_PACK_IMAGES_GEN++; }; // signal re-bake Pixi
    img.onerror = () => console.warn('[graphics-pack] image introuvable ou invalide:', sprite.src);
    img.src = sprite.src;
    GRAPHIC_PACK_IMAGES[sprite.src] = img;
  }
  return img;
}

const SPRITE_CONTENT_BOUNDS = {};

function contentBoundsForSprite(sprite, img){
  const fallback = { x:0, y:0, w:img.naturalWidth, h:img.naturalHeight };
  if(!sprite?.src || !/\.png(?:[?#]|$)/i.test(sprite.src)) return fallback;
  if(SPRITE_CONTENT_BOUNDS[sprite.src]) return SPRITE_CONTENT_BOUNDS[sprite.src];
  try {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently:true });
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
    for(let y=0; y<c.height; y++){
      for(let x=0; x<c.width; x++){
        if(data[(y*c.width + x)*4 + 3] <= 2) continue;
        if(x < minX) minX = x;
        if(y < minY) minY = y;
        if(x > maxX) maxX = x;
        if(y > maxY) maxY = y;
      }
    }
    return SPRITE_CONTENT_BOUNDS[sprite.src] = maxX >= minX
      ? { x:minX, y:minY, w:maxX-minX+1, h:maxY-minY+1 }
      : fallback;
  } catch(err){
    SPRITE_CONTENT_BOUNDS[sprite.src] = fallback;
    return fallback;
  }
}

function shouldFitSpriteToFootprint(sprite, pack){
  const fit = sprite && Object.prototype.hasOwnProperty.call(sprite, 'fit') ? sprite.fit : pack.defaultFit;
  if(fit != null) return fit === true || fit === 'footprint';
  return false;
}

function spriteFootprintSize(rw, rh){
  return {
    w: Math.max(TW, (rw + rh) * TW2),
    h: Math.max(TH, (rw + rh) * TH2)
  };
}

function drawBuildingSprite(b, rx0, ry0, rw, rh, d, lift){
  const sprite = spriteForBuilding(b, rw, rh);
  const img = imageForSprite(sprite);
  if(!img || !img.complete || !img.naturalWidth) return null;

  const pack = graphicPack();
  const fitFootprint = shouldFitSpriteToFootprint(sprite, pack);
  // PNG sprites anchor to bottom corner of the isometric diamond (most natural for building sprites)
  // SVG/other sprites without fitFootprint anchor to the tile center (legacy behaviour)
  const isPng = /\.png(?:[?#]|$)/i.test(sprite?.src || '');
  const base = (fitFootprint || isPng)
    ? liftedIso(rx0 + rw, ry0 + rh, lift)
    : liftedIso(rx0 + rw*0.5, ry0 + rh*0.5, lift);
  const ax = sprite.anchorX == null ? 0.5 : sprite.anchorX;
  const ay = sprite.anchorY == null ? 1 : sprite.anchorY;
  const ox = sprite.offsetX || 0;
  const oy = sprite.offsetY || 0;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  let w, h;

  if(fitFootprint){
    const bounds = contentBoundsForSprite(sprite, img);
    sx = bounds.x; sy = bounds.y; sw = bounds.w; sh = bounds.h;
    const footprint = spriteFootprintSize(rw, rh);
    const scale = (sprite.scale ?? pack.defaultScale ?? 1) * (sprite.footprintScale ?? 1);
    w = (sprite.width || footprint.w) * scale;
    h = (sprite.height || (sh * (w / sw)));
  } else {
    const autoScale = sprite.autoScale ? Math.max(1, Math.sqrt(rw*rh) * 0.72) : 1;
    const dW = sprite._designW || rw;
    const dH = sprite._designH || rh;
    const tileScale = (dW !== rw || dH !== rh) ? (rw + rh) / (dW + dH) : 1;
    const scale = (sprite.scale ?? pack.defaultScale ?? 1) * autoScale * tileScale;
    w = (sprite.width || img.naturalWidth) * scale;
    h = (sprite.height || img.naturalHeight) * scale;
  }

  ctx.drawImage(img, sx, sy, sw, sh, base[0] - w*ax + ox, base[1] - h*ay + oy, w, h);
  return [
    base[0] + (sprite.labelX || 0),
    base[1] - h*ay + (sprite.labelY == null ? 18 : sprite.labelY)
  ];
}

function drawTree(rx,ry,x,y){
  const c = tileCenterIso(rx, ry, x, y);
  const h = 13 + (hash(x,y)&7);
  ctx.fillStyle = 'rgba(0,0,0,.16)';
  ctx.beginPath(); ctx.ellipse(c[0]+2, c[1]+2, 9, 4.5, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#6b4a2a';
  ctx.fillRect(c[0]-1.5, c[1]-h*0.4, 3, h*0.4+1);
  const tri = (top, base, hw, col)=>{
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(c[0], c[1]-top);
    ctx.lineTo(c[0]+hw, c[1]-base);
    ctx.lineTo(c[0]-hw, c[1]-base);
    ctx.closePath(); ctx.fill();
  };
  tri(h+9,  h*0.25, 9.5, '#2e7d32');
  tri(h+14, h*0.55, 6.5, '#43a047');
}

function isUnderstaffedOwnFactory(b){
  const d = BUILD[b.type];
  if(!d?.ind || b.paused || !ownedBy(b, myOwner())) return false;
  const req = workersRequiredOf(b);
  return req > 0 && workersAllocatedOf(b) < req;
}

function drawBuildingLayerDiagnostic(b, rx0, ry0, rw, rh, lift){
  const d = BUILD[b.type];
  const target = isUnderstaffedOwnFactory(b);
  const own = ownedBy(b, myOwner());
  ctx.save();
  diamond(rx0, ry0, rw, rh, lift);
  if(target){
    ctx.fillStyle = '#ff2d2d';
    ctx.strokeStyle = '#fff200';
    ctx.lineWidth = 4.5;
  } else if(d.ind && own){
    ctx.fillStyle = '#1557ff';
    ctx.strokeStyle = '#eaf2ff';
    ctx.lineWidth = 2.4;
  } else if(own){
    ctx.fillStyle = '#111827';
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 1.8;
  } else {
    ctx.fillStyle = '#3f4654';
    ctx.strokeStyle = '#aab4c2';
    ctx.lineWidth = 1.2;
  }
  ctx.fill();
  ctx.stroke();

  const c = liftedIso(rx0 + rw * 0.5, ry0 + rh * 0.5, lift);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if(target){
    ctx.fillStyle = '#fff200';
    ctx.strokeStyle = '#050505';
    ctx.lineWidth = 4;
    ctx.font = 'bold 18px sans-serif';
    ctx.strokeText('!', c[0], c[1]);
    ctx.fillText('!', c[0], c[1]);
  } else if(d.ind && own && !b.paused){
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(workersAllocatedOf(b) + '/' + workersRequiredOf(b), c[0], c[1]);
  }
  ctx.restore();
}

function drawPausedBuildingBadge(tc, rw, rh){
  const x = tc[0] + TW * rw * 0.24;
  const y = tc[1] - TH * rh * 0.32;
  const r = 11;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r + 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,.78)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffcc00';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#111111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('Ⅱ', x, y + 0.5);
  ctx.restore();
}

function trainPlatformTrackKey(b){
  const [dx, dy] = String(b.stationAxis || '0,0').split(',').map(Number);
  return String(b.stationAxis || '0,0') + '|' + ((b.x * dy) - (b.y * dx));
}

function trainPlatformTrackPieces(b){
  const key = trainPlatformTrackKey(b);
  return buildings.filter(piece => !piece.dead
    && piece.type === 'train_platform'
    && piece.stationGroupId === b.stationGroupId
    && trainPlatformTrackKey(piece) === key);
}

function trainPlatformTrackAnchor(b){
  const [dx, dy] = String(b.stationAxis || '0,0').split(',').map(Number);
  const pieces = trainPlatformTrackPieces(b);
  let best = b;
  let bestPos = (b.x * dx) + (b.y * dy);
  for(const piece of pieces){
    const pos = (piece.x * dx) + (piece.y * dy);
    if(pos < bestPos){ best = piece; bestPos = pos; }
  }
  return best;
}

function trainStationGroupBounds(groupId, type){
  const pieces = buildings.filter(piece => isTrainStationPiece(piece)
    && piece.stationGroupId === groupId
    && (!type || piece.type === type));
  if(!pieces.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for(const piece of pieces){
    minX = Math.min(minX, piece.x);
    minY = Math.min(minY, piece.y);
    maxX = Math.max(maxX, piece.x);
    maxY = Math.max(maxY, piece.y);
  }
  const [r1x, r1y] = rotIdx(minX, minY);
  const [r2x, r2y] = rotIdx(maxX, maxY);
  return {
    minX, minY, maxX, maxY,
    rx0: Math.min(r1x, r2x),
    ry0: Math.min(r1y, r2y),
    rw: Math.abs(r1x - r2x) + 1,
    rh: Math.abs(r1y - r2y) + 1,
    pieces,
  };
}

function drawTrainStationPiece(b){
  const [rx, ry] = rotIdx(b.x, b.y);
  const lift = terrainLiftPxAt(b.x, b.y);
  if(b.type === 'train_platform'){
    if(trainPlatformTrackAnchor(b) === b){
      const ownerColor = b.owner ? playerColor(b.owner) : '#b07b49';
      const pieces = trainPlatformTrackPieces(b);
      const [adx, ady] = String(b.stationAxis || '1,0').split(',').map(Number);
      const [du, dv] = rotDir(adx, ady);
      const end = iso(du, dv);
      const len = Math.hypot(end[0], end[1]) || 1;
      const tx = end[0] / len, ty = end[1] / len;
      let nx = -ty, ny = tx;
      const station = buildings.find(piece => piece.stationGroupId === b.stationGroupId && piece.type === 'train_station');
      if(station){
        const [sdx, sdy] = rotDir(station.x - b.x, station.y - b.y);
        const toward = iso(sdx, sdy);
        if(nx * toward[0] + ny * toward[1] < 0){ nx = -nx; ny = -ny; }
      }
      let first = pieces[0], last = pieces[0];
      let firstPos = (first.x * adx) + (first.y * ady);
      let lastPos = firstPos;
      for(const piece of pieces){
        const pos = (piece.x * adx) + (piece.y * ady);
        if(pos < firstPos){ first = piece; firstPos = pos; }
        if(pos > lastPos){ last = piece; lastPos = pos; }
      }
      const [frx, fry] = rotIdx(first.x, first.y);
      const [lrx, lry] = rotIdx(last.x, last.y);
      const c0 = liftedIso(frx + 0.5, fry + 0.5, terrainLiftPxAt(first.x, first.y));
      const c1 = liftedIso(lrx + 0.5, lry + 0.5, terrainLiftPxAt(last.x, last.y));
      const half = len * 0.48, offset = 9;
      const x0 = c0[0] - tx * half + nx * offset, y0 = c0[1] - ty * half + ny * offset;
      const x1 = c1[0] + tx * half + nx * offset, y1 = c1[1] + ty * half + ny * offset;
      ctx.lineCap = 'butt';
      ctx.strokeStyle = shade(ownerColor, -0.42); ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.strokeStyle = shade(ownerColor, 0.20); ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(x0, y0 - 1); ctx.lineTo(x1, y1 - 1); ctx.stroke();
      ctx.strokeStyle = '#f0d15f'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x0 - nx * 4, y0 - ny * 4); ctx.lineTo(x1 - nx * 4, y1 - ny * 4); ctx.stroke();

      // Repère visuel des dalles manquantes : un quai incomplet (trou interne ou
      // trop court) n'est JAMAIS desservi (cf. trainStationStopTiles, qui écarte
      // toute voie de longueur < gare). La bande de quai étant tracée d'un bout à
      // l'autre, un trou est invisible — on le matérialise ici en rouge. La plage
      // requise est celle des têtes de gare, projetée sur l'axe du quai.
      const stationPieces = buildings.filter(piece => !piece.dead
        && piece.type === 'train_station' && piece.stationGroupId === b.stationGroupId);
      if(stationPieces.length){
        let minPos = Infinity, maxPos = -Infinity;
        for(const s of stationPieces){
          const sp = (s.x * adx) + (s.y * ady);
          minPos = Math.min(minPos, sp); maxPos = Math.max(maxPos, sp);
        }
        const have = new Set(pieces.map(p => (p.x * adx) + (p.y * ady)));
        const perp = (b.x * ady) - (b.y * adx);
        for(let pos = minPos; pos <= maxPos; pos++){
          if(have.has(pos)) continue;
          const mx = pos * adx + perp * ady;
          const my = pos * ady - perp * adx;
          const [mrx, mry] = rotIdx(mx, my);
          ctx.save();
          ctx.fillStyle = 'rgba(220,40,40,0.42)';
          diamond(mrx, mry, 1, 1, terrainLiftPxAt(mx, my)); ctx.fill();
          ctx.strokeStyle = '#ff5252'; ctx.lineWidth = 2; ctx.setLineDash([4,3]);
          diamond(mrx, mry, 1, 1, terrainLiftPxAt(mx, my)); ctx.stroke();
          ctx.restore();
          const c = liftedIso(mrx + 0.5, mry + 0.5, terrainLiftPxAt(mx, my));
          ctx.font = '13px "Segoe UI Emoji",sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('⚠️', c[0], c[1]);
        }
      }
    }
  } else {
    const bounds = trainStationGroupBounds(b.stationGroupId, 'train_station');
    if(bounds && bounds.pieces[0] === b){
      const col = b.owner ? playerColor(b.owner) : '#b07b49';
      prism(bounds.rx0 + 0.08, bounds.ry0 + 0.08, bounds.rx0 + bounds.rw - 0.08, bounds.ry0 + bounds.rh - 0.08, 10, col, lift);
      const c = liftedIso(bounds.rx0 + bounds.rw * 0.5, bounds.ry0 + bounds.rh * 0.5, lift);
      ctx.fillStyle = '#f5e7c8';
      ctx.font = '14px "Segoe UI Emoji",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🚉', c[0], c[1] - 9);
    }
  }
  const selectedGroup = trainStationSelectionMatches(selected, b);
  const _trainRoute = vehicleRouteMode?.vehicle?.vtype === 'train';
  const _foreignStation = _trainRoute && b.owner != null && b.owner !== (MP.connected ? MP.myId : null);
  const routeEligible = vehicleRouteMode && vehicleRouteEndpointOk(b)
    && (vehicleRouteMode.step === 'dest' || b.owner == null || b.owner === (MP.connected ? MP.myId : null)
        || (_trainRoute && isTrainStationPiece(b)));
  if(selectedGroup || routeEligible){
    ctx.save();
    if(routeEligible){
      // Gare d'un autre joueur (commerce inter-joueurs) → or, sinon vert.
      ctx.strokeStyle = _foreignStation ? '#f0c060' : '#9fe8a0'; ctx.lineWidth = 1.5;
      ctx.setLineDash([4,3]);
      diamond(rx, ry, 1, 1, lift); ctx.stroke();
    } else if(trainStationSelectionMatches(selected, b) && isTrainStationPiece(selected)){
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      const stationPieces = buildings.filter(piece => isTrainStationPiece(piece) && piece.stationGroupId === b.stationGroupId);
      let rx0 = Infinity, ry0 = Infinity, rx1 = -Infinity, ry1 = -Infinity;
      for(const piece of stationPieces){
        const [prx, pry] = rotIdx(piece.x, piece.y);
        rx0 = Math.min(rx0, prx);
        ry0 = Math.min(ry0, pry);
        rx1 = Math.max(rx1, prx);
        ry1 = Math.max(ry1, pry);
      }
      diamond(rx0, ry0, rx1 - rx0 + 1, ry1 - ry0 + 1, lift); ctx.stroke();
    }
    ctx.restore();
  }
}

// Corps statique du bâtiment (sprite/prisme + toit + fenêtres + icône). Extrait de
// drawBuilding pour être baké en texture Pixi (js/pixi/sprites.js). Retourne la
// géométrie (tc = centre haut, empreinte tournée, lift) pour placer les overlays.
function drawBuildingBody(b){
  const d = BUILD[b.type];
  const [r1x,r1y] = rotIdx(b.x, b.y);
  const [r2x,r2y] = rotIdx(b.x+b.w-1, b.y+b.h-1);
  const rx0 = Math.min(r1x,r2x), ry0 = Math.min(r1y,r2y);
  // l'empreinte tournée échange largeur et profondeur selon l'orientation
  const rw = Math.abs(r1x-r2x)+1, rh = Math.abs(r1y-r2y)+1;
  const lift = buildingLiftPx(b);
  // les sites industriels fusionnés gagnent en hauteur avec leur taille
  const hgt = d.ind ? d.hgt*(1+0.18*(Math.max(b.w,b.h)-1)) : d.hgt;
  const bCol = packBuildingColor(b, d);
  let tc = drawBuildingSprite(b, rx0, ry0, rw, rh, d, lift);
  const usedSprite = !!tc;
  if(!tc){
    tc = prism(rx0, ry0, rx0+rw, ry0+rh, hgt, bCol, lift);
    drawRoofAccent(rx0, ry0, rw, rh, hgt, bCol, b, d, lift);
  }

  // fenêtres éclairées sur les faces des grands logements
  if(!usedSprite && !drawFast && d.resid && d.hgt >= 40){
    const B = liftedIso(rx0+rw, ry0, lift), C = liftedIso(rx0+rw, ry0+rh, lift), D = liftedIso(rx0, ry0+rh, lift);
    const rows = Math.max(3, Math.min(9, Math.floor(d.hgt/14)));
    const face = (P,Q,tiles,seed)=>{
      const cols = Math.min(8, 3*tiles);
      for(let r=0;r<rows;r++) for(let cI=0;cI<cols;cI++){
        const s0 = (cI+0.25)/cols, s1 = (cI+0.80)/cols;
        const t0 = (0.08 + r*0.86/rows)*d.hgt, t1 = t0 + 0.45*0.86/rows*d.hgt;
        const p0 = [P[0]+(Q[0]-P[0])*s0, P[1]+(Q[1]-P[1])*s0];
        const p1 = [P[0]+(Q[0]-P[0])*s1, P[1]+(Q[1]-P[1])*s1];
        ctx.fillStyle = (hash(b.x*7+r+seed, b.y*13+cI)&3)
          ? 'rgba(255,236,170,.65)' : 'rgba(22,32,48,.55)';
        quad([p0[0],p0[1]-t0],[p1[0],p1[1]-t0],[p1[0],p1[1]-t1],[p0[0],p0[1]-t1]);
      }
    };
    face(B,C,rh,1); face(C,D,rw,2);
  }

  // icône sur le toit
  if(!usedSprite){
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = (TH*(0.62+0.28*(Math.max(b.w,b.h)-1)))+'px "Segoe UI Emoji",sans-serif';
    if(b.type === 'mine' && b.ore){
      // Pioche colorée selon le minerai (fer = orange, charbon = gris clair)
      const oreColor = b.ore === 'iron' ? '#d98a4f' : '#b0b0c0';
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = oreColor;
      // fond coloré rond derrière l'icône
      const fs = TH*(0.62+0.28*(Math.max(b.w,b.h)-1));
      ctx.beginPath();
      ctx.arc(tc[0], tc[1], fs*0.55, 0, Math.PI*2);
      ctx.globalAlpha = 0.28;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillText(d.ic, tc[0], tc[1]+1);
      ctx.restore();
    } else {
      ctx.fillText(d.ic, tc[0], tc[1]+1);
    }
  }
  return { tc, rx0, ry0, rw, rh, lift, usedSprite };
}

// Overlays dynamiques du bâtiment (badge pausé, progression, labels, alertes,
// contours propriétaire/sélection…). Réimplémentés en Pixi live
// (js/pixi/sprites.js) ; ce code Canvas2D reste la référence / chemin de secours.
function drawBuildingOverlays(b, g){
  const d = BUILD[b.type];
  const { tc, rx0, ry0, rw, rh, lift, usedSprite } = g;
  if(!drawFast && d.ind && b.paused){
    drawPausedBuildingBadge(tc, rw, rh);
  }

  // barre de progression
  const r = recipeOf(b);
  const prog = typeof buildingRenderProg === 'function' ? buildingRenderProg(b) : (b.prog || 0);
  if(!drawFast && r && prog > 0){
    const bw = TW*0.42*b.w;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(tc[0]-bw/2, tc[1]+TH*0.36, bw, 4);
    ctx.fillStyle = '#7fd96a';
    ctx.fillRect(tc[0]-bw/2, tc[1]+TH*0.36, bw*Math.min(1, prog / r.time), 4);
  }
  // habitants
  if(!drawFast && d.resid && b.pop>0){
    ctx.font = 'bold 11px sans-serif';
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 3;
    ctx.strokeText('👤'+b.pop, tc[0], tc[1]-TH*0.55);
    ctx.fillStyle = '#ffe9a0';
    ctx.fillText('👤'+b.pop, tc[0], tc[1]-TH*0.55);
    if((b.workersIdle||0) > 0){
      ctx.font = 'bold 10px sans-serif';
      ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 3;
      ctx.strokeText('💤'+b.workersIdle, tc[0], tc[1]-TH*0.32);
      ctx.fillStyle = '#ff9a8a';
      ctx.fillText('💤'+b.workersIdle, tc[0], tc[1]-TH*0.32);
    }
  }
  // pas d'accès de transport adjacent
  const lacksRoadAccess = b.type !== 'train_depot' && !adjRoadTiles(b).length;
  const lacksRailAccess = b.type === 'train_depot' && !adjRailTiles(b).length;
  if(!drawFast && (lacksRoadAccess || lacksRailAccess)){
    ctx.font = '14px "Segoe UI Emoji",sans-serif';
    ctx.fillText('⚠️', tc[0], tc[1]-TH*0.95);
  }
  // contour couleur propriétaire (multijoueur)
  if(!drawFast && !UI_OPTIONS.hideColorMarkers && b.owner){
    const ownerColor = playerColor(b.owner);
    ctx.strokeStyle = ownerColor; ctx.lineWidth = (b===selected || trainStationSelectionMatches(selected, b)) ? 3 : 1.5;
    diamond(rx0, ry0, rw, rh, lift); ctx.stroke();
    // petit drapeau couleur en haut à gauche du toit
    ctx.fillStyle = ownerColor;
    ctx.beginPath(); ctx.arc(tc[0]-TW*rw*0.28, tc[1]-4, 4, 0, 7); ctx.fill();
  } else if(b===selected || trainStationSelectionMatches(selected, b)){
    // sélection solo
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    diamond(rx0, ry0, rw, rh, lift); ctx.stroke();
  }
  // sélection par-dessus (multijoueur)
  if((b===selected || trainStationSelectionMatches(selected, b)) && MP.connected){
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    diamond(rx0, ry0, rw, rh, lift); ctx.stroke();
  }
  // Indicateur "en vente" : petit $ doré sur le dépôt
  if(!drawFast && BUILD[b.type]?.storageHub && b.type !== 'tank' && b.sellTo && Object.values(b.sellTo).some(v=>v)){
    ctx.save();
    ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f0c060';
    ctx.fillText('$', tc[0] + TW*rw*0.3, tc[1] - 3);
    ctx.restore();
  }
  // Nombre de passagers sur les arrêts de bus
  if(!drawFast && b.type === 'bus_stop' && (b.passengersMax || 0) > 0){
    const pDisp = Math.floor(b.passengers || 0);
    ctx.font = 'bold 11px sans-serif';
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 3;
    ctx.strokeText('👥'+pDisp, tc[0], tc[1]-TH*0.75);
    ctx.fillStyle = pDisp < (b.passengersMax||0) ? '#a0c8e8' : '#7dd8ff';
    ctx.fillText('👥'+pDisp, tc[0], tc[1]-TH*0.75);
  }
  // Contour vert clignotant sur les bâtiments éligibles lors de l'assignation de route
  if(vehicleRouteMode && vehicleRouteEndpointOk(b)){
    const isBus = vehicleRouteMode.vehicle?.vtype === 'bus';
    const myOid = MP.connected ? MP.myId : null;
    if(isBus){
      // Pour les bus : tous les arrêts sont éligibles (y compris d'autres joueurs)
      ctx.strokeStyle = '#7dd8ff'; ctx.lineWidth = 1.5;
      ctx.setLineDash([4,3]);
      diamond(rx0, ry0, rw, rh, lift); ctx.stroke();
      ctx.setLineDash([]);
    } else if(vehicleRouteMode.step === 'dest' || b.owner == null || b.owner === myOid || b.type === 'tank'){
      ctx.strokeStyle = '#9fe8a0'; ctx.lineWidth = 1.5;
      ctx.setLineDash([4,3]);
      diamond(rx0, ry0, rw, rh, lift); ctx.stroke();
      ctx.setLineDash([]);
    } else if(b.owner != null && b.owner !== myOid && b.type === 'market'){
      const vt = VEHICLE_TYPES[vehicleRouteMode.vehicle.vtype];
      if(vt.resources.some(r => b.sellTo?.[r])){
        ctx.strokeStyle = '#f0c060'; ctx.lineWidth = 1.5;
        ctx.setLineDash([4,3]);
        diamond(rx0, ry0, rw, rh, lift); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
}

function drawBuilding(b){
  if(isTrainStationPiece(b)){ drawTrainStationPiece(b); return; }
  const d = BUILD[b.type];
  if(!drawFast && UI_OPTIONS.highlightUnderstaffedFactories){
    const [r1x,r1y] = rotIdx(b.x, b.y);
    const [r2x,r2y] = rotIdx(b.x+b.w-1, b.y+b.h-1);
    const rx0 = Math.min(r1x,r2x), ry0 = Math.min(r1y,r2y);
    const rw = Math.abs(r1x-r2x)+1, rh = Math.abs(r1y-r2y)+1;
    const lift = buildingLiftPx(b);
    drawBuildingLayerDiagnostic(b, rx0, ry0, rw, rh, lift);
    if(b === selected || trainStationSelectionMatches(selected, b)){
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      diamond(rx0, ry0, rw, rh, lift);
      ctx.stroke();
      ctx.restore();
    }
    return;
  }
  drawBuildingOverlays(b, drawBuildingBody(b));
}

// Petit personnage (piéton / sans-abri) dessiné autour d'un centre écran c, avec
// un décalage vertical bob. Source partagée rendu + baking Pixi.
function drawWalkerCore(c, col, bob){
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath(); ctx.ellipse(c[0], c[1]+1, 3.2, 1.7, 0, 0, 7); ctx.fill();
  ctx.fillStyle = col;                          // corps
  ctx.fillRect(c[0]-2, c[1]-8+bob, 4, 7);
  ctx.fillStyle = '#f0c8a0';                    // tête
  ctx.beginPath(); ctx.arc(c[0], c[1]-10+bob, 2.5, 0, 7); ctx.fill();
}
function walkerPose(wk){
  const rs = typeof mpWalkerRenderState === 'function' ? mpWalkerRenderState(wk) : wk;
  if(!rs.pts || !rs.pts.length) return null;
  const seg = Math.min(rs.seg, rs.pts.length-1);
  const a = rs.pts[seg], b = rs.pts[Math.min(seg+1, rs.pts.length-1)];
  const wx = a.x + (b.x-a.x)*rs.t, wy = a.y + (b.y-a.y)*rs.t;
  const [u,v] = rotF(wx/TILE, wy/TILE);
  return { u, v, c: liftedIso(u, v, terrainLiftPxAtWorld(wx, wy)) };
}
function drawWalker(wk){
  const p = walkerPose(wk); if(!p) return;
  drawWalkerCore(p.c, wk.col, Math.sin(gtime*12 + wk.phase)*1.1);
}

function homelessPose(h){
  const [u,v] = rotF(h.x/TILE, h.y/TILE);
  return { u, v, c: liftedIso(u, v, terrainLiftPxAtWorld(h.x, h.y)) };
}
function drawHomeless(h){
  const p = homelessPose(h);
  drawWalkerCore(p.c, h.col || playerColor(h.owner), Math.sin(gtime*4 + h.phase)*0.7);
}

function drawWorkRadiusOverlay(center, radius, color, minRx, maxRx, minRy, maxRy){
  for(let ry=minRy; ry<=maxRy; ry++) for(let rx=minRx; rx<=maxRx; rx++){
    const [x,y] = invRotIdx(rx,ry);
    const d = Math.max(Math.abs(x-center.x), Math.abs(y-center.y));
    if(d > radius) continue;
    ctx.fillStyle = color + (Math.ceil(d) === radius ? '33' : '1a');
    tilePolygon(rx, ry, x, y); ctx.fill();
    if(Math.ceil(d) === radius){
      ctx.strokeStyle = color + '99';
      ctx.lineWidth = 1;
      tilePolygon(rx, ry, x, y); ctx.stroke();
    }
  }
}

// Rayon de pêche : fond bleu clair + tuiles poisson surlignées en cyan vif
function drawFisherRadiusOverlay(center, radius, minRx, maxRx, minRy, maxRy){
  const fishTiles = getFishTiles();
  const bx = Math.round(center.x), by = Math.round(center.y);
  for(let ry = minRy; ry <= maxRy; ry++) for(let rx = minRx; rx <= maxRx; rx++){
    const [x, y] = invRotIdx(rx, ry);
    if(terrain[y * N + x] !== T.WATER) continue;
    const dx = x - bx, dy = y - by;
    const d = Math.sqrt(dx * dx + dy * dy);
    if(d > radius) continue;
    const atEdge = d > radius - 1.0;
    const isFish = fishTiles.has(y * N + x);
    ctx.fillStyle = isFish ? '#1de9b633' : '#3bc4f51a';
    tilePolygon(rx, ry, x, y); ctx.fill();
    if(isFish){
      ctx.fillStyle = '#1de9b622';
      tilePolygon(rx, ry, x, y); ctx.fill();
    }
    if(atEdge){
      ctx.strokeStyle = '#3bc4f599';
      ctx.lineWidth = 1;
      tilePolygon(rx, ry, x, y); ctx.stroke();
    }
  }
}

function roadPointAt(pt){
  const x = Math.floor(pt.x / TILE), y = Math.floor(pt.y / TILE);
  return inMap(x, y) && road[y*N+x];
}

function lanePose(pts, seg, t, lane=0.16){
  const a = pts[seg], b = pts[Math.min(seg+1, pts.length-1)];
  const wx = a.x + (b.x-a.x)*t, wy = a.y + (b.y-a.y)*t;
  let [u,v] = rotF(wx/TILE, wy/TILE);
  const [du,dv] = rotDir(b.x-a.x, b.y-a.y);
  if(roadPointAt(a) && roadPointAt(b)){
    const len = Math.hypot(du, dv) || 1;
    u += (-dv / len) * lane;
    v += ( du / len) * lane;
  }
  return { u, v, du, dv };
}

// Direction lissée pour les trains : blend symétrique autour de chaque sommet du
// tracé. La transition s'étale sur la moitié de chaque segment adjacent et atteint
// la direction MOYENNE des deux segments pile au sommet, identique des deux côtés.
// On évite ainsi le saut de direction (≈45°) qui se produisait quand la seconde
// moitié d'un segment atteignait déjà la direction suivante avant que le segment
// suivant ne reparte de la direction précédente.
function trainBlendedDir(pts, seg, t){
  const dirAt = (i) => {
    const a = pts[Math.max(0, i)], b = pts[Math.min(i+1, pts.length-1)];
    return [b.x - a.x, b.y - a.y];
  };
  const [cdx, cdy] = dirAt(seg);
  if(t >= 0.5 && seg + 1 <= pts.length - 2){
    // Vers le sommet suivant : w va de 0 (milieu du segment) à 0.5 (au sommet).
    const [ndx, ndy] = dirAt(seg + 1);
    const w = t - 0.5;
    return [cdx*(1-w) + ndx*w, cdy*(1-w) + ndy*w];
  }
  if(t < 0.5 && seg > 0){
    // Depuis le sommet précédent : w va de 0.5 (au sommet) à 0 (milieu du segment).
    const [pdx, pdy] = dirAt(seg - 1);
    const w = 0.5 - t;
    return [cdx*(1-w) + pdx*w, cdy*(1-w) + pdy*w];
  }
  return [cdx, cdy];
}

// Retourne la pose iso du wagon wagonIndex (0 = premier wagon derrière la loco).
// Trace en arrière le long de la polyline réelle, avec longueurs de segments variables.
function trainWagonPose(veh, wagonIndex){
  const rs = typeof mpVehicleRenderState === 'function' ? mpVehicleRenderState(veh) : veh;
  const pts = rs.pts;
  const SPACING = TILE * 0.80;
  const backDist = (wagonIndex + 1) * SPACING;

  // Source principale : historique continu de la locomotive. Il survit aux
  // arrêts en gare et aux changements de chemin aux aiguillages.
  const trail = rs.railTrail;
  if(Array.isArray(trail) && trail.length >= 2){
    let rem = backDist;
    for(let i = trail.length - 1; i > 0; i--){
      const newer = trail[i], older = trail[i - 1];
      const dx = newer.x - older.x, dy = newer.y - older.y;
      const len = Math.hypot(dx, dy);
      if(len < 0.001) continue;
      if(rem <= len){
        const ratio = rem / len;
        const wx = newer.x + (older.x - newer.x) * ratio;
        const wy = newer.y + (older.y - newer.y) * ratio;
        const [u, v] = rotF(wx / TILE, wy / TILE);
        const [du, dv] = rotDir(dx, dy);
        return { u, v, du, dv };
      }
      rem -= len;
    }
  }

  if(pts && pts.length >= 2){
    let ws = rs.seg, wt = rs.t, rem = backDist;
    while(rem > 1e-3){
      const a = pts[Math.max(0, ws)];
      const b = pts[Math.min(ws + 1, pts.length - 1)];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const d = wt * segLen;
      if(d >= rem){
        wt -= rem / segLen;
        rem = 0;
      } else {
        rem -= d;
        ws--;
        if(ws < 0) break;
        wt = 1;
      }
    }
    if(ws >= 0){
      wt = Math.max(0, Math.min(1, wt));
      const pose = lanePose(pts, ws, wt, 0);
      const [rdx, rdy] = trainBlendedDir(pts, ws, wt);
      const [du, dv] = rotDir(rdx, rdy);
      return { u: pose.u, v: pose.v, du, dv };
    }

    // Tracé insuffisant (train au début de son path) : extrapoler depuis la tuile d'entrée.
    const startTile = rs.pathTiles?.[0] ?? -1;
    const entryTile = veh.railPathEntryFromTile ?? null;
    if(startTile >= 0 && entryTile !== null && entryTile !== startTile){
      const sx = startTile % N, sy = (startTile / N) | 0;
      const ex = entryTile % N, ey = (entryTile / N) | 0;
      const dx = sx - ex, dy = sy - ey;
      const [u, v] = rotF(sx + 0.5 - dx * rem / TILE, sy + 0.5 - dy * rem / TILE);
      const [du, dv] = rotDir(dx, dy);
      return { u, v, du, dv };
    }
    return lanePose(pts, 0, 0, 0);
  }

  // Train arrêté en gare (pts.length <= 1) : extrapoler en arrière depuis la direction d'arrivée.
  const curTile = rs.railContinueTile ?? null;
  const prevTile = rs.railPreviousTile ?? null;
  if(curTile == null || prevTile == null || curTile === prevTile) return null;
  const cx = curTile % N, cy = (curTile / N) | 0;
  const px = prevTile % N, py = (prevTile / N) | 0;
  const dx = cx - px, dy = cy - py;
  const [u, v] = rotF((cx + 0.5) - dx * backDist / TILE, (cy + 0.5) - dy * backDist / TILE);
  const [du, dv] = rotDir(dx, dy);
  return { u, v, du, dv };
}

// Corps directionnel d'un wagon (ombre + 2 prismes). Source partagée rendu + baking.
function drawWagonCore(u, v, du, dv, color){
  const c = entityIso(u, v);
  const lift = terrainLiftPxAtRot(u, v);
  const nd0 = Math.hypot(du, dv) || 1;
  const fn0 = du/nd0, fv0 = dv/nd0;
  const shadowAngle0 = Math.atan2((fn0+fv0)*TH2, (fn0-fv0)*TW2);
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath(); ctx.ellipse(c[0]+1, c[1]+2, 11, 4.5, shadowAngle0, 0, Math.PI*2); ctx.fill();
  trainPrism(u, v, du, dv, 0.30,      0.13,      5, '#252e38', lift);
  trainPrism(u, v, du, dv, 0.30*0.82, 0.13*0.82, 7, color, lift + 4);
}
function drawTrainWagon(veh, wagonIndex){
  const pose = trainWagonPose(veh, wagonIndex);
  if(!pose) return;
  const {u, v, du, dv} = pose;
  const wagon = veh.wagons?.[wagonIndex];
  const wtype = trainWagonDef(wagon);
  if(!wtype) return;
  const selectedRes = trainWagonSelectedResource(wagon);
  const c = entityIso(u, v);
  drawWagonCore(u, v, du, dv, wtype.color);
  if(selectedRes && RES[selectedRes]?.ic){
    const label = RES[selectedRes].ic;
    ctx.save();
    ctx.font = 'bold 11px "Segoe UI Emoji","Segoe UI",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const badgeY = c[1] - 11;
    ctx.fillStyle = 'rgba(12,24,38,.92)';
    ctx.beginPath();
    ctx.ellipse(c[0], badgeY, 8.5, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = RES[selectedRes].c || '#ffe082';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, c[0], badgeY + 0.5);
    ctx.restore();
  }
}

function trainPose(veh){
  const rs = typeof mpVehicleRenderState === 'function' ? mpVehicleRenderState(veh) : veh;
  const pts = rs.pts;
  if(pts && pts.length >= 2){
    const pose = lanePose(pts, rs.seg, rs.t, 0);
    const [dx, dy] = trainBlendedDir(pts, rs.seg, rs.t);
    const [du, dv] = rotDir(dx, dy);
    return { u: pose.u, v: pose.v, du, dv };
  }
  const pose = lanePose(pts || [{x:0,y:0}], 0, 0, 0);
  if(Math.abs(pose.du) > 1e-6 || Math.abs(pose.dv) > 1e-6) return pose;
  const curTile = rs?.railContinueTile ?? rs?.pathTiles?.[rs?.seg ?? 0] ?? null;
  const prevTile = rs?.railPreviousTile ?? null;
  if(curTile != null && prevTile != null && curTile !== prevTile){
    const cx = curTile % N, cy = (curTile / N) | 0;
    const px = prevTile % N, py = (prevTile / N) | 0;
    const [u, v] = rotF(cx + 0.5, cy + 0.5);
    const [du, dv] = rotDir(cx - px, cy - py);
    return { u, v, du, dv };
  }
  return pose;
}

// ---------- fumée de locomotive ----------
// Locomotive actuellement dans la fenêtre visible ?
function isTrainLocoVisible(veh){
  const pose = trainPose(veh);
  if(!pose) return false;
  const [ix, iy] = entityIso(pose.u, pose.v);
  const z = cam.z || 1;
  return ix >= cam.x && ix <= cam.x + W / z && iy >= cam.y && iy <= cam.y + H / z;
}
// Émet une bouffée de fumée au-dessus de la cheminée de la loco. Positions
// stockées en px iso (repère monde, avant transform caméra), comme les floats.
function emitTrainSmoke(veh){
  if(smoke.length > 140) return;
  const pose = trainPose(veh);
  if(!pose) return;
  const [ix, iy] = entityIso(pose.u, pose.v);
  const life = 1.1 + Math.random() * 0.6;
  smoke.push({
    x: ix + (Math.random() - 0.5) * 6,
    y: iy - TH * 0.95 + (Math.random() - 0.5) * 4,  // au-dessus de la loco
    vx: (Math.random() - 0.5) * 7,
    vy: -(11 + Math.random() * 9),                  // montée (px iso/s)
    r: 2.5 + Math.random() * 2,
    grow: 9 + Math.random() * 7,                    // expansion (px/s)
    life, life0: life,
  });
}

function drawSmoke(){
  if(!smoke.length) return;
  for(const s of smoke){
    const a = Math.max(0, s.life / s.life0) * 0.45;
    if(a <= 0.01) continue;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#c2c7cc';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Pose d'un camion (position tuile tournée + direction) depuis son état de
// rendu (interpolé en MP). Réutilisé par le rendu ET le baking de textures Pixi.
function truckPose(tk){
  const rs = typeof mpTruckRenderState === 'function' ? mpTruckRenderState(tk) : tk;
  if(!rs.pts || !rs.pts.length) return null;
  const {u, v} = lanePose(rs.pts, rs.seg, rs.t, tk.overtaking ? -0.15 : 0.15);
  const [bDx, bDy] = trainBlendedDir(rs.pts, rs.seg, rs.t);
  const [du, dv] = rotDir(bDx, bDy);
  return { u, v, du, dv };
}
// Dessin d'un camion à une pose explicite. Source unique partagée par drawTruck
// (Canvas2D) et le baker de textures directionnelles (js/pixi/sprites.js).
function drawTruckCore(u, v, du, dv, col){
  const nd = Math.hypot(du, dv) || 1;
  const fn = du/nd, fv = dv/nd;
  const shadowAngle = Math.atan2((fn+fv)*TH2, (fn-fv)*TW2);
  const c = entityIso(u, v);
  const lift = terrainLiftPxAtRot(u, v);
  ctx.fillStyle = 'rgba(0,0,0,.20)';
  ctx.beginPath(); ctx.ellipse(c[0]+1, c[1]+1, 9, 4, shadowAngle, 0, Math.PI*2); ctx.fill();
  trainPrism(u, v, du, dv, 0.21, 0.11, 4, '#39404c', lift);
  trainPrism(u, v, du, dv, 0.21*0.72, 0.11*0.72, 6, col, lift + 4);
}
function drawTruck(tk){
  const p = truckPose(tk);
  if(!p) return;
  drawTruckCore(p.u, p.v, p.du, p.dv, RES[tk.res]?.c ?? '#aaa');
}

function drawVehicleRoute(veh){
  if(!veh.vizRoute) return;
  const drawPath = (pts, color) => {
    if(!pts || pts.length < 2) return;
    ctx.beginPath();
    let first = true;
    for(const pt of pts){
      const [sx, sy] = liftedIso(...rotF(pt.x / TILE, pt.y / TILE), terrainLiftPxAtWorld(pt.x, pt.y));
      if(first){ ctx.moveTo(sx, sy); first = false; }
      else ctx.lineTo(sx, sy);
    }
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.globalAlpha = 0.82;
    ctx.setLineDash([10, 6]);
    ctx.stroke();
    ctx.restore();
  };
  drawPath(veh.vizRoute.fwd, '#4dd9ff');   // cyan  : source → dest
  drawPath(veh.vizRoute.bwd, '#ffaa44');   // orange: dest   → source

  // Surligner les bâtiments source et destination
  const highlightBld = (b, col) => {
    if(!b || b.dead) return;
    let rx0, ry0, rw, rh;
    let lift = 0;
    if(isTrainStationPiece(b)){
      const bounds = trainStationGroupBounds(b.stationGroupId, null);
      if(!bounds) return;
      rx0 = bounds.rx0; ry0 = bounds.ry0; rw = bounds.rw; rh = bounds.rh;
      lift = terrainLiftPxAt(b.x, b.y);
    } else {
      const [r1x,r1y] = rotIdx(b.x, b.y);
      const [r2x,r2y] = rotIdx(b.x+b.w-1, b.y+b.h-1);
      rx0 = Math.min(r1x,r2x); ry0 = Math.min(r1y,r2y);
      rw = Math.abs(r1x-r2x)+1; rh = Math.abs(r1y-r2y)+1;
      lift = buildingLiftPx(b);
    }
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.globalAlpha = 0.9;
    diamond(rx0, ry0, rw, rh, lift); ctx.stroke();
    ctx.restore();
  };
  if(veh.vtype === 'train' && Array.isArray(veh.orders)){
    for(const stop of veh.orders) highlightBld(stop, 'rgba(255,255,255,.45)');
  }
  highlightBld(veh.source, '#4dd9ff');
  highlightBld(veh.dest,   '#ffaa44');
}

function drawTrafficLight(c, approaches){
  ctx.save();
  for(const { du, dv, green } of approaches){
    // Position: 0.62 tiles before intersection center (= stop line), 0.22 tiles right of lane
    // right direction in rotated space = (dv, -du)
    const along = 0.82, lane = 0.40;
    const lx = c[0] + (du - dv) * TW2 * along + (dv + du) * TW2 * lane;
    const ly = c[1] + (du + dv) * TH2 * along + (dv - du) * TH2 * lane;
    ctx.fillStyle = 'rgba(0,0,0,.75)';
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(lx - 4, ly - 6, 8, 11, 2);
    else ctx.rect(lx - 4, ly - 6, 8, 11);
    ctx.fill();
    ctx.fillStyle = green ? '#35ff64' : '#ff3030';
    ctx.beginPath();
    ctx.arc(lx, ly, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  ctx.restore();
}

// Décalage px écran d'un point iso `c` selon deux vecteurs MONDE unitaires.
// alongWorld : vecteur monde du décalage longitudinal ; rightWorld : latéral.
// magAlong/magRight en px écran, normalisés via la projection iso → identiques
// que le vecteur soit cardinal ou diagonal (compense le squash TW≠TH).
// Rotation-invariant : le feu reste du même côté du rail à toute rotation caméra.
function isoWorldOffset(c, alongWorld, rightWorld, magAlong, magRight){
  const [au, av] = rotDir(alongWorld[0], alongWorld[1]);
  const [ru, rv] = rotDir(rightWorld[0], rightWorld[1]);
  const sa = iso(au, av), la = Math.hypot(sa[0], sa[1]) || 1;
  const sr = iso(ru, rv), lr = Math.hypot(sr[0], sr[1]) || 1;
  return [ c[0] + sa[0] / la * magAlong + sr[0] / lr * magRight,
           c[1] + sa[1] / la * magAlong + sr[1] / lr * magRight ];
}

// Position écran (espace iso, avant transform caméra) du feu pour l'arête
// dirigée `def` de la tuile (x,y). Centralisée pour que le rendu ET la sélection
// au clic (chooseRailSignalDef) utilisent exactement le même point.
function railSignalScreenPos(x, y, def){
  const [rx, ry] = rotIdx(x, y);
  const c = tileCenterIso(rx, ry, x, y);
  // Clé = direction de MARCHE du train protégé (= -def) en monde.
  // along monde = def (vers le train qui arrive) ; droite monde = (def.dy,-def.dx)
  // = droite du mécanicien (et non plus sa gauche comme avec l'ancien (dv,-du)).
  const sigCfg = (CFG.rails?.signaux?.deplacement || {})[`${-def.dx},${-def.dy}`] || { along:13, right:7 };
  return isoWorldOffset(c, [def.dx, def.dy], [def.dy, -def.dx], sigCfg.along, sigCfg.right);
}

// Feu de jonction : même rendu en perspective que le feu simple (profil /
// cardinal / face / dos selon l'orientation du rail vis-à-vis de la caméra),
// mais avec DEUX lentilles empilées et un boîtier plus haut pour les loger.
// Lentille du HAUT = disponibilité des voies suivantes (verte si au moins une
// voie est libre pour le tronçon suivant) ; lentille du BAS = signal normal
// (aspect du canton : occupation / rouge forcé). Le train n'est bloqué que
// lorsque les DEUX lentilles sont rouges.
function drawRailJunctionSignal(sig, def){
  const [du, dv] = rotDir(def.dx, def.dy);
  const [sx, sy] = railSignalScreenPos(sig.x, sig.y, def);
  const aheadGreen = !sig.forcedRed && railJunctionDownstreamClear(sig);
  const blockGreen = railBlockSignalClear(sig);
  const topColor = aheadGreen ? '#35ff64' : '#ff3030';
  const botColor = blockGreen ? '#35ff64' : '#ff3030';

  // Même calcul de perspective que drawRailSignal : direction écran de la
  // lampe, puis classement face / profil / cardinal / dos.
  let fx = (du - dv) * TW2, fy = (du + dv) * TH2;
  const flen = Math.hypot(fx, fy) || 1;
  fx /= flen; fy /= flen;
  const facing = fy > 0.001;
  const sideOn = Math.abs(fy) < 0.3;
  const cardinal = !sideOn && Math.abs(fx) > 0.3 && Math.abs(fy) > 0.3;
  const depth = 4;
  // Centres verticaux des deux lentilles (boîtier plus haut que le feu simple).
  const topY = sy - 11, botY = sy - 3;
  const casingTop = sy - 16, casingH = 22;

  ctx.save();
  // Poteau
  ctx.strokeStyle = '#0b1017';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx, sy + 2);
  ctx.lineTo(sx, sy + 9);
  ctx.stroke();

  const drawCasing = (half) => {
    ctx.fillStyle = 'rgba(18,24,32,.95)';
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(sx - half, casingTop, half * 2, casingH, 2);
    else ctx.rect(sx - half, casingTop, half * 2, casingH);
    ctx.fill();
    ctx.strokeStyle = '#0b1017';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  };

  if(sideOn){
    // Cadre étroit vu de profil : demi-cercle débordant du côté de la lampe.
    const dir = fx >= 0 ? 1 : -1;
    const half = 2, r = 3, cx = sx + dir * half;
    drawCasing(half);
    const lens = (cy, color) => {
      ctx.shadowColor = color; ctx.shadowBlur = 8; ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, dir < 0);
      ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.beginPath(); ctx.arc(cx + dir, cy - 1, 1, 0, Math.PI * 2); ctx.fill();
    };
    lens(topY, topColor); lens(botY, botColor);
  } else if(cardinal){
    // Rails cardinaux : demi-cercles orientés dans l'axe du rail.
    const ang = Math.atan2(fy, fx);
    const half = 2.5, r = 2.8;
    const lens = (by, color, off, blur, reflect) => {
      const cx = sx + fx * off, cy = by + fy * off;
      ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, ang - Math.PI / 2, ang + Math.PI / 2);
      ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
      if(reflect){
        ctx.fillStyle = 'rgba(255,255,255,.7)';
        ctx.beginPath(); ctx.arc(cx + fx, cy + fy, 1, 0, Math.PI * 2); ctx.fill();
      }
    };
    if(facing){
      drawCasing(half);
      lens(topY, topColor, 2.4, 8, true);
      lens(botY, botColor, 2.4, 8, true);
    } else {
      // Dos : croissants devinés derrière le boîtier dessiné par-dessus.
      lens(topY, topColor, 1.4, 3, false);
      lens(botY, botColor, 1.4, 3, false);
      drawCasing(half);
    }
  } else if(facing){
    // Face éclairée vers le joueur : boîtier puis lentilles pleines.
    drawCasing(5);
    const lx = sx + fx * depth;
    const lens = (by, color) => {
      const ly = by + fy * depth * 0.4;
      ctx.shadowColor = color; ctx.shadowBlur = 8; ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.beginPath(); ctx.arc(lx - 1, ly - 1, 1, 0, Math.PI * 2); ctx.fill();
    };
    lens(topY, topColor); lens(botY, botColor);
  } else {
    // Dos du signal : lueurs colorées qui débordent, puis boîtier par-dessus.
    ctx.save();
    ctx.shadowBlur = 9; ctx.globalAlpha = 0.75;
    const glow = (cy, color) => {
      ctx.shadowColor = color; ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(sx, cy, 4, 2.4, 0, 0, Math.PI * 2); ctx.fill();
    };
    glow(topY, topColor); glow(botY, botColor);
    ctx.restore();
    drawCasing(5);
  }
  ctx.restore();
}

function drawRailSignal(sig){
  const def = RAIL_DIRS.find(d => d.bit === sig.bit);
  if(!def) return;
  if(sig.kind === 'junction'){ drawRailJunctionSignal(sig, def); return; }
  const [du, dv] = rotDir(def.dx, def.dy);
  const [sx, sy] = railSignalScreenPos(sig.x, sig.y, def);
  const isGreen = railSignalAspect(sig);
  const color = isGreen ? '#35ff64' : '#ff3030';

  // Direction écran vers laquelle pointe la lampe : le feu « regarde » dans le
  // sens du rail (def), c.-à-d. vers le mécanicien qui l'aborde. On projette ce
  // vecteur monde -> écran. fy > 0 => la face éclairée est tournée vers la
  // caméra (couleur visible) ; fy < 0 => on voit le dos du signal et la couleur
  // reste cachée pour le joueur (mais le mécanicien, lui, la voit toujours).
  let fx = (du - dv) * TW2, fy = (du + dv) * TH2;
  const flen = Math.hypot(fx, fy) || 1;
  fx /= flen; fy /= flen;
  const facing = fy > 0.001;           // lampe tournée vers la caméra
  // Rails qui apparaissent ~horizontaux à l'écran (sens 1,-1 / -1,1) : la lampe
  // est vue de profil (fy≈0). Ni « face » ni « dos » exploitables -> rendu
  // dédié avec un cadre étroit et la couleur sur un demi-cercle qui dépasse.
  const sideOn = Math.abs(fy) < 0.3;
  // Rails cardinaux (1,0 / -1,0 / 0,1 / 0,-1) : projetés en diagonale écran. Le
  // panneau est tourné dans l'axe du rail (~45° iso) pour simuler la perspective.
  const cardinal = !sideOn && Math.abs(fx) > 0.3 && Math.abs(fy) > 0.3;
  const depth = 4;                     // décalage de la lentille hors du boîtier
  // On atténue la composante VERTICALE de ce décalage : sur les rails quasi
  // verticaux (ex. sens -1,-1, fy≈1) la lentille « sortait » trop vers le bas et
  // se retrouvait dans le bas du panneau. Le décalage horizontal reste entier.
  const lx = sx + fx * depth, ly = sy - 3.5 + fy * depth * 0.4;

  ctx.save();
  // Poteau vertical court pour ancrer le signal au sol
  ctx.strokeStyle = '#0b1017';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx, sy + 2);
  ctx.lineTo(sx, sy + 8);
  ctx.stroke();

  const drawCasing = () => {
    ctx.fillStyle = 'rgba(18,24,32,.95)';
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(sx - 5, sy - 9, 10, 14, 2);
    else ctx.rect(sx - 5, sy - 9, 10, 14);
    ctx.fill();
    ctx.strokeStyle = '#0b1017';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  };

  if(sideOn){
    // Cadre étroit vu de profil. La couleur est visible sur un demi-cercle qui
    // dépasse du côté où pointe la lampe -> lisible pour les deux sens du rail.
    const dir = fx >= 0 ? 1 : -1;
    const half = 2;                    // demi-largeur du cadre (étroit)
    ctx.fillStyle = 'rgba(18,24,32,.95)';
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(sx - half, sy - 9, half * 2, 14, 1.5);
    else ctx.rect(sx - half, sy - 9, half * 2, 14);
    ctx.fill();
    ctx.strokeStyle = '#0b1017';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    const cx = sx + dir * half, cy = sy - 2.5, r = 3.5;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, dir < 0);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    // Reflet
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.beginPath();
    ctx.arc(cx + dir, cy - 1, 1, 0, Math.PI * 2);
    ctx.fill();
  } else if(cardinal){
    // Cadre droit (non incliné). La lentille est un demi-cercle orienté DANS l'axe
    // du rail (fx,fy) -> elle « regarde » la locomotive qui arrive. Face avant
    // (fy>0) : couleur vive vers la caméra ; dos : mince croissant deviné.
    const ang = Math.atan2(fy, fx);    // direction écran du rail, vers le train
    const half = 2.5, r = 3.2, bx = sx, by = sy - 2;
    const upCasing = () => {
      ctx.fillStyle = 'rgba(18,24,32,.95)';
      ctx.beginPath();
      if(ctx.roundRect) ctx.roundRect(sx - half, sy - 9, half * 2, 14, 1.5);
      else ctx.rect(sx - half, sy - 9, half * 2, 14);
      ctx.fill();
      ctx.strokeStyle = '#0b1017';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    };
    if(facing){
      upCasing();
      const cx = bx + fx * 2.6, cy = by + fy * 2.6;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, ang - Math.PI / 2, ang + Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.beginPath();
      ctx.arc(cx + fx, cy + fy, 1, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Dos : lentille derrière le boîtier, il n'en dépasse qu'un mince croissant.
      const cx = bx + fx * 1.4, cy = by + fy * 1.4;
      ctx.shadowColor = color;
      ctx.shadowBlur = 3;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, ang - Math.PI / 2, ang + Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      upCasing();
    }
  } else if(facing){
    // Face éclairée vers le joueur : boîtier puis lentille allumée par-dessus.
    drawCasing();
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Petit point central blanc pour suggérer le reflet
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.beginPath();
    ctx.arc(lx - 1, ly - 1, 1, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // On voit le dos du signal : la lampe est sur la face avant, donc cachée par
    // le boîtier. On dessine d'ABORD la lueur colorée, puis le boîtier PAR-DESSUS
    // (il occulte la partie qui le recouvre) : seul le halo qui déborde autour du
    // panneau reste visible, comme le reflet du feu rayonnant derrière la caisse.
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 9;
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(sx, sy - 9, 4, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    drawCasing();
  }
  ctx.restore();
}

function drawTownLabels(){
  townLabelHits = [];
  if(!towns.length) return;
  const z = cam.z;
  for(const t of towns){
    const members = buildings.filter(b => !b.dead && b.townId === t.id && BUILD[b.type]?.resid);
    if(!members.length) continue;
    const isOwn = townOwnedBy(t);
    const isSelectedTown = t.id === selectedTownId;

    const pop = members.reduce((s, b) => s + (b.pop||0), 0);

    // Centroïde en tiles → position X centrale du label
    let sx = 0, sy = 0;
    for(const b of members){ sx += b.x + b.w/2; sy += b.y + b.h/2; }
    const cx = sx / members.length, cy = sy / members.length;
    const [ruc, rvc] = rotF(cx, cy);
    const [ix] = liftedIso(ruc, rvc, terrainLiftPxAtRot(ruc, rvc));

    // Trouver le point le plus haut (min Y iso) parmi tous les bâtiments du village
    let topIsoY = Infinity;
    for(const b of members){
      const [ru, rv] = rotF(b.x + b.w/2, b.y + b.h/2);
      const [, biy] = liftedIso(ru, rv, buildingLiftPx(b));
      const bTop = biy - BUILD[b.type].hgt;
      if(bTop < topIsoY) topIsoY = bTop;
    }
    const labelIy = topIsoY - 14; // marge au-dessus du toit le plus haut

    // Conversion iso → CSS pixels
    const cssX = (ix  - cam.x) * z;
    const cssY = (labelIy - cam.y) * z;

    if(cssX < -300 || cssX > W + 300 || cssY < -60 || cssY > H + 20) continue;

    const label = t.name + (pop > 0 ? ' · ' + pop + ' 👤' : '');

    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px "Segoe UI Emoji","Segoe UI",sans-serif';
    const tw = ctx.measureText(label).width;
    const pw = tw + 18, ph = 20;
    const bx = cssX - pw/2, by = cssY - ph/2;
    townLabelHits.push({ id:t.id, x:bx, y:by, w:pw, h:ph });

    // Fond pilule
    ctx.globalAlpha = isSelectedTown ? 0.96 : 0.88;
    ctx.fillStyle = isSelectedTown ? '#143659' : '#0c1a2b';
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(bx, by, pw, ph, 5);
    else ctx.rect(bx, by, pw, ph);
    ctx.fill();

    // Bordure dorée
    ctx.globalAlpha = isSelectedTown ? 0.95 : 0.65;
    ctx.strokeStyle = isSelectedTown ? '#7fb0ff' : (isOwn ? '#c9a830' : '#6e7480');
    ctx.lineWidth = isSelectedTown ? 2 : 1;
    ctx.stroke();

    // Texte
    ctx.globalAlpha = 1;
    ctx.fillStyle = isSelectedTown ? '#ffffff' : '#f0dc90';
    ctx.fillText(label, cssX, cssY);
    ctx.restore();
  }
}

function drawTrainDepotFlags(){
  trainDepotFlagHits = [];
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 11px "Segoe UI Emoji","Segoe UI",sans-serif';
  for(const depot of buildings){
    if(depot.dead || (depot.type !== 'train_depot' && depot.type !== 'garage')) continue;
    const trains = (depot.vehicles || []).filter(v =>
      depot.type === 'train_depot'
        ? trainPresentAtDepot(v) && (v.orders?.length || 0) >= 2
        : v.vtype !== 'train' && vehiclePresentAtDepot(v) && v.source && v.dest
    );
    if(!trains.length) continue;
    const center = centerOfBuilding(depot);
    const [u, v] = rotF(center.x, center.y);
    const [ix, iy] = liftedIso(u, v, buildingLiftPx(depot));
    const cssX = (ix - cam.x) * cam.z;
    const cssY = (iy - cam.y) * cam.z - 28;
    if(cssX < -60 || cssX > W + 60 || cssY < -80 || cssY > H + 40) continue;
    // Un seul drapeau par dépôt, avec le nombre de trains présents.
    // Vert = tous prêts à partir, rouge = aucun, ambre = mixte.
    const armedCount = trains.reduce((n, t) => {
      const s = vehicleDepotFlagState(t);
      return n + (s && s.armed ? 1 : 0);
    }, 0);
    const flagColor = armedCount === trains.length ? '#7dda5a'
                    : armedCount > 0 ? '#ffce5a' : '#ff7474';
    const bx = cssX - 12;
    const by = cssY;
    ctx.fillStyle = '#c8d3df';
    ctx.fillRect(bx, by - 9, 2, 14);
    ctx.fillStyle = flagColor;
    ctx.beginPath();
    ctx.moveTo(bx + 2, by - 8);
    ctx.lineTo(bx + 11, by - 5);
    ctx.lineTo(bx + 2, by - 1);
    ctx.closePath();
    ctx.fill();
    const label = '×' + trains.length;
    ctx.strokeStyle = 'rgba(0,0,0,.75)';
    ctx.lineWidth = 2.5;
    ctx.strokeText(label, bx + 14, by - 2);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, bx + 14, by - 2);
    const labelW = ctx.measureText(label).width;
    trainDepotFlagHits.push({ depot, x:bx - 4, y:by - 12, w:18 + labelW + 6, h:20 });
  }
  ctx.restore();
}

// Corps directionnel (locomotive / voiture) : ombre + prismes. Source partagée
// rendu + baking Pixi. (Les anneaux focus/sélection + label cargo sont des overlays.)
function drawTrainLocoCore(u, v, du, dv, color){
  const c = entityIso(u, v);
  const lift = terrainLiftPxAtRot(u, v);
  const hl=0.34, hw=0.16, nd=Math.hypot(du,dv)||1;
  const fn_l=du/nd, fv_l=dv/nd;
  const shadowAngle_l = Math.atan2((fn_l+fv_l)*TH2, (fn_l-fv_l)*TW2);
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  ctx.beginPath(); ctx.ellipse(c[0]+1, c[1]+2, 13, 5.5, shadowAngle_l, 0, Math.PI*2); ctx.fill();
  trainPrism(u, v, du, dv, hl,      hw,      6, '#2f3640', lift);
  trainPrism(u, v, du, dv, hl*0.78, hw*0.78, 8, color, lift + 5);
  trainPrism(u+(du/nd)*0.06, v+(dv/nd)*0.06, du, dv, hl*0.28, hw, 10, '#92a2b4', lift + 8);
}
function drawCarCore(u, v, du, dv, color){
  const c = entityIso(u, v);
  const lift = terrainLiftPxAtRot(u, v);
  const nd = Math.hypot(du, dv) || 1;
  const fn = du/nd, fv = dv/nd;
  const shadowAngle = Math.atan2((fn+fv)*TH2, (fn-fv)*TW2);
  ctx.fillStyle = 'rgba(0,0,0,.20)';
  ctx.beginPath(); ctx.ellipse(c[0]+1, c[1]+1, 10, 4.6, shadowAngle, 0, Math.PI*2); ctx.fill();
  trainPrism(u, v, du, dv, 0.23, 0.13, 5, '#39404c', lift);
  trainPrism(u, v, du, dv, 0.23*0.72, 0.13*0.72, 7, color, lift + 5);
}
function vehiclePose(veh){
  const rs = typeof mpVehicleRenderState === 'function' ? mpVehicleRenderState(veh) : veh;
  if(!rs.pts || !rs.pts.length) return null;
  if(veh.vtype === 'train') return trainPose(veh);
  const {u, v} = lanePose(rs.pts, rs.seg, rs.t, veh.overtaking ? -0.17 : 0.17);
  const [bDx, bDy] = trainBlendedDir(rs.pts, rs.seg, rs.t);
  const [du, dv] = rotDir(bDx, bDy);
  return { u, v, du, dv };
}
function vehicleColor(veh){
  const vt = VEHICLE_TYPES[veh.vtype];
  if(veh.vtype === 'train'){
    const o = veh.garageRef?.owner ?? null;
    return o != null ? playerColor(o) : vt.color;
  }
  return vt.color;
}
function drawVehicle(veh){
  const p = vehiclePose(veh); if(!p) return;
  const { u, v, du, dv } = p;
  const c = entityIso(u, v);
  const vt = VEHICLE_TYPES[veh.vtype];
  if(veh.vtype === 'train'){
    drawTrainLocoCore(u, v, du, dv, vehicleColor(veh));
  } else {
    drawCarCore(u, v, du, dv, vt.color);
    if(!drawFast && veh.cargo > 0){
      const label = vt.icone + ' ' + veh.cargo;
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 2;
      ctx.strokeText(label, c[0], c[1] - TH);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, c[0], c[1] - TH);
    }
  }
  const isTrain = veh.vtype === 'train';
  if(veh === focusVehicle){
    const pu = 0.6 + 0.4*Math.sin(performance.now()/300);
    ctx.save();
    ctx.strokeStyle = '#4dd9ff'; ctx.lineWidth = 3; ctx.globalAlpha = 0.45 + 0.4*pu;
    ctx.beginPath(); ctx.ellipse(c[0], c[1], (isTrain?17:15) + 1.5*pu, isTrain?8:7, 0, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }
  if(veh === selectedVehicle){
    ctx.save();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.ellipse(c[0], c[1], isTrain?15:13, isTrain?7:6, 0, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }
}

const EXP_N_PIECES = 3; // pièces de puzzle par côté

// Badge de prix canvas (remplace les anciennes fonctions jigsawPath/expPieceTabs devenus inutiles)
function jigsawPath(cx, cy, w, h, tabs){
  const r  = Math.min(w, h) * 0.10; // rayon de coin
  const tr = Math.min(w, h) * 0.20; // rayon de tab/slot
  const x0 = cx - w/2, x1 = cx + w/2;
  const y0 = cy - h/2, y1 = cy + h/2;
  const PI = Math.PI;

  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);

  // Bord TOP (gauche → droite)
  if(tabs.top === 'tab'){
    ctx.lineTo(cx - tr, y0);
    ctx.arc(cx, y0, tr, PI, 0, false);   // tab vers le HAUT
    ctx.lineTo(x1 - r, y0);
  } else if(tabs.top === 'slot'){
    ctx.lineTo(cx - tr, y0);
    ctx.arc(cx, y0, tr, PI, 0, true);    // slot vers le BAS (rentrant)
    ctx.lineTo(x1 - r, y0);
  } else { ctx.lineTo(x1 - r, y0); }

  ctx.quadraticCurveTo(x1, y0, x1, y0 + r);

  // Bord RIGHT (haut → bas)
  if(tabs.right === 'tab'){
    ctx.lineTo(x1, cy - tr);
    ctx.arc(x1, cy, tr, PI*1.5, PI*0.5, false); // tab vers la DROITE
    ctx.lineTo(x1, y1 - r);
  } else if(tabs.right === 'slot'){
    ctx.lineTo(x1, cy - tr);
    ctx.arc(x1, cy, tr, PI*1.5, PI*0.5, true);  // slot vers la GAUCHE
    ctx.lineTo(x1, y1 - r);
  } else { ctx.lineTo(x1, y1 - r); }

  ctx.quadraticCurveTo(x1, y1, x1 - r, y1);

  // Bord BOTTOM (droite → gauche)
  if(tabs.bottom === 'tab'){
    ctx.lineTo(cx + tr, y1);
    ctx.arc(cx, y1, tr, 0, PI, false);   // tab vers le BAS
    ctx.lineTo(x0 + r, y1);
  } else if(tabs.bottom === 'slot'){
    ctx.lineTo(cx + tr, y1);
    ctx.arc(cx, y1, tr, 0, PI, true);    // slot vers le HAUT
    ctx.lineTo(x0 + r, y1);
  } else { ctx.lineTo(x0 + r, y1); }

  ctx.quadraticCurveTo(x0, y1, x0, y1 - r);

  // Bord LEFT (bas → haut)
  if(tabs.left === 'tab'){
    ctx.lineTo(x0, cy + tr);
    ctx.arc(x0, cy, tr, PI*0.5, PI*1.5, false); // tab vers la GAUCHE
    ctx.lineTo(x0, y0 + r);
  } else if(tabs.left === 'slot'){
    ctx.lineTo(x0, cy + tr);
    ctx.arc(x0, cy, tr, PI*0.5, PI*1.5, true);  // slot vers la DROITE
    ctx.lineTo(x0, y0 + r);
  } else { ctx.lineTo(x0, y0 + r); }

  ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
  ctx.closePath();
}

// Détermine les tabs d'une pièce selon sa position dans le côté
function expPieceTabs(side, pi, n){
  const t = { left:'flat', right:'flat', top:'flat', bottom:'flat' };
  // Face vers la carte = tab (s'emboîte sur le bord existant)
  if(side === 'right')  t.left   = 'tab';
  if(side === 'left')   t.right  = 'tab';
  if(side === 'bottom') t.top    = 'tab';
  if(side === 'top')    t.bottom = 'tab';
  // Interfaces entre pièces voisines : tab alternent avec slots
  if(side === 'right' || side === 'left'){
    if(pi < n-1) t.bottom = (pi%2===0) ? 'tab' : 'slot';
    if(pi > 0)   t.top    = ((pi-1)%2===0) ? 'slot' : 'tab';
  } else {
    if(pi < n-1) t.right = (pi%2===0) ? 'tab' : 'slot';
    if(pi > 0)   t.left  = ((pi-1)%2===0) ? 'slot' : 'tab';
  }
  return t;
}

function drawExpansionBadges(){
  if(drawFast) return;
  for(const exp of expansions){
    const isHov = exp === hoveredExpansion;
    const isSel = exp === selectedExpansion;
    const canAfford = myWallet().money >= exp.cost;
    // Centre ISO de la pièce
    const [ru, rv] = rotF(exp.cx, exp.cy);
    const [px, py] = liftedIso(ru, rv, terrainLiftPxAtRot(ru, rv));
    const pulse = 0.85 + 0.15 * Math.sin(gtime * 2.4 + exp.cx * 0.12);

    // Mini badge fond
    const R = TH * 1.35;
    ctx.save();
    ctx.beginPath(); ctx.arc(px, py, R, 0, Math.PI*2);
    ctx.fillStyle = isSel ? 'rgba(12,50,38,0.96)' : `rgba(8,25,20,${0.85*pulse})`;
    ctx.fill();
    ctx.strokeStyle = isSel ? 'rgba(60,240,150,1)' : `rgba(50,190,130,${0.65*(isHov?1.4:1)*pulse})`;
    ctx.lineWidth = isSel ? 2.5 : 1.5;
    ctx.stroke();
    ctx.restore();

    // Prix
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 4;
    ctx.fillStyle = canAfford ? '#ffe9a0' : '#ff9a8a';
    ctx.font = 'bold '+Math.round(TH*0.52)+'px "Segoe UI",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(exp.cost.toLocaleString()+'$', px, py);
    ctx.restore();
  }
}

// Exposés pour la couche terrain PixiJS (Phase 2, flag ?pixiterrain) : offset de blit
// du scroll-buffer + version incrémentée à chaque reconstruction (→ re-upload texture).
let groundBlitSrcX = 0, groundBlitSrcY = 0, groundTexVersion = 0, cacheCamZ = 1;
// Terrain sur Pixi ACTIVÉ PAR DÉFAUT. Trappe de secours : ?nopixiterrain force le Canvas2D.
// L'usage réel est gaté sur PixiScene.ready (voir usePixiTerrain dans draw()) → si Pixi
// n'initialise pas (WebGL indispo), on retombe automatiquement sur le rendu Canvas2D.
let PIXI_TERRAIN = !(typeof location !== 'undefined' && location.search.includes('nopixiterrain'));

function draw(){
  // Sécurité : si une frame précédente a jeté pendant le rendu du buffer-sol, `ctx`
  // pourrait être resté pointé sur groundCacheCtx. getContext('2d') renvoie le contexte
  // mémorisé du canvas principal → on repart toujours d'un état sain.
  ctx = cv.getContext('2d');
  drawFast = performance.now() < zoomActiveUntil || Math.abs(targetCam.z - cam.z) > 0.006;
  const pack = graphicBasePack();

  // --- scroll-buffer de la couche sol (ciel + terrain + routes + rails) ---
  // Le sol est rendu dans un buffer offscreen plus grand que le viewport (marge M).
  // Tant que la caméra reste dans la marge et que rien d'autre n'a changé, on blitte
  // le buffer décalé sans rien redessiner. La clé de CONTENU exclut cam.x/cam.y (gérés
  // par l'offset de blit) et n'inclut que ce qui change réellement les pixels du sol.
  // En zoom actif (drawFast) on bypasse le buffer : rendu direct sur le canvas
  // principal comme avant. Les éléments dynamiques (feux, signaux) sont HORS buffer.
  const z = cam.z;
  const M = GROUND_BUFFER_MARGIN;
  const contentKey = cam.z + '|' + rot + '|' + groundVersion + '|'
    + cv.width + '|' + cv.height + '|'
    + expansions.indexOf(hoveredExpansion) + '|' + expansions.indexOf(selectedExpansion);
  const bufW = (W + 2*M) * DPR, bufH = (H + 2*M) * DPR;
  // Offset de blit buffer→principal (en px device). Le buffer couvre une zone centrée
  // sur cacheCam ; le viewport courant y pioche à srcX/srcY.
  let srcX = ((cam.x - cacheCamX) * z + M) * DPR;
  let srcY = ((cam.y - cacheCamY) * z + M) * DPR;
  const bufferReusable = !drawFast
    && _bufContentKey === contentKey
    && groundCache.width === bufW && groundCache.height === bufH
    && srcX >= 0 && srcX <= 2*M*DPR && srcY >= 0 && srcY <= 2*M*DPR;
  // Terrain sur Pixi UNIQUEMENT si la scène Pixi est prête (sinon fallback Canvas2D).
  const usePixiTerrain = PIXI_TERRAIN && typeof PixiScene !== 'undefined' && PixiScene.ready;
  // En mode Pixi-terrain, on reconstruit AUSSI pendant le zoom (drawFast) : le sol part
  // dans groundCache (au lieu de #cv, de toute façon caché) → terrain net et suivi au zoom.
  // Même coût de rendu qu'aujourd'hui (le drawFast re-rend le sol chaque frame), juste
  // redirigé, + un re-upload de texture. Hors mode Pixi : comportement inchangé.
  const rebuildBuffer = (!drawFast && !bufferReusable) || (drawFast && usePixiTerrain);
  const groundDirty = rebuildBuffer || drawFast; // exécuter les tracés coûteux du sol ?

  // CIEL : en mode Pixi-terrain, ciel + sol sont sur Pixi ; #cv (au-dessus) ne porte
  // QUE les overlays dynamiques (transparent) → on l'efface. Sinon, ciel repère écran.
  if(usePixiTerrain){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,cv.width,cv.height);
    ctx.setTransform(DPR,0,0,DPR,0,0);
  } else {
    ctx.setTransform(DPR,0,0,DPR,0,0);
    const sky = ctx.createLinearGradient(0,0,0,H);
    sky.addColorStop(0, pack.sky[0]);
    sky.addColorStop(1, pack.sky[1]);
    ctx.fillStyle = sky;
    ctx.fillRect(0,0,W,H);
  }

  // Pendant une reconstruction, on dessine le sol DANS le buffer : on bascule le
  // global `ctx` vers groundCacheCtx (restauré plus bas). cacheCam = caméra courante.
  const mainCtx = ctx;
  if(rebuildBuffer){
    if(groundCache.width !== bufW || groundCache.height !== bufH){
      groundCache.width = bufW; groundCache.height = bufH; // redimensionner efface
    } else {
      groundCacheCtx.setTransform(1,0,0,1,0,0);
      groundCacheCtx.clearRect(0,0,bufW,bufH); // void transparent (ciel transparaît)
    }
    cacheCamX = cam.x; cacheCamY = cam.y; cacheCamZ = cam.z; // zoom au moment du bake
    srcX = M * DPR; srcY = M * DPR; // cam == cacheCam → blit centré
    ctx = groundCacheCtx;
  }

  // Origine du repère monde→pixels : décalée de la marge quand on rend dans le buffer.
  const originX = rebuildBuffer ? M*DPR : 0;
  const originY = rebuildBuffer ? M*DPR : 0;
  const camX = rebuildBuffer ? cacheCamX : cam.x;
  const camY = rebuildBuffer ? cacheCamY : cam.y;

  ctx.setTransform(DPR*z,0,0,DPR*z, -camX*DPR*z + originX, -camY*DPR*z + originY);

  // fenêtre visible en px iso. En reconstruction on l'élargit de la marge (M/z) pour
  // peupler aussi la bordure du buffer.
  const bufMarginWorld = rebuildBuffer ? M/z : 0;
  const vx0 = camX - TW - bufMarginWorld, vx1 = camX + W/z + TW + bufMarginWorld;
  const vy0 = camY - TH*3 - 160 - bufMarginWorld, vy1 = camY + H/z + TH*2 + bufMarginWorld; // marge haute = gratte-ciel

  const isoToTile = (px,py)=> [ (px/TW2 + py/TH2)/2, (py/TH2 - px/TW2)/2 ];
  const viewCorners = [
    isoToTile(vx0-TW, vy0-TH),
    isoToTile(vx1+TW, vy0-TH),
    isoToTile(vx0-TW, vy1+TH),
    isoToTile(vx1+TW, vy1+TH),
  ];
  let minRx = N-1, maxRx = 0, minRy = N-1, maxRy = 0;
  for(const [u,v] of viewCorners){
    minRx = Math.min(minRx, Math.floor(u)-2);
    maxRx = Math.max(maxRx, Math.ceil(u)+2);
    minRy = Math.min(minRy, Math.floor(v)-2);
    maxRy = Math.max(maxRy, Math.ceil(v)+2);
  }
  minRx = Math.max(0, minRx); minRy = Math.max(0, minRy);
  maxRx = Math.min(N-1, maxRx); maxRy = Math.min(N-1, maxRy);
  const radiusSel = selected && !selected.dead && BUILD[selected.type]?.resid ? {
    center: centerOfBuilding(selected),
    r: workRadiusOf(selected),
    color: playerColor(selected.owner),
  } : null;
  const depotRadiusSel = selected && !selected.dead && BUILD[selected.type]?.storageHub && selected.type !== 'tank' ? {
    center: centerOfBuilding(selected),
    r: BUILD[selected.type]?.radiusOf ? BUILD[selected.type].radiusOf(selected) : depotRadiusOf(selected),
  } : null;
  const tankRadiusSel = selected && !selected.dead && selected.type === 'tank' ? {
    center: centerOfBuilding(selected),
    r: tankRadiusOf(selected),
  } : null;
  const indRadiusSel = selected && !selected.dead && BUILD[selected.type]?.ind ? {
    center: centerOfBuilding(selected),
    r: indRadiusOf(selected),
  } : null;
  const fisherRadiusSel = selected && !selected.dead && selected.type === 'fisher' ? {
    center: centerOfBuilding(selected),
    r: fisherRadiusOf(selected),
  } : null;
  const visibleFish = [];

  // --- passe 1 : sol (ordre ligne par ligne = peintre) ---
  for(let ry=minRy; ry<=maxRy; ry++) for(let rx=minRx; rx<=maxRx; rx++){
    const px = (rx-ry)*TW2, py = (rx+ry)*TH2;
    if(px < vx0-TW || px > vx1 || py < vy0 || py > vy1) continue;
    const [x,y] = invRotIdx(rx,ry);
    if(x<0||y<0||x>=N||y>=N) continue;
    const i = y*N+x, t = terrain[i];
    const lift = terrainLiftPxAt(x, y);
    const snowAmount = t === T.WATER ? 0 : snowAmountForTile(x, y);

    // Tuiles hors zone jouable : zones d'expansion ou void (sol → caché)
    const inPlay = !!mapMask && mapMask[i]===1;
    if(!inPlay){
      if(groundDirty){
        const expZone = expansions.find(e=>e.inPiece(x,y));
        if(expZone){
          // Terrain dim + overlay sarcelle teinté par pièce
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = packTerrain(t, x, y);
          tilePolygon(rx, ry, x, y); ctx.fill();
          ctx.globalAlpha = 1;
          const isHov = expZone === hoveredExpansion;
          const isSel = expZone === selectedExpansion;
          // Couleur légèrement différente par pièce pour distinguer visuellement
          const PIECE_COLS = ['rgba(14,68,52,0.68)','rgba(20,82,62,0.68)','rgba(10,58,44,0.68)'];
          const hovCol = isSel ? 'rgba(50,180,120,0.80)' : isHov ? 'rgba(38,150,105,0.75)' : PIECE_COLS[expZone.pieceIndex%3];
          ctx.fillStyle = hovCol;
          tilePolygon(rx, ry, x, y); ctx.fill();
          // Bordure lumineuse sur les tuiles adjacentes à la zone jouable
          if(!drawFast){
            const nextToMap = (x>0&&mapMask[i-1]===1)||(x<N-1&&mapMask[i+1]===1)
                            ||(y>0&&mapMask[i-N]===1)||(y<N-1&&mapMask[i+N]===1);
            if(nextToMap){
              ctx.strokeStyle = isHov||isSel ? 'rgba(60,220,150,0.90)' : 'rgba(40,160,100,0.50)';
              ctx.lineWidth = 1.5;
              tilePolygon(rx, ry, x, y); ctx.stroke();
            }
          }
        }
      }
      continue;
    }

    if(groundDirty){
    if(t===T.WATER){
      ctx.fillStyle = packTerrain(T.WATER, x, y);
      tilePolygon(rx, ry, x, y); ctx.fill();
    } else {
      ctx.fillStyle = packTerrain(t, x, y);
      tilePolygon(rx, ry, x, y); ctx.fill();
      if(snowAmount > 0){
        ctx.save();
        ctx.globalAlpha = 0.24 + snowAmount * 0.46;
        ctx.fillStyle = '#eef5fb';
        tilePolygon(rx, ry, x, y); ctx.fill();
        ctx.restore();
      }
      if(!drawFast && t===T.WHEAT){
        const hs = hash(x,y), c = tileCenterIso(rx, ry, x, y);
        ctx.strokeStyle = '#d7b348';
        ctx.lineWidth = 1.2;
        for(let k=0;k<6;k++){
          const ox = ((hs>>(k*3))&7)/7*TW*0.42 - TW*0.21;
          const oy = ((hs>>(k*3+6))&7)/7*TH*0.34 - TH*0.17;
          ctx.beginPath();
          ctx.moveTo(c[0]+ox, c[1]+oy+5);
          ctx.lineTo(c[0]+ox+((k&1)?2:-2), c[1]+oy-4);
          ctx.stroke();
        }
      }
      if(!drawFast && t===T.COTTON){
        const hs = hash(x,y), c = tileCenterIso(rx, ry, x, y);
        for(let k=0;k<7;k++){
          const ox = ((hs>>(k*3))&7)/7*TW*0.42 - TW*0.21;
          const oy = ((hs>>(k*3+6))&7)/7*TH*0.34 - TH*0.17;
          ctx.fillStyle = 'rgba(245,242,224,.92)';
          ctx.beginPath(); ctx.ellipse(c[0]+ox, c[1]+oy-2, 4.2, 2.8, 0, 0, 7); ctx.fill();
          ctx.strokeStyle = 'rgba(116,126,88,.75)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(c[0]+ox, c[1]+oy+5); ctx.lineTo(c[0]+ox, c[1]+oy); ctx.stroke();
        }
      }
      if(!drawFast && (t===T.IRON || t===T.COAL)){
        ctx.fillStyle = t===T.IRON ? '#c0763a' : '#23232b';
        const hs = hash(x,y), c = tileCenterIso(rx, ry, x, y);
        for(let k=0;k<4;k++){
          const ox = ((hs>>(k*4))&7)/7*TW*0.36 - TW*0.18;
          const oy = ((hs>>(k*4+8))&7)/7*TH*0.36 - TH*0.18;
          ctx.beginPath(); ctx.ellipse(c[0]+ox, c[1]+oy, 4.2, 2.6, 0, 0, 7); ctx.fill();
        }
      }
      if(!drawFast && t===T.SAND){
        const hs = hash(x,y), c = tileCenterIso(rx, ry, x, y);
        ctx.fillStyle = 'rgba(247,228,176,.70)';
        for(let k=0;k<6;k++){
          const ox = ((hs>>(k*3))&7)/7*TW*0.46 - TW*0.23;
          const oy = ((hs>>(k*3+6))&7)/7*TH*0.38 - TH*0.19;
          ctx.beginPath(); ctx.arc(c[0]+ox, c[1]+oy, 1.2 + ((hs>>(k*3+9))&1)*0.5, 0, Math.PI*2); ctx.fill();
        }
      }
      if(!drawFast && t===T.CLAY){
        const hs = hash(x,y), c = tileCenterIso(rx, ry, x, y);
        ctx.fillStyle = 'rgba(123,78,58,.30)';
        for(let k=0;k<4;k++){
          const ox = ((hs>>(k*4))&7)/7*TW*0.40 - TW*0.20;
          const oy = ((hs>>(k*4+8))&7)/7*TH*0.32 - TH*0.16;
          const rw = 5 + ((hs>>(k*4+12))&3);
          const rh = 2.4 + ((hs>>(k*4+14))&1);
          ctx.beginPath(); ctx.ellipse(c[0]+ox, c[1]+oy, rw, rh, ((hs>>(k*4+16))&3) * 0.2, 0, Math.PI*2); ctx.fill();
        }
      }
    }

    if(!drawFast && t===T.WATER && getFishTiles().has(i)) visibleFish.push({ rx, ry, x, y });
    drawWaterBankFaces(rx, ry, x, y, t, snowAmount);
    } // fin if(groundDirty) — dessin du sol

    // Arbres : rendus par la couche sprites PixiJS (js/pixi/sprites.js), plus par
    // le Canvas2D. (Migration Full Pixi — Phase 1.)
    // Bâtiments (gares incluses) : rendus par la couche sprites PixiJS
    // (js/pixi/sprites.js). (Migration Full Pixi — Phase 1.)
  }

  // --- passe 2 : routes (après tout le terrain pour éviter que l'herbe écrase les gaps) ---
  const roadSegments = [];
  const roadNodes = [];
  const roadSingles = [];
  const railSegments = [];
  const railNodeSleepers = [];
  const railNodes = [];
  const railSingles = [];
  const trafficLights = [];
  const roadWidth = 28;
  const roadLineWidth = 14;
  const railWidth = 12;
  const railSleeperWidth = 20;
  const railColor = '#6f747c';
  const railLineColor = '#c7ccd3';
  for(let ry=minRy-1; ry<=maxRy+1; ry++) for(let rx=minRx-1; rx<=maxRx+1; rx++){
    const [x,y] = invRotIdx(rx,ry);
    if(x<0||y<0||x>=N||y>=N) continue;
    const i = y*N+x;
    const c = tileCenterIso(rx, ry, x, y);
    if(road[i]){
      roadNodes.push(c);
      let links = 0;
      for(const [dx,dy] of DIRS8){
        const nx = x+dx, ny = y+dy;
        if(!inMap(nx,ny) || !road[ny*N+nx]) continue;
        links++;
        if(ny < y || (ny === y && nx < x)) continue;
        if(dx !== 0 && dy !== 0 && (road[y*N+nx] || road[ny*N+x])) continue;
        const [du,dv] = rotDir(dx,dy);
        roadSegments.push([c, liftedIso(rx+du+0.5, ry+dv+0.5, terrainLiftPxAt(nx, ny))]);
      }
      if(!links) roadSingles.push(c);
      else if(!UI_OPTIONS.disableTrafficLights && isTrafficIntersectionTile({ x, y, i })){
        const tileAxis = trafficGreenAxis({ x, y, i });
        const approaches = [];
        for(const [adx,ady] of [[1,0],[-1,0],[0,1],[0,-1]]){
          const nx = x+adx, ny = y+ady;
          if(!inMap(nx,ny) || !road[ny*N+nx]) continue;
          const [du,dv] = rotDir(adx,ady);
          const axisDir = Math.abs(adx) >= Math.abs(ady) ? 'ew' : 'ns';
          approaches.push({ du, dv, green: tileAxis === axisDir });
        }
        if(approaches.length) trafficLights.push({ c, approaches });
      }
    }

    if(rail[i]){
      railNodes.push(c);
      const mask = rail[i];
      const owner = railOwner ? railOwner[i] : -1;
      let links = 0;
      const railDirs = [];
      for(const def of RAIL_DIRS){
        if(!(mask & def.bit)) continue;
        const nx = x+def.dx, ny = y+def.dy;
        if(!inMap(nx,ny)) continue;
        links++;
        const [du,dv] = rotDir(def.dx, def.dy);
        railDirs.push([du, dv]);
        if(ny < y || (ny === y && nx < x)) continue;
        // Rail masks describe explicit edges. Do not hide a diagonal edge at a
        // junction merely because the tile also has an orthogonal connection.
        railSegments.push({ a:c, b:liftedIso(rx+du+0.5, ry+dv+0.5, terrainLiftPxAt(nx, ny)), dir:[du, dv], owner });
      }
      if(!links) railSingles.push({ c, owner });
      else if(links <= 2) railNodeSleepers.push({ center:c, dirs:railDirs });
    }
  }

  const strokeSegments = (segments, width, color, cap)=>{
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = cap || 'butt';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for(const [a,b] of segments){
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
  };
  const fillNodes = (nodes, radius, color)=>{
    ctx.fillStyle = color;
    for(const c of nodes){
      ctx.beginPath(); ctx.arc(c[0], c[1], radius, 0, Math.PI*2); ctx.fill();
    }
  };
  const railSleeperHalf = (perp, length)=>{
    const plen = Math.hypot(perp[0], perp[1]);
    if(plen < 0.001) return null;
    const nx = perp[0] / plen;
    const ny = perp[1] / plen;
    return [nx * length * 0.5, ny * length * 0.34];
  };
  const strokeRailPairs = (segments, gauge, width, color)=>{
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for(const seg of segments){
      const { a, b } = seg;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if(!len) continue;
      const ox = -dy / len * gauge;
      const oy = dx / len * gauge;
      ctx.moveTo(a[0] + ox, a[1] + oy);
      ctx.lineTo(b[0] + ox, b[1] + oy);
      ctx.moveTo(a[0] - ox, a[1] - oy);
      ctx.lineTo(b[0] - ox, b[1] - oy);
    }
    ctx.stroke();
  };
  const strokeRailBed = (segments, width, color)=>{
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for(const seg of segments){
      const { a, b } = seg;
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
  };
  const drawRailSleepers = (segments, count, inset, length, width, color)=>{
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for(const seg of segments){
      const { a, b, dir } = seg;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const segLen = Math.hypot(dx, dy);
      if(segLen < 0.001) continue;
      const [du, dv] = dir || [0, 0];
      const dlen = Math.hypot(du, dv);
      if(dlen < 0.001) continue;
      const perp = iso(-dv / dlen, du / dlen);
      const half = railSleeperHalf(perp, length);
      if(!half) continue;
      const [hx, hy] = half;
      for(let i = 0; i < count; i++){
        const t = inset + (1 - inset * 2) * ((i + 1) / (count + 1));
        const cx = a[0] + dx * t;
        const cy = a[1] + dy * t;
        ctx.moveTo(cx - hx, cy - hy);
        ctx.lineTo(cx + hx, cy + hy);
      }
    }
    ctx.stroke();
  };
  const drawRailNodeSleepers = (markers, length, width, color)=>{
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for(const marker of markers){
      const dirs = marker.dirs || [];
      if(!dirs.length) continue;
      let tx = 0, ty = 0;
      if(dirs.length === 1){
        [tx, ty] = dirs[0];
      } else {
        for(const [dx,dy] of dirs){ tx += dx; ty += dy; }
        if(Math.abs(tx) < 0.001 && Math.abs(ty) < 0.001){
          tx = dirs[0][0];
          ty = dirs[0][1];
        }
      }
      const tlen = Math.hypot(tx, ty);
      if(tlen < 0.001) continue;
      const perp = iso(-ty / tlen, tx / tlen);
      const half = railSleeperHalf(perp, length);
      if(!half) continue;
      const [hx, hy] = half;
      ctx.moveTo(marker.center[0] - hx, marker.center[1] - hy);
      ctx.lineTo(marker.center[0] + hx, marker.center[1] + hy);
    }
    ctx.stroke();
  };
  // Dessin du sol routes+rails : uniquement si le cache doit être (re)généré.
  // La COLLECTE ci-dessus (segments, feux) tourne chaque frame pour que les feux
  // dynamiques restent à jour ; seuls les tracés coûteux sont conditionnés.
  if(groundDirty){
    strokeSegments(roadSegments, roadWidth, pack.road, 'butt');
    fillNodes(roadNodes, roadWidth*0.5, pack.road);
    fillNodes(roadSingles, roadWidth*0.56, pack.road);
    if(!drawFast){
      strokeSegments(roadSegments, roadLineWidth, pack.roadLine, 'butt');
      fillNodes(roadNodes, roadLineWidth*0.5, pack.roadLine);
      strokeSegments(roadSegments, 1.4, 'rgba(200,206,214,.55)', 'butt');
      fillNodes(roadSingles, roadLineWidth*0.56, pack.roadLine);
    }
    const railSingleCoords = railSingles.map(s=>s.c);
    strokeRailBed(railSegments, 11, '#4f3925');
    drawRailSleepers(railSegments, 4, 0.06, 16, 3.2, '#6a4a2b');
    drawRailNodeSleepers(railNodeSleepers, 13, 3, '#6a4a2b');
    fillNodes(railSingleCoords, railSleeperWidth*0.24, '#6a4a2b');
    // Rails métalliques : couleur du joueur en multijoueur, gris sinon.
    const railColorFor = owner => (owner != null && owner >= 0) ? playerColor(owner) : railColor;
    const groupByColor = (items, get) => {
      const map = new Map();
      for(const it of items){
        const col = railColorFor(it.owner);
        let arr = map.get(col);
        if(!arr){ arr = []; map.set(col, arr); }
        arr.push(get(it));
      }
      return map;
    };
    for(const [col, segs] of groupByColor(railSegments, it=>it)) strokeRailPairs(segs, 4.2, 2.8, col);
    for(const [col, coords] of groupByColor(railSingles, it=>it.c)) fillNodes(coords, 3.2, col);
    if(!drawFast){
      strokeRailPairs(railSegments, 4.2, 1.1, railLineColor);
      fillNodes(railSingleCoords, 1.2, railLineColor);
    }
  }

  // (Arbres déplacés vers la couche sprites PixiJS — voir js/pixi/sprites.js.)

  // Poissons : statiques (plus d'animation) → cuits dans la couche sol cachée, comme
  // les décors de terrain. Dessinés ici (dans le buffer en reconstruction, sur le
  // principal en drawFast), au-dessus de l'eau/berges, sous les bâtiments.
  if(groundDirty){
    for(const fish of visibleFish) drawFishOnTile(fish.rx, fish.ry, fish.x, fish.y);
  }

  // --- restauration + blit : le sol vient d'être rendu dans le buffer (rebuild) ou
  // est déjà à jour (réutilisation). On restaure `ctx` au canvas principal puis on
  // blitte la portion visible du buffer. En drawFast le sol est déjà sur le principal.
  if(rebuildBuffer){
    ctx = mainCtx;
    _bufContentKey = contentKey;
    groundTexVersion++; // contenu du groundCache changé → re-upload côté Pixi
  }
  if(!drawFast && !usePixiTerrain){
    // Blit du sol sur #cv (mode Canvas2D). En mode Pixi-terrain, le sol est affiché
    // par Pixi depuis groundCache → pas de blit ici (#cv ne porte que les overlays).
    ctx.setTransform(1,0,0,1,0,0);
    ctx.drawImage(groundCache, srcX, srcY, W*DPR, H*DPR, 0, 0, W*DPR, H*DPR);
    groundBlitSrcX = srcX; groundBlitSrcY = srcY;
  }
  // Transform monde du canvas PRINCIPAL (vraie caméra, origine 0) pour la suite
  // (sprites + éléments dynamiques). Le blit l'avait remis en identité ; en drawFast
  // il est déjà correct.
  ctx.setTransform(DPR*z,0,0,DPR*z, -cam.x*DPR*z, -cam.y*DPR*z);

  // Éléments du sol DYNAMIQUES (hors cache) : feux de circulation et signaux
  // ferroviaires changent de couleur en continu → dessinés chaque frame.
  if(!drawFast){
    for(const tl of trafficLights) drawTrafficLight(tl.c, tl.approaches);
  }
  if(railSignals){
    for(const sig of Object.values(railSignals)) drawRailSignal(sig);
  }

  if(radiusSel)
    drawWorkRadiusOverlay(radiusSel.center, radiusSel.r, radiusSel.color, minRx, maxRx, minRy, maxRy);

  // rayon du dépôt sélectionné (jaune)
  if(depotRadiusSel)
    drawWorkRadiusOverlay(depotRadiusSel.center, depotRadiusSel.r, '#ffd700', minRx, maxRx, minRy, maxRy);

  // rayon de la citerne sélectionnée (bleu)
  if(tankRadiusSel)
    drawWorkRadiusOverlay(tankRadiusSel.center, tankRadiusSel.r, '#64b7e8', minRx, maxRx, minRy, maxRy);

  // rayon de l'industrie sélectionnée (orange)
  if(indRadiusSel)
    drawWorkRadiusOverlay(indRadiusSel.center, indRadiusSel.r, '#ff8c42', minRx, maxRx, minRy, maxRy);

  // en mode placement d'entrepôt : afficher tous les rayons existants (semi-transparent)
  if(tool === 'depot' && !drawFast){
    for(const b of buildings){
      if(b.type !== 'depot' || b.dead) continue;
      ctx.globalAlpha = 0.45;
      drawWorkRadiusOverlay(centerOfBuilding(b), depotRadiusOf(b), '#ffd700', minRx, maxRx, minRy, maxRy);
      ctx.globalAlpha = 1;
    }
    // rayon du futur entrepôt sous le curseur
    if(inMap(mouse.tx, mouse.ty)){
      const ghost = { type:'depot', x:mouse.tx, y:mouse.ty, w:1, h:1 };
      drawWorkRadiusOverlay(centerOfBuilding(ghost), depotRadiusOf(ghost), '#ffd700', minRx, maxRx, minRy, maxRy);
    }
  }

  // en mode placement de citerne : afficher tous les rayons existants
  if(tool === 'tank' && !drawFast){
    for(const b of buildings){
      if(b.type !== 'tank' || b.dead) continue;
      ctx.globalAlpha = 0.45;
      drawWorkRadiusOverlay(centerOfBuilding(b), tankRadiusOf(b), '#64b7e8', minRx, maxRx, minRy, maxRy);
      ctx.globalAlpha = 1;
    }
    if(inMap(mouse.tx, mouse.ty)){
      const ghost = { type:'tank', x:mouse.tx, y:mouse.ty, w:1, h:1 };
      drawWorkRadiusOverlay(centerOfBuilding(ghost), tankRadiusOf(ghost), '#64b7e8', minRx, maxRx, minRy, maxRy);
    }
  }

  // en mode placement d'industrie : afficher tous les rayons industriels existants
  if(['mine','lumber','farm','cotton_farm','weaver','pump','fisher','mill','bakery','fishery','smelter','factory'].includes(tool) && !drawFast){
    for(const b of buildings){
      if(!BUILD[b.type]?.ind || b.dead) continue;
      ctx.globalAlpha = 0.35;
      drawWorkRadiusOverlay(centerOfBuilding(b), indRadiusOf(b), '#ff8c42', minRx, maxRx, minRy, maxRy);
      ctx.globalAlpha = 1;
    }
    if(inMap(mouse.tx, mouse.ty)){
      const ghost = { type:tool, x:mouse.tx, y:mouse.ty, w:1, h:1 };
      drawWorkRadiusOverlay(centerOfBuilding(ghost), indRadiusOf(ghost), '#ff8c42', minRx, maxRx, minRy, maxRy);
    }
  }

  // rayon de pêche de la cabane sélectionnée (bleu)
  if(fisherRadiusSel)
    drawFisherRadiusOverlay(fisherRadiusSel.center, fisherRadiusSel.r, minRx, maxRx, minRy, maxRy);

  // Sprites triés (arbres, bâtiments, entités) : entièrement migrés sur la couche
  // PixiJS (js/pixi/sprites.js). L'ancienne passe de tri Canvas2D est supprimée.

  // Parcours du véhicule sélectionné (style Transport Tycoon)
  if(selectedVehicle && !selectedVehicle.garageRef?.dead)
    drawVehicleRoute(selectedVehicle);
  if(focusVehicle && focusVehicle !== selectedVehicle && !focusVehicle.garageRef?.dead)
    drawVehicleRoute(focusVehicle);

  // Noms des villages au centre de chaque groupe de maisons
  drawTownLabels();
  drawTrainDepotFlags();

  // aperçu du tracé de route (deux-points)
  if((tool === 'road' || tool === 'rail') && roadPreviewTiles.length > 0){
    for(const t of roadPreviewTiles){
      if(!inMap(t.x, t.y)) continue;
      const [rx, ry] = rotIdx(t.x, t.y);
      ctx.fillStyle = canPlace(tool, t.x, t.y).ok ? 'rgba(110,230,120,.55)' : 'rgba(200,200,200,.2)';
      tilePolygon(rx, ry, t.x, t.y); ctx.fill();
    }
  }

  // fantôme de placement
  if(tool!=='select' && inMap(mouse.tx,mouse.ty)){
    const va = canPlace(tool, mouse.tx, mouse.ty);
    const [grx,gry] = rotIdx(mouse.tx, mouse.ty);
    ctx.fillStyle = va.ok ? 'rgba(110,230,120,.4)' : 'rgba(235,80,80,.4)';
    tilePolygon(grx, gry, mouse.tx, mouse.ty); ctx.fill();
    const d = BUILD[tool];
    if(d.resid){
      drawWorkRadiusOverlay(
        { x:mouse.tx, y:mouse.ty },
        workRadiusOf({ type:tool, w:1, h:1 }),
        va.ok ? playerColor(MP.connected ? MP.myId : null) : '#eb5050',
        minRx, maxRx, minRy, maxRy
      );
      ctx.fillStyle = va.ok ? 'rgba(110,230,120,.45)' : 'rgba(235,80,80,.45)';
      tilePolygon(grx, gry, mouse.tx, mouse.ty); ctx.fill();
    }
    if(va.ok && d.hgt){
      ctx.globalAlpha = 0.55;
      const ghost = { type:tool, x:mouse.tx, y:mouse.ty, w:1, h:1 };
      const tc = prism(grx, gry, grx+1, gry+1, d.hgt, packBuildingColor(ghost, d), terrainLiftPxAt(mouse.tx, mouse.ty));
      ctx.font = (TH*0.62)+'px "Segoe UI Emoji",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.ic, tc[0], tc[1]+1);
      ctx.globalAlpha = 1;
    }
  } else if(tool==='select' && inMap(mouse.tx,mouse.ty)){
    const [grx,gry] = rotIdx(mouse.tx, mouse.ty);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5;
    tilePolygon(grx, gry, mouse.tx, mouse.ty); ctx.stroke();
  }

  // badges des zones d'expansion
  if(!drawFast && expansions.length) drawExpansionBadges();

  // fumée des locomotives (au-dessus des sprites, sous les textes)
  drawSmoke();

  // textes flottants
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for(const f of floats){
    const [u, v] = rotF(f.x / TILE, f.y / TILE);
    const p = liftedIso(u, v, terrainLiftPxAtWorld(f.x, f.y));
    ctx.globalAlpha = Math.min(1, f.life);
    ctx.fillStyle = f.col;
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(f.txt, p[0], p[1] - 20 - (1.3-f.life)*26);
  }
  ctx.globalAlpha = 1;
}
