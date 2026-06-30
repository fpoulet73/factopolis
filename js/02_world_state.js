const COLORS = ['#e25e4c','#4ca3e2','#58c470','#e2a93f','#b06fd8','#f0a040','#40d0c0','#e0e0e0'];

// ---------- état ----------
let terrain, terrainHeightMap, waterHeightMap, road, rail, railOwner, railSignals, railBlocks, railBlockOccupancy, bgrid, buildings, trucks, walkers, homeless, floats;
let smoke = [];  // particules de fumée (locomotives) — purement cosmétique, transitoire
let vehicles = [];        // véhicules persistants
let vehicleRouteMode = null; // { vehicle, step:'source'|'dest' } ou null
let selectedVehicle = null;  // véhicule sélectionné
let focusVehicle = null;     // véhicule dont on affiche le trajet + focus caméra (sans ouvrir le détail)
let camTracking = false;     // si vrai, la caméra suit focusVehicle en continu
let vehicleListMode = null;  // 'road' | 'train' | null : filtre courant du panneau liste
let nextTruckId = 0;
let nextWalkerId = 0;
let nextVehicleId = 0;
let nextTrainStationId = 1;
let towns = [];           // villages / villes
let nextTownId = 0;
let selectedTownId = null;
let townLabelHits = [];
let trainDepotFlagHits = [];
let mapBounds = { x0:0, y0:0, x1:64, y1:64 }; // boîte englobante jouable (caméra, clamps)
let mapMask = null;         // Uint8Array(N*N) : 1 = tuile jouable
let expansions = [];        // pièces d'expansion disponibles (chacune achetable individuellement)
let expansionLevels = { left:0, right:0, top:0, bottom:0 }; // niveaux de bandes complètes achetées
let purchasedPieces = new Set(); // pièces en cours (ex: "right-0", "top-left")
let hoveredExpansion = null;
let selectedExpansion = null;
let gtime = 0, eff = 1; // eff = snapshot du wallet courant, gardé pour statusOf
let selected = null, tool = 'select';
let speed = 1, paused = false;
let dispatchTimer = 0, taxTimer = 0, mergeTimer = 0, upkeepTimer = 0, busStopTimer = 0, passengerCycleTimer = 0;
let autoSaveTimer = AUTO_SAVE_INTERVAL; // décompte en secondes (temps réel)
const FIN_ZERO = ()=> ({ ventes:0, vehicules:0, taxes:0, rembours:0, construction:0, entretien:0, entretienVehicules:0, peageRecu:0, peagePaye:0, expansion:0 });
const START_HOMELESS = 0;
let rot = 0; // orientation de la vue (0..3)
const cam = { x:0, y:0, z:1 };
const targetCam = { x:0, y:0, z:1 };
const ZOOM_MIN = 0.35;

// options d'affichage (persistées en localStorage)
const UI_OPTIONS = (() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('factopolis_ui_options') || '{}'); } catch(e){}
  return {
    language: (typeof currentLanguage === 'function') ? currentLanguage() : (saved.language || 'fr'),
    hideColorMarkers: saved.hideColorMarkers ?? false,
    highlightUnderstaffedFactories: saved.highlightUnderstaffedFactories ?? false,
    disableTrafficLights: saved.disableTrafficLights ?? false,
    disableSounds: saved.disableSounds ?? false,
    soundVolume: (typeof saved.soundVolume === 'number') ? Math.max(0, Math.min(1, saved.soundVolume)) : 0.7,
    soundZoomMin: (typeof saved.soundZoomMin === 'number') ? saved.soundZoomMin : ((CFG && CFG.sons && CFG.sons.zoomMin) ?? 1.0),
    graphicPack: GRAPHIC_PACKS[saved.graphicPack] || /^asset:/.test(saved.graphicPack || '') ? saved.graphicPack : 'classic',
    panelEvents: saved.panelEvents ?? false,
  };
})();
function saveUIOptions(){ localStorage.setItem('factopolis_ui_options', JSON.stringify(UI_OPTIONS)); }

// Historique runtime des événements UI focalisables (non persisté dans les sauvegardes).
let gameEvents = [];
let nextGameEventId = 1;

// ---------- sons ----------
// Effets sonores du jeu, définis dans config.js (CFG.sons) : nom logique →
// { fichier, volume }. Volume effectif = volume global (réglages ⚙️) × volume
// par effet (config). Désactivables globalement via UI_OPTIONS.disableSounds.
const SOUNDS = (CFG && CFG.sons) ? CFG.sons : {};
const _soundCache = {};
function playSound(name){
  if(UI_OPTIONS.disableSounds) return;
  const def = SOUNDS[name];
  if(!def || !def.fichier) return;
  const vol = Math.max(0, Math.min(1, (UI_OPTIONS.soundVolume ?? 1) * (def.volume ?? 1)));
  if(vol <= 0) return;
  try {
    // Élément de référence mis en cache (préchargé) ; on clone pour autoriser
    // plusieurs lectures simultanées (départs rapprochés).
    let base = _soundCache[name];
    if(!base){
      base = new Audio(def.fichier);
      base.preload = 'auto';
      _soundCache[name] = base;
    }
    const a = base.cloneNode();
    a.volume = vol;
    const p = a.play();
    if(p && typeof p.catch === 'function') p.catch(() => {});
  } catch(e){ /* autoplay bloqué ou fichier absent : on ignore */ }
}
// Un son « de carte » (départ de train…) ne joue que si le point (en tuiles) est
// visible à l'écran ET que le zoom est suffisamment proche (CFG.sons.zoomMin).
function isMapSoundAudible(tx, ty){
  const zoomMin = UI_OPTIONS.soundZoomMin ?? (CFG.sons && CFG.sons.zoomMin) ?? 1.0;
  if((cam.z || 1) < zoomMin) return false;
  return isWorldTileVisible(tx, ty);
}
const ZOOM_MAX = 2.4;
const ZOOM_WHEEL_SENS = 0.0022;
const CAM_SMOOTH = 18;
let zoomActiveUntil = 0;
let drawFast = false;

