const COLORS = ['#e25e4c','#4ca3e2','#58c470','#e2a93f','#b06fd8','#f0a040','#40d0c0','#e0e0e0'];

// ---------- état ----------
let terrain, terrainHeightMap, waterHeightMap, road, rail, railOwner, railSignals, railBlocks, railBlockOccupancy, railTunnel, bgrid, buildings, trucks, walkers, homeless, floats;
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
let terraformRadius = 1; // 1..4 : taille du carré N×N affecté par Creuser/Remonter
let speed = 1, paused = false;
let dispatchTimer = 0, taxTimer = 0, mergeTimer = 0, upkeepTimer = 0, busStopTimer = 0, passengerCycleTimer = 0;
let autoSaveTimer = AUTO_SAVE_INTERVAL; // décompte en secondes (temps réel)
const FIN_ZERO = ()=> ({ ventes:0, vehicules:0, taxes:0, rembours:0, primes:0, construction:0, entretien:0, entretienVehicules:0, peageRecu:0, peagePaye:0, expansion:0 });
const START_HOMELESS = 0;
let rot = 0; // orientation de la vue (0..3)
const cam = { x:0, y:0, z:1 };
const targetCam = { x:0, y:0, z:1 };
const ZOOM_MIN = 0.35;

// Feux de circulation désactivés : réglage du MONDE (pas d'affichage local), décidé
// par l'hôte et appliqué à tous les joueurs ; sauvegardé et synchronisé avec l'état.
let trafficLightsOff = false;

// options d'affichage (persistées en localStorage)
const UI_OPTIONS = (() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('factopolis_ui_options') || '{}'); } catch(e){}
  return {
    language: (typeof currentLanguage === 'function') ? currentLanguage() : (saved.language || 'fr'),
    hideColorMarkers: saved.hideColorMarkers ?? false,
    highlightUnderstaffedFactories: saved.highlightUnderstaffedFactories ?? false,
    disableSounds: saved.disableSounds ?? false,
    soundVolume: (typeof saved.soundVolume === 'number') ? Math.max(0, Math.min(1, saved.soundVolume)) : 0.7,
    soundZoomMin: (typeof saved.soundZoomMin === 'number') ? saved.soundZoomMin : ((CFG && CFG.sons && CFG.sons.zoomMin) ?? 1.0),
    graphicPack: GRAPHIC_PACKS[saved.graphicPack] || /^asset:/.test(saved.graphicPack || '') ? saved.graphicPack : 'classic',
    panelEvents: saved.panelEvents ?? false,
    panelMinimap: saved.panelMinimap ?? true,
    panelObjectives: saved.panelObjectives ?? true,
    // Qualité graphique : auto (baisse la résolution si le jeu rame), haute (résolution
    // native de l'écran), basse (résolution 1×, sans fumée) — pour les machines modestes.
    quality: ['auto','high','low'].includes(saved.quality) ? saved.quality : 'auto',
  };
})();
function saveUIOptions(){ localStorage.setItem('factopolis_ui_options', JSON.stringify(UI_OPTIONS)); }

// Historique runtime des événements UI focalisables (non persisté dans les sauvegardes).
let gameEvents = [];
let nextGameEventId = 1;
// La Gazette : grands événements annoncés une seule fois par partie (drapeaux et
// dernières nouvelles persistés et synchronisés ; l'hôte publie, cf. publishNews).
let newsFlags = Object.create(null);
let newsLog = [];
let nextNewsId = 1;
let newsSeenId = 0;   // dernière nouvelle affichée localement
let newsNeedsPriming = false; // ancienne sauvegarde chargée : marquer l'existant comme annoncé

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
// Clé de WALLETS → identifiant propriétaire des bâtiments. En solo le portefeuille
// est rangé sous la clé 0 alors que les bâtiments ont owner = null : sans cette
// conversion, taxes, paliers de population et efficacité ne comptaient RIEN en solo.
const walletOwnerOf = k => { const n = +k; return n === 0 ? null : n; };
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

const MAP_SIZE_OPTIONS = [128, 192, 256];
function snapMapSize(v, def){
  v = Number(v);
  if(!Number.isFinite(v)) return def;
  let best = MAP_SIZE_OPTIONS[0], bestDiff = Infinity;
  for(const opt of MAP_SIZE_OPTIONS){
    const diff = Math.abs(opt - v);
    if(diff < bestDiff){ bestDiff = diff; best = opt; }
  }
  return best;
}