// ---------- wallets (économie par joueur) ----------
let WALLETS = {};
function currentWalletOwner(){
  if(MP.connected && MP.myId != null) return MP.myId;
  if(WALLETS[0]) return 0;
  const keys = Object.keys(WALLETS);
  if(keys.length === 1) return +keys[0];
  return 0;
}
const walletOf  = oid => {
  const k = oid ?? currentWalletOwner();
  if(!WALLETS[k]) WALLETS[k] = { money:2500, fin:FIN_ZERO(), finHist:[], finTimer:0, mi:0, eff:1, homelessSeeded:false, starterHomes:0 };
  // Rétro-compat : compléter les catégories financières absentes des anciennes sauvegardes.
  if(!WALLETS[k].fin) WALLETS[k].fin = FIN_ZERO();
  else { const z = FIN_ZERO(); for(const c in z) if(WALLETS[k].fin[c] == null) WALLETS[k].fin[c] = 0; }
  if(!WALLETS[k].peageDetail) WALLETS[k].peageDetail = { recv:{}, paid:{} };
  if(!WALLETS[k].ventesDetail) WALLETS[k].ventesDetail = { res:{}, veh:{} };
  else { if(!WALLETS[k].ventesDetail.res) WALLETS[k].ventesDetail.res = {};
         if(!WALLETS[k].ventesDetail.veh) WALLETS[k].ventesDetail.veh = {}; }
  if(WALLETS[k].starterHomes == null) WALLETS[k].starterHomes = 0;
  if(WALLETS[k].starterHomesGranted == null) WALLETS[k].starterHomesGranted = WALLETS[k].starterHomes || 0;
  return WALLETS[k];
};
const myWallet  = () => walletOf(currentWalletOwner());
// accesseurs rétro-compatibles (lecture/écriture du wallet courant)
const getMoney   = ()    => myWallet().money;
const spendMoney = (n,cat)=>{ const w=myWallet(); w.money-=n; w.fin[cat]=(w.fin[cat]||0)+n; };
const earnMoney  = (n,cat,w=myWallet())=>{ w.money+=n; w.fin[cat]=(w.fin[cat]||0)+n; };
// Détail des ventes : 'res' (par ressource vendue) ou 'veh' (par type de véhicule).
const recordVente = (w, kind, key, amt)=>{
  if(!amt || !w) return;
  if(!w.ventesDetail) w.ventesDetail = { res:{}, veh:{} };
  const bucket = w.ventesDetail[kind] || (w.ventesDetail[kind] = {});
  bucket[key] = (bucket[key]||0) + amt;
};

// BFS réutilisables
let dist = new Int32Array(N*N);
let prev = new Int32Array(N*N);

function clampNum(v, min, max, def){
  v = Number(v);
  if(!Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, v));
}

function worldDefaultsFromConfig(){
  const worldCfg = CFG.monde || {};
  const resourcesCfg = worldCfg.ressources || {};
  return {
    size: Math.round(clampNum(worldCfg.taille, 32, 128, 64)),
    maxPlayers: Math.round(clampNum(worldCfg.joueursMax, 1, 32, 8)),
    waterPct: clampNum(worldCfg.eauPct, 0, 100, 40),
    reliefEnabled: worldCfg.reliefEnabled !== false,
    resources: {
      tree: clampNum(resourcesCfg.tree, 0, 100, 8),
      wheat: clampNum(resourcesCfg.wheat, 0, 100, 4),
      cotton: clampNum(resourcesCfg.cotton, 0, 100, 1),
      iron: clampNum(resourcesCfg.iron, 0, 100, 2),
      coal: clampNum(resourcesCfg.coal, 0, 100, 2),
    },
  };
}

const WORLD_DEFAULTS = worldDefaultsFromConfig();
let WORLD = normalizeWorldConfig(WORLD_DEFAULTS);

function normalizeWorldConfig(config){
  const c = config || {};
  return {
    size: Math.round(clampNum(c.size, 32, 128, WORLD_DEFAULTS.size)),
    maxPlayers: Math.round(clampNum(c.maxPlayers, 1, 32, WORLD_DEFAULTS.maxPlayers)),
    waterPct: WORLD_DEFAULTS.waterPct,
    reliefEnabled: c.reliefEnabled !== false,
    resources: { ...WORLD_DEFAULTS.resources },
  };
}

function reliefCfg(){
  const src = CFG.monde?.relief || {};
  const levels = Math.max(0, Math.min(12, Math.round(src.niveaux ?? 6)));
  return {
    enabled: levels > 0 && WORLD?.reliefEnabled !== false,
    levels,
    stepPx: clampNum(src.hauteurPalierPx, 6, 32, 14),
    roughness: clampNum(src.variation, 0, 1, 0.18),
    plateauNoise: clampNum(src.plateaux, 0, 1, 0.22),
    snowLevel: Math.round(clampNum(src.neigeNiveau, 1, Math.max(1, levels), Math.max(1, levels - 1))),
    snowBlend: clampNum(src.neigeFondu, 0, 1, 0.35),
  };
}

function terrainReliefStepPx(){
  return reliefCfg().stepPx;
}

function terrainLevelAt(x, y){
  if(!terrainHeightMap || x < 0 || y < 0 || x >= N || y >= N) return 0;
  return terrainHeightMap[y * N + x] || 0;
}

function waterLevelAt(x, y){
  if(!waterHeightMap || x < 0 || y < 0 || x >= N || y >= N) return 0;
  return waterHeightMap[y * N + x] || 0;
}

function terrainLiftPxAt(x, y){
  if(terrain && terrain[y * N + x] === T.WATER) return waterLevelAt(x, y) * terrainReliefStepPx();
  return terrainLevelAtFloat(x + 0.5, y + 0.5) * terrainReliefStepPx();
}

function terrainCornerLevelAt(gx, gy){
  if(!terrainHeightMap) return 0;
  let best = 0;
  for(let oy = -1; oy <= 0; oy++) for(let ox = -1; ox <= 0; ox++){
    const tx = gx + ox, ty = gy + oy;
    if(tx < 0 || ty < 0 || tx >= N || ty >= N) continue;
    best = Math.max(best, terrainLevelAt(tx, ty));
  }
  return best;
}

function terrainTileCornerLevels(x, y){
  return {
    nw: terrainCornerLevelAt(x, y),
    ne: terrainCornerLevelAt(x + 1, y),
    se: terrainCornerLevelAt(x + 1, y + 1),
    sw: terrainCornerLevelAt(x, y + 1),
  };
}

function terrainLevelAtFloat(tx, ty){
  if(!terrainHeightMap) return 0;
  const x0 = Math.max(0, Math.min(N - 1, Math.floor(tx)));
  const y0 = Math.max(0, Math.min(N - 1, Math.floor(ty)));
  if(terrain && terrain[y0 * N + x0] === T.WATER) return waterLevelAt(x0, y0);
  const fx = Math.max(0, Math.min(1, tx - x0));
  const fy = Math.max(0, Math.min(1, ty - y0));
  const corners = terrainTileCornerLevels(x0, y0);
  const hx0 = corners.nw + (corners.ne - corners.nw) * fx;
  const hx1 = corners.sw + (corners.se - corners.sw) * fx;
  return hx0 + (hx1 - hx0) * fy;
}

function rebuildWaterLevels(){
  if(!waterHeightMap || waterHeightMap.length !== N * N) waterHeightMap = new Uint8Array(N * N);
  else waterHeightMap.fill(0);
  if(!terrain) return;
  if(!reliefCfg().enabled) return;
  const seen = new Uint8Array(N * N);
  const queue = new Int32Array(N * N);
  for(let i = 0; i < N * N; i++){
    if(terrain[i] !== T.WATER || seen[i]) continue;
    let qh = 0, qt = 0;
    queue[qt++] = i;
    seen[i] = 1;
    const tiles = [];
    let shoreMin = Infinity;
    while(qh < qt){
      const cur = queue[qh++];
      tiles.push(cur);
      const x = cur % N, y = (cur / N) | 0;
      for(const [dx, dy] of DIRS){
        const nx = x + dx, ny = y + dy;
        if(nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = ny * N + nx;
        if(terrain[ni] === T.WATER){
          if(!seen[ni]){
            seen[ni] = 1;
            queue[qt++] = ni;
          }
        } else {
          shoreMin = Math.min(shoreMin, terrainLevelAt(nx, ny));
        }
      }
    }
    const level = Number.isFinite(shoreMin) ? Math.max(0, shoreMin - 1) : 0;
    for(const wi of tiles) waterHeightMap[wi] = level;
  }
}

function terrainLiftPxAtWorld(wx, wy){
  return terrainLevelAtFloat(wx / TILE, wy / TILE) * terrainReliefStepPx();
}

function terrainLiftPxAtRot(u, v){
  const [tx, ty] = invRotF(u, v);
  return terrainLevelAtFloat(tx, ty) * terrainReliefStepPx();
}

function buildingLiftPx(b){
  if(!b) return 0;
  return Math.round(terrainLiftPxAtWorld(
    (b.x + (b.w || 1) * 0.5) * TILE,
    (b.y + (b.h || 1) * 0.5) * TILE
  ));
}

function setMapSize(size){
  N = Math.max(32, Math.round(size));
  dist = new Int32Array(N*N);
  prev = new Int32Array(N*N);
  mapMask = new Uint8Array(N*N);
}

// ---------- canvas ----------
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize(){
  DPR = window.devicePixelRatio || 1;
  W = innerWidth; H = innerHeight;
  cv.width = W*DPR; cv.height = H*DPR;
}
addEventListener('resize', resize); resize();

// ---------- cache de la couche sol (terrain/eau/routes/rails) ----------
// Cette couche est statique tant que la caméra et le terrain ne changent pas. On
// la rend une fois dans un canvas offscreen et on la blitte chaque frame, ce qui
// évite de redessiner des dizaines de milliers de tuiles caméra immobile (gros
// gain sur grande carte dézoomée). Voir draw() dans 07_rendering.js.
const groundCache = document.createElement('canvas');
const groundCacheCtx = groundCache.getContext('2d');
let _groundKey = null;          // signature du dernier rendu mis en cache
let groundVersion = 0;          // incrémenté à chaque mutation du sol
function markGroundDirty(){ groundVersion++; }

// ---------- projection isométrique rotative ----------
// indices de tuile : monde -> tourné
function rotIdx(x,y){
  switch(rot){
    case 0:  return [x, y];
    case 1:  return [y, N-1-x];
    case 2:  return [N-1-x, N-1-y];
    default: return [N-1-y, x];
  }
}
function invRotIdx(rx,ry){
  switch(rot){
    case 0:  return [rx, ry];
    case 1:  return [N-1-ry, rx];
    case 2:  return [N-1-rx, N-1-ry];
    default: return [ry, N-1-rx];
  }
}
// coordonnées continues (en tuiles) : monde -> tourné
function rotF(tx,ty){
  switch(rot){
    case 0:  return [tx, ty];
    case 1:  return [ty, N-tx];
    case 2:  return [N-tx, N-ty];
    default: return [N-ty, tx];
  }
}
function invRotF(u,v){
  switch(rot){
    case 0:  return [u, v];
    case 1:  return [N-v, u];
    case 2:  return [N-u, N-v];
    default: return [v, N-u];
  }
}
// tuile tournée (continue) -> px iso
const iso = (u,v)=> [ (u-v)*TW2, (u+v)*TH2 ];
function worldPxToIso(wx,wy){
  const [u,v] = rotF(wx/TILE, wy/TILE);
  return iso(u,v);
}
// Tuile monde (tx,ty en tuiles) dans la fenêtre visible courante ?
function isWorldTileVisible(tx, ty, margin = 0){
  const z = cam.z || 1;
  const [u,v] = rotF(tx, ty);
  const [px,py] = iso(u,v);
  return px >= cam.x - margin && px <= cam.x + W/z + margin
      && py >= cam.y - margin && py <= cam.y + H/z + margin;
}
// rotation d'un vecteur direction monde -> tourné
function rotDir(dx,dy){
  switch(rot){
    case 0:  return [dx, dy];
    case 1:  return [dy, -dx];
    case 2:  return [-dx, -dy];
    default: return [-dy, dx];
  }
}
function screenCenterWorldPx(){
  const ix = cam.x + (W/2)/cam.z, iy = cam.y + (H/2)/cam.z;
  const u = (ix/TW2 + iy/TH2)/2, v = (iy/TH2 - ix/TW2)/2;
  const [tx,ty] = invRotF(u,v);
  return [tx*TILE, ty*TILE];
}
function centerOn(wx,wy){
  const p = worldPxToIso(wx,wy);
  cam.x = p[0] - W/(2*cam.z);
  cam.y = p[1] - H/(2*cam.z);
  clampCam();
  syncTargetCam();
}
function rotate(d){
  const c = screenCenterWorldPx();
  rot = (rot - d + 4) & 3;
  centerOn(c[0], c[1]);
}

// ---------- génération du monde ----------
function valueNoise(cell){
  const gs = Math.floor(N/cell)+3;
  const g = new Float32Array(gs*gs);
  for(let i=0;i<g.length;i++) g[i] = Math.random();
  const sm = t => t*t*(3-2*t);
  return (x,y)=>{
    const gx = x/cell, gy = y/cell;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = sm(gx-x0), fy = sm(gy-y0);
    const a = g[y0*gs+x0],     b = g[y0*gs+x0+1];
    const c = g[(y0+1)*gs+x0], d = g[(y0+1)*gs+x0+1];
    return a + (b-a)*fx + (c-a)*fy + (a-b-c+d)*fx*fy;
  };
}

function tileTouchesWater(x, y){
  for(const [dx,dy] of DIRS){
    const nx = x + dx, ny = y + dy;
    if(nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    if(terrain[ny*N+nx] === T.WATER) return true;
  }
  return false;
}

function applyShoreResources(noiseFn, inScope){
  const sandPct = Math.max(0, Math.min(1, CFG.lac?.sablePct ?? 0.12));
  const clayPct = Math.max(0, Math.min(1, CFG.lac?.argilePct ?? 0.08));
  if(sandPct <= 0 && clayPct <= 0) return;
  const shore = [];
  for(let y = 0; y < N; y++) for(let x = 0; x < N; x++){
    if(inScope && !inScope(x, y)) continue;
    const i = y * N + x;
    if(terrain[i] !== T.GRASS) continue;
    if(!tileTouchesWater(x, y)) continue;
    shore.push({ x, y, score: noiseFn(x, y) + (hash(x, y) & 31) / 1024 });
  }
  if(!shore.length) return;
  shore.sort((a, b) => b.score - a.score);
  const sandCount = Math.min(shore.length, Math.round(shore.length * sandPct));
  const clayCount = Math.min(shore.length - sandCount, Math.round(shore.length * clayPct));
  for(let i = 0; i < sandCount; i++){
    const t = shore[i];
    terrain[t.y * N + t.x] = T.SAND;
  }
  for(let i = sandCount; i < sandCount + clayCount; i++){
    const t = shore[i];
    terrain[t.y * N + t.x] = T.CLAY;
  }
}

function terrainNoiseScore(n1, n2, n3, x, y){
  return 0.55 * n1(x, y) + 0.30 * n2(x, y) + 0.15 * n3(x, y);
}

function pseudoNoise(x, y, scaleX, scaleY, seed){
  const v = Math.sin((x + seed) * scaleX + (y - seed) * scaleY) * 43758.5453123;
  return v - Math.floor(v);
}

function smoothTerrainHeights(inScope){
  if(!terrainHeightMap) return;
  const cfg = reliefCfg();
  if(!cfg.enabled) return;
  const next = new Uint8Array(terrainHeightMap);
  for(let pass = 0; pass < 3; pass++){
    for(let y = 0; y < N; y++) for(let x = 0; x < N; x++){
      if(inScope && !inScope(x, y)) continue;
      const i = y * N + x;
      if(terrain[i] === T.WATER){ next[i] = 0; continue; }
      let sum = terrainHeightMap[i] * 3;
      let count = 3;
      let minNeighbor = terrainHeightMap[i];
      for(const [dx, dy] of DIRS){
        const nx = x + dx, ny = y + dy;
        if(nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        if(inScope && !inScope(nx, ny)) continue;
        const nh = terrain[(ny * N) + nx] === T.WATER ? 0 : terrainHeightMap[(ny * N) + nx];
        sum += nh;
        count++;
        if(nh < minNeighbor) minNeighbor = nh;
      }
      let h = Math.round(sum / count);
      h = Math.max(1, Math.min(cfg.levels, h));
      if(h > minNeighbor + 1) h = minNeighbor + 1;
      next[i] = h;
    }
    terrainHeightMap.set(next);
  }
}

function rebuildTerrainHeightsFromTerrain(inScope){
  if(!terrainHeightMap || terrainHeightMap.length !== N * N) terrainHeightMap = new Uint8Array(N * N);
  const cfg = reliefCfg();
  for(let y = 0; y < N; y++) for(let x = 0; x < N; x++){
    if(inScope && !inScope(x, y)) continue;
    const i = y * N + x;
    if(terrain[i] === T.WATER || !cfg.enabled){
      terrainHeightMap[i] = 0;
      continue;
    }
    const broad = pseudoNoise(x, y, 0.065, 0.052, 17);
    const detail = pseudoNoise(x, y, 0.17, 0.11, 53);
    const coastPenalty = tileTouchesWater(x, y) ? 0.22 : 0;
    const richness = (terrain[i] === T.IRON || terrain[i] === T.COAL) ? 0.08 : 0;
    const value = Math.max(0, Math.min(1, broad * 0.78 + detail * 0.22 - coastPenalty + richness));
    terrainHeightMap[i] = 1 + Math.round(value * Math.max(0, cfg.levels - 1));
  }
  smoothTerrainHeights(inScope);
  if(!inScope) rebuildWaterLevels();
}

function applyBaseTerrain(noiseA, noiseB, noiseC, waterPct, inScope){
  if(!terrainHeightMap || terrainHeightMap.length !== N * N) terrainHeightMap = new Uint8Array(N * N);
  if(!waterHeightMap || waterHeightMap.length !== N * N) waterHeightMap = new Uint8Array(N * N);
  const cfg = reliefCfg();
  const ridgeNoise = valueNoise(21);
  const plateauNoise = valueNoise(5);
  const candidates = [];
  for(let y = 0; y < N; y++) for(let x = 0; x < N; x++){
    if(inScope && !inScope(x, y)) continue;
    const i = y * N + x;
    const base = terrainNoiseScore(noiseA, noiseB, noiseC, x, y);
    const ridge = 1 - Math.abs(ridgeNoise(x, y) * 2 - 1);
    const plateau = (plateauNoise(x, y) - 0.5) * cfg.plateauNoise;
    candidates.push({ i, x, y, water: base, land: base * 0.7 + ridge * 0.3 + plateau });
  }
  if(!candidates.length) return;
  const waterTiles = Math.min(candidates.length, Math.max(0, Math.round(candidates.length * waterPct / 100)));
  const sorted = candidates.slice().sort((a, b) => a.water - b.water);
  const waterSet = new Set(sorted.slice(0, waterTiles).map(c => c.i));
  const waterThreshold = waterTiles > 0 ? sorted[Math.max(0, waterTiles - 1)].water : 0;
  const den = Math.max(0.001, 1 - waterThreshold);
  for(const entry of candidates){
    if(waterSet.has(entry.i)){
      terrain[entry.i] = T.WATER;
      terrainHeightMap[entry.i] = 0;
      continue;
    }
    terrain[entry.i] = T.GRASS;
    if(!cfg.enabled){
      terrainHeightMap[entry.i] = 0;
      continue;
    }
    const normalized = Math.max(0, Math.min(1, (entry.land - waterThreshold) / den));
    const terraces = Math.pow(normalized, 0.82);
    const jitter = (pseudoNoise(entry.x, entry.y, 0.31, 0.19, 91) - 0.5) * cfg.roughness;
    const level = 1 + Math.round(Math.max(0, Math.min(1, terraces + jitter)) * Math.max(0, cfg.levels - 1));
    terrainHeightMap[entry.i] = Math.max(1, Math.min(cfg.levels, level));
  }
  smoothTerrainHeights(inScope);
  if(!inScope) rebuildWaterLevels();
}

function genWorld(config){
  WORLD = normalizeWorldConfig(config || WORLD);
  const N_PLAY = WORLD.size;
  const N_FULL_MAP = N_PLAY + 2 * EXP_MARGIN;
  setMapSize(N_FULL_MAP);
  terrain = new Uint8Array(N*N);
  terrainHeightMap = new Uint8Array(N*N);
  waterHeightMap = new Uint8Array(N*N);
  road = new Uint8Array(N*N);
  rail = new Uint8Array(N*N);
  railOwner = new Int16Array(N*N).fill(-1);
  railSignals = Object.create(null);
  railBlocks = null;
  railBlockOccupancy = null;
  bgrid = new Array(N*N).fill(null);
  buildings = []; trucks = []; walkers = []; homeless = []; floats = []; smoke = [];
  vehicles = []; vehicleRouteMode = null; selectedVehicle = null; focusVehicle = null; camTracking = false; vehicleListMode = null; nextTruckId = 0; nextWalkerId = 0; nextVehicleId = 0; nextTrainStationId = 1;
  towns = []; nextTownId = 0; selectedTownId = null; townLabelHits = []; trainDepotFlagHits = [];
  WALLETS = {}; gtime = 0;
  gameEvents = []; nextGameEventId = 1;
  selected = null; dispatchTimer = 0; taxTimer = 0; mergeTimer = 0; upkeepTimer = 0; busStopTimer = 0; passengerCycleTimer = 0;
  mapBounds = { x0: EXP_MARGIN, y0: EXP_MARGIN, x1: EXP_MARGIN + N_PLAY, y1: EXP_MARGIN + N_PLAY };
  expansions = []; expansionLevels = { left:0, right:0, top:0, bottom:0 };
  purchasedPieces = new Set();
  selectedExpansion = null; hoveredExpansion = null;
  // Remplir le masque pour la zone de jeu initiale
  mapMask.fill(0);
  for(let y=mapBounds.y0; y<mapBounds.y1; y++)
    for(let x=mapBounds.x0; x<mapBounds.x1; x++)
      mapMask[y*N+x] = 1;

  const n1 = valueNoise(16), n2 = valueNoise(7), n3 = valueNoise(3);
  const tn = valueNoise(9);
  applyBaseTerrain(n1, n2, n3, WORLD.waterPct, null);
  const treeCandidates = [];
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    if(terrain[y*N+x] !== T.GRASS) continue;
    treeCandidates.push({ x, y, score: tn(x,y) + Math.random()*0.25 });
  }
  treeCandidates.sort((a,b)=> b.score - a.score);
  for(let i=0, n=Math.min(treeCandidates.length, Math.round(N*N*WORLD.resources.tree/100)); i<n; i++){
    const c = treeCandidates[i];
    terrain[c.y*N+c.x] = T.TREE;
  }
  markGroundDirty(); // nouveau terrain → invalider le cache sol
  // champs et gisements en taches
  const placePatch = (type, count, opts={})=>{
    const minRadius = opts.minRadius ?? 1;
    const maxRadius = opts.maxRadius ?? 2;
    const fillChance = opts.fillChance ?? 0.85;
    for(let k=0;k<count;k++){
      let cx, cy, tries = 0;
      do { cx = 3+(Math.random()*(N-6))|0; cy = 3+(Math.random()*(N-6))|0; }
      while(terrain[cy*N+cx] === T.WATER && ++tries < 300);
      const r = minRadius + (Math.random()*(maxRadius-minRadius+1))|0;
      for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
        const x = cx+dx, y = cy+dy;
        if(x<0||y<0||x>=N||y>=N) continue;
        if(dx*dx+dy*dy > r*r+0.5) continue;
        if(terrain[y*N+x] !== T.WATER && Math.random() < fillChance) terrain[y*N+x] = type;
      }
    }
  };
  const patchCount = pct => Math.round(N*N * pct / 100 / 8);
  placePatch(T.WHEAT, patchCount(WORLD.resources.wheat));
  placePatch(T.COTTON, patchCount(WORLD.resources.cotton), { maxRadius:1, fillChance:0.65 });
  placePatch(T.IRON, patchCount(WORLD.resources.iron));
  placePatch(T.COAL, patchCount(WORLD.resources.coal));
  applyShoreResources(tn, (x, y) => !!mapMask[y*N+x]);
  markGroundDirty();

  // caméra : centrée sur une zone d'herbe proche du milieu de la zone jouable
  const mcx = (mapBounds.x0+mapBounds.x1)>>1, mcy = (mapBounds.y0+mapBounds.y1)>>1;
  let sx = mcx, sy = mcy;
  outer:
  for(let r=0;r<N_PLAY>>1;r++)
    for(let y=mcy-r;y<=mcy+r;y++)
      for(let x=mcx-r;x<=mcx+r;x++)
        if(inMap(x,y) && terrain[y*N+x]===T.GRASS){ sx=x; sy=y; break outer; }
  cam.z = 1;
  centerOn(sx*TILE+TILE/2, sy*TILE+TILE/2);
  if(MP.connected && MP.myId != null) ensureHomelessForOwner(MP.myId);
  refreshExpansionSlots();
}

// ---------- aides ----------
const inMap = (x,y)=> x>=0 && y>=0 && x<N && y<N && !!mapMask && mapMask[y*N+x]===1;
// Filtres par owner : en solo (owner null) on compte tout, en MP on filtre
const myOwner   = () => (MP.connected && MP.myId != null) ? MP.myId : null;
const ownedBy   = (b, oid) => oid == null ? (b.owner == null) : (b.owner === oid);
const popTotal  = (oid=myOwner()) => buildings.filter(b=>ownedBy(b,oid)).reduce((s,b)=> s+(b.pop||0), 0);
const housingCap= (oid=myOwner()) => buildings.filter(b=>ownedBy(b,oid)).reduce((s,b)=>
      s + (BUILD[b.type].resid ? BUILD[b.type].resid.popCap : 0), 0);
const jobsTotal = (oid=myOwner()) => buildings.filter(b=>!b.dead && ownedBy(b,oid))
  .reduce((s,b)=> s + (b.paused ? 0 : (BUILD[b.type].workers||0)*b.w*b.h), 0);
const workersRequiredOf = b => (BUILD[b.type].workers||0)*b.w*b.h;
const workersAllocatedOf = b => {
  if(b.paused) return 0;
  return Math.min(workersRequiredOf(b), b.workersAssigned||0);
};
const workRadiusOf = b => BUILD[b.type].resid ? Math.max(b.w||1, b.h||1) * 3 : 0;
const centerOfBuilding = b => ({ x:b.x + (b.w||1)/2 - 0.5, y:b.y + (b.h||1)/2 - 0.5 });
const buildingDistance = (a,b)=>{
  const ca = centerOfBuilding(a), cb = centerOfBuilding(b);
  return Math.max(Math.abs(ca.x-cb.x), Math.abs(ca.y-cb.y));
};

// ---------- expansion de carte ----------
// Détermine si un tile appartient à la pièce puzzle pi (parmi n) d'une bande d'expansion
function jigsawTileInPiece(x, y, strip, pi, n, tabR){
  const {x0,y0,x1,y1,vert} = strip;
  if(x<x0||x>=x1||y<y0||y>=y1) return false;
  const tc = x+0.5, tr = y+0.5;
  const len = vert ? (y1-y0)/n : (x1-x0)/n;
  const ctr = vert ? (x0+x1)/2 : (y0+y1)/2; // centre perpendiculaire

  let piece = vert
    ? Math.min(n-1, Math.max(0, (tr-y0)/len|0))
    : Math.min(n-1, Math.max(0, (tc-x0)/len|0));

  for(let b=0; b<n-1; b++){
    const bPos = vert ? (y0+(b+1)*len) : (x0+(b+1)*len);
    const da   = vert ? (tc-ctr) : (tr-ctr);
    const db   = vert ? (tr-bPos) : (tc-bPos);
    if(da*da+db*db < tabR*tabR){
      piece = b%2===0 ? b : b+1; // paire → pièce haute/gauche a le tab
      break;
    }
  }
  return piece===pi;
}

// Génère le terrain (eau, arbres, ressources) dans toutes les tuiles hors mapBounds.
// Appelée lors du chargement de sauvegardes anciennes dont les marges sont vides (tout herbe).
function generateExpansionTerrain(){
  const n1=valueNoise(16),n2=valueNoise(7),n3=valueNoise(3),tn=valueNoise(9);
  const inPlay=(x,y)=>x>=mapBounds.x0&&y>=mapBounds.y0&&x<mapBounds.x1&&y<mapBounds.y1;

  // Eau / herbe de base
  applyBaseTerrain(n1, n2, n3, WORLD.waterPct, (x, y) => !inPlay(x, y));
  // Arbres
  const tc=[];
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    if(!inPlay(x,y)&&terrain[y*N+x]===T.GRASS) tc.push({x,y,s:tn(x,y)+Math.random()*0.25});
  }
  tc.sort((a,b)=>b.s-a.s);
  const mTiles=N*N-(mapBounds.x1-mapBounds.x0)*(mapBounds.y1-mapBounds.y0);
  for(let i=0,lim=Math.round(mTiles*(WORLD.resources?.tree??20)/100);i<lim&&i<tc.length;i++)
    terrain[tc[i].y*N+tc[i].x]=T.TREE;
  // Gisements et champs
  const pp=(type,count,opts={})=>{
    const minRadius=opts.minRadius??1,maxRadius=opts.maxRadius??2,fillChance=opts.fillChance??0.85;
    for(let k=0;k<count;k++){
      let cx,cy,tries=0;
      do{cx=(1+Math.random()*(N-2))|0;cy=(1+Math.random()*(N-2))|0;}
      while((inPlay(cx,cy)||terrain[cy*N+cx]===T.WATER)&&++tries<400);
      if(tries>=400)continue;
      const r=minRadius+(Math.random()*(maxRadius-minRadius+1))|0;
      for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
        const px=cx+dx,py=cy+dy;
        if(px<0||py<0||px>=N||py>=N||inPlay(px,py))continue;
        if(dx*dx+dy*dy>r*r+0.5)continue;
        if(terrain[py*N+px]!==T.WATER&&Math.random()<fillChance)terrain[py*N+px]=type;
      }
    }
  };
  const cnt=pct=>Math.round(mTiles*pct/100/8);
  pp(T.WHEAT,cnt(WORLD.resources?.wheat??8));
  pp(T.COTTON,cnt(WORLD.resources?.cotton??2),{maxRadius:1,fillChance:0.65});
  pp(T.IRON, cnt(WORLD.resources?.iron??10));
  pp(T.COAL, cnt(WORLD.resources?.coal??10));
  applyShoreResources(tn, (x, y) => !inPlay(x, y));
  rebuildWaterLevels();
  markGroundDirty();
}