function worldDefaultsFromConfig(){
  const worldCfg = CFG.monde || {};
  const resourcesCfg = worldCfg.ressources || {};
  return {
    size: snapMapSize(worldCfg.taille, 128),
    maxPlayers: Math.round(clampNum(worldCfg.joueursMax, 1, 32, 8)),
    waterPct: clampNum(worldCfg.eauPct, 0, 100, 40),
    reliefEnabled: worldCfg.reliefEnabled !== false,
    mountainPct: clampNum(worldCfg.montagnePct, 0, 80, 15),
    mountainMaxHeight: Math.round(clampNum(worldCfg.montagneHauteurMax, 1, 12, 6)),
    resourceFactor: 1,
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
  const resourceFactor = clampNum(c.resourceFactor, 0.1, 3, WORLD_DEFAULTS.resourceFactor);
  const baseRes = WORLD_DEFAULTS.resources;
  return {
    size: snapMapSize(c.size, WORLD_DEFAULTS.size),
    maxPlayers: Math.round(clampNum(c.maxPlayers, 1, 32, WORLD_DEFAULTS.maxPlayers)),
    waterPct: WORLD_DEFAULTS.waterPct,
    reliefEnabled: c.reliefEnabled !== false,
    mountainPct: clampNum(c.mountainPct, 0, 80, WORLD_DEFAULTS.mountainPct),
    mountainMaxHeight: Math.round(clampNum(c.mountainMaxHeight, 1, 12, WORLD_DEFAULTS.mountainMaxHeight)),
    resourceFactor,
    resources: {
      tree: clampNum(baseRes.tree * resourceFactor, 0, 100, baseRes.tree),
      wheat: clampNum(baseRes.wheat * resourceFactor, 0, 100, baseRes.wheat),
      cotton: clampNum(baseRes.cotton * resourceFactor, 0, 100, baseRes.cotton),
      iron: clampNum(baseRes.iron * resourceFactor, 0, 100, baseRes.iron),
      coal: clampNum(baseRes.coal * resourceFactor, 0, 100, baseRes.coal),
    },
    seed: Number.isFinite(c.seed) ? c.seed : Math.floor(Math.random() * 2 ** 31),
    // Décalage cumulé de l'origine de la grille (growMap) — repère absolu du bruit
    noiseOx: Number.isFinite(c.noiseOx) ? c.noiseOx : 0,
    noiseOy: Number.isFinite(c.noiseOy) ? c.noiseOy : 0,
  };
}

function reliefCfg(){
  const src = CFG.monde?.relief || {};
  const levels = Math.max(0, Math.min(12, Math.round(WORLD?.mountainMaxHeight ?? src.niveaux ?? 6)));
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

// Une tuile est "plate" si ses quatre coins sont au même niveau de relief
// (pas de pente/falaise dessinée dessus) : seules ces tuiles sont constructibles.
function tileIsFlat(x, y){
  const c = terrainTileCornerLevels(x, y);
  return c.nw === c.ne && c.ne === c.se && c.se === c.sw;
}

// Une tuile est une rampe simple à 45° si un côté (nord ou ouest) est à un
// niveau et le côté opposé exactement un niveau plus haut/bas — c'est la seule
// pente franchissable par une route (les coins/falaises à 3 niveaux ou en
// diagonale ne le sont pas).
function tileIsSlope45(x, y){
  const c = terrainTileCornerLevels(x, y);
  if(c.nw === c.ne && c.sw === c.se) return Math.abs(c.nw - c.sw) === 1;
  if(c.nw === c.sw && c.ne === c.se) return Math.abs(c.nw - c.ne) === 1;
  return false;
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

// ---------- plancher de tunnel ----------
// Une tuile de galerie souterraine (railTunnel) porte un relief de montagne : sans
// correction, le train grimperait sur la montagne au lieu de filer tout droit dans
// le tunnel. On précalcule l'altitude px du PLANCHER du tunnel (au niveau des
// bouches, à l'opposé du sommet percé) pour chaque tuile de galerie ET chaque
// bouche : les véhicules s'y posent à plat, puis sont masqués sous le relief entre
// les deux bouches. Recalculé quand les rails/tunnels changent (railVersion).
let tunnelFloorPx = null;        // Float32Array(N*N) : altitude px du plancher, -1 = hors tunnel
let tunnelFloorVersion = -1;

function rebuildTunnelFloors(){
  if(!rail || !railTunnel || !terrainHeightMap){ tunnelFloorPx = null; return; }
  const step = terrainReliefStepPx();
  const floor = new Float32Array(N * N).fill(-1);
  const seen = new Uint8Array(N * N);
  const mouthLift = m => terrainLevelAt(m % N, (m / N) | 0) * step; // côté bas de la pente
  for(let i = 0; i < N * N; i++){
    if(!railTunnel[i] || seen[i]) continue;
    // Composante connexe de tuiles souterraines reliées par le rail.
    const comp = [];
    const stack = [i]; seen[i] = 1;
    const mouths = new Set();
    while(stack.length){
      const cur = stack.pop(); comp.push(cur);
      const cx = cur % N, cy = (cur / N) | 0;
      for(const def of RAIL_DIRS){
        if(!(rail[cur] & def.bit)) continue;
        const nx = cx + def.dx, ny = cy + def.dy;
        if(nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = ny * N + nx;
        if(!rail[ni] || !(rail[ni] & RAIL_DIRS[def.opposite].bit)) continue;
        if(railTunnel[ni]){ if(!seen[ni]){ seen[ni] = 1; stack.push(ni); } }
        else mouths.add(ni); // rail de surface relié = bouche du tunnel
      }
    }
    const mouthArr = [...mouths];
    if(mouthArr.length === 2){
      // Plancher interpolé linéairement entre les altitudes des deux bouches,
      // suivant la distance parcourue dans la galerie (tunnel qui relie deux
      // niveaux de terrain différents → pente régulière).
      const distFrom = (start)=>{
        const d = new Map([[start, 0]]); const q = [start];
        for(let qi = 0; qi < q.length; qi++){
          const cur = q[qi], cx = cur % N, cy = (cur / N) | 0;
          for(const def of RAIL_DIRS){
            if(!(rail[cur] & def.bit)) continue;
            const nx = cx + def.dx, ny = cy + def.dy;
            if(nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            const ni = ny * N + nx;
            if(!railTunnel[ni] || d.has(ni)) continue;
            if(!(rail[ni] & RAIL_DIRS[def.opposite].bit)) continue;
            d.set(ni, d.get(cur) + 1); q.push(ni);
          }
        }
        return d;
      };
      const [ma, mb] = mouthArr;
      const La = mouthLift(ma), Lb = mouthLift(mb);
      const da = distFrom(ma), db = distFrom(mb);
      for(const t of comp){
        const a = da.get(t) ?? 1, b = db.get(t) ?? 1;
        floor[t] = La + (Lb - La) * (a / (a + b));
      }
      floor[ma] = La; floor[mb] = Lb;
    } else {
      // Géométrie atypique (0, 1 ou >2 bouches) : plancher plat au niveau le plus bas.
      let base = Infinity;
      for(const m of mouthArr) base = Math.min(base, mouthLift(m));
      if(!isFinite(base)) base = 0;
      for(const t of comp) floor[t] = base;
      for(const m of mouthArr) floor[m] = base;
    }
  }
  tunnelFloorPx = floor;
}

function ensureTunnelFloors(){
  if(tunnelFloorVersion === railVersion) return;
  rebuildTunnelFloors();
  tunnelFloorVersion = railVersion;
}

function tunnelFloorPxAt(x, y){
  if(!tunnelFloorPx || x < 0 || y < 0 || x >= N || y >= N) return -1;
  return tunnelFloorPx[y * N + x];
}

function setMapSize(size){
  N = Math.max(32, Math.round(size));
  dist = new Int32Array(N*N);
  prev = new Int32Array(N*N);
  mapMask = new Uint8Array(N*N);
}

// Décale toutes les collections vivantes portant des coordonnées absolues de (dx,dy) tuiles.
// Utilisé par growMap() quand la grille grandit vers la gauche/le haut (copie décalée dans le
// tableau réalloué). Les champs dérivés d'une référence d'objet vivant (garageRef/source/dest/
// target sur trucks/vehicles) n'ont besoin d'aucun traitement : ils sont recalculés depuis
// l'objet référencé (building), lui-même déjà décalé ici.
function shiftWorldOrigin(dx, dy){
  if(!dx && !dy) return;
  for(const b of buildings){ b.x += dx; b.y += dy; }
  for(const t of towns){ t.cx += dx; t.cy += dy; }
  const shiftPts = pts => { if(Array.isArray(pts)) for(const p of pts){ p.x += dx*TILE; p.y += dy*TILE; } };
  for(const tk of trucks) shiftPts(tk.pts);
  for(const wk of walkers) shiftPts(wk.pts);
  for(const v of vehicles){ shiftPts(v.pts); shiftPts(v.railTrail); }
  for(const h of homeless){ h.x += dx*TILE; h.y += dy*TILE; }
  for(const f of floats){ f.x += dx*TILE; f.y += dy*TILE; }
  cam.x += dx*TILE; cam.y += dy*TILE;
  targetCam.x += dx*TILE; targetCam.y += dy*TILE;
  if(railSignals){
    const shifted = Object.create(null);
    for(const key in railSignals){
      const sig = railSignals[key];
      sig.x += dx; sig.y += dy;
      shifted[railSignalKey(sig.x, sig.y, sig.bit)] = sig;
    }
    railSignals = shifted;
  }
}

// Agrandit la grille N×N en cours de partie. `need` = tuiles manquantes par côté
// ({left,right,top,bottom}, >=0). Grandit par paliers de GROW_CHUNK pour limiter la
// fréquence des réallocations O(N²). Retourne {dx,dy} (décalage appliqué à l'origine)
// si la grille a grandi, false sinon (rien à faire, ou plafond MAP_MAX_N atteint).
// ATTENTION : tout changement de N invalide les index plats y*N+x (le stride change),
// même sans décalage (dx=dy=0) — d'où le ré-encodage systématique des pathTiles etc.
function growMap(need){
  const chunk = s => Math.ceil(Math.max(0, need?.[s] || 0) / GROW_CHUNK) * GROW_CHUNK;
  let addL = chunk('left'), addR = chunk('right'), addT = chunk('top'), addB = chunk('bottom');
  if(!addL && !addR && !addT && !addB) return false;
  const oldN = N;
  let newN = oldN + addL + addR;
  const newNy = oldN + addT + addB;
  // Grille carrée : on grandit du même total sur les deux axes (l'excédent va côté droit/bas,
  // append-only, sans décalage). MAP_MAX_N = plafond de sécurité (coût pathfinding O(N²)/tick).
  if(newNy > newN){ addR += newNy - newN; newN = newNy; }
  else if(newN > newNy){ addB += newN - newNy; }
  if(newN > MAP_MAX_N) return false;
  const dx = addL, dy = addT;

  // Centre de vue actuel (repère monde AVANT décalage), pour recentrer après coup :
  // les transformations de rotation (rotIdx/rotF) dépendent de N via N-1-x, donc toute
  // vue tournée "saute" au changement de N — absorbé par un recentrage caméra explicite.
  const viewCenter = (typeof screenCenterWorldPx === 'function') ? screenCenterWorldPx() : null;

  const oldTerrain = terrain, oldHeights = terrainHeightMap, oldWater = waterHeightMap;
  const oldRoad = road, oldRail = rail, oldRailOwner = railOwner, oldRailTunnel = railTunnel;
  const oldMask = mapMask;
  setMapSize(newN); // met à jour N, réalloue dist/prev/mapMask (mapMask à zéro)
  terrain = new Uint8Array(N*N);
  terrainHeightMap = new Uint8Array(N*N);
  waterHeightMap = new Uint8Array(N*N);
  road = new Uint8Array(N*N);
  rail = new Uint8Array(N*N);
  railOwner = new Int16Array(N*N).fill(-1);
  railTunnel = new Uint8Array(N*N);
  for(let y=0; y<oldN; y++){
    const src = y*oldN, dst = (y+dy)*N + dx;
    terrain.set(oldTerrain.subarray(src, src+oldN), dst);
    terrainHeightMap.set(oldHeights.subarray(src, src+oldN), dst);
    waterHeightMap.set(oldWater.subarray(src, src+oldN), dst);
    road.set(oldRoad.subarray(src, src+oldN), dst);
    rail.set(oldRail.subarray(src, src+oldN), dst);
    railOwner.set(oldRailOwner.subarray(src, src+oldN), dst);
    railTunnel.set(oldRailTunnel.subarray(src, src+oldN), dst);
    if(oldMask) mapMask.set(oldMask.subarray(src, src+oldN), dst);
  }

  // Coordonnées absolues des entités vivantes (+ signaux, caméra)
  shiftWorldOrigin(dx, dy);
  mapBounds.x0 += dx; mapBounds.x1 += dx;
  mapBounds.y0 += dy; mapBounds.y1 += dy;

  // Index plats y*N+x des trains : stride changé → décoder (oldN), décaler, ré-encoder (N)
  const remapTile = t => {
    if(!Number.isInteger(t) || t < 0) return t;
    const x = t % oldN + dx, y = ((t / oldN) | 0) + dy;
    return y*N + x;
  };
  for(const v of vehicles){
    if(Array.isArray(v.pathTiles)) v.pathTiles = v.pathTiles.map(remapTile);
    if(v.railContinueTile != null) v.railContinueTile = remapTile(v.railContinueTile);
    if(v.railPreviousTile != null) v.railPreviousTile = remapTile(v.railPreviousTile);
    if(v.railPathEntryFromTile != null) v.railPathEntryFromTile = remapTile(v.railPathEntryFromTile);
    // currentRailBlock : ids recalculés par rebuildRailBlocks/rebuildRailBlockOccupancy ci-dessous
  }

  // Terrain des tuiles réellement nouvelles uniquement. noiseOx/noiseOy AVANT la
  // génération : les closures valueNoise doivent échantillonner le repère absolu décalé.
  WORLD.noiseOx = (WORLD.noiseOx || 0) + dx;
  WORLD.noiseOy = (WORLD.noiseOy || 0) + dy;
  if(starterSite) starterSite = { x: starterSite.x + dx, y: starterSite.y + dy };
  generateNewMapRegion(oldN, dx, dy);

  // Grille d'occupation des bâtiments
  bgrid = new Array(N*N).fill(null);
  for(const b of buildings) if(!b.dead) setGrid(b, b);

  // Cantons ferroviaires (ids par tuile) + occupation
  rebuildRailBlocks();
  if(typeof rebuildRailBlockOccupancy === 'function') rebuildRailBlockOccupancy();

  // États transitoires dépendants de N / de la projection iso
  smoke.length = 0;
  if(typeof roadDragStart !== 'undefined'){ roadDragStart = null; roadPreviewTiles = []; tunnelPreview = null; }

  markTerrainDirty();
  markRailDirty();
  if(viewCenter) centerOn(viewCenter[0] + dx*TILE, viewCenter[1] + dy*TILE);
  return { dx, dy };
}

// Fait grandir la grille si la PROCHAINE bande d'expansion (EXP_DEPTH tuiles) d'un côté
// quelconque déborderait. Appelé après chaque extension de mapBounds (buyExpansion), pour
// que refreshExpansionSlots trouve toujours du terrain réel à tarifer sur les offres.
// Côté hôte / solo uniquement : en multijoueur les invités reçoivent la grille agrandie
// via le snapshot complet de l'hôte. Retourne le résultat de growMap ({dx,dy} ou false).
function ensureMapCapacityForNextBand(){
  if(typeof MP !== 'undefined' && MP.connected && MP.role !== 'host') return false;
  const need = {
    left:   Math.max(0, EXP_DEPTH - mapBounds.x0),
    right:  Math.max(0, mapBounds.x1 + EXP_DEPTH - N),
    top:    Math.max(0, EXP_DEPTH - mapBounds.y0),
    bottom: Math.max(0, mapBounds.y1 + EXP_DEPTH - N),
  };
  const grown = growMap(need);
  if(grown && typeof MP !== 'undefined' && MP.connected && MP.role === 'host'
     && typeof mpForceFullSnapshot === 'function'){
    // Snapshot complet immédiat : sans lui, les invités décoderaient les pathTiles des
    // trains avec un N obsolète pendant jusqu'à ~1s (timer normal de sync monde).
    mpForceFullSnapshot();
  }
  return grown;
}

// ---------- canvas ----------
const cv = document.getElementById('cv');
// `ctx` est volontairement `let` : draw() le bascule temporairement vers le
// contexte du buffer-sol pendant une reconstruction, puis le restaure. Toutes
// les fonctions de dessin passent par ce global, donc la bascule les redirige.
let ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
// Qualité : en « basse » (ou « auto » après détection d'une machine lente) on rend
// à la résolution CSS (1 pixel par pixel logique) au lieu de la résolution physique de
// l'écran : sur un écran à mise à l'échelle 150–200 %, c'est 2 à 4 fois moins de pixels
// pour le sol, les sprites et la couche 2D.
let qualityAutoLowered = false;
const qualityLow = () => UI_OPTIONS.quality === 'low' || (UI_OPTIONS.quality === 'auto' && qualityAutoLowered);
function resize(){
  DPR = qualityLow() ? 1 : (window.devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  cv.width = W*DPR; cv.height = H*DPR;
}
// Changement de qualité à chaud : recalcule DPR, redimensionne #cv et la scène Pixi.
function applyQuality(){
  resize();
  if(typeof PixiScene !== 'undefined' && PixiScene.resize) PixiScene.resize();
  if(typeof markGroundDirty === 'function') markGroundDirty();
}
addEventListener('resize', resize); resize();

// ---------- cache de la couche sol (terrain/eau/routes/rails) ----------
// Scroll-buffer à marge : on rend le sol dans un canvas offscreen PLUS GRAND que
// le viewport (marge GROUND_BUFFER_MARGIN px CSS de chaque côté), centré sur la
// caméra du moment. Tant que la caméra reste dans la marge (et que rien d'autre
// n'a changé), on se contente de blitter le buffer décalé — zéro re-rendu du sol.
// On ne reconstruit qu'en sortant de la marge, au zoom (z change), sur rotation
// ou mutation du sol. Voir draw() dans 07_rendering.js.
//
// Mémoire : buffer ≈ (W+2M)·(H+2M)·DPR²·4 octets (dizaines de Mo en hi-DPI). M est
// le curseur : plus grand = pan plus longtemps sans reconstruction, mais plus de
// mémoire et reconstructions plus coûteuses.
const GROUND_BUFFER_MARGIN = 320; // marge en px CSS
const groundCache = document.createElement('canvas');
const groundCacheCtx = groundCache.getContext('2d');
let _bufContentKey = null;      // signature du contenu du buffer (hors cam.x/cam.y)
let cacheCamX = 0, cacheCamY = 0; // caméra à laquelle le buffer a été rendu
let groundVersion = 0;          // incrémenté à chaque mutation du sol (buffer sol)
// Versions plus fines pour éviter les rescans plein-carte O(N²) inutiles : le décor
// de terrain (arbres, poissons) ne dépend QUE du terrain/mapMask, et les bouches de
// tunnel QUE des rails. Poser une route/un rail ne doit donc pas les recalculer.
let terrainVersion = 0;         // terrain, eau/relief, mapMask (zones)
let railVersion = 0;            // masques rail + tuiles de tunnel
let railSignalVersion = 0;      // pose/retrait/état des signaux ferroviaires
function markGroundDirty(){ groundVersion++; }
function markTerrainDirty(){ terrainVersion++; groundVersion++; } // terrain → + sol
function markRailDirty(){ railVersion++; groundVersion++; }       // rail → + sol

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
// Hash entier déterministe : ne dépend que de (seed, cell, col, row), jamais de N/gs.
// Permet à valueNoise() de rejouer exactement le même champ de bruit à des instants
// différents (ex: generateNewMapRegion appelé après une croissance de la grille),
// pour éviter toute couture visible entre le terrain existant et le terrain nouvellement généré.
function noiseLatticeHash(seed, cell, col, row){
  let h = (seed ^ Math.imul(cell, 374761393) ^ Math.imul(col, 668265263) ^ Math.imul(row, 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}

function valueNoise(cell){
  const seed = (WORLD && Number.isFinite(WORLD.seed)) ? WORLD.seed : 0;
  // Repère ABSOLU : growMap décale l'origine de la grille (dx,dy) quand la carte grandit
  // vers la gauche/le haut ; noiseOx/noiseOy accumulent ce décalage pour que chaque tuile
  // garde la même valeur de bruit quelle que soit sa coordonnée de grille actuelle.
  const ox = (WORLD && Number.isFinite(WORLD.noiseOx)) ? WORLD.noiseOx : 0;
  const oy = (WORLD && Number.isFinite(WORLD.noiseOy)) ? WORLD.noiseOy : 0;
  const sm = t => t*t*(3-2*t);
  return (x,y)=>{
    const gx = (x - ox)/cell, gy = (y - oy)/cell;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = sm(gx-x0), fy = sm(gy-y0);
    const a = noiseLatticeHash(seed, cell, x0,   y0);
    const b = noiseLatticeHash(seed, cell, x0+1, y0);
    const c = noiseLatticeHash(seed, cell, x0,   y0+1);
    const d = noiseLatticeHash(seed, cell, x0+1, y0+1);
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
  const mountainNoise = valueNoise(26);
  const mountainPct = clampNum(WORLD?.mountainPct, 0, 80, 15);
  const candidates = [];
  for(let y = 0; y < N; y++) for(let x = 0; x < N; x++){
    if(inScope && !inScope(x, y)) continue;
    const i = y * N + x;
    const base = terrainNoiseScore(noiseA, noiseB, noiseC, x, y);
    const ridge = 1 - Math.abs(ridgeNoise(x, y) * 2 - 1);
    const plateau = (plateauNoise(x, y) - 0.5) * cfg.plateauNoise;
    const mountain = mountainNoise(x, y) * 0.7 + ridge * 0.3;
    candidates.push({ i, x, y, water: base, land: base * 0.7 + ridge * 0.3 + plateau, mountain });
  }
  if(!candidates.length) return;
  const waterTiles = Math.min(candidates.length, Math.max(0, Math.round(candidates.length * waterPct / 100)));
  const sorted = candidates.slice().sort((a, b) => a.water - b.water);
  const waterSet = new Set(sorted.slice(0, waterTiles).map(c => c.i));
  const waterThreshold = waterTiles > 0 ? sorted[Math.max(0, waterTiles - 1)].water : 0;
  const den = Math.max(0.001, 1 - waterThreshold);
  // Zone de montagne : un sous-ensemble contigu (choisi par bruit) des tuiles
  // de terre ; le reste de la carte reste plus ou moins plat (relief léger).
  const landCandidates = candidates.filter(c => !waterSet.has(c.i));
  const mountainTiles = Math.min(landCandidates.length, Math.max(0, Math.round(landCandidates.length * mountainPct / 100)));
  const sortedByMountain = landCandidates.slice().sort((a, b) => b.mountain - a.mountain);
  const mountainSet = new Set(sortedByMountain.slice(0, mountainTiles).map(c => c.i));
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
    const jitter = (pseudoNoise(entry.x, entry.y, 0.31, 0.19, 91) - 0.5) * cfg.roughness;
    let level;
    if(mountainSet.has(entry.i)){
      const normalized = Math.max(0, Math.min(1, (entry.land - waterThreshold) / den));
      const terraces = Math.pow(normalized, 0.82);
      level = 1 + Math.round(Math.max(0, Math.min(1, terraces + jitter)) * Math.max(0, cfg.levels - 1));
    } else {
      // Plaine : quasi plate, avec juste un léger vallonnement occasionnel.
      const flatBump = plateauNoise(entry.x, entry.y) > 0.8 ? 1 : 0;
      level = 1 + flatBump;
    }
    terrainHeightMap[entry.i] = Math.max(1, Math.min(cfg.levels, level));
  }
  smoothTerrainHeights(inScope);
  if(!inScope) rebuildWaterLevels();
}

// Zone de départ garantie (façon Factorio) : choisit un site de plaine dégagé
// près du centre et d'une rive (pêche = première filière), creuse un étang s'il
// n'y a pas d'eau à portée, et ajoute fer, charbon et bosquet à moins de ~11
// cases s'ils manquent (dans le rayon de travail d'un premier quartier). Blé et coton restent répartis sur la carte : les faire
// venir de loin est le jeu de transport du milieu de partie.
let starterSite = null; // site de départ choisi par genWorld (tuile {x,y})

// Caméra sur un endroit utile après chargement / arrivée dans un monde : ses
// propres bâtiments, sinon la ville la plus peuplée, sinon le site de départ,
// sinon le centre de la zone jouable.
function focusCameraOnWorld(){
  const me = myOwner();
  const pick = list => {
    if(!list.length) return null;
    let sx = 0, sy = 0;
    for(const b of list){ sx += b.x + b.w / 2; sy += b.y + b.h / 2; }
    sx /= list.length; sy /= list.length;
    let best = list[0], bd = Infinity;
    for(const b of list){ const d = Math.abs(b.x - sx) + Math.abs(b.y - sy); if(d < bd){ bd = d; best = b; } }
    return { x: best.x + best.w / 2, y: best.y + best.h / 2 };
  };
  const alive = buildings.filter(b => !b.dead);
  let at = pick(alive.filter(b => ownedBy(b, me) && (BUILD[b.type]?.resid || BUILD[b.type]?.ind)));
  if(!at){
    const homes = alive.filter(b => BUILD[b.type]?.resid);
    const byTown = new Map();
    for(const h of homes){ const k = h.townId ?? -1; byTown.set(k, (byTown.get(k) || 0) + (h.pop || 0)); }
    let bestTown = null, bestPop = -1;
    for(const [k, p] of byTown) if(p > bestPop){ bestPop = p; bestTown = k; }
    at = pick(homes.filter(h => (h.townId ?? -1) === bestTown));
  }
  if(!at && starterSite) at = { x: starterSite.x + 0.5, y: starterSite.y + 0.5 };
  if(!at) at = { x: (mapBounds.x0 + mapBounds.x1) / 2, y: (mapBounds.y0 + mapBounds.y1) / 2 };
  cam.z = 1;
  centerOn(at.x * TILE, at.y * TILE);
}

function ensureStarterArea(){
  const { x0, y0, x1, y1 } = mapBounds;
  const mcx = (x0 + x1) >> 1, mcy = (y0 + y1) >> 1;
  const inPlay = (x, y, m) => x >= x0 + m && y >= y0 + m && x < x1 - m && y < y1 - m;
  const plainGrass = (x, y) => terrain[y*N+x] === T.GRASS && terrainLevelAt(x, y) <= 2;
  // distance (Chebyshev) de chaque case à la rive la plus proche
  const dShore = new Int16Array(N*N).fill(-1);
  const q = new Int32Array(N*N);
  let qh = 0, qt = 0;
  for(let y = y0; y < y1; y++) for(let x = x0; x < x1; x++){
    const i = y*N+x;
    if(terrain[i] === T.GRASS && tileTouchesWater(x, y)){ dShore[i] = 0; q[qt++] = i; }
  }
  while(qh < qt){
    const c = q[qh++], cx = c % N, cy = (c / N) | 0;
    for(const [dx, dy] of DIRS8){
      const nx = cx + dx, ny = cy + dy;
      if(nx < x0 || ny < y0 || nx >= x1 || ny >= y1) continue;
      const ni = ny*N+nx;
      if(dShore[ni] >= 0) continue;
      dShore[ni] = dShore[c] + 1; q[qt++] = ni;
    }
  }
  // site : herbe de plaine dégagée (7×7 à 70 %), idéalement à ~5 cases d'une rive
  const R = Math.max(4, Math.min(28, ((x1 - x0) >> 1) - 10));
  let best = null, bestScore = Infinity;
  for(let y = mcy - R; y <= mcy + R; y++) for(let x = mcx - R; x <= mcx + R; x++){
    if(!inPlay(x, y, 10) || !plainGrass(x, y)) continue;
    let free = 0;
    for(let dy = -3; dy <= 3; dy++) for(let dx = -3; dx <= 3; dx++) if(plainGrass(x+dx, y+dy)) free++;
    if(free < 34) continue;
    const ds = dShore[y*N+x] < 0 ? 40 : dShore[y*N+x];
    const score = Math.abs(ds - 5) * 2 + Math.max(Math.abs(x - mcx), Math.abs(y - mcy)) * 0.5;
    if(score < bestScore){ bestScore = score; best = { x, y, ds }; }
  }
  if(!best) return null;
  const { x: sx, y: sy } = best;
  // Aplanit la plaine autour du site (±1 niveau seulement : collines et
  // montagnes restent intactes) pour que la rive proche soit constructible —
  // une case n'est plate que si aucune voisine n'est plus haute.
  const L = terrainLevelAt(sx, sy);
  for(let dy = -8; dy <= 8; dy++) for(let dx = -8; dx <= 8; dx++){
    const x = sx + dx, y = sy + dy;
    if(!inPlay(x, y, 1) || dx*dx + dy*dy > 72) continue;
    const i = y*N+x;
    if(terrain[i] !== T.WATER && Math.abs(terrainHeightMap[i] - L) <= 1) terrainHeightMap[i] = L;
  }
  const ring = (dmin, dmax, fn) => {
    for(let tries = 0; tries < 80; tries++){
      const a = Math.random() * Math.PI * 2, d = dmin + Math.random() * (dmax - dmin);
      const cx = Math.round(sx + Math.cos(a) * d), cy = Math.round(sy + Math.sin(a) * d);
      if(inPlay(cx, cy, 4) && fn(cx, cy)) return true;
    }
    return false;
  };
  const disk = (cx, cy, r, fn) => {
    for(let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for(let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++)
      if(dx*dx + dy*dy <= r*r + 0.3) fn(cx + dx, cy + dy);
  };
  // étang si aucune rive à portée
  if(best.ds > 10){
    ring(5, 8, (cx, cy) => {
      let ok = true;
      disk(cx, cy, 2.3, (x, y) => { if(!plainGrass(x, y) || Math.max(Math.abs(x - sx), Math.abs(y - sy)) < 3) ok = false; });
      if(!ok) return false;
      disk(cx, cy, 2.3, (x, y) => { terrain[y*N+x] = T.WATER; terrainHeightMap[y*N+x] = 0; });
      return true;
    });
  }
  rebuildWaterLevels();
  const nearest = (type, maxD) => {
    for(let y = sy - maxD; y <= sy + maxD; y++) for(let x = sx - maxD; x <= sx + maxD; x++)
      if(inMap(x, y) && mapMask[y*N+x] && terrain[y*N+x] === type) return true;
    return false;
  };
  const patch = (type, dmin, dmax, r, fill) => ring(dmin, dmax, (cx, cy) => {
    if(!plainGrass(cx, cy)) return false;
    disk(cx, cy, r, (x, y) => {
      if(terrain[y*N+x] === T.GRASS && !tileTouchesWater(x, y) && Math.random() < fill) terrain[y*N+x] = type;
    });
    terrain[cy*N+cx] = type;
    return true;
  });
  if(!nearest(T.IRON, 11)) patch(T.IRON, 6, 10, 1.5, 0.85);
  if(!nearest(T.COAL, 11)) patch(T.COAL, 6, 10, 1.5, 0.85);
  if(!nearest(T.TREE, 8)) patch(T.TREE, 4, 7, 2, 0.6);
  return { x: sx, y: sy };
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
  railTunnel = new Uint8Array(N*N);
  bgrid = new Array(N*N).fill(null);
  buildings = []; trucks = []; walkers = []; homeless = []; floats = []; smoke = [];
  vehicles = []; vehicleRouteMode = null; selectedVehicle = null; focusVehicle = null; camTracking = false; vehicleListMode = null; nextTruckId = 0; nextWalkerId = 0; nextVehicleId = 0; nextTrainStationId = 1;
  towns = []; nextTownId = 0; selectedTownId = null; townLabelHits = []; trainDepotFlagHits = [];
  WALLETS = {}; gtime = 0;
  gameEvents = []; nextGameEventId = 1;
  newsFlags = Object.create(null); newsLog = []; nextNewsId = 1; newsSeenId = 0;
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
  markTerrainDirty(); // nouveau terrain → invalider cache sol + décor (arbres/poissons)
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
  // Garantit une zone de chaque ressource indispensable dans la zone jouable initiale
  // (les taches ci-dessus peuvent toutes tomber dans la marge d'expansion non achetée)
  const ensureResourceZoneInPlayArea = (type) => {
    for(let y=mapBounds.y0; y<mapBounds.y1; y++)
      for(let x=mapBounds.x0; x<mapBounds.x1; x++)
        if(terrain[y*N+x] === type) return;
    const spots = [];
    for(let y=mapBounds.y0; y<mapBounds.y1; y++)
      for(let x=mapBounds.x0; x<mapBounds.x1; x++)
        if(terrain[y*N+x] === T.GRASS) spots.push(y*N+x);
    if(!spots.length) return;
    const idx = spots[(Math.random()*spots.length)|0];
    const cx = idx % N, cy = (idx / N) | 0;
    for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++){
      const x = cx+dx, y = cy+dy;
      if(x<mapBounds.x0||y<mapBounds.y0||x>=mapBounds.x1||y>=mapBounds.y1) continue;
      if(terrain[y*N+x] === T.GRASS) terrain[y*N+x] = type;
    }
  };
  [T.TREE, T.WHEAT, T.COTTON, T.IRON, T.COAL].forEach(ensureResourceZoneInPlayArea);
  applyShoreResources(tn, (x, y) => !!mapMask[y*N+x]);
  // zone de départ jouable : rive, fer, charbon et bois à portée (façon Factorio)
  const start = ensureStarterArea();
  starterSite = start;
  markTerrainDirty();

  // caméra : centrée sur le site de départ (à défaut, herbe proche du milieu)
  const mcx = (mapBounds.x0+mapBounds.x1)>>1, mcy = (mapBounds.y0+mapBounds.y1)>>1;
  let sx = start ? start.x : mcx, sy = start ? start.y : mcy;
  if(!start){
    outer:
    for(let r=0;r<N_PLAY>>1;r++)
      for(let y=mcy-r;y<=mcy+r;y++)
        for(let x=mcx-r;x<=mcx+r;x++)
          if(inMap(x,y) && terrain[y*N+x]===T.GRASS){ sx=x; sy=y; break outer; }
  }
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
// Rayon de recrutement des ouvriers d'un logement : base + taille × facteur
// (config habitants.rayonTravail). Maison 1×1 → 6 cases, gratte-ciel 4×4 → 12.
const WORK_RADIUS_BASE   = CFG.habitants?.rayonTravail?.base     ?? 4;
const WORK_RADIUS_FACTOR = CFG.habitants?.rayonTravail?.parTaille ?? 2;
const workRadiusOf = b => BUILD[b.type].resid ? WORK_RADIUS_BASE + Math.max(b.w||1, b.h||1) * WORK_RADIUS_FACTOR : 0;
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
  markTerrainDirty();
}

// Génère le terrain uniquement dans les tuiles réellement nouvelles après un growMap(oldN,dx,dy).
// Variante scoped de generateExpansionTerrain(): ne touche jamais une tuile déjà générée
// (même si encore hors mapBounds), pour ne pas faire "sauter" une marge déjà vue par le joueur.
function generateNewMapRegion(oldN, dx, dy){
  const n1=valueNoise(16),n2=valueNoise(7),n3=valueNoise(3),tn=valueNoise(9);
  const oldX0=dx, oldX1=dx+oldN, oldY0=dy, oldY1=dy+oldN;
  const isNew=(x,y)=> x<oldX0||y<oldY0||x>=oldX1||y>=oldY1;

  // Rectangles couvrant exactement la zone neuve (cadre autour de l'ancienne grille décalée) :
  // tirage direct des centres de gisements dedans, plutôt qu'un rejet uniforme sur tout N×N
  // (la zone neuve peut être une fine bande sur une très grande grille).
  const rects=[];
  if(oldY0>0) rects.push({x0:0,y0:0,x1:N,y1:oldY0});           // bande du haut
  if(oldY1<N) rects.push({x0:0,y0:oldY1,x1:N,y1:N});           // bande du bas
  if(oldX0>0) rects.push({x0:0,y0:oldY0,x1:oldX0,y1:oldY1});   // bande gauche (hauteur ancienne)
  if(oldX1<N) rects.push({x0:oldX1,y0:oldY0,x1:N,y1:oldY1});   // bande droite (hauteur ancienne)
  const rectArea=r=>Math.max(0,r.x1-r.x0)*Math.max(0,r.y1-r.y0);
  const totalArea=rects.reduce((s,r)=>s+rectArea(r),0);
  const pickCell=()=>{
    if(totalArea<=0) return null;
    let t=Math.random()*totalArea;
    for(const r of rects){
      const a=rectArea(r);
      if(t<a) return {x:(r.x0+Math.random()*(r.x1-r.x0))|0, y:(r.y0+Math.random()*(r.y1-r.y0))|0};
      t-=a;
    }
    return null;
  };

  // Eau / herbe de base
  applyBaseTerrain(n1, n2, n3, WORLD.waterPct, isNew);
  // Arbres
  const tc=[];
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    if(isNew(x,y)&&terrain[y*N+x]===T.GRASS) tc.push({x,y,s:tn(x,y)+Math.random()*0.25});
  }
  tc.sort((a,b)=>b.s-a.s);
  const mTiles=totalArea;
  for(let i=0,lim=Math.round(mTiles*(WORLD.resources?.tree??20)/100);i<lim&&i<tc.length;i++)
    terrain[tc[i].y*N+tc[i].x]=T.TREE;
  // Gisements et champs
  const pp=(type,count,opts={})=>{
    const minRadius=opts.minRadius??1,maxRadius=opts.maxRadius??2,fillChance=opts.fillChance??0.85;
    for(let k=0;k<count;k++){
      let c=null,tries=0;
      do{c=pickCell();tries++;}
      while(c&&terrain[c.y*N+c.x]===T.WATER&&tries<20);
      if(!c||terrain[c.y*N+c.x]===T.WATER)continue;
      const cx=c.x,cy=c.y;
      const r=minRadius+(Math.random()*(maxRadius-minRadius+1))|0;
      for(let ddy=-r;ddy<=r;ddy++)for(let ddx=-r;ddx<=r;ddx++){
        const px=cx+ddx,py=cy+ddy;
        if(px<0||py<0||px>=N||py>=N||!isNew(px,py))continue;
        if(ddx*ddx+ddy*ddy>r*r+0.5)continue;
        if(terrain[py*N+px]!==T.WATER&&Math.random()<fillChance)terrain[py*N+px]=type;
      }
    }
  };
  const cnt=pct=>Math.round(mTiles*pct/100/8);
  pp(T.WHEAT,cnt(WORLD.resources?.wheat??8));
  pp(T.COTTON,cnt(WORLD.resources?.cotton??2),{maxRadius:1,fillChance:0.65});
  pp(T.IRON, cnt(WORLD.resources?.iron??10));
  pp(T.COAL, cnt(WORLD.resources?.coal??10));
  applyShoreResources(tn, isNew);
  rebuildWaterLevels();
  markTerrainDirty();
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

// Achat depuis l'interface : appliqué localement puis diffusé (l'hôte rejoue
// l'achat pour le joueur expéditeur, cf. applyAction 'buy_expansion').
function buyExpansionAction(exp){
  if(!exp) return;
  if(myWallet().money < exp.cost){ toast('Fonds insuffisants ('+exp.cost.toLocaleString()+' $ requis).','err'); return; }
  if(typeof mpInRoom === 'function' && mpInRoom()){
    if(!MP.username){ toast('👤 Connecte-toi avec un compte joueur pour acheter du terrain','err'); return; }
    netSend({ type:'buy_expansion', side:exp.side, pieceIndex:exp.pieceIndex });
  }
  buyExpansion(exp);
}

function buyExpansion(exp, payer = null, remote = false){
  if(!exp) return false;
  const wallet = payer || myWallet();
  if(wallet.money < exp.cost){
    if(!remote) toast('Fonds insuffisants ('+exp.cost.toLocaleString()+' $ requis).','err');
    return false;
  }
  wallet.money -= exp.cost;
  wallet.fin.expansion = (wallet.fin.expansion || 0) + exp.cost;

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

  // Si la prochaine bande d'un côté déborderait la grille, agrandir maintenant
  // (expansion "infinie" — jusqu'au plafond MAP_MAX_N). Décale exp.cx/cy si l'origine
  // a bougé, pour que le float 🧩 s'affiche au bon endroit.
  const grown = ensureMapCapacityForNextBand();
  if(grown){ exp.cx += grown.dx; exp.cy += grown.dy; }

  refreshExpansionSlots();
  markTerrainDirty(); // mapMask/zones modifiés → cache sol + décor (arbres révélés)
  if(selectedExpansion && (selectedExpansion === exp || !expansions.includes(selectedExpansion))) selectedExpansion = null;
  hudTimer = 0;
  const dirLabel = {right:'droite',left:'gauche',bottom:'bas',top:'haut',
    'top-left':'haut-gauche','top-right':'haut-droite',
    'bottom-left':'bas-gauche','bottom-right':'bas-droite'}[exp.side];
  if(!remote) toast('🧩 Pièce achetée vers '+dirLabel+'.','win');
  addFloat(exp.cx, exp.cy, '🧩', '#60d8a0');
  return true;
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

// Emplois à portée des logements d'un village. Appelé par le HUD plusieurs fois
// par seconde : grille spatiale des postes + cache court (même pas de temps).
let _townJobsCache = { key:'', map:new Map() };
function townReachableJobBuildings(townId){
  const key = buildings.length + ':' + Math.floor(gtime * 2) + ':' + _workerAllocSig;
  if(_townJobsCache.key !== key) _townJobsCache = { key, map:new Map() };
  const cached = _townJobsCache.map.get(townId);
  if(cached) return cached;
  const homes = townHomes(townId);
  const CELL = 16, grid = new Map();
  for(const job of buildings){
    if(job.dead || job.paused || workersRequiredOf(job) <= 0) continue;
    const c = centerOfBuilding(job);
    const k = Math.floor(c.x / CELL) * 65536 + Math.floor(c.y / CELL);
    let cell = grid.get(k);
    if(!cell){ cell = []; grid.set(k, cell); }
    cell.push(job);
  }
  const seen = new Set();
  const out = [];
  for(const home of homes){
    const radius = workRadiusOf(home);
    const hc = centerOfBuilding(home);
    const gx0 = Math.floor((hc.x - radius) / CELL), gx1 = Math.floor((hc.x + radius) / CELL);
    const gy0 = Math.floor((hc.y - radius) / CELL), gy1 = Math.floor((hc.y + radius) / CELL);
    for(let gx = gx0; gx <= gx1; gx++) for(let gy = gy0; gy <= gy1; gy++){
      const cell = grid.get(gx * 65536 + gy);
      if(!cell) continue;
      for(const job of cell){
        if(seen.has(job) || !ownedBy(job, home.owner)) continue;
        if(buildingDistance(home, job) <= radius){
          seen.add(job);
          out.push(job);
        }
      }
    }
  }
  _townJobsCache.map.set(townId, out);
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
  // Un arrêt/une gare posé(e) AVANT le village n'avait jamais de townId, donc ne
  // recevait jamais de voyageurs. On le rattache au village le plus proche dès
  // qu'il en existe un à portée.
  for(const b of busStops.concat(trainStations)){
    if(b.townId != null && towns.some(t => t.id === b.townId)) continue;
    const t = getTownOf({ x:b.x, y:b.y, w:b.w, h:b.h, townId:null });
    b.townId = t ? t.id : null;
  }

  const terminals = buildings.filter(b => !b.dead && (b.type === 'boat_depot' || b.type === 'plane_depot'));
  for(const t of terminals){
    if(t.townId != null && towns.some(tw => tw.id === t.townId)) continue;
    const tw = getTownOf({ x:t.x, y:t.y, w:t.w, h:t.h, townId:null });
    t.townId = tw ? tw.id : null;
  }
  for(const stop of busStops) stop.passengersMax = 0;
  for(const station of trainStations) station.passengersEntrantMax = 0;
  for(const t of terminals) t.passengersEntrantMax = 0;

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
      for(const t of terminals){
        if(t.townId !== townId) continue;
        const radius = t.type === 'boat_depot' ? PORT_RADIUS : AIRPORT_RADIUS;
        if(buildingDistance(home, t) > radius) continue;
        addEntry('term:' + t.x + ',' + t.y, t).weight += idle;
      }
    }

    if(idleTotal <= 0 || !entries.length) continue;

    for(const entry of entries) entry.building._tmpTransitCap = 0;
    apportion(entries, idleTotal, (entry, value) => { entry.building._tmpTransitCap = value; });

    for(const entry of entries){
      if(entry.building.type === 'bus_stop') entry.building.passengersMax = entry.building._tmpTransitCap || 0;
      else entry.building.passengersEntrantMax = entry.building._tmpTransitCap || 0;
      delete entry.building._tmpTransitCap;
    }
  }

  // Arrêt de bus lié à une gare : ses habitants s'ajoutent aux passagers entrants
  // de la gare (l'arrêt n'en génère plus lui-même).
  for(const stop of busStops){
    if(!(stop.passengersMax > 0)) continue;
    const station = trainStationLinkedRepresentative(stop);
    if(!station) continue;
    station.passengersEntrantMax = (station.passengersEntrantMax || 0) + stop.passengersMax;
    stop.passengersMax = 0;
  }
}

// ---------- cohérence des passagers ----------
// Les passagers sont des habitants SANS travail : pour chaque joueur, le total
// (en attente aux arrêts/gares/ports/aéroports + arrivés + à bord des véhicules)
// ne peut jamais dépasser sa population moins ses ouvriers en poste.
// (les navetteurs déjà arrivés à leur poste — entrants d'arrêt de bus — comptent
// comme « au travail »)
function transitByOwner(){
  const out = new Map();
  const get = o => {
    o = o ?? null;
    let r = out.get(o);
    if(!r){ r = { owner:o, pop:0, working:0, waiting:0, sortants:0, onboard:0, passengers:0, allowed:0, refs:[] }; out.set(o, r); }
    return r;
  };
  for(const b of buildings){
    if(b.dead) continue;
    const r = get(b.owner);
    r.pop += b.pop || 0;
    r.working += workersAllocatedOf(b);
    if(b.type === 'bus_stop'){
      r.waiting += b.passengers || 0; r.sortants += b.passagersSortant || 0;
      r.refs.push([b, 'passagersSortant', 0], [b, 'passengers', 1]);
    } else if(b.type === 'train_station' || b.type === 'boat_depot' || b.type === 'plane_depot'){
      r.waiting += (b.passengersEntrant || 0) + (b.passengersEntrantPending || 0);
      r.sortants += b.passagersSortant || 0;
      r.refs.push([b, 'passagersSortant', 0], [b, 'passengersEntrantPending', 1], [b, 'passengersEntrant', 1]);
    }
  }
  for(const v of vehicles){
    const n = v.vtype === 'train' ? (v.passengersOnBoard || 0)
      : (v.vtype === 'bus' || VEHICLE_TYPES[v.vtype]?.passengers) ? (v.cargo || 0) : 0;
    if(n > 0) get(v.owner ?? v.garageRef?.owner).onboard += n;
  }
  for(const r of out.values()){
    r.working = Math.min(r.pop, r.working);
    r.passengers = r.waiting + r.sortants + r.onboard;
    r.allowed = Math.max(0, r.pop - r.working);
  }
  return out;
}
// Retire le surplus de passagers (sortants d'abord, puis ceux en attente).
function enforceTransitCoherence(){
  for(const r of transitByOwner().values()){
    let excess = r.passengers - r.allowed;
    if(excess <= 0.01) continue;
    for(const stage of [0, 1]){
      const refs = r.refs.filter(x => x[2] === stage && (x[0][x[1]] || 0) > 0);
      const sum = refs.reduce((s, x) => s + x[0][x[1]], 0);
      if(sum <= 0 || excess <= 0) continue;
      const cut = Math.min(excess, sum), f = 1 - cut / sum;
      for(const x of refs) x[0][x[1]] *= f;
      excess -= cut;
    }
  }
}

// Allocation des ouvriers : coûteuse (chaque poste cherche les logements à
// portée). Recalculée seulement quand la structure change (bâtiments, population,
// pauses) ou au plus tard toutes les WORKER_ALLOC_PERIOD secondes de jeu.
const WORKER_ALLOC_PERIOD = 0.5;
let _workerAllocSig = '', _workerAllocAt = -Infinity;
function refreshWorkerAllocationIfNeeded(){
  let pop = 0, paused = 0;
  for(const b of buildings){ pop += b.pop || 0; if(b.paused) paused++; }
  const sig = buildings.length + ':' + pop + ':' + paused + ':' + Object.keys(WALLETS).length;
  const age = gtime - _workerAllocAt;
  // Une population qui bouge sans cesse (grande ville) changeait la signature à
  // chaque tick : on espace alors les recalculs d'au moins 0,3 s de jeu.
  if(age >= 0 && age < WORKER_ALLOC_PERIOD && (sig === _workerAllocSig || age < 0.3)) return;
  refreshWorkerAllocation();
}

const WORKER_GRID_CELL = 16;
// Ressources « vitales » : celles qu'exigent les logements (filets, pain,
// vêtements) et, par fermeture sur les recettes, leurs intrants (poisson, farine,
// blé, eau, charbon, coton). Les postes qui les produisent sont servis en
// ouvriers AVANT les autres : bâtir une fonderie ne doit pas vider les cabanes de
// pêcheurs et affamer la ville (spirale de déclin).
let _essentialRes = null;
function essentialResources(){
  if(_essentialRes) return _essentialRes;
  const set = new Set();
  for(const t in BUILD) for(const r of BUILD[t].resid?.required || []) set.add(r);
  for(let changed = true; changed;){
    changed = false;
    for(const t in BUILD){
      const rc = BUILD[t].recipe;
      if(!rc || !Object.keys(rc.out || {}).some(k => set.has(k))) continue;
      for(const k in rc.in || {}) if(!set.has(k)){ set.add(k); changed = true; }
    }
  }
  return (_essentialRes = set);
}
function isEssentialJob(b){
  const out = recipeOf(b)?.out;
  if(!out) return false;
  const ess = essentialResources();
  for(const k in out) if(ess.has(k)) return true;
  return false;
}
function refreshWorkerAllocation(){
  {
    let pop = 0, paused = 0;
    for(const b of buildings){ pop += b.pop || 0; if(b.paused) paused++; }
    _workerAllocSig = buildings.length + ':' + pop + ':' + paused + ':' + Object.keys(WALLETS).length;
    _workerAllocAt = gtime;
  }
  for(const b of buildings){ b.workersAssigned = 0; b.workersByTown = {}; b.workersIdle = 0; b.workersByBusStop = 0; }
  const jobs = buildings.filter(b=>!b.dead && !b.paused && workersRequiredOf(b)>0);
  for(const b of jobs) b._wEss = isEssentialJob(b) ? 1 : 0;
  // filières vitales d'abord, puis les plus grands postes (un transformateur
  // pourvu avant ses fournisseurs : la chaîne démarre même avec peu d'habitants)
  jobs.sort((a,b)=> (b._wEss - a._wEss) || (workersRequiredOf(b) - workersRequiredOf(a)));
  const homes = buildings
    .filter(b=>!b.dead && BUILD[b.type].resid && b.pop>0);
  // disponibilité par maison
  const avail = new Map(homes.map(h => [h, h.pop]));
  // Grille spatiale des logements (par centre) : un poste n'examine que les
  // cellules à portée du plus grand rayon de travail, au lieu de toute la carte.
  // Centres et rayons précalculés (pas d'allocation dans les boucles chaudes).
  const grid = new Map();
  let maxRadius = 0;
  for(const h of homes){
    h._wcx = h.x + (h.w||1)/2 - 0.5; h._wcy = h.y + (h.h||1)/2 - 0.5;
    h._wr = workRadiusOf(h);
    const key = Math.floor(h._wcx / WORKER_GRID_CELL) * 65536 + Math.floor(h._wcy / WORKER_GRID_CELL);
    let cell = grid.get(key);
    if(!cell){ cell = []; grid.set(key, cell); }
    cell.push(h);
    if(h._wr > maxRadius) maxRadius = h._wr;
  }
  const candidates = [];
  const homesNear = job => {
    const jx = job.x + (job.w||1)/2 - 0.5, jy = job.y + (job.h||1)/2 - 0.5;
    candidates.length = 0;
    const cx0 = Math.floor((jx - maxRadius) / WORKER_GRID_CELL), cx1 = Math.floor((jx + maxRadius) / WORKER_GRID_CELL);
    const cy0 = Math.floor((jy - maxRadius) / WORKER_GRID_CELL), cy1 = Math.floor((jy + maxRadius) / WORKER_GRID_CELL);
    for(let gx = cx0; gx <= cx1; gx++) for(let gy = cy0; gy <= cy1; gy++){
      const cell = grid.get(gx * 65536 + gy);
      if(!cell) continue;
      for(const h of cell){
        if(!(avail.get(h) > 0)) continue;
        if(h.owner != null && job.owner != null && h.owner !== job.owner) continue;
        const d = Math.max(Math.abs(h._wcx - jx), Math.abs(h._wcy - jy));
        if(d <= h._wr){ h._wd = d; candidates.push(h); } // pas d'objet par candidat
      }
    }
    candidates.sort((a,b)=> (a._wd - b._wd) || (a.y - b.y) || (a.x - b.x));
    return candidates;
  };
  // approche centrée sur le poste : chaque poste recrute depuis les maisons les plus proches
  // null owner = bâtiment solo/non assigné, peut travailler avec n'importe quel propriétaire
  for(const job of jobs){
    const nearbyHomes = homesNear(job);
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

  // Pass 3 : passagers arrivés en gare (passagersSortant) → rejoignent à pied les
  // postes encore sous-dotés situés dans le rayon de la gare (stockés sur le
  // représentant du groupe de gares).
  const stationsOut = buildings.filter(b => !b.dead && b.type === 'train_station' && (b.passagersSortant || 0) >= 1);
  if(stationsOut.length){
    const stAvail = new Map();
    const stGroups = new Map(); // représentant -> gares du groupe
    for(const st of buildings){
      if(st.dead || st.type !== 'train_station') continue;
      const rep = (typeof trainStationGroupRepresentative === 'function' && trainStationGroupRepresentative(st.stationGroupId)) || st;
      if(!(rep.passagersSortant >= 1)) continue;
      stAvail.set(rep, Math.floor(rep.passagersSortant));
      if(!stGroups.has(rep)) stGroups.set(rep, []);
      stGroups.get(rep).push(st);
    }
    for(const job of jobs){
      if(workersRequiredOf(job) - workersAllocatedOf(job) <= 0) continue;
      const near = [];
      for(const [rep, group] of stGroups){
        if(!(stAvail.get(rep) > 0)) continue;
        if(job.owner != null && rep.owner != null && job.owner !== rep.owner) continue;
        let d = Infinity;
        for(const st of group) d = Math.min(d, buildingDistance(st, job));
        if(d <= TRAIN_STATION_RADIUS) near.push({ rep, d });
      }
      near.sort((a, b) => a.d - b.d);
      for(const { rep } of near){
        const remaining = workersRequiredOf(job) - workersAllocatedOf(job);
        if(remaining <= 0) break;
        const take = Math.min(stAvail.get(rep), remaining);
        job.workersAssigned = (job.workersAssigned||0) + take;
        job.workersByBusStop = (job.workersByBusStop||0) + take;
        stAvail.set(rep, stAvail.get(rep) - take);
      }
    }
  }

  for(const k in WALLETS){
    const oid = walletOwnerOf(k);
    let req = 0, assigned = 0;
    for(const b of buildings){
      if(b.dead || !ownedBy(b, oid)) continue;
      if(!b.paused) req += workersRequiredOf(b);
      assigned += workersAllocatedOf(b);
    }
    WALLETS[k].eff = req > 0 ? Math.min(1, assigned / req) : 1;
  }
}