// Coût d'une tuile selon son terrain (prix de base au niveau 0)
function expTileCost(t){
  if(t===T.WATER) return  600;  // pas constructible, moins cher
  if(t===T.GRASS) return 3000;  // terrain standard
  if(t===T.TREE)  return 4500;  // ressource bois
  if(t===T.WHEAT) return 4000;  // ressource agriculture
  if(t===T.COTTON)return 4200;  // ressource textile
  if(t===T.IRON)  return 6000;  // minerai rare
  if(t===T.COAL)  return 5500;  // minerai
  if(t===T.SAND)  return 3600;  // ressource littorale
  if(t===T.CLAY)  return 3900;  // ressource littorale
  return 3000;
}

function refreshExpansionSlots(){
  expansions = [];
  const m = mapBounds;
  const n = EXP_N_PIECES;

  const sideList = [
    { side:'right',  vert:true,  x0:m.x1,           y0:m.y0, x1:m.x1+EXP_DEPTH, y1:m.y1  },
    { side:'left',   vert:true,  x0:m.x0-EXP_DEPTH, y0:m.y0, x1:m.x0,           y1:m.y1  },
    { side:'bottom', vert:false, x0:m.x0, y0:m.y1,           x1:m.x1, y1:m.y1+EXP_DEPTH  },
    { side:'top',    vert:false, x0:m.x0, y0:m.y0-EXP_DEPTH, x1:m.x1, y1:m.y0            },
  ];
  const cornerList = [
    { side:'top-left',     x0:m.x0-EXP_DEPTH, y0:m.y0-EXP_DEPTH, x1:m.x0, y1:m.y0             },
    { side:'top-right',    x0:m.x1,           y0:m.y0-EXP_DEPTH, x1:m.x1+EXP_DEPTH, y1:m.y0   },
    { side:'bottom-left',  x0:m.x0-EXP_DEPTH, y0:m.y1,           x1:m.x0, y1:m.y1+EXP_DEPTH   },
    { side:'bottom-right', x0:m.x1,           y0:m.y1,           x1:m.x1+EXP_DEPTH, y1:m.y1+EXP_DEPTH },
  ];

  // Bandes latérales – 3 pièces puzzle chacune
  for(const strip of sideList){
    if(strip.x0<0||strip.y0<0||strip.x1>N||strip.y1>N) continue;
    const level = expansionLevels[strip.side]||0;
    const pieceLen = strip.vert ? (strip.y1-strip.y0)/n : (strip.x1-strip.x0)/n;
    const tabR = pieceLen * 0.30;
    const mult = Math.pow(2, level);

    // Précalculer membership de chaque tuile de la bande pour les n pièces
    const pieceTiles = Array.from({length:n}, ()=>[]);
    for(let y=strip.y0; y<strip.y1; y++)
      for(let x=strip.x0; x<strip.x1; x++)
        for(let pi=0; pi<n; pi++)
          if(jigsawTileInPiece(x,y,strip,pi,n,tabR)){ pieceTiles[pi].push({x,y}); break; }

    for(let pi=0; pi<n; pi++){
      const key = strip.side+'-'+pi;
      if(purchasedPieces.has(key)) continue;
      const pFrac = (pi+0.5)/n;
      const cx = strip.vert ? (strip.x0+strip.x1)/2 : strip.x0 + pFrac*(strip.x1-strip.x0);
      const cy = strip.vert ? strip.y0 + pFrac*(strip.y1-strip.y0) : (strip.y0+strip.y1)/2;
      const inPiece = (x,y) => jigsawTileInPiece(x,y,strip,pi,n,tabR);
      // Prix basé sur la valeur du terrain de chaque tuile
      const rawCost = pieceTiles[pi].reduce((s,{x,y}) => s + expTileCost(terrain[y*N+x]), 0);
      const cost = Math.ceil(rawCost * mult);
      expansions.push({ side:strip.side, pieceIndex:pi, x0:strip.x0, y0:strip.y0, x1:strip.x1, y1:strip.y1,
                        cx, cy, cost, inPiece, strip });
    }
  }

  // Coins – 1 pièce carrée chacun
  for(const c of cornerList){
    if(c.x0<0||c.y0<0||c.x1>N||c.y1>N) continue;
    if(purchasedPieces.has(c.side)) continue;
    const level = Math.max(expansionLevels.left||0, expansionLevels.right||0,
                           expansionLevels.top||0,  expansionLevels.bottom||0);
    const mult = Math.pow(2, level);
    let rawCost = 0;
    for(let y=c.y0; y<c.y1; y++) for(let x=c.x0; x<c.x1; x++) rawCost += expTileCost(terrain[y*N+x]);
    const cost = Math.ceil(rawCost * mult);
    const {x0,y0,x1,y1} = c;
    const inPiece = (x,y) => x>=x0&&x<x1&&y>=y0&&y<y1;
    expansions.push({ side:c.side, pieceIndex:0, x0,y0,x1,y1,
                      cx:(x0+x1)/2, cy:(y0+y1)/2, cost, inPiece, strip:null });
  }
}

function buyExpansion(exp){
  if(!exp) return;
  if(myWallet().money < exp.cost){ toast('Fonds insuffisants ('+exp.cost.toLocaleString()+' $ requis).','err'); return; }
  spendMoney(exp.cost, 'expansion');

  // Remplir les tuiles de cette pièce dans le masque
  const s = exp.strip || exp;
  for(let y=s.y0; y<s.y1; y++)
    for(let x=s.x0; x<s.x1; x++)
      if(x>=0&&y>=0&&x<N&&y<N && exp.inPiece(x,y)) mapMask[y*N+x] = 1;

  if(exp.strip){
    // Pièce latérale : marquer achetée, vérifier si bande complète
    const key = exp.side+'-'+exp.pieceIndex;
    purchasedPieces.add(key);
    const allDone = Array.from({length:EXP_N_PIECES},(_,i)=>exp.side+'-'+i).every(k=>purchasedPieces.has(k));
    if(allDone){
      // Bande terminée → étendre mapBounds et ouvrir la bande suivante
      expansionLevels[exp.side] = (expansionLevels[exp.side]||0)+1;
      for(let i=0;i<EXP_N_PIECES;i++) purchasedPieces.delete(exp.side+'-'+i);
      // mapBounds s'étend d'une bande complète dans la bonne direction
      if(exp.side==='right')  mapBounds.x1 = s.x1;
      if(exp.side==='left')   mapBounds.x0 = s.x0;
      if(exp.side==='bottom') mapBounds.y1 = s.y1;
      if(exp.side==='top')    mapBounds.y0 = s.y0;
    }
    // mapBounds ne change PAS pour un achat partiel : les pièces restantes restent visibles
  } else {
    // Coin : achat unique, étendre mapBounds immédiatement
    purchasedPieces.add(exp.side);
    mapBounds.x0 = Math.min(mapBounds.x0, exp.x0);
    mapBounds.y0 = Math.min(mapBounds.y0, exp.y0);
    mapBounds.x1 = Math.max(mapBounds.x1, exp.x1);
    mapBounds.y1 = Math.max(mapBounds.y1, exp.y1);
  }

  refreshExpansionSlots();
  markGroundDirty(); // mapMask/zones d'expansion modifiés → invalider le cache sol
  selectedExpansion = null;
  hudTimer = 0;
  const dirLabel = {right:'droite',left:'gauche',bottom:'bas',top:'haut',
    'top-left':'haut-gauche','top-right':'haut-droite',
    'bottom-left':'bas-gauche','bottom-right':'bas-droite'}[exp.side];
  toast('🧩 Pièce achetée vers '+dirLabel+'.','win');
  addFloat(exp.cx, exp.cy, '🧩', '#60d8a0');
}

function townOwnedBy(t, oid=myOwner()){
  return buildings.some(b=>!b.dead && b.townId === t.id && BUILD[b.type]?.resid && ownedBy(b, oid));
}

function townHasResidents(t){
  return buildings.some(b=>!b.dead && b.townId === t.id && BUILD[b.type]?.resid);
}

function ownTowns(oid=myOwner()){
  return towns
    .filter(t=>townOwnedBy(t, oid))
    .sort((a,b)=> a.id-b.id);
}

function ensureSelectedTown(){
  const list = ownTowns();
  if(selectedTownId != null){
    const selectedTown = towns.find(t=>t.id === selectedTownId) || null;
    if(selectedTown && townHasResidents(selectedTown))
      return selectedTown;
  }
  const first = list[0] || towns.filter(t=>townHasResidents(t)).sort((a,b)=>a.id-b.id)[0] || null;
  selectedTownId = first ? first.id : null;
  return first;
}

function resetSelectedTown(){
  selectedTownId = null;
  return ensureSelectedTown();
}

function townHomes(townId, oid=myOwner()){
  const owned = buildings.filter(b=>!b.dead && b.townId === townId && BUILD[b.type]?.resid && ownedBy(b, oid));
  if(owned.length) return owned;
  return buildings.filter(b=>!b.dead && b.townId === townId && BUILD[b.type]?.resid);
}

function townPopTotal(townId){
  return townHomes(townId).reduce((s,b)=>s+(b.pop||0), 0);
}

function townHousingCap(townId){
  return townHomes(townId).reduce((s,b)=>s+BUILD[b.type].resid.popCap, 0);
}

function townReachableJobBuildings(townId){
  const homes = townHomes(townId);
  const seen = new Set();
  const out = [];
  for(const home of homes){
    const radius = workRadiusOf(home);
    for(const job of buildings){
      if(job.dead || job.paused || !ownedBy(job, home.owner)) continue;
      const req = workersRequiredOf(job);
      if(req <= 0 || seen.has(job)) continue;
      if(buildingDistance(home, job) <= radius){
        seen.add(job);
        out.push(job);
      }
    }
  }
  return out;
}

function townReachableJobs(townId){
  return townReachableJobBuildings(townId).reduce((s,b)=>s+workersRequiredOf(b), 0);
}

function townAllocatedWorkers(townId){
  return townReachableJobBuildings(townId).reduce((s,b)=>s+workersAllocatedOf(b), 0);
}

function refreshTransitPassengerCaps(){
  const busStops = buildings.filter(b => !b.dead && b.type === 'bus_stop');
  const trainStations = buildings.filter(b => !b.dead && b.type === 'train_station');

  for(const stop of busStops) stop.passengersMax = 0;
  for(const station of trainStations) station.passengersEntrantMax = 0;

  const homesByTown = new Map();
  for(const home of buildings){
    if(home.dead || !BUILD[home.type]?.resid || (home.pop || 0) <= 0 || home.townId == null) continue;
    if(!homesByTown.has(home.townId)) homesByTown.set(home.townId, []);
    homesByTown.get(home.townId).push(home);
  }

  function apportion(entries, total, assign){
    if(!entries.length || total <= 0) return;
    let weightSum = entries.reduce((s, entry) => s + Math.max(0, entry.weight || 0), 0);
    if(weightSum <= 0){
      for(const entry of entries) entry.weight = 1;
      weightSum = entries.length;
    }
    let assigned = 0;
    const ranked = entries.map((entry, idx) => {
      const exact = (total * entry.weight) / weightSum;
      const base = Math.floor(exact);
      assign(entry, base);
      assigned += base;
      return { entry, idx, frac: exact - base };
    });
    ranked.sort((a,b) => (b.frac - a.frac) || (a.idx - b.idx));
    let remaining = total - assigned;
    for(let i = 0; i < remaining; i++){
      const target = ranked[i % ranked.length].entry;
      assign(target, (target.building._tmpTransitCap || 0) + 1);
    }
  }

  for(const [townId, homes] of homesByTown){
    let idleTotal = 0;
    const entries = [];
    const byKey = new Map();
    const addEntry = (key, building) => {
      let entry = byKey.get(key);
      if(!entry){
        entry = { key, building, weight: 0 };
        byKey.set(key, entry);
        entries.push(entry);
      }
      return entry;
    };

    for(const home of homes){
      const idle = Math.max(0, Math.floor(home.workersIdle || 0));
      idleTotal += idle;
      if(idle <= 0) continue;

      for(const stop of busStops){
        if(stop.townId !== townId) continue;
        if(buildingDistance(home, stop) > BUS_STOP_RADIUS) continue;
        addEntry('bus:' + stop.x + ',' + stop.y, stop).weight += idle;
      }
      for(const station of trainStations){
        if(station.townId !== townId) continue;
        if(buildingDistance(home, station) > TRAIN_STATION_RADIUS) continue;
        addEntry('train:' + station.stationGroupId + ':' + station.x + ',' + station.y, station).weight += idle;
      }
    }

    if(idleTotal <= 0 || !entries.length) continue;

    for(const entry of entries) entry.building._tmpTransitCap = 0;
    apportion(entries, idleTotal, (entry, value) => { entry.building._tmpTransitCap = value; });

    for(const entry of entries){
      if(entry.building.type === 'bus_stop') entry.building.passengersMax = entry.building._tmpTransitCap || 0;
      else if(entry.building.type === 'train_station') entry.building.passengersEntrantMax = entry.building._tmpTransitCap || 0;
      delete entry.building._tmpTransitCap;
    }
  }
}

function refreshWorkerAllocation(){
  for(const b of buildings){ b.workersAssigned = 0; b.workersByTown = {}; b.workersIdle = 0; }
  const jobs = buildings
    .filter(b=>!b.dead && !b.paused && workersRequiredOf(b)>0)
    .sort((a,b)=> workersRequiredOf(b) - workersRequiredOf(a)); // les plus grands postes en premier
  const homes = buildings
    .filter(b=>!b.dead && BUILD[b.type].resid && b.pop>0);
  // disponibilité par maison
  const avail = new Map(homes.map(h => [h, h.pop]));
  // approche centrée sur le poste : chaque poste recrute depuis les maisons les plus proches
  // null owner = bâtiment solo/non assigné, peut travailler avec n'importe quel propriétaire
  for(const job of jobs){
    const nearbyHomes = homes
      .filter(h => (h.owner == null || job.owner == null || h.owner === job.owner)
                && avail.get(h) > 0
                && buildingDistance(h, job) <= workRadiusOf(h))
      .sort((a,b)=> buildingDistance(a, job) - buildingDistance(b, job));
    for(const home of nearbyHomes){
      const need = workersRequiredOf(job) - workersAllocatedOf(job);
      if(need <= 0) break;
      const take = Math.min(avail.get(home), need);
      job.workersAssigned = (job.workersAssigned||0) + take;
      if(home.townId != null)
        job.workersByTown[home.townId] = (job.workersByTown[home.townId]||0) + take;
      avail.set(home, avail.get(home) - take);
    }
  }
  for(const [home, remaining] of avail) home.workersIdle = remaining;

  // Pass 2 : postes encore sous-dotés → navetteurs arrivés par bus (passengersEntrant)
  const busStops = buildings.filter(b => !b.dead && b.type === 'bus_stop' && (b.passengersEntrant || 0) >= 1);
  // pool de navetteurs disponibles par arrêt (snapshot, non consommé définitivement)
  const busAvail = new Map(busStops.map(bs => [bs, Math.floor(bs.passengersEntrant)]));
  for(const job of jobs){
    const need = workersRequiredOf(job) - workersAllocatedOf(job);
    if(need <= 0) continue;
    const nearbyStops = busStops
      .filter(bs => busAvail.get(bs) > 0 && buildingDistance(bs, job) <= BUS_STOP_RADIUS)
      .sort((a, b) => buildingDistance(a, job) - buildingDistance(b, job));
    for(const stop of nearbyStops){
      const remaining = workersRequiredOf(job) - workersAllocatedOf(job);
      if(remaining <= 0) break;
      const take = Math.min(busAvail.get(stop), remaining);
      job.workersAssigned = (job.workersAssigned||0) + take;
      job.workersByBusStop = (job.workersByBusStop||0) + take;
      busAvail.set(stop, busAvail.get(stop) - take);
    }
  }

  for(const k in WALLETS){
    const oid = +k;
    const req = jobsTotal(oid);
    const assigned = buildings.filter(b=>ownedBy(b,oid)).reduce((s,b)=>s+workersAllocatedOf(b),0);
    WALLETS[k].eff = req > 0 ? Math.min(1, assigned / req) : 1;
  }
}
