'use strict';
/* ===================== Factopolis =====================
   Factorio (chaînes de production) + City builder (population/ouvriers)
   + Transport Tycoon (camions sur routes).
   Rendu isométrique 2.5D rotatif (touche R). Canvas 2D, zéro dépendance. */

// ---------- configuration (voir config.js) ----------
const CFG = (typeof CONFIG !== 'undefined') ? CONFIG : {};
function _resid(c, def){
  c = c || {};
  return {
    interval: c.intervalleConsommation ?? def.interval,
    income:   c.revenuParUnite        ?? def.income,
    popCap:   c.habitantsMax          ?? def.popCap,
    stockCap: c.stockMax              ?? def.stockCap,
  };
}
const ECO = {
  taxe:         CFG.economie?.taxeParHabitant ?? 2,
  taxeInterval: CFG.economie?.intervalleTaxes ?? 10,
};

// ---------- constantes ----------
let N = 64;              // taille de la carte (tuiles)
const TILE = 36;         // taille d'une tuile en px monde (simulation)
const TW = 64, TH = 32;  // taille d'une tuile iso à l'écran
const TW2 = TW/2, TH2 = TH/2;
const T = { GRASS:0, WATER:1, TREE:2, IRON:3, COAL:4 };
const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
const OUTCAP = 12;       // stock max de sortie par ressource
const INCAP = 12;        // stock max d'entrée par ressource
const TRUCK_LOAD  = CFG.camions?.capacite ?? 6; // cargaison max d'un camion
const TRUCK_SPEED = CFG.camions?.vitesse ?? 3.4;// tuiles / seconde
const WALK_SPEED  = CFG.habitants?.vitesseMarche ?? 1.3; // piétons, tuiles / seconde
const STARVE_DELAY = CFG.penurie?.delai ?? 30; // secondes sans marchandises avant dégradation
const BONUS_GROWTH_THRESHOLD = CFG.habitants?.croissanceBonus?.seuilStock ?? 0.5;
const BONUS_GROWTH_INTERVAL  = CFG.habitants?.croissanceBonus?.intervalle  ?? 30;
const WALKER_COLS = ['#e2574c','#4ca3e2','#58c470','#e2a93f','#b06fd8','#ececec'];

const RES = {
  iron:  { n:'Fer',          c:'#d98a4f' },
  coal:  { n:'Charbon',      c:'#454552' },
  wood:  { n:'Bois',         c:'#a4713d' },
  steel: { n:'Acier',        c:'#a8bdd2' },
  goods: { n:'Marchandises', c:'#e6c84f' },
};

const BUILD = {
  select:  { n:'Inspecter', ic:'🔍', hk:'1', desc:'Cliquer sur un bâtiment pour voir ses stocks.' },
  road:    { n:'Route',     ic:'🛣️', hk:'2', cost: CFG.batiments?.route?.cout    ?? 10,
             desc:'Relie les bâtiments — les camions y circulent. Glisser pour tracer.' },
  mine:    { n:'Mine',      ic:'⛏️', hk:'3', cost: CFG.production?.mine?.cout     ?? 450,
             workers:3, time:2.2, col:'#7d6457', hgt:16, ind:true,
             upkeep: CFG.production?.mine?.entretien     ?? 2,
             desc:'À placer sur un gisement (fer ou charbon).' },
  lumber:  { n:'Bûcheron',  ic:'🪓', hk:'4', cost: CFG.production?.bucheron?.cout ?? 350,
             workers:2, time:2.8, col:'#5e7a3a', hgt:16, ind:true,
             upkeep: CFG.production?.bucheron?.entretien ?? 1.5,
             recipe:{ in:{}, out:{wood:1} },
             desc:"À placer à 2 cases ou moins d'arbres. Produit du bois." },
  smelter: { n:'Fonderie',  ic:'🔥', hk:'5', cost: CFG.production?.fonderie?.cout ?? 900,
             workers:4, time:3.5, col:'#8a4f3d', hgt:26, ind:true,
             upkeep: CFG.production?.fonderie?.entretien ?? 3,
             recipe:{ in:{iron:1, coal:1}, out:{steel:1} },
             desc:'Fer + charbon → acier.' },
  factory: { n:'Usine',     ic:'🏭', hk:'6', cost: CFG.production?.usine?.cout    ?? 1400,
             workers:5, time:4, col:'#5a6a86', hgt:30, ind:true,
             upkeep: CFG.production?.usine?.entretien    ?? 4,
             recipe:{ in:{steel:1, wood:1}, out:{goods:1} },
             desc:'Acier + bois → marchandises.' },
  house:   { n:'Maison',    ic:'🏠', hk:'7', cost: CFG.batiments?.maison?.cout    ?? 100,
             col:'#9a7e5f', hgt:18, desc:'' },
  depot:   { n:'Entrepôt',  ic:'📦', hk:'8', cost: CFG.batiments?.entrepot?.cout  ?? 400,
             col:'#7a7048', hgt:22,
             desc:'Stocke et redistribue. Cliquer dessus pour choisir les ressources acceptées.' },
  bulldoze:{ n:'Démolir',   ic:'🧨', hk:'9', desc:'Détruit routes, bâtiments (30 % remboursés) et arbres.' },
};
// ---------- niveaux résidentiels ----------
// Un rectangle entièrement couvert de logements PLEINS plus petits fusionne
// en bâtiment du niveau correspondant (les deux orientations comptent).
const LEVELS = [
  { key:'house',     cfg:CFG.maison,                     n:'Maison',            ic:'🏠', shapes:[[1,1]],       col:'#9a7e5f', hgt:18,
    def:{ interval:8, income:25, popCap:5,   stockCap:10 } },
  { key:'duplex',    cfg:CFG.residentiel?.duplex,        n:'Maison jumelée',    ic:'🏡', shapes:[[2,1],[1,2]], col:'#8d7a52', hgt:24,
    def:{ interval:7, income:27, popCap:12,  stockCap:14 } },
  { key:'row',       cfg:CFG.residentiel?.rangee,        n:'Maisons en rangée', ic:'🏘️', shapes:[[3,1],[1,3]], col:'#97705a', hgt:27,
    def:{ interval:6, income:28, popCap:20,  stockCap:18 } },
  { key:'residence', cfg:CFG.residentiel?.residence,     n:'Résidence',         ic:'🏨', shapes:[[4,1],[1,4]], col:'#7a6a8a', hgt:34,
    def:{ interval:5, income:30, popCap:28,  stockCap:22 } },
  { key:'tower',     cfg:CFG.immeuble,                   n:'Immeuble',          ic:'🏢', shapes:[[2,2]],       col:'#6b5d8c', hgt:58,
    def:{ interval:4, income:25, popCap:30,  stockCap:25 } },
  { key:'bigtower',  cfg:CFG.residentiel?.grandImmeuble, n:'Grand immeuble',    ic:'🏬', shapes:[[3,2],[2,3]], col:'#5d6da0', hgt:84,
    def:{ interval:3, income:28, popCap:60,  stockCap:40 } },
  { key:'sky',       cfg:CFG.residentiel?.gratteCiel,    n:'Gratte-ciel',       ic:'🏙️', shapes:[[4,4]],       col:'#4a5a78', hgt:130,
    def:{ interval:2, income:30, popCap:150, stockCap:80 } },
].map(L=> ({ key:L.key, n:L.n, ic:L.ic, col:L.col, hgt:L.hgt,
             shapes: L.cfg?.formes ?? L.shapes,
             resid: _resid(L.cfg, L.def) }));

(function applyLevels(){
  for(const L of LEVELS){
    const area = L.shapes[0][0]*L.shapes[0][1];
    if(L.key==='house'){
      Object.assign(BUILD.house, { resid:L.resid, area:1 });
      BUILD.house.desc = 'Consomme des marchandises → +1 habitant et +'+L.resid.income
        +' $ par habitant présent. Les logements pleins adjacents fusionnent en niveaux supérieurs.';
      continue;
    }
    BUILD[L.key] = { n:L.n, ic:L.ic, col:L.col, hgt:L.hgt, cost:100*area, area,
      size:L.shapes[0][0], resid:L.resid,
      desc:'Fusion de logements pleins ('+L.shapes.map(s=>s[0]+'×'+s[1]).join(' ou ')
        +'). '+L.resid.popCap+' habitants.' };
  }
})();
// niveaux fusionnables, du plus grand au plus petit
const MERGE_ORDER = LEVELS.filter(L=>L.key!=='house')
  .sort((a,b)=> b.shapes[0][0]*b.shapes[0][1] - a.shapes[0][0]*a.shapes[0][1]);

// ---------- fusion industrielle ----------
// production d'un bâtiment fusionné = cases × facteur (palier ≤ taille)
const IND_SHAPES = [[4,4],[3,2],[2,3],[2,2],[4,1],[1,4],[3,1],[1,3],[2,1],[1,2]];
const IND_FACTORS = CFG.industrie?.facteurs ?? { 2:1.15, 3:1.3, 4:1.5, 6:1.75, 16:2.5 };
function indFactor(area){
  if(area <= 1) return 1;
  let f = 1;
  for(const k in IND_FACTORS) if(+k <= area) f = IND_FACTORS[k];
  return f;
}
const prodMult = b => b.w*b.h*indFactor(b.w*b.h);
// entretien : base × cases × facteur — grandit plus vite que la taille
const IND_UPKEEP_INTERVAL = CFG.industrie?.intervalleEntretien ?? 10;
const PAUSE_UPKEEP = CFG.industrie?.entretienEnPause ?? 0.5;
const upkeepOf = b => (BUILD[b.type].upkeep||0) * b.w*b.h * indFactor(b.w*b.h)
                      * (b.paused ? PAUSE_UPKEEP : 1);

// ---------- fusion entrepôt ----------
const DEPOT_STOCK_PER_CELL = CFG.entrepot?.stockParCase ?? 20;
// génère les deux orientations et déduplique, triées du plus grand au plus petit
const DEPOT_SHAPES = (()=>{
  const raw = CFG.entrepot?.formesFusion ?? [[2,1],[3,1],[2,2],[3,2],[3,3],[4,4]];
  const seen = new Set();
  const all = [];
  for(const [w,h] of raw){
    for(const [sw,sh] of [[w,h],[h,w]]){
      const k = sw+','+sh;
      if(!seen.has(k)){ seen.add(k); all.push([sw,sh]); }
    }
  }
  return all.sort((a,b)=> b[0]*b[1] - a[0]*a[1]);
})();

function checkRectDepot(x,y,w,h){
  const area = w*h, set = [];
  for(let yy=y; yy<y+h; yy++) for(let xx=x; xx<x+w; xx++){
    const b = bgrid[yy*N+xx];
    if(!b || b.type !== 'depot') return null;
    if(b.w*b.h >= area) return null;          // déjà aussi grand ou plus grand
    if(b.x<x || b.y<y || b.x+b.w>x+w || b.y+b.h>y+h) return null;
    if(!set.includes(b)) set.push(b);
  }
  return set.length ? set : null;
}

function tryMergeDepot(){
  for(const [w,h] of DEPOT_SHAPES){
    for(let y=0; y<=N-h; y++) for(let x=0; x<=N-w; x++){
      const set = checkRectDepot(x,y,w,h);
      if(!set) continue;
      const owner = set[0].owner||null;
      const store = {}, allow = {};
      // initialiser allow à true pour toutes les ressources
      for(const k in RES) allow[k] = true;
      let wasSel = false;
      for(const o of set){
        for(const k in o.storage) store[k] = (store[k]||0) + o.storage[k];
        // une ressource est refusée dans le grand entrepôt seulement si TOUS les petits la refusent
        for(const k in RES) if(o.allow?.[k] !== false) allow[k] = true;
        if(o === selected) wasSel = true;
        o.dead = true;
        setGrid(o, null);
      }
      buildings = buildings.filter(o=> !o.dead);
      const t = newBuilding('depot', x, y, w, h);
      t.owner = owner;
      t.allow = allow;
      for(const k in store) t.storage[k] = Math.min(capOf(t,k), store[k]);
      buildings.push(t);
      setGrid(t, t);
      if(wasSel) selected = t;
      toast('📦 '+set.length+' entrepôts → '+w+'×'+h+' !','win');
      return true;
    }
  }
  return false;
}
(function applyUpkeepConfig(){
  const p = CFG.production || {};
  const map = { mine:'mine', bucheron:'lumber', fonderie:'smelter', usine:'factory' };
  for(const fr in map) if(p[fr]?.entretien != null) BUILD[map[fr]].upkeep = p[fr].entretien;
})();

// surcharge des recettes et coûts par config.js (clés françaises)
(function applyProductionConfig(){
  const p = CFG.production || {};
  const map = { mine:'mine', bucheron:'lumber', fonderie:'smelter', usine:'factory' };
  for(const fr in map){
    const c = p[fr];
    if(!c) continue;
    const b = BUILD[map[fr]];
    if(c.temps != null) b.time = c.temps;
    if(c.cout  != null) b.cost = c.cout;
    if(fr==='mine'){ if(c.quantite != null) b.qty = c.quantite; continue; }
    if(c.entree) b.recipe.in  = c.entree;
    if(c.sortie) b.recipe.out = c.sortie;
  }
  // coûts des bâtiments civils
  const bats = CFG.batiments || {};
  if(bats.route?.cout    != null) BUILD.road.cost   = bats.route.cout;
  if(bats.maison?.cout   != null) BUILD.house.cost  = bats.maison.cout;
  if(bats.entrepot?.cout != null) BUILD.depot.cost  = bats.entrepot.cout;
})();

const TOOL_ORDER = ['select','road','mine','lumber','smelter','factory','house','depot','bulldoze'];
const MILESTONES = [25, 50, 100, 200, 400];

// ---------- état ----------
let terrain, road, bgrid, buildings, trucks, walkers, homeless, floats;
let gtime = 0, eff = 1; // eff = snapshot du wallet courant, gardé pour statusOf
let selected = null, tool = 'select';
let speed = 1, paused = false;
let dispatchTimer = 0, taxTimer = 0, mergeTimer = 0, upkeepTimer = 0;
const FIN_ZERO = ()=> ({ ventes:0, taxes:0, rembours:0, construction:0, entretien:0 });
const START_HOMELESS = 10;
let rot = 0; // orientation de la vue (0..3)
const cam = { x:0, y:0, z:1 };
const targetCam = { x:0, y:0, z:1 };
const ZOOM_MIN = 0.35;

// options d'affichage (persistées en localStorage)
const UI_OPTIONS = (() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('factopolis_ui_options') || '{}'); } catch(e){}
  return {
    hideColorMarkers: saved.hideColorMarkers ?? false,
  };
})();
function saveUIOptions(){ localStorage.setItem('factopolis_ui_options', JSON.stringify(UI_OPTIONS)); }
const ZOOM_MAX = 2.4;
const ZOOM_WHEEL_SENS = 0.0022;
const CAM_SMOOTH = 18;
let zoomActiveUntil = 0;
let drawFast = false;

// ---------- wallets (économie par joueur) ----------
// Clé : MP.myId en multijoueur, 0 en solo.
let WALLETS = {};
const SOLO_KEY = 0;
const walletKey = () => (MP.connected && MP.myId != null) ? MP.myId : SOLO_KEY;
const walletOf  = oid => {
  const k = (oid == null) ? SOLO_KEY : oid;
  if(!WALLETS[k]) WALLETS[k] = { money:2500, fin:FIN_ZERO(), finHist:[], finTimer:0, mi:0, eff:1, homelessSeeded:false, starterHomes:0 };
  if(WALLETS[k].starterHomes == null) WALLETS[k].starterHomes = 0;
  return WALLETS[k];
};
const myWallet  = () => walletOf(walletKey());
// accesseurs rétro-compatibles (lecture/écriture du wallet courant)
const getMoney   = ()    => myWallet().money;
const spendMoney = (n,cat)=>{ const w=myWallet(); w.money-=n; w.fin[cat]=(w.fin[cat]||0)+n; };
const earnMoney  = (n,cat,w=myWallet())=>{ w.money+=n; w.fin[cat]=(w.fin[cat]||0)+n; };

// BFS réutilisables
let dist = new Int32Array(N*N);
let prev = new Int32Array(N*N);

const WORLD_DEFAULTS = {
  size: 64,
  maxPlayers: 8,
  resources: { tree: 8, iron: 2, coal: 2 },
};
let WORLD = JSON.parse(JSON.stringify(WORLD_DEFAULTS));

function clampNum(v, min, max, def){
  v = Number(v);
  if(!Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, v));
}

function normalizeWorldConfig(config){
  const c = config || {};
  const r = c.resources || {};
  return {
    size: Math.round(clampNum(c.size, 32, 128, WORLD_DEFAULTS.size)),
    maxPlayers: Math.round(clampNum(c.maxPlayers, 1, 32, WORLD_DEFAULTS.maxPlayers)),
    resources: {
      tree: clampNum(r.tree, 0, 40, WORLD_DEFAULTS.resources.tree),
      iron: clampNum(r.iron, 0, 40, WORLD_DEFAULTS.resources.iron),
      coal: clampNum(r.coal, 0, 40, WORLD_DEFAULTS.resources.coal),
    },
  };
}

function setMapSize(size){
  N = Math.round(clampNum(size, 32, 128, WORLD_DEFAULTS.size));
  dist = new Int32Array(N*N);
  prev = new Int32Array(N*N);
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
  rot = (rot + d + 4) & 3;
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

function genWorld(config){
  WORLD = normalizeWorldConfig(config || WORLD);
  setMapSize(WORLD.size);
  terrain = new Uint8Array(N*N);
  road = new Uint8Array(N*N);
  bgrid = new Array(N*N).fill(null);
  buildings = []; trucks = []; walkers = []; homeless = []; floats = [];
  WALLETS = {}; gtime = 0;
  selected = null; dispatchTimer = 0; taxTimer = 0; mergeTimer = 0; upkeepTimer = 0;

  const n1 = valueNoise(16), n2 = valueNoise(7), n3 = valueNoise(3);
  const tn = valueNoise(9);
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const h = 0.55*n1(x,y) + 0.30*n2(x,y) + 0.15*n3(x,y);
    let t = T.GRASS;
    if(h < 0.40) t = T.WATER;
    terrain[y*N+x] = t;
  }
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
  // gisements en taches
  const placePatch = (type, count)=>{
    for(let k=0;k<count;k++){
      let cx, cy, tries = 0;
      do { cx = 3+(Math.random()*(N-6))|0; cy = 3+(Math.random()*(N-6))|0; }
      while(terrain[cy*N+cx] === T.WATER && ++tries < 300);
      const r = 1 + (Math.random()*2)|0;
      for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
        const x = cx+dx, y = cy+dy;
        if(x<0||y<0||x>=N||y>=N) continue;
        if(dx*dx+dy*dy > r*r+0.5) continue;
        if(terrain[y*N+x] !== T.WATER && Math.random() < 0.85) terrain[y*N+x] = type;
      }
    }
  };
  const patchCount = pct => Math.round(N*N * pct / 100 / 8);
  placePatch(T.IRON, patchCount(WORLD.resources.iron));
  placePatch(T.COAL, patchCount(WORLD.resources.coal));

  // caméra : centrée sur une zone d'herbe proche du milieu
  let sx = N>>1, sy = N>>1;
  outer:
  for(let r=0;r<N>>1;r++)
    for(let y=(N>>1)-r;y<=(N>>1)+r;y++)
      for(let x=(N>>1)-r;x<=(N>>1)+r;x++)
        if(x>=0&&y>=0&&x<N&&y<N && terrain[y*N+x]===T.GRASS){ sx=x; sy=y; break outer; }
  cam.z = 1;
  centerOn(sx*TILE+TILE/2, sy*TILE+TILE/2);
  if(MP.connected && MP.myId != null) ensureHomelessForOwner(MP.myId);
}

// ---------- aides ----------
const inMap = (x,y)=> x>=0 && y>=0 && x<N && y<N;
// Filtres par owner : en solo (owner null) on compte tout, en MP on filtre
const myOwner   = () => (MP.connected && MP.myId != null) ? MP.myId : null;
const ownedBy   = (b, oid) => oid == null ? (b.owner == null) : (b.owner === oid);
const popTotal  = (oid=myOwner()) => buildings.filter(b=>ownedBy(b,oid)).reduce((s,b)=> s+(b.pop||0), 0);
const housingCap= (oid=myOwner()) => buildings.filter(b=>ownedBy(b,oid)).reduce((s,b)=>
      s + (BUILD[b.type].resid ? BUILD[b.type].resid.popCap : 0), 0);
const jobsTotal = (oid=myOwner()) => buildings.filter(b=>ownedBy(b,oid))
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

function refreshWorkerAllocation(){
  for(const b of buildings) b.workersAssigned = 0;
  const jobs = buildings
    .filter(b=>!b.dead && !b.paused && workersRequiredOf(b)>0)
    .sort((a,b)=> (a.y-b.y) || (a.x-b.x));
  const homes = buildings
    .filter(b=>!b.dead && BUILD[b.type].resid && b.pop>0)
    .sort((a,b)=> workRadiusOf(b)-workRadiusOf(a));
  for(const home of homes){
    let available = home.pop;
    const radius = workRadiusOf(home);
    const nearbyJobs = jobs
      .filter(j=>ownedBy(j, home.owner) && workersAllocatedOf(j) < workersRequiredOf(j) && buildingDistance(home,j) <= radius)
      .sort((a,b)=> buildingDistance(home,a)-buildingDistance(home,b));
    for(const job of nearbyJobs){
      if(available <= 0) break;
      const need = workersRequiredOf(job) - workersAllocatedOf(job);
      const take = Math.min(available, need);
      job.workersAssigned = (job.workersAssigned||0) + take;
      available -= take;
    }
  }
  for(const k in WALLETS){
    const oid = +k === SOLO_KEY ? null : +k;
    const req = jobsTotal(oid);
    const assigned = buildings.filter(b=>ownedBy(b,oid)).reduce((s,b)=>s+workersAllocatedOf(b),0);
    WALLETS[k].eff = req > 0 ? Math.min(1, assigned / req) : 1;
  }
}

function newBuilding(type,x,y,w,h){
  const d = BUILD[type];
  const b = { type, x, y, w:w||d.size||1, h:h||d.size||1,
              storage:{}, inc:{}, prog:0, trucksOut:0, dead:false, owner:null };
  if(type==='mine')  b.ore = terrain[y*N+x]===T.IRON ? 'iron' : 'coal';
  if(type==='depot'){ b.allow = {}; for(const k in RES) b.allow[k] = true; }
  if(d.ind) b.paused = false;
  if(d.resid){ b.pop = 0; b.protectedPop = 0; b.ct = 0; b.bonusCt = 0; b.pending = 0; b.pendingProtected = 0; b.starve = 0; }
  return b;
}

function markStarterHomeIfNeeded(b){
  if(!b || b.type !== 'house') return;
  const w = walletOf(b.owner ?? SOLO_KEY);
  if(w.starterHomes >= 2) return;
  b.starterHome = true;
  b.protectedPop = b.protectedPop || 0;
  w.starterHomes++;
}

function ensureStarterProtectionForOwner(owner){
  const key = owner ?? SOLO_KEY;
  const w = walletOf(key);
  let protectedHomes = buildings.filter(b=>
    !b.dead && ownedBy(b, owner) && BUILD[b.type].resid && b.starterHome
  );
  if(protectedHomes.length < 2){
    const candidates = buildings
      .filter(b=>!b.dead && ownedBy(b, owner) && BUILD[b.type].resid && !b.starterHome)
      .sort((a,b)=> (a.y-b.y) || (a.x-b.x));
    for(const b of candidates){
      if(protectedHomes.length >= 2) break;
      b.starterHome = true;
      protectedHomes.push(b);
    }
  }
  w.starterHomes = Math.min(2, protectedHomes.length);
  for(const b of protectedHomes.slice(0,2)){
    if((b.pop||0) > 0 && (b.protectedPop||0) < 1) b.protectedPop = 1;
  }
}

function ensureAllStarterProtections(){
  const owners = new Set();
  for(const b of buildings) if(BUILD[b.type].resid) owners.add(b.owner ?? SOLO_KEY);
  for(const h of homeless) owners.add(h.owner ?? SOLO_KEY);
  if(MP.connected && MP.myId != null) owners.add(MP.myId);
  for(const o of owners) ensureStarterProtectionForOwner(o === SOLO_KEY ? null : o);
}

function setGrid(b,val){
  for(let y=b.y; y<b.y+b.h; y++)
    for(let x=b.x; x<b.x+b.w; x++) bgrid[y*N+x] = val;
}

function recipeOf(b){
  const d = BUILD[b.type];
  if(b.type==='mine') return { in:{}, out:{ [b.ore]: d.qty||1 }, time:d.time/prodMult(b) };
  if(d.recipe) return { in:d.recipe.in, out:d.recipe.out, time:d.time/prodMult(b) };
  return null;
}

function adjRoadTiles(b){
  const a = [], w = b.w||1, h = b.h||1;
  for(let x=b.x; x<b.x+w; x++){
    if(inMap(x,b.y-1) && road[(b.y-1)*N+x]) a.push((b.y-1)*N+x);
    if(inMap(x,b.y+h) && road[(b.y+h)*N+x]) a.push((b.y+h)*N+x);
  }
  for(let y=b.y; y<b.y+h; y++){
    if(inMap(b.x-1,y) && road[y*N+b.x-1]) a.push(y*N+b.x-1);
    if(inMap(b.x+w,y) && road[y*N+b.x+w]) a.push(y*N+b.x+w);
  }
  return a;
}

function capOf(b,res){
  const rc = BUILD[b.type].resid;
  if(rc) return rc.stockCap;
  if(b.type==='depot') return DEPOT_STOCK_PER_CELL * b.w * b.h;
  const r = recipeOf(b);
  // les stocks des bâtiments industriels fusionnés grandissent avec leur taille
  return ((r && res in r.out) ? OUTCAP : INCAP) * (BUILD[b.type].ind ? b.w*b.h : 1);
}

function accepts(b,res){
  if(b.paused) return false; // un site en pause ne reçoit plus de livraisons
  if(b.type==='depot') return b.allow?.[res] !== false;
  if(BUILD[b.type].resid){
    if(res !== 'goods') return false;
    if(b.starterHome) return false; // maisons protégées : pas besoin de marchandises
    return true;
  }
  const r = recipeOf(b);
  return !!(r && res in r.in);
}
const space = (b,res)=> capOf(b,res) - (b.storage[res]||0) - (b.inc[res]||0);

function treeNear(x,y,r){
  for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
    const a = x+dx, c = y+dy;
    if(inMap(a,c) && terrain[c*N+a]===T.TREE) return true;
  }
  return false;
}

function playerColor(owner){
  if(owner == null) return '#e0e0e0';
  return (MP.players.find(p=>p.id===owner)||{}).color || COLORS[(owner - 1) % COLORS.length] || '#e0e0e0';
}

function findEmptySpawnTiles(owner, count){
  const seed = owner == null ? 17 : owner * 97 + 13;
  const cx = Math.max(4, Math.min(N-5, ((seed * 37) % Math.max(1, N-8)) + 4));
  const cy = Math.max(4, Math.min(N-5, ((seed * 53) % Math.max(1, N-8)) + 4));
  const out = [];
  for(let r=0; r<N && out.length<count; r++){
    for(let y=cy-r; y<=cy+r && out.length<count; y++) for(let x=cx-r; x<=cx+r && out.length<count; x++){
      if(x<0||y<0||x>=N||y>=N) continue;
      if(Math.max(Math.abs(x-cx), Math.abs(y-cy)) !== r) continue;
      const i = y*N+x;
      if(terrain[i] !== T.GRASS || road[i] || bgrid[i]) continue;
      if(out.some(p=>p.x===x && p.y===y)) continue;
      out.push({ x, y });
    }
  }
  return out;
}

function ensureHomelessForOwner(owner){
  const key = owner ?? SOLO_KEY;
  const w = walletOf(key);
  if(w.homelessSeeded) return;
  const hasPresence =
    homeless.some(h=> (h.owner ?? SOLO_KEY) === key)
    || walkers.some(wk=>wk.fromHomeless && wk.target && (wk.target.owner ?? SOLO_KEY) === key)
    || buildings.some(b=>ownedBy(b, owner) && BUILD[b.type].resid && ((b.pop||0) > 0 || (b.pending||0) > 0));
  if(hasPresence){ w.homelessSeeded = true; return; }
  w.homelessSeeded = true;
  const tiles = findEmptySpawnTiles(owner, START_HOMELESS);
  for(let i=0; i<START_HOMELESS; i++){
    const t = tiles[i] || { x:(N>>1), y:(N>>1) };
    homeless.push({
      owner,
      x:t.x*TILE+TILE/2,
      y:t.y*TILE+TILE/2,
      col: playerColor(owner),
      phase: (i*1.73) % 7,
    });
  }
}

function adoptSoloHomeless(owner){
  if(owner == null) return;
  let adopted = 0;
  for(const h of homeless){
    if(h.owner == null){
      h.owner = owner;
      h.col = playerColor(owner);
      adopted++;
    }
  }
  if(adopted){
    const w = walletOf(owner);
    w.homelessSeeded = true;
    if(WALLETS[SOLO_KEY]) WALLETS[SOLO_KEY].homelessSeeded = true;
  }
}

function assignHomelessToHousing(owner){
  if(!homeless?.length) return;
  for(const h of homeless)
    if((h.owner ?? SOLO_KEY) === (owner ?? SOLO_KEY)) h.col = playerColor(owner);
  const homes = buildings
    .filter(b=>!b.dead && BUILD[b.type].resid && ownedBy(b, owner))
    .sort((a,b)=> (b.starterHome?1:0)-(a.starterHome?1:0) || (a.y-b.y) || (a.x-b.x));
  for(const home of homes){
    const rc = BUILD[home.type].resid;
    while(home.pop + home.pending < rc.popCap){
      const idx = homeless.findIndex(h=> (h.owner ?? SOLO_KEY) === (owner ?? SOLO_KEY));
      if(idx < 0) return;
      const h = homeless.splice(idx, 1)[0];
      const protectedResident = !!home.starterHome && (home.protectedPop||0) + (home.pendingProtected||0) < 1;
      home.pending++;
      if(protectedResident) home.pendingProtected = (home.pendingProtected||0) + 1;
      walkers.push({
        pts:[
          { x:h.x, y:h.y },
          { x:(home.x+home.w/2)*TILE, y:(home.y+home.h/2)*TILE },
        ],
        seg:0, t:0, target:home, fromHomeless:true, protectedResident,
        col:h.col, phase:h.phase,
      });
    }
  }
}

function randomExitPoint(){
  const side = (Math.random()*4)|0;
  if(side===0) return { x:-TILE, y:Math.random()*N*TILE };
  if(side===1) return { x:(N+1)*TILE, y:Math.random()*N*TILE };
  if(side===2) return { x:Math.random()*N*TILE, y:-TILE };
  return { x:Math.random()*N*TILE, y:(N+1)*TILE };
}

function routeUnhousedResidents(owner, residents){
  assignHomelessToHousing(owner);
  for(const h of residents){
    const i = homeless.indexOf(h);
    if(i < 0) continue;
    const exit = randomExitPoint();
    homeless.splice(i, 1);
    walkers.push({
      pts:[{ x:h.x, y:h.y }, exit],
      seg:0, t:0, target:null, leaving:true,
      col:h.col || playerColor(owner), phase:h.phase || Math.random()*7,
    });
  }
}

function makeResidentsHomeless(b){
  const count = b.pop||0;
  if(!count || !BUILD[b.type]?.resid) return [];
  b.pop = 0;
  const owner = b.owner ?? null;
  const created = [];
  for(let i=0; i<count; i++){
    const ox = ((i % Math.max(1, b.w)) + 0.5) / Math.max(1, b.w);
    const oy = (((i / Math.max(1, b.w))|0) % Math.max(1, b.h) + 0.5) / Math.max(1, b.h);
    const h = {
      owner,
      x:(b.x + ox*b.w)*TILE,
      y:(b.y + oy*b.h)*TILE,
      col:playerColor(owner),
      phase:Math.random()*7,
    };
    homeless.push(h);
    created.push(h);
  }
  return created;
}

function demolishBuilding(b, refundOwner){
  if(!b || b.dead) return 0;
  const owner = b.owner ?? null;
  const evicted = makeResidentsHomeless(b);
  b.dead = true;
  buildings.splice(buildings.indexOf(b),1);
  setGrid(b,null);
  if(selected===b) selected = null;
  const refund = Math.floor((BUILD[b.type].cost||0)*0.3);
  earnMoney(refund, 'rembours', walletOf(refundOwner ?? owner ?? SOLO_KEY));
  routeUnhousedResidents(owner, evicted);
  return refund;
}

function setBuildingPaused(b, pausedState, broadcastChange=true){
  if(!b || !BUILD[b.type]?.ind) return;
  b.paused = !!pausedState;
  if(broadcastChange && MP.connected){
    netSend({ type:'toggle_bld_pause', x:b.x, y:b.y, paused:b.paused });
  }
}

// ---------- construction ----------

// état multijoueur — déclaré ici car utilisé dans canPlace, clickAt et drawBuilding
const MP = {
  ws: null, myId: null, myColor: '#ffffff', myName: 'Moi',
  role: null, isAdmin: false, players: [], cursors: {}, chat: [], connected: false,
  username: null, token: null, saves: [],
};

const mpHasAdminRights = () => MP.connected && (MP.role === 'host' || MP.isAdmin);

const MP_ZONE = 20; // distance minimale entre bâtiments de joueurs différents

// Retourne l'id du joueur adverse le plus proche ayant un bâtiment à moins de MP_ZONE cases,
// ou null si la pose est libre.
function nearbyEnemyOwner(myId, cx, cy){
  if(!myId) return null; // solo : pas de restriction
  for(const b of buildings){
    if(!b.owner || b.owner === myId) continue;
    // distance Chebyshev (max des axes) entre centres — simple et rapide
    const bcx = b.x + (b.w-1)/2, bcy = b.y + (b.h-1)/2;
    if(Math.abs(cx - bcx) <= MP_ZONE && Math.abs(cy - bcy) <= MP_ZONE) return b.owner;
  }
  return null;
}

function canPlace(t,x,y){
  if(!inMap(x,y)) return { ok:false };
  const i = y*N+x, ter = terrain[i];
  if(t==='bulldoze') return { ok: !!(road[i] || bgrid[i] || ter===T.TREE) };
  if(road[i] || bgrid[i]) return { ok:false, msg:'Case occupée' };
  if(ter===T.WATER) return { ok:false, msg:"Impossible de construire sur l'eau" };
  if(t==='road'){
    if(ter!==T.GRASS) return { ok:false, msg:"Les routes se posent sur l'herbe (démolis les arbres)" };
    return { ok:true };
  }
  if(t==='mine'){
    if(ter!==T.IRON && ter!==T.COAL) return { ok:false, msg:'La mine doit être sur un gisement' };
  } else {
    if(ter!==T.GRASS) return { ok:false, msg:'Terrain non constructible' };
    if(t==='lumber' && !treeNear(x,y,2)) return { ok:false, msg:"Aucun arbre à moins de 2 cases" };
  }
  // zone d'exclusion multijoueur
  if(MP.connected && nearbyEnemyOwner(MP.myId, x, y))
    return { ok:false, msg:"Trop proche d'un autre joueur (−"+MP_ZONE+' cases)' };
  return { ok:true };
}

function clickAt(x,y){
  if(!inMap(x,y)) return;
  const i = y*N+x;
  if(tool==='select'){
    selected = bgrid[i];
    return;
  }
  if(!MP.connected){
    toast('🌐 Connecte-toi au serveur multijoueur pour construire','err');
    return;
  }
  if(tool==='bulldoze'){
    if(bgrid[i]){
      const b = bgrid[i];
      // en multijoueur : impossible de démolir le bâtiment d'un autre joueur
      if(MP.connected && b.owner && b.owner !== MP.myId){
        toast('⛔ Ce bâtiment appartient à un autre joueur','err'); return;
      }
      const refund = demolishBuilding(b, b.owner);
      if(refund) addFloat(x,y,'+'+refund+' $','#9fe89f');
    } else if(road[i]){
      road[i] = 0; earnMoney(3, 'rembours');
    } else if(terrain[i]===T.TREE){
      terrain[i] = T.GRASS;
    }
    return;
  }
  // outil de construction
  const v = canPlace(tool,x,y);
  if(!v.ok){
    if(bgrid[i]){ selected = bgrid[i]; }       // clic sur bâtiment existant → inspecter
    else if(v.msg) toast(v.msg,'err');
    return;
  }
  const cost = BUILD[tool].cost;
  if(myWallet().money < cost){ toast('Fonds insuffisants ('+cost+' $)','err'); return; }
  spendMoney(cost, 'construction');
  if(tool==='road'){ road[i] = 1; return; }
  const b = newBuilding(tool,x,y);
  b.owner = MP.connected ? MP.myId : null;
  markStarterHomeIfNeeded(b);
  buildings.push(b);
  bgrid[i] = b;
  selected = b;
  if(BUILD[b.type].resid) assignHomelessToHousing(b.owner);
}

// ---------- logistique (camions) ----------
function tryDispatch(b,res){
  const starts = adjRoadTiles(b);
  if(!starts.length) return false;
  dist.fill(-1);
  const q = [];
  for(const s of starts){ dist[s] = 0; prev[s] = -1; q.push(s); }
  for(let qi=0; qi<q.length; qi++){
    const c = q[qi], cx = c%N, cy = (c/N)|0;
    for(const [dx,dy] of DIRS){
      const x = cx+dx, y = cy+dy;
      if(!inMap(x,y)) continue;
      const ni = y*N+x;
      if(road[ni] && dist[ni]<0){ dist[ni] = dist[c]+1; prev[ni] = c; q.push(ni); }
    }
  }
  let bestB = null, bestScore = Infinity, bestTile = -1;
  for(const c of buildings){
    if(c===b || c.dead || !accepts(c,res) || space(c,res)<=0) continue;
    if(b.type==='depot' && c.type==='depot') continue;
    let bd = Infinity, bt = -1;
    for(const t of adjRoadTiles(c))
      if(dist[t]>=0 && dist[t]<bd){ bd = dist[t]; bt = t; }
    if(bt<0) continue;
    // l'entrepôt en dernier recours ; les logements déjà pleins après ceux qui grandissent
    const rcc = BUILD[c.type].resid;
    const full = !!rcc && c.pop >= rcc.popCap;
    // pour les marchandises vers les logements : priorité au stock le plus bas
    const stockRatio = (rcc && res === 'goods')
      ? ((c.storage[res]||0) + (c.inc[res]||0)) / (rcc.stockCap || 1)
      : 0;
    const score = bd + (c.type==='depot' ? 500 : 0) + (full ? 200 : 0) + stockRatio * 150;
    if(score<bestScore){ bestScore = score; bestB = c; bestTile = bt; }
  }
  if(!bestB) return false;

  const path = [];
  let t = bestTile;
  while(t!==-1){ path.push(t); t = prev[t]; }
  path.reverse();

  const amt = Math.min(TRUCK_LOAD, b.storage[res]);
  b.storage[res] -= amt;
  b.trucksOut++;
  bestB.inc[res] = (bestB.inc[res]||0) + amt;

  const C = i => ({ x:(i%N)*TILE+TILE/2, y:((i/N)|0)*TILE+TILE/2 });
  const pts = [
    { x:(b.x+b.w/2)*TILE, y:(b.y+b.h/2)*TILE },
    ...path.map(C),
    { x:(bestB.x+bestB.w/2)*TILE, y:(bestB.y+bestB.h/2)*TILE },
  ];
  trucks.push({ pts, seg:0, t:0, res, amt, target:bestB, from:b });
  return true;
}

function updateTrucks(dt){
  for(let i=trucks.length-1;i>=0;i--){
    const tk = trucks[i];
    let move = TRUCK_SPEED*TILE*dt;
    while(move>0 && tk.seg < tk.pts.length-1){
      const a = tk.pts[tk.seg], b = tk.pts[tk.seg+1];
      const d = Math.hypot(b.x-a.x, b.y-a.y) || 1;
      const remain = (1-tk.t)*d;
      if(move >= remain){ move -= remain; tk.seg++; tk.t = 0; }
      else { tk.t += move/d; move = 0; }
    }
    if(tk.seg >= tk.pts.length-1){
      let tg = tk.target;
      if(!tg.dead){
        tg.inc[tk.res] = Math.max(0, (tg.inc[tk.res]||0) - tk.amt);
      } else {
        // la cible a disparu (ex. maisons fusionnées en immeuble) → livrer le remplaçant
        const rep = bgrid[tg.y*N+tg.x];
        tg = (rep && !rep.dead && accepts(rep,tk.res)) ? rep : null;
      }
      if(tg){
        const room = capOf(tg,tk.res) - (tg.storage[tk.res]||0);
        tg.storage[tk.res] = (tg.storage[tk.res]||0) + Math.min(room, tk.amt);
      }
      if(!tk.from.dead) tk.from.trucksOut--;
      trucks.splice(i,1);
    }
  }
}

// ---------- simulation ----------
function update(dt){
  gtime += dt;
  let starved = null;

  ensureAllStarterProtections();
  refreshWorkerAllocation();
  // eff du joueur courant (pour statusOf)
  eff = myWallet().eff;

  for(const b of buildings){
    const w = walletOf(b.owner ?? SOLO_KEY); // wallet du propriétaire du bâtiment
    const r = recipeOf(b);
    if(r && !b.paused){
      let outOK = true, inOK = true;
      for(const k in r.out) if((b.storage[k]||0) >= OUTCAP) outOK = false;
      for(const k in r.in)  if((b.storage[k]||0) <  r.in[k]) inOK = false;
      if(outOK && inOK){
        b.prog += dt * (workersRequiredOf(b) ? workersAllocatedOf(b) / workersRequiredOf(b) : w.eff);
        if(b.prog >= r.time){
          b.prog = 0;
          for(const k in r.in)  b.storage[k] -= r.in[k];
          for(const k in r.out) b.storage[k] = (b.storage[k]||0) + r.out[k];
        }
      }
    }
    const rc = BUILD[b.type].resid;
    if(rc && !b.starterHome && (b.storage.goods||0) > 0){
      b.starve = 0;
      b.ct += dt;
      if(b.ct >= rc.interval){
        b.ct = 0;
        b.storage.goods--;
        const income = rc.income * Math.max(1, b.pop);
        earnMoney(income, 'ventes', w);
        addFloat(b.x + (b.w-1)/2, b.y, '+'+income+' $', '#ffe9a0');
        if(b.pop + b.pending < rc.popCap) spawnWalker(b);
      }
    } else if(rc && b.starterHome){
      b.starve = 0; // maison protégée : pas de pénurie
      b.ct += dt;
      if(b.ct >= rc.interval){
        b.ct = 0;
        const income = rc.income * Math.max(1, b.pop);
        earnMoney(income, 'ventes', w);
        addFloat(b.x + (b.w-1)/2, b.y, '+'+income+' $', '#ffe9a0');
        if(b.pop + b.pending < rc.popCap) spawnWalker(b);
      }
    } else if(rc && !b.starterHome && b.pop > (b.protectedPop||0)){
      b.starve += dt;
      if(b.starve >= STARVE_DELAY){
        b.starve = 0;
        (starved ||= []).push(b);
      }
    } else if(rc){
      b.starve = 0;
    }
    // croissance bonus : stock > seuil ET logement non plein → +1 habitant toutes les X secondes
    if(rc && b.pop + b.pending < rc.popCap){
      const stockFull = (b.storage.goods||0) / rc.stockCap;
      if(stockFull > BONUS_GROWTH_THRESHOLD){
        b.bonusCt = (b.bonusCt||0) + dt;
        if(b.bonusCt >= BONUS_GROWTH_INTERVAL){
          b.bonusCt = 0;
          spawnWalker(b);
        }
      } else {
        b.bonusCt = 0;
      }
    } else if(rc){
      b.bonusCt = 0;
    }
  }
  if(starved) for(const b of starved){
    if(b.dead) continue;
    if(b.w*b.h > 1) splitBuilding(b);
    else leaveOne(b);
  }

  mergeTimer += dt;
  if(mergeTimer >= 1){ mergeTimer = 0; tryMerge(); tryMergeInd(); tryMergeDepot(); }

  dispatchTimer += dt;
  if(dispatchTimer >= 0.7){
    dispatchTimer = 0;
    for(const b of buildings){
      const maxTrucks = b.type === 'depot'
        ? 4 + b.w * b.h          // entrepôt : plus de camions pour servir plusieurs destinations
        : 2 + ((b.w*b.h)>>1);    // production : limite standard
      if(b.trucksOut >= maxTrucks) continue;
      const r = recipeOf(b);

      if(b.type === 'depot'){
        // entrepôt : dispatcher toutes les ressources avec demande, seuil = 1 unité
        for(const k in b.storage){
          if(b.trucksOut >= maxTrucks) break;
          if((b.storage[k]||0) < 1) continue;
          if(b.allow?.[k] === false) continue;
          tryDispatch(b, k);
        }
      } else {
        // bâtiment de production : dispatcher la ressource la plus abondante en sortie
        let best = null, amt = 0;
        for(const k in b.storage){
          if(b.storage[k] < 3) continue;
          if(r && k in r.out && b.storage[k] > amt){ best = k; amt = b.storage[k]; }
        }
        if(best) tryDispatch(b, best);
      }
    }
  }

  updateTrucks(dt);
  updateWalkers(dt);

  taxTimer += dt;
  if(taxTimer >= ECO.taxeInterval){
    taxTimer = 0;
    // taxes par wallet : chaque joueur reçoit les taxes de ses habitants
    for(const k in WALLETS){
      const oid = +k === SOLO_KEY ? null : +k;
      const w = WALLETS[k];
      const t = ECO.taxe * popTotal(oid);
      earnMoney(t, 'taxes', w);
    }
  }

  upkeepTimer += dt;
  if(upkeepTimer >= IND_UPKEEP_INTERVAL){
    upkeepTimer = 0;
    for(const b of buildings){
      const u = upkeepOf(b);
      if(u <= 0) continue;
      const w = walletOf(b.owner ?? SOLO_KEY);
      w.money -= u; w.fin.entretien += u;
      addFloat(b.x+(b.w-1)/2, b.y, '−'+(Math.round(u*10)/10)+' $', '#ff9a8a');
    }
  }

  // historique financier par wallet
  for(const k in WALLETS){
    const w = WALLETS[k];
    w.finTimer = (w.finTimer||0) + dt;
    if(w.finTimer >= 1){
      w.finTimer = 0;
      w.finHist = w.finHist || [];
      w.finHist.push({ ...w.fin });
      if(w.finHist.length > 61) w.finHist.shift();
    }
  }

  // milestones par wallet
  for(const k in WALLETS){
    const oid = +k === SOLO_KEY ? null : +k;
    const w = WALLETS[k];
    if(w.mi == null) w.mi = 0;
    // n'afficher le toast que si c'est le joueur courant
    if(w.mi < MILESTONES.length && popTotal(oid) >= MILESTONES[w.mi]){
      if(+k === walletKey())
        toast('🎉 '+MILESTONES[w.mi]+' habitants ! Ta ville prospère.','win');
      w.mi++;
    }
  }

  for(let i=floats.length-1;i>=0;i--){
    floats[i].life -= dt;
    if(floats[i].life <= 0) floats.splice(i,1);
  }
}

// un rectangle w×h entièrement couvert de logements pleins strictement plus
// petits → fusion en bâtiment de niveau supérieur
function checkRect(x,y,w,h){
  const area = w*h, set = [];
  for(let yy=y; yy<y+h; yy++) for(let xx=x; xx<x+w; xx++){
    const b = bgrid[yy*N+xx];
    if(!b) return null;
    const rc = BUILD[b.type].resid;
    if(!rc) return null;                                        // pas un logement
    if(b.w*b.h >= area) return null;                            // pas plus petit
    if(b.x<x || b.y<y || b.x+b.w>x+w || b.y+b.h>y+h) return null; // déborde du rectangle
    if(b.pop < rc.popCap) return null;                          // pas plein
    if(!b.starterHome && (b.storage.goods||0) <= 0) return null; // pas approvisionné (hors maisons protégées)
    if(!set.includes(b)) set.push(b);
  }
  return set;
}

// rectangle couvert de bâtiments de production IDENTIQUES plus petits → fusion
function checkRectInd(x,y,w,h){
  const area = w*h;
  const first = bgrid[y*N+x];
  if(!first || !BUILD[first.type].ind) return null;
  const type = first.type, ore = first.ore;
  const set = [];
  for(let yy=y; yy<y+h; yy++) for(let xx=x; xx<x+w; xx++){
    const b = bgrid[yy*N+xx];
    if(!b || b.type!==type || b.paused) return null;
    if(b.w*b.h >= area) return null;
    if(b.x<x || b.y<y || b.x+b.w>x+w || b.y+b.h>y+h) return null;
    if(type==='mine' && b.ore!==ore) return null;
    if(!set.includes(b)) set.push(b);
  }
  return set;
}

function tryMergeInd(){
  for(const [w,h] of IND_SHAPES){
    for(let y=0; y<=N-h; y++) for(let x=0; x<=N-w; x++){
      const set = checkRectInd(x,y,w,h);
      if(!set) continue;
      const type = set[0].type, ore = set[0].ore, owner = set[0].owner||null;
      const store = {};
      let wasSel = false;
      for(const o of set){
        for(const k in o.storage) store[k] = (store[k]||0) + o.storage[k];
        if(o===selected) wasSel = true;
        o.dead = true;
        setGrid(o,null);
      }
      buildings = buildings.filter(o=> !o.dead);
      const t = newBuilding(type, x, y, w, h);
      if(ore) t.ore = ore;
      t.owner = owner;
      for(const k in store) t.storage[k] = Math.min(capOf(t,k), store[k]);
      buildings.push(t);
      setGrid(t,t);
      if(wasSel) selected = t;
      toast('🏭 '+set.length+' × '+BUILD[type].n+' → '+w+'×'+h
        +' — production ×'+prodMult(t).toFixed(1)+' !','win');
      return true;
    }
  }
  return false;
}

function tryMerge(){
  for(const L of MERGE_ORDER){
    for(const [w,h] of L.shapes){
      for(let y=0; y<=N-h; y++) for(let x=0; x<=N-w; x++){
        const set = checkRect(x,y,w,h);
        if(!set) continue;
        const d = BUILD[L.key];
        let goods = 0, pop = 0, protectedPop = 0, wasSel = false;
        const owner = set[0].owner||null;
        for(const o of set){
          goods += o.storage.goods||0;
          pop += o.pop;
          protectedPop += o.protectedPop||0;
          if(o===selected) wasSel = true;
          o.dead = true;
          setGrid(o,null);
        }
        buildings = buildings.filter(o=> !o.dead);
        const t = newBuilding(L.key, x, y, w, h);
        t.owner = owner;
        t.pop = Math.min(d.resid.popCap, pop);
        t.protectedPop = Math.min(t.pop, protectedPop);
        t.starterHome = t.protectedPop > 0;
        t.storage.goods = Math.min(d.resid.stockCap, goods);
        buildings.push(t);
        setGrid(t,t);
        if(wasSel) selected = t;
        toast('🏗️ '+set.length+' logements pleins → '+d.n+' ('+w+'×'+h+') !','win');
        return; // une fusion à la fois : la liste vient d'être modifiée
      }
    }
  }
}

// ---------- piétons (nouveaux habitants) ----------
function growPop(b, protectedResident=false){
  const rc = BUILD[b.type].resid;
  if(b.pop < rc.popCap){
    b.pop++;
    if(protectedResident) b.protectedPop = Math.min(b.pop, (b.protectedPop||0) + 1);
    addFloat(b.x+(b.w-1)/2, b.y-0.5, '+1 👤', '#9fe8c9');
  }
}

// Dijkstra du pourtour du logement vers le bord de carte le plus accessible
// (routes : rapides, herbe : moyen, forêt : lent ; eau et bâtiments bloquent)
// renvoie les étapes du bord de la carte jusqu'au bâtiment, ou null si enclavé
function pathToEdge(b){
  const walkable = i => terrain[i]!==T.WATER && !bgrid[i];
  const costOf = i => road[i] ? 1 : (terrain[i]===T.TREE ? 6 : 3);

  dist.fill(-1);
  const heap = [];
  const hpush = (c,i)=>{
    heap.push([c,i]);
    let j = heap.length-1;
    while(j>0){
      const p = (j-1)>>1;
      if(heap[p][0] <= heap[j][0]) break;
      [heap[p],heap[j]] = [heap[j],heap[p]]; j = p;
    }
  };
  const hpop = ()=>{
    const top = heap[0], last = heap.pop();
    if(heap.length){
      heap[0] = last;
      let j = 0;
      for(;;){
        const l = 2*j+1, r = l+1;
        let m = j;
        if(l<heap.length && heap[l][0]<heap[m][0]) m = l;
        if(r<heap.length && heap[r][0]<heap[m][0]) m = r;
        if(m===j) break;
        [heap[m],heap[j]] = [heap[j],heap[m]]; j = m;
      }
    }
    return top;
  };

  for(let y=b.y-1; y<=b.y+b.h; y++) for(let x=b.x-1; x<=b.x+b.w; x++){
    if(!inMap(x,y)) continue;
    if(x>=b.x && x<b.x+b.w && y>=b.y && y<b.y+b.h) continue; // intérieur du bâtiment
    const i = y*N+x;
    if(!walkable(i)) continue;
    dist[i] = costOf(i); prev[i] = -1; hpush(dist[i], i);
  }

  let goal = -1;
  while(heap.length){
    const [c,i] = hpop();
    if(c > dist[i]) continue;
    const x = i%N, y = (i/N)|0;
    if(x===0 || y===0 || x===N-1 || y===N-1){ goal = i; break; }
    for(const [dx,dy] of DIRS){
      const nx = x+dx, ny = y+dy;
      if(!inMap(nx,ny)) continue;
      const ni = ny*N+nx;
      if(!walkable(ni)) continue;
      const nc = c + costOf(ni);
      if(dist[ni]<0 || nc<dist[ni]){ dist[ni] = nc; prev[ni] = i; hpush(nc,ni); }
    }
  }
  if(goal < 0) return null; // enclavé

  // prev pointe vers la maison → suivre depuis le bord donne l'ordre de marche
  const pts = [];
  for(let t=goal; t!==-1; t=prev[t])
    pts.push({ x:(t%N)*TILE+TILE/2, y:((t/N)|0)*TILE+TILE/2 });
  pts.push({ x:(b.x+b.w/2)*TILE, y:(b.y+b.h/2)*TILE });
  return pts;
}

function spawnWalker(b){
  if(walkers.length > 80){ growPop(b); return; }
  const pts = pathToEdge(b);
  if(!pts){ growPop(b); return; } // logement enclavé : arrivée instantanée
  b.pending++;
  walkers.push({ pts, seg:0, t:0, target:b,
                 col: playerColor(b.owner),
                 phase: Math.random()*7 });
}

// n habitants quittent le bâtiment à pied (la population est déjà décomptée)
function spawnLeavers(b, n){
  for(let i=0; i<n && walkers.length<=80; i++){
    const pts = pathToEdge(b);
    if(!pts) return;
    walkers.push({ pts:[...pts].reverse(), seg:0, t:0, target:null, leaving:true,
                   col: playerColor(b.owner),
                   phase: Math.random()*7 });
  }
}

// pénurie : un bâtiment fusionné se sépare en maisons individuelles,
// l'excédent d'habitants quitte la ville
function splitBuilding(b){
  if((b.pop||0) <= (b.protectedPop||0)) return;
  const houseCap = BUILD.house.resid.popCap;
  const houseStockCap = BUILD.house.resid.stockCap;
  const wasSel = selected===b;
  const owner = b.owner ?? null;
  let pop = b.pop;
  let protectedPop = b.protectedPop||0;
  let goodsPool = b.storage.goods||0;
  const area = b.w * b.h;
  const excess = Math.max(0, pop - area * houseCap);
  b.dead = true;
  buildings.splice(buildings.indexOf(b),1);
  setGrid(b,null);
  pop -= excess;
  const newHouses = [];
  for(let y=b.y; y<b.y+b.h; y++) for(let x=b.x; x<b.x+b.w; x++){
    const h = newBuilding('house',x,y);
    h.owner = owner;
    h.pop = Math.min(houseCap, pop);
    pop -= h.pop;
    h.protectedPop = Math.min(h.pop, protectedPop);
    h.starterHome = h.protectedPop > 0;
    protectedPop -= h.protectedPop;
    h.starve = 0;
    // distribuer les marchandises équitablement entre les nouvelles maisons
    const share = Math.min(houseStockCap, Math.floor(goodsPool / area));
    h.storage.goods = share;
    goodsPool -= share;
    buildings.push(h);
    setGrid(h,h);
    newHouses.push(h);
    if(wasSel && x===b.x && y===b.y) selected = h;
  }
  // donner le reste aux premières maisons
  for(const h of newHouses){
    if(goodsPool <= 0) break;
    const space = houseStockCap - (h.storage.goods||0);
    const give = Math.min(space, goodsPool);
    h.storage.goods += give;
    goodsPool -= give;
  }
  if(excess > 0) spawnLeavers(bgrid[b.y*N+b.x], excess);
  toast('📉 '+BUILD[b.type].n+' sans marchandises : défusion'
    + (excess>0 ? ', '+excess+" habitants s'en vont" : ''),'err');
  if(excess > 0) addFloat(b.x+(b.w-1)/2, b.y, '−'+excess+' 👤', '#ff9a8a');
  // tenter de remplir les maisons incomplètes avec les sans-abri disponibles
  assignHomelessToHousing(owner);
}

// pénurie d'une maison simple : un habitant part
function leaveOne(b){
  if(b.pop <= (b.protectedPop||0)) return;
  b.pop--;
  addFloat(b.x, b.y-0.5, '−1 👤', '#ff9a8a');
  spawnLeavers(b, 1);
}

function updateWalkers(dt){
  for(let i=walkers.length-1;i>=0;i--){
    const wk = walkers[i];
    let move = WALK_SPEED*TILE*dt;
    while(move>0 && wk.seg < wk.pts.length-1){
      const a = wk.pts[wk.seg], b = wk.pts[wk.seg+1];
      const d = Math.hypot(b.x-a.x, b.y-a.y) || 1;
      const remain = (1-wk.t)*d;
      if(move >= remain){ move -= remain; wk.seg++; wk.t = 0; }
      else { wk.t += move/d; move = 0; }
    }
    if(wk.seg >= wk.pts.length-1){
      if(wk.leaving){ walkers.splice(i,1); continue; } // parti pour de bon
      let tg = wk.target;
      if(tg.dead){
        // bâtiment disparu (fusion ou split) : chercher un logement incomplet proche
        const ox = tg.x, oy = tg.y;
        let best = null, bestPop = Infinity;
        for(const c of buildings){
          if(c.dead || !BUILD[c.type].resid) continue;
          if(c.pop + c.pending >= BUILD[c.type].resid.popCap) continue;
          const d = Math.abs(c.x - ox) + Math.abs(c.y - oy);
          if(d < 4 && c.pop < bestPop){ bestPop = c.pop; best = c; }
        }
        tg = best;
        if(tg){ tg.pending++; }
      } else {
        tg.pending--;
        if(wk.protectedResident) tg.pendingProtected = Math.max(0, (tg.pendingProtected||0) - 1);
      }
      if(tg) growPop(tg, wk.protectedResident);
      else if(wk.fromHomeless){
        const exit = randomExitPoint();
        walkers.push({
          pts:[wk.pts[wk.pts.length-1], exit],
          seg:0, t:0, target:null, leaving:true,
          col:wk.col, phase:wk.phase,
        });
      }
      walkers.splice(i,1);
    }
  }
}

function addFloat(x,y,txt,col){
  if(floats.length > 60) return;
  floats.push({ x:x*TILE+TILE/2, y:y*TILE, txt, col, life:1.3 });
}

// ---------- rendu isométrique ----------
function hash(x,y){ return ((x*73856093) ^ (y*19349663)) >>> 0; }

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
  const A = iso(rx,ry), B = iso(rx+w,ry), C = iso(rx+w,ry+h), D = iso(rx,ry+h);
  ctx.beginPath();
  ctx.moveTo(A[0],A[1]); ctx.lineTo(B[0],B[1]);
  ctx.lineTo(C[0],C[1]); ctx.lineTo(D[0],D[1]);
  ctx.closePath();
}

const GRASS_COLS = ['#74b048','#6ea944','#7ab84d','#68a23f'];
const WATER_COLS = ['#3590cf','#3187c2'];

function drawTree(rx,ry,x,y){
  const c = iso(rx+0.5, ry+0.5);
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

function drawBuilding(b){
  const d = BUILD[b.type];
  const [r1x,r1y] = rotIdx(b.x, b.y);
  const [r2x,r2y] = rotIdx(b.x+b.w-1, b.y+b.h-1);
  const rx0 = Math.min(r1x,r2x), ry0 = Math.min(r1y,r2y);
  // l'empreinte tournée échange largeur et profondeur selon l'orientation
  const rw = Math.abs(r1x-r2x)+1, rh = Math.abs(r1y-r2y)+1;
  // les sites industriels fusionnés gagnent en hauteur avec leur taille
  const hgt = d.ind ? d.hgt*(1+0.18*(Math.max(b.w,b.h)-1)) : d.hgt;
  const tc = prism(rx0, ry0, rx0+rw, ry0+rh, hgt, d.col);

  // fenêtres éclairées sur les faces des grands logements
  if(!drawFast && d.resid && d.hgt >= 40){
    const B = iso(rx0+rw,ry0), C = iso(rx0+rw,ry0+rh), D = iso(rx0,ry0+rh);
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
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = (TH*(0.62+0.28*(Math.max(b.w,b.h)-1)))+'px "Segoe UI Emoji",sans-serif';
  ctx.fillText(d.ic, tc[0], tc[1]+1);

  // barre de progression
  const r = recipeOf(b);
  if(!drawFast && r && b.prog>0){
    const bw = TW*0.42*b.w;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(tc[0]-bw/2, tc[1]+TH*0.36, bw, 4);
    ctx.fillStyle = '#7fd96a';
    ctx.fillRect(tc[0]-bw/2, tc[1]+TH*0.36, bw*Math.min(1,b.prog/r.time), 4);
  }
  // habitants
  if(!drawFast && d.resid && b.pop>0){
    ctx.font = 'bold 11px sans-serif';
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 3;
    ctx.strokeText('👤'+b.pop, tc[0], tc[1]-TH*0.55);
    ctx.fillStyle = '#ffe9a0';
    ctx.fillText('👤'+b.pop, tc[0], tc[1]-TH*0.55);
  }
  // pas de route adjacente
  if(!drawFast && !adjRoadTiles(b).length){
    ctx.font = '14px "Segoe UI Emoji",sans-serif';
    ctx.fillText('⚠️', tc[0], tc[1]-TH*0.95);
  }
  // contour couleur propriétaire (multijoueur)
  if(!drawFast && !UI_OPTIONS.hideColorMarkers && b.owner && MP.connected){
    const ownerColor = (MP.players.find(p=>p.id===b.owner)||{}).color || '#aaa';
    ctx.strokeStyle = ownerColor; ctx.lineWidth = b===selected ? 3 : 1.5;
    diamond(rx0, ry0, rw, rh); ctx.stroke();
    // petit drapeau couleur en haut à gauche du toit
    ctx.fillStyle = ownerColor;
    ctx.beginPath(); ctx.arc(tc[0]-TW*rw*0.28, tc[1]-4, 4, 0, 7); ctx.fill();
  } else if(b===selected){
    // sélection solo
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    diamond(rx0, ry0, rw, rh); ctx.stroke();
  }
  // sélection par-dessus (multijoueur)
  if(b===selected && MP.connected){
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    diamond(rx0, ry0, rw, rh); ctx.stroke();
  }
}

function drawWalker(wk){
  const a = wk.pts[wk.seg], b = wk.pts[Math.min(wk.seg+1, wk.pts.length-1)];
  const wx = a.x + (b.x-a.x)*wk.t, wy = a.y + (b.y-a.y)*wk.t;
  const [u,v] = rotF(wx/TILE, wy/TILE);
  const c = iso(u,v);
  const bob = Math.sin(gtime*12 + wk.phase)*1.1;
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath(); ctx.ellipse(c[0], c[1]+1, 3.2, 1.7, 0, 0, 7); ctx.fill();
  ctx.fillStyle = wk.col;                       // corps
  ctx.fillRect(c[0]-2, c[1]-8+bob, 4, 7);
  ctx.fillStyle = '#f0c8a0';                    // tête
  ctx.beginPath(); ctx.arc(c[0], c[1]-10+bob, 2.5, 0, 7); ctx.fill();
}

function drawHomeless(h){
  const [u,v] = rotF(h.x/TILE, h.y/TILE);
  const c = iso(u,v);
  const bob = Math.sin(gtime*4 + h.phase)*0.7;
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath(); ctx.ellipse(c[0], c[1]+1, 3.2, 1.7, 0, 0, 7); ctx.fill();
  ctx.fillStyle = h.col || playerColor(h.owner);
  ctx.fillRect(c[0]-2, c[1]-8+bob, 4, 7);
  ctx.fillStyle = '#f0c8a0';
  ctx.beginPath(); ctx.arc(c[0], c[1]-10+bob, 2.5, 0, 7); ctx.fill();
}

function drawWorkRadiusOverlay(center, radius, color, minRx, maxRx, minRy, maxRy){
  for(let ry=minRy; ry<=maxRy; ry++) for(let rx=minRx; rx<=maxRx; rx++){
    const [x,y] = invRotIdx(rx,ry);
    const d = Math.max(Math.abs(x-center.x), Math.abs(y-center.y));
    if(d > radius) continue;
    ctx.fillStyle = color + (Math.ceil(d) === radius ? '33' : '1a');
    diamond(rx,ry); ctx.fill();
    if(Math.ceil(d) === radius){
      ctx.strokeStyle = color + '99';
      ctx.lineWidth = 1;
      diamond(rx,ry); ctx.stroke();
    }
  }
}

function drawTruck(tk){
  const a = tk.pts[tk.seg], b = tk.pts[Math.min(tk.seg+1, tk.pts.length-1)];
  const wx = a.x + (b.x-a.x)*tk.t, wy = a.y + (b.y-a.y)*tk.t;
  const [u,v] = rotF(wx/TILE, wy/TILE);
  const [du,dv] = rotDir(b.x-a.x, b.y-a.y);
  const alongU = Math.abs(du) >= Math.abs(dv);
  const au = alongU ? 0.26 : 0.14, av = alongU ? 0.14 : 0.26;
  const c = iso(u,v);
  ctx.fillStyle = 'rgba(0,0,0,.20)';
  ctx.beginPath(); ctx.ellipse(c[0]+1, c[1]+1, 11, 5, 0, 0, 7); ctx.fill();
  prism(u-au, v-av, u+au, v+av, 5, '#39404c');
  prism(u-au*0.72, v-av*0.72, u+au*0.72, v+av*0.72, 7, RES[tk.res].c, 5);
}

function draw(){
  drawFast = performance.now() < zoomActiveUntil || Math.abs(targetCam.z - cam.z) > 0.006;
  // ciel
  ctx.setTransform(DPR,0,0,DPR,0,0);
  const sky = ctx.createLinearGradient(0,0,0,H);
  sky.addColorStop(0,'#1c2740');
  sky.addColorStop(1,'#0b101a');
  ctx.fillStyle = sky;
  ctx.fillRect(0,0,W,H);

  const z = cam.z;
  ctx.setTransform(DPR*z,0,0,DPR*z, -cam.x*DPR*z, -cam.y*DPR*z);

  // fenêtre visible en px iso
  const vx0 = cam.x - TW, vx1 = cam.x + W/z + TW;
  const vy0 = cam.y - TH*3 - 160, vy1 = cam.y + H/z + TH*2; // marge haute = gratte-ciel

  const sprites = [];

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

  // --- passe 1 : sol (ordre ligne par ligne = peintre) ---
  for(let ry=minRy; ry<=maxRy; ry++) for(let rx=minRx; rx<=maxRx; rx++){
    const px = (rx-ry)*TW2, py = (rx+ry)*TH2;
    if(px < vx0-TW || px > vx1 || py < vy0 || py > vy1) continue;
    const [x,y] = invRotIdx(rx,ry);
    const i = y*N+x, t = terrain[i];

    if(t===T.WATER){
      ctx.fillStyle = WATER_COLS[hash(x,y)&1];
      diamond(rx,ry); ctx.fill();
    } else {
      ctx.fillStyle = GRASS_COLS[hash(x,y)&3];
      diamond(rx,ry); ctx.fill();
      if(!drawFast && (t===T.IRON || t===T.COAL)){
        ctx.fillStyle = t===T.IRON ? '#c0763a' : '#23232b';
        const hs = hash(x,y), c = iso(rx+0.5, ry+0.5);
        for(let k=0;k<4;k++){
          const ox = ((hs>>(k*4))&7)/7*TW*0.36 - TW*0.18;
          const oy = ((hs>>(k*4+8))&7)/7*TH*0.36 - TH*0.18;
          ctx.beginPath(); ctx.ellipse(c[0]+ox, c[1]+oy, 4.2, 2.6, 0, 0, 7); ctx.fill();
        }
      }
    }

    // routes
    if(road[i]){
      ctx.fillStyle = '#33373e';
      diamond(rx,ry); ctx.fill();
      if(drawFast) {
        // Pendant le zoom on évite les traits arrondis multiples, très coûteux en canvas.
        continue;
      }
      const c = iso(rx+0.5, ry+0.5);
      let links = 0;
      ctx.lineCap = 'round';
      for(const [dx,dy] of DIRS){
        const nx = x+dx, ny = y+dy;
        if(!inMap(nx,ny) || !road[ny*N+nx]) continue;
        links++;
        const [du,dv] = rotDir(dx,dy);
        const m = iso(rx+0.5+du*0.5, ry+0.5+dv*0.5);
        ctx.strokeStyle = '#4c525c'; ctx.lineWidth = 12;
        ctx.beginPath(); ctx.moveTo(c[0],c[1]); ctx.lineTo(m[0],m[1]); ctx.stroke();
        ctx.strokeStyle = 'rgba(200,206,214,.55)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(c[0],c[1]); ctx.lineTo(m[0],m[1]); ctx.stroke();
      }
      if(!links){
        ctx.fillStyle = '#4c525c';
        ctx.beginPath(); ctx.ellipse(c[0], c[1], 8, 4.5, 0, 0, 7); ctx.fill();
      }
    }

    // falaises au bord de la carte
    const D = 15;
    const cliff = t===T.WATER ? '#1c557f' : '#6f5236';
    if(ry===N-1){
      const Cc = iso(rx+1,ry+1), Dd = iso(rx,ry+1);
      ctx.fillStyle = shade(cliff,-0.15);
      quad(Cc, Dd, [Dd[0],Dd[1]+D], [Cc[0],Cc[1]+D]);
    }
    if(rx===N-1){
      const Bb = iso(rx+1,ry), Cc = iso(rx+1,ry+1);
      ctx.fillStyle = shade(cliff,-0.35);
      quad(Bb, Cc, [Cc[0],Cc[1]+D], [Bb[0],Bb[1]+D]);
    }

    // collecte des sprites (arbres / bâtiments) au passage
    if(!drawFast && t===T.TREE){
      sprites.push({ k:ry*1024+rx, f:()=>drawTree(rx,ry,x,y) });
    }
    const b = bgrid[i];
    if(b){
      const [r1x,r1y] = rotIdx(b.x, b.y);
      const [r2x,r2y] = rotIdx(b.x+b.w-1, b.y+b.h-1);
      // dessiné une seule fois, depuis sa tuile la plus « en avant »
      if(rx===Math.max(r1x,r2x) && ry===Math.max(r1y,r2y))
        sprites.push({ k:ry*1024+rx, f:()=>drawBuilding(b) });
    }
  }

  if(radiusSel)
    drawWorkRadiusOverlay(radiusSel.center, radiusSel.r, radiusSel.color, minRx, maxRx, minRy, maxRy);

  // camions
  if(!drawFast){
    for(const h of homeless){
      const [u,v] = rotF(h.x/TILE, h.y/TILE);
      sprites.push({ k:Math.floor(v)*1024 + Math.floor(u) + 0.55, f:()=>drawHomeless(h) });
    }

    for(const tk of trucks){
      const a = tk.pts[tk.seg], b = tk.pts[Math.min(tk.seg+1, tk.pts.length-1)];
      const wx = a.x + (b.x-a.x)*tk.t, wy = a.y + (b.y-a.y)*tk.t;
      const [u,v] = rotF(wx/TILE, wy/TILE);
      sprites.push({ k:Math.floor(v)*1024 + Math.floor(u) + 0.5, f:()=>drawTruck(tk) });
    }

    // piétons
    for(const wk of walkers){
      const a = wk.pts[wk.seg], b = wk.pts[Math.min(wk.seg+1, wk.pts.length-1)];
      const wx = a.x + (b.x-a.x)*wk.t, wy = a.y + (b.y-a.y)*wk.t;
      const [u,v] = rotF(wx/TILE, wy/TILE);
      sprites.push({ k:Math.floor(v)*1024 + Math.floor(u) + 0.6, f:()=>drawWalker(wk) });
    }
  }

  // --- passe 2 : sprites triés arrière → avant ---
  sprites.sort((a,b)=> a.k-b.k);
  for(const s of sprites) s.f();

  // fantôme de placement
  if(tool!=='select' && inMap(mouse.tx,mouse.ty)){
    const va = canPlace(tool, mouse.tx, mouse.ty);
    const [grx,gry] = rotIdx(mouse.tx, mouse.ty);
    ctx.fillStyle = va.ok ? 'rgba(110,230,120,.4)' : 'rgba(235,80,80,.4)';
    diamond(grx,gry); ctx.fill();
    const d = BUILD[tool];
    if(d.resid){
      drawWorkRadiusOverlay(
        { x:mouse.tx, y:mouse.ty },
        workRadiusOf({ type:tool, w:1, h:1 }),
        va.ok ? playerColor(MP.connected ? MP.myId : null) : '#eb5050',
        minRx, maxRx, minRy, maxRy
      );
      ctx.fillStyle = va.ok ? 'rgba(110,230,120,.45)' : 'rgba(235,80,80,.45)';
      diamond(grx,gry); ctx.fill();
    }
    if(va.ok && d.hgt){
      ctx.globalAlpha = 0.55;
      const tc = prism(grx, gry, grx+1, gry+1, d.hgt, d.col);
      ctx.font = (TH*0.62)+'px "Segoe UI Emoji",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.ic, tc[0], tc[1]+1);
      ctx.globalAlpha = 1;
    }
  } else if(tool==='select' && inMap(mouse.tx,mouse.ty)){
    const [grx,gry] = rotIdx(mouse.tx, mouse.ty);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5;
    diamond(grx,gry); ctx.stroke();
  }

  // textes flottants
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for(const f of floats){
    const p = worldPxToIso(f.x, f.y);
    ctx.globalAlpha = Math.min(1, f.life);
    ctx.fillStyle = f.col;
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(f.txt, p[0], p[1] - 20 - (1.3-f.life)*26);
  }
  ctx.globalAlpha = 1;
}

// ---------- HUD ----------
const $ = id => document.getElementById(id);
let hudTimer = 0;
function updateHUD(dt){
  hudTimer -= dt;
  if(hudTimer > 0) return;
  hudTimer = 0.2;
  const pop = popTotal(), jobs = jobsTotal();
  const mEl = $('hMoney');
  const myMoney = myWallet().money;
  mEl.textContent = Math.floor(myMoney).toLocaleString('fr-FR');
  mEl.style.color = myMoney < 0 ? '#ff8a7a' : '';
  $('hPop').textContent = pop + ' / ' + housingCap();
  $('hJobs').textContent = Math.min(pop,jobs) + ' / ' + jobs;
  $('hTrucks').textContent = trucks.length;
  renderInfo();
  renderFinance();
}

// ---------- panneau finances ----------
function toggleFinance(){
  const p = $('finance');
  p.style.display = p.style.display==='block' ? 'none' : 'block';
  renderFinance();
}
function renderFinance(){
  const p = $('finance');
  if(p.style.display !== 'block') return;
  const wt = myWallet();
  const fin = wt.fin, finHist = wt.finHist || [];
  const base = finHist[0] || fin;
  const wl = Math.max(1, finHist.length);
  const rate = c => (fin[c]-base[c])*60/wl;
  const fmt = n => Math.round(Math.abs(n)).toLocaleString('fr-FR');
  const row = (lbl,c,sign,cls)=>
    '<tr class="'+cls+'"><td>'+lbl+'</td>'
    + '<td class="r">'+sign+fmt(fin[c])+' $</td>'
    + '<td class="r">'+sign+fmt(rate(c))+' $</td></tr>';
  const netT = fin.ventes+fin.taxes+fin.rembours-fin.construction-fin.entretien;
  const netR = rate('ventes')+rate('taxes')+rate('rembours')
             - rate('construction')-rate('entretien');
  const sgn = n => n>=0 ? '+' : '−';
  p.innerHTML =
    '<h3>💰 Finances <button class="tbtn" id="bFinX">✕</button></h3>'
    + '<table>'
    + '<tr class="hdr"><td></td><td class="r">Total</td><td class="r">Par minute</td></tr>'
    + row('Ventes de marchandises','ventes','+','in')
    + row('Taxes des habitants','taxes','+','in')
    + row('Remboursements','rembours','+','in')
    + row('Construction','construction','−','out')
    + row('Entretien industriel','entretien','−','out')
    + '<tr class="net"><td>Bilan</td><td class="r">'+sgn(netT)+fmt(netT)+' $</td>'
    + '<td class="r">'+sgn(netR)+fmt(netR)+' $</td></tr>'
    + '</table>';
}

function statusOf(b){
  if(BUILD[b.type].resid){
    if(b.starterHome) return 'Maison de départ protégée (pas besoin de marchandises)';
    if((b.storage.goods||0) > 0) return 'Consomme des marchandises…';
    if(b.pop > (b.protectedPop||0) && b.starve > 0)
      return '⚠️ Pénurie ! Dégradation dans '+Math.max(0,Math.ceil(STARVE_DELAY-b.starve))+' s';
    return 'Attend des marchandises';
  }
  if(b.type==='depot') return 'Stocke et redistribue';
  if(b.paused) return 'En pause — ouvriers libérés';
  const r = recipeOf(b);
  if(!r) return '';
  for(const k in r.out) if((b.storage[k]||0) >= OUTCAP) return 'Stock de sortie plein';
  for(const k in r.in)  if((b.storage[k]||0) <  r.in[k]) return 'Manque : '+RES[k].n;
  const req = workersRequiredOf(b);
  if(req && workersAllocatedOf(b) < req)
    return "Production à "+Math.round(workersAllocatedOf(b)/req*100)+" % (manque d'ouvriers à portée)";
  return 'En production';
}

function renderInfo(){
  const p = $('info');
  if(!selected || selected.dead){ p.style.display = 'none'; return; }
  const b = selected, d = BUILD[b.type];
  let h = '<h3><span style="font-size:22px">'+d.ic+'</span>'+d.n+'</h3>';
  h += '<div class="status">'+statusOf(b)+'</div>';
  if(!adjRoadTiles(b).length)
    h += '<div class="warn">⚠️ Aucune route adjacente — pas de camions !</div>';
  if(d.workers) h += '<div class="row"><span>Ouvriers</span><b>'+workersAllocatedOf(b)+' / '+workersRequiredOf(b)+'</b></div>';
  if(d.ind && b.w*b.h>1)
    h += '<div class="row"><span>Taille / production</span><b>'+b.w+'×'+b.h
       + ' — ×'+prodMult(b).toFixed(1)+'</b></div>';
  if(d.ind)
    h += '<div class="row"><span>Entretien</span><b>'+(Math.round(upkeepOf(b)*10)/10)
       + ' $ / '+IND_UPKEEP_INTERVAL+' s</b></div>';
  if(d.resid)
    h += '<div class="row"><span>Habitants</span><b>'+b.pop+' / '+d.resid.popCap+'</b></div>';
  if(d.resid && !b.starterHome){
    const incomePerCycle = d.resid.income * Math.max(1, b.pop);
    const ratePerMin = b.pop > 0 ? Math.round(incomePerCycle / d.resid.interval * 60) : 0;
    h += '<div class="row"><span>Revenu / marchandise</span><b>'+incomePerCycle+' $</b></div>';
    h += '<div class="row"><span>Intervalle conso.</span><b>'+d.resid.interval+' s</b></div>';
    h += '<div class="row"><span>Revenu / min</span><b style="color:#9fe8a0">~'+ratePerMin+' $</b></div>';
  }
  if(d.resid)
    h += '<div class="row"><span>Rayon travail</span><b>'+workRadiusOf(b)+' cases</b></div>';
  const keys = Object.keys(b.storage).filter(k=>b.storage[k]>0 || (b.inc[k]||0)>0);
  if(keys.length){
    h += '<div style="margin-top:8px;color:#8fa3bf">Stocks</div>';
    for(const k of keys){
      const cap = capOf(b,k), val = b.storage[k]||0;
      h += '<div class="row"><span>'+RES[k].n+'</span><b>'+val+' / '+cap+'</b></div>';
      h += '<div class="bar"><i style="width:'+Math.min(100,100*val/cap)+'%;background:'+RES[k].c+'"></i></div>';
    }
  }
  if(b.type==='depot'){
    h += '<div style="margin-top:8px;color:#8fa3bf">Ressources acceptées</div><div>';
    for(const k in RES){
      const on = b.allow?.[k] !== false;
      h += '<button class="tbtn flt'+(on?' on':'')+'" data-r="'+k+'">'
         + '<span class="dot" style="background:'+RES[k].c+'"></span>'+RES[k].n+'</button>';
    }
    h += '</div>';
  }
  const canControl = !MP.connected || !b.owner || b.owner === MP.myId;
  if(d.ind && canControl)
    h += '<button class="tbtn" id="bPauseBld">'+(b.paused ? '▶ Reprendre' : '⏸ Mettre en pause')+'</button>';
  h += '<button class="tbtn" id="bDemol">🧨 Démolir (+'+Math.floor((d.cost||0)*0.3)+' $)</button>';
  p.style.display = 'block';
  if(p._html === h && p._b === b) return; // ne pas reconstruire le DOM sous la souris
  p._html = h; p._b = b;
  p.innerHTML = h;
  p.querySelectorAll('.flt').forEach(btn=>{
    btn.onclick = ()=>{
      b.allow[btn.dataset.r] = b.allow[btn.dataset.r] === false;
      p._html = null; // forcer le rafraîchissement
    };
  });
  const pauseBtn = $('bPauseBld');
  if(pauseBtn) pauseBtn.onclick = ()=>{
    setBuildingPaused(b, !b.paused);
    p._html = null;
    renderInfo();
  };
  $('bDemol').onclick = ()=>{
    if(MP.connected && b.owner && b.owner !== MP.myId){
      toast('⛔ Ce bâtiment appartient à un autre joueur','err'); return;
    }
    if(MP.connected) netSend({ type:'bulldoze_bld', bx:b.x, by:b.y });
    demolishBuilding(b, b.owner);
    selected = null;
  };
}

// ---------- toasts ----------
function toast(msg, cls){
  const t = document.createElement('div');
  t.className = 'toast' + (cls ? ' '+cls : '');
  t.textContent = msg;
  const box = $('toasts');
  box.appendChild(t);
  while(box.children.length > 4) box.removeChild(box.firstChild);
  setTimeout(()=>{ t.style.transition = 'opacity .4s'; t.style.opacity = '0'; }, 2400);
  setTimeout(()=> t.remove(), 2900);
}

// ---------- barre d'outils ----------
function buildToolbar(){
  const bar = $('toolbar');
  for(const k of TOOL_ORDER){
    const d = BUILD[k];
    const btn = document.createElement('button');
    btn.className = 'tool' + (k===tool ? ' on' : '');
    btn.dataset.t = k;
    btn.title = d.desc || '';
    btn.innerHTML = '<span class="ic">'+d.ic+'</span><span>'+d.n+'</span>'
      + (d.cost ? '<span class="cost">'+d.cost+' $</span>' : '<span class="cost">&nbsp;</span>')
      + '<span class="hk">['+d.hk+']</span>';
    btn.onclick = ()=> setTool(k);
    bar.appendChild(btn);
  }
}
function setTool(k){
  tool = k;
  document.querySelectorAll('.tool').forEach(b=> b.classList.toggle('on', b.dataset.t===k));
}

// ---------- souris / clavier ----------
const mouse = { x:0, y:0, tx:-1, ty:-1, lDown:false, rDown:false, rMoved:0, lastX:0, lastY:0 };

function updateMouseTileAt(x,y){
  mouse.x = x; mouse.y = y;
  const ix = cam.x + x/cam.z, iy = cam.y + y/cam.z;
  const u = (ix/TW2 + iy/TH2)/2, v = (iy/TH2 - ix/TW2)/2;
  const [tx,ty] = invRotF(u,v);
  mouse.tx = Math.floor(tx); mouse.ty = Math.floor(ty);
}
function updateMouseTile(e){
  updateMouseTileAt(e.clientX, e.clientY);
}

// clickFn : indirection pour permettre au module multijoueur d'intercepter les clics
let clickFn = clickAt;

cv.addEventListener('mousedown', e=>{
  updateMouseTile(e);
  if(e.button===0){
    mouse.lDown = true;
    clickFn(mouse.tx, mouse.ty);
  } else if(e.button===2 || e.button===1){
    mouse.rDown = true; mouse.rMoved = 0;
    mouse.lastX = e.clientX; mouse.lastY = e.clientY;
  }
});
addEventListener('mousemove', e=>{
  const ptx = mouse.tx, pty = mouse.ty;
  updateMouseTile(e);
  if(mouse.rDown){
    const dx = e.clientX-mouse.lastX, dy = e.clientY-mouse.lastY;
    mouse.rMoved += Math.abs(dx)+Math.abs(dy);
    cam.x -= dx/cam.z; cam.y -= dy/cam.z;
    clampCam();
    syncTargetCam();
    mouse.lastX = e.clientX; mouse.lastY = e.clientY;
  }
  if(mouse.lDown && (tool==='road'||tool==='bulldoze') && (mouse.tx!==ptx || mouse.ty!==pty))
    clickFn(mouse.tx, mouse.ty);
});
addEventListener('mouseup', e=>{
  if(e.button===0) mouse.lDown = false;
  if(e.button===2 || e.button===1){
    if(e.button===2 && mouse.rMoved < 6) setTool('select'); // clic droit simple = annuler
    mouse.rDown = false;
  }
});
cv.addEventListener('wheel', e=>{
  e.preventDefault();
  zoomActiveUntil = performance.now() + 180;
  const unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? H : 1);
  const factor = Math.exp(-e.deltaY * unit * ZOOM_WHEEL_SENS);
  const z2 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, targetCam.z * factor));
  // garder le point sous le curseur fixe sur la caméra cible, puis lisser vers elle.
  targetCam.x += e.clientX/targetCam.z - e.clientX/z2;
  targetCam.y += e.clientY/targetCam.z - e.clientY/z2;
  targetCam.z = z2;
  clampCamera(targetCam);
},{ passive:false });
cv.addEventListener('contextmenu', e=> e.preventDefault());

function clampCamera(c){
  const m = TW*4;
  c.z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.z));
  c.x = Math.min(N*TW2+m - W/c.z, Math.max(-N*TW2-m, c.x));
  c.y = Math.min(N*TH+m - H/c.z, Math.max(-m-200, c.y));
}
function clampCam(){
  clampCamera(cam);
}
function syncTargetCam(){
  targetCam.x = cam.x;
  targetCam.y = cam.y;
  targetCam.z = cam.z;
}
function smoothCamera(dt){
  const a = 1 - Math.exp(-CAM_SMOOTH * dt);
  cam.x += (targetCam.x - cam.x) * a;
  cam.y += (targetCam.y - cam.y) * a;
  cam.z += (targetCam.z - cam.z) * a;
  if(Math.abs(targetCam.x-cam.x) < 0.01) cam.x = targetCam.x;
  if(Math.abs(targetCam.y-cam.y) < 0.01) cam.y = targetCam.y;
  if(Math.abs(targetCam.z-cam.z) < 0.0005) cam.z = targetCam.z;
  clampCam();
  updateMouseTileAt(mouse.x, mouse.y);
}

const keys = new Set();
addEventListener('keydown', e=>{
  if(e.target.tagName==='INPUT') return;
  keys.add(e.code);
  if(e.code==='Space'){ e.preventDefault(); togglePause(); }
  if(e.code==='Escape'){ setTool('select'); selected = null; }
  if(e.code==='KeyH') toggleHelp();
  if(e.code==='KeyR') rotate(e.shiftKey ? -1 : 1);
  if(e.code.startsWith('Digit')){
    const num = +e.code.slice(5) - 1;
    if(num>=0 && num<TOOL_ORDER.length) setTool(TOOL_ORDER[num]);
  }
});
addEventListener('keyup', e=> keys.delete(e.code));

function panKeys(dt){
  const s = 520*dt/cam.z;
  let moved = false;
  if(keys.has('ArrowLeft') || keys.has('KeyA') || keys.has('KeyQ')){ cam.x -= s; moved = true; }
  if(keys.has('ArrowRight')|| keys.has('KeyD')){ cam.x += s; moved = true; }
  if(keys.has('ArrowUp')   || keys.has('KeyW') || keys.has('KeyZ')){ cam.y -= s; moved = true; }
  if(keys.has('ArrowDown') || keys.has('KeyS')){ cam.y += s; moved = true; }
  clampCam();
  if(moved) syncTargetCam();
}

// ---------- boutons du haut ----------
function togglePause(){
  paused = !paused;
  $('bPause').textContent = paused ? '▶' : '⏸';
  $('bPause').classList.toggle('on', paused);
}
$('bPause').onclick = togglePause;
document.querySelectorAll('.spd').forEach(b=>{
  b.onclick = ()=>{
    speed = +b.dataset.s;
    document.querySelectorAll('.spd').forEach(x=> x.classList.toggle('on', x===b));
    if(paused) togglePause();
  };
});
$('bRotL').onclick = ()=> rotate(-1);
$('bRotR').onclick = ()=> rotate(1);
$('sMoney').onclick = toggleFinance;
// délégation : le ✕ survit aux reconstructions du panneau (rafraîchi 5×/s)
$('finance').onclick = e=>{ if(e.target.id==='bFinX') toggleFinance(); };

function toggleHelp(){
  const h = $('help');
  h.style.display = h.style.display==='block' ? 'none' : 'block';
}
$('bHelp').onclick = toggleHelp;
$('bGo').onclick = ()=> $('help').style.display = 'none';

// ---------- dropdown options ----------
const optMenu = $('optMenu');

function refreshOptMenu(){
  document.querySelectorAll('.opt-item[data-opt]').forEach(el => {
    const key = el.dataset.opt;
    const active = !!UI_OPTIONS[key];
    el.classList.toggle('active', active);
    el.querySelector('.chk').textContent = active ? '✓' : '';
  });
}
refreshOptMenu();

$('bOptions').onclick = e => {
  e.stopPropagation();
  optMenu.classList.toggle('open');
};

document.addEventListener('click', e => {
  if(!optMenu.contains(e.target) && e.target.id !== 'bOptions')
    optMenu.classList.remove('open');
});

document.querySelectorAll('.opt-item[data-opt]').forEach(el => {
  el.onclick = e => {
    e.stopPropagation();
    const key = el.dataset.opt;
    UI_OPTIONS[key] = !UI_OPTIONS[key];
    saveUIOptions();
    refreshOptMenu();
  };
});

// ---------- boucle principale ----------
// drawFn est une indirection pour permettre aux extensions (multijoueur) de surcharger draw
let drawFn = draw;

let last = performance.now();
function frame(now){
  const rdt = Math.min(0.05, (now-last)/1000);
  last = now;
  panKeys(rdt);
  smoothCamera(rdt);
  if(!paused) update(rdt*speed);
  drawFn();
  updateHUD(rdt);
  requestAnimationFrame(frame);
}

buildToolbar();
genWorld();
$('help').style.display = 'block';
requestAnimationFrame(frame);

// ======================================================================
// MULTIJOUEUR — couche réseau WebSocket
// ======================================================================

// ---- sérialisation de l'état complet (hôte → invité) ----
function serializeState(){
  return {
    world: WORLD,
    size: N,
    terrain: Array.from(terrain),
    road:    Array.from(road),
    wallets: WALLETS,
    homeless: homeless.map(h=>({ owner:h.owner ?? null, x:h.x, y:h.y, col:h.col, phase:h.phase })),
    gtime,
    paused, speed,
    buildings: buildings.map(b => ({
      type:b.type, x:b.x, y:b.y, w:b.w, h:b.h,
      storage:{...b.storage}, inc:{...b.inc},
      prog:b.prog||0, trucksOut:b.trucksOut||0,
      pop:b.pop||0, protectedPop:b.protectedPop||0,
      ct:b.ct||0, pending:b.pending||0, pendingProtected:b.pendingProtected||0, starve:b.starve||0,
      ore:b.ore||null, allow:b.allow||null, paused:b.paused||false, owner:b.owner||null,
      starterHome:!!b.starterHome,
    })),
  };
}

function applySnapshot(d){
  WORLD = normalizeWorldConfig(d.world || { ...WORLD, size: d.size || WORLD.size });
  setMapSize(WORLD.size);
  terrain  = Uint8Array.from(d.terrain);
  road     = Uint8Array.from(d.road);
  gtime    = d.gtime || 0;
  WALLETS  = {};
  if(d.wallets){ for(const k in d.wallets) WALLETS[k] = d.wallets[k]; }
  paused   = d.paused;  speed   = d.speed||1;
  $('bPause').textContent = paused ? '▶' : '⏸';
  $('bPause').classList.toggle('on', paused);
  document.querySelectorAll('.spd').forEach(b=> b.classList.toggle('on', +b.dataset.s===speed));

  buildings = []; trucks = []; walkers = []; homeless = []; floats = [];
  bgrid = new Array(N*N).fill(null);
  selected = null;

  for(const o of d.buildings){
    if(!BUILD[o.type]) continue;
    const b = newBuilding(o.type, o.x, o.y, o.w, o.h);
    Object.assign(b, {
      storage:o.storage||{}, inc:o.inc||{},
      prog:o.prog||0, trucksOut:o.trucksOut||0,
      pop:o.pop||0, protectedPop:o.protectedPop||0,
      ct:o.ct||0, pending:o.pending||0, pendingProtected:o.pendingProtected||0, starve:o.starve||0,
    });
    if(o.ore)   b.ore   = o.ore;
    if(o.allow) b.allow = o.allow;
    if(o.paused != null) b.paused = o.paused;
    if(o.owner  != null) b.owner  = o.owner;
    if(o.starterHome) b.starterHome = true;
    buildings.push(b);
    setGrid(b,b);
  }
  for(const k in WALLETS) WALLETS[k].starterHomes = 0;
  for(const b of buildings){
    if(!b.starterHome) continue;
    const w = walletOf(b.owner ?? SOLO_KEY);
    w.starterHomes = Math.min(2, (w.starterHomes||0) + Math.max(1, b.protectedPop||0));
  }
  ensureAllStarterProtections();
  if(Array.isArray(d.homeless)){
    homeless = d.homeless.map(h=>({
      owner:h.owner ?? null,
      x:h.x, y:h.y,
      col:h.col || playerColor(h.owner),
      phase:h.phase || 0,
    }));
    if(MP.connected && MP.role === 'host' && MP.myId != null) adoptSoloHomeless(MP.myId);
    for(const h of homeless) h.col = playerColor(h.owner);
    for(const h of homeless) walletOf(h.owner ?? SOLO_KEY).homelessSeeded = true;
  }
}

// ---- patch minimal d'une action entrante ----
function applyAction(msg){
  const { act } = msg;
  switch(act.type){
    case 'road':   road[act.i] = 1; break;
    case 'bulldoze_road': road[act.i] = 0; earnMoney(3, 'rembours', walletOf(msg.from)); break;
    case 'bulldoze_tree': terrain[act.i] = T.GRASS; break;
    case 'bulldoze_bld': {
      const b = bgrid[act.by*N+act.bx];
      if(!b) break;
      // valider le droit de démolition côté receveur aussi
      if(b.owner && b.owner !== msg.from) break;
      demolishBuilding(b, msg.from);
      break;
    }
    case 'build': {
      const cost = BUILD[act.btype].cost||0;
      const wSender = walletOf(msg.from);
      if(act.btype === 'road'){
        road[act.y*N+act.x] = 1;
        wSender.money -= cost; wSender.fin.construction += cost;
        break;
      }
      const b = newBuilding(act.btype, act.x, act.y);
      b.owner = msg.from;
      markStarterHomeIfNeeded(b);
      buildings.push(b); bgrid[act.y*N+act.x] = b;
      wSender.money -= cost; wSender.fin.construction += cost;
      if(BUILD[b.type].resid) assignHomelessToHousing(b.owner);
      break;
    }
    case 'toggle_bld_pause': {
      const b = bgrid[act.y*N+act.x];
      if(!b || !BUILD[b.type]?.ind) break;
      if(b.owner && b.owner !== msg.from) break;
      b.paused = !!act.paused;
      break;
    }
    case 'pause': togglePause(); break;
    case 'speed': {
      speed = act.s; paused = false;
      document.querySelectorAll('.spd').forEach(b=> b.classList.toggle('on', +b.dataset.s===act.s));
      if($('bPause').textContent==='▶'){ paused=false; $('bPause').textContent='⏸'; $('bPause').classList.remove('on'); }
      break;
    }
    default: break;
  }
}

// ---- envoi d'une action au réseau ----
function netSend(act){
  if(!MP.ws || !MP.connected) return;
  MP.ws.send(JSON.stringify({ type:'action', act }));
}

// ---- connection ----
function mpConnect(url){
  if(MP.ws){ MP.ws.close(); }
  const ws = new WebSocket(url);
  MP.ws = ws;

  ws.onopen = () => {
    MP.connected = true;
    toast('🌐 Connecté au serveur multijoueur');
    mpUpdateUI();
    // tentative de reprise de session via token stocké
    const saved = localStorage.getItem('fp_token');
    if(saved) ws.send(JSON.stringify({ type:'resume', token:saved }));
  };

  ws.onclose = () => {
    MP.connected = false;
    MP.role = null;
    MP.isAdmin = false;
    MP.username = null;
    MP.token = null;
    MP.saves = [];
    toast('🔌 Déconnecté du serveur','err');
    mpUpdateUI();
  };

  ws.onerror = () => {
    toast('⚠️ Erreur de connexion','err');
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    switch(msg.type){
      case 'hello':
        MP.myId    = msg.id;
        MP.myColor = msg.color;
        MP.myName  = msg.name;
        MP.role    = msg.role;
        MP.isAdmin = !!msg.isAdmin;
        if(msg.worldConfig) WORLD = normalizeWorldConfig(msg.worldConfig);
        adoptSoloHomeless(MP.myId);
        ensureHomelessForOwner(MP.myId);
        toast((msg.role==='host' ? '👑 Tu es l\'hôte' : '👥 Tu as rejoint la partie')+' (#'+msg.id+')');
        mpUpdateUI();
        break;

      case 'promoted_host':
        MP.role = 'host';
        MP.isAdmin = false;
        if(msg.worldConfig) WORLD = normalizeWorldConfig(msg.worldConfig);
        toast('👑 Tu es maintenant l\'hôte de la partie');
        mpUpdateUI();
        break;

      case 'admin_promoted':
        MP.isAdmin = true;
        toast('🛡️ Tu es maintenant administrateur');
        mpUpdateUI();
        break;

      case 'admin_changed':
        if(msg.playerId === MP.myId) MP.isAdmin = !!msg.isAdmin;
        toast('🛡️ Un joueur a été promu administrateur');
        mpUpdateUI();
        break;

      case 'snapshot_request':
        // l'hôte envoie l'état complet à un invité
        if(MP.role === 'host'){
          MP.ws.send(JSON.stringify({
            type:'snapshot', forId: msg.forId,
            state: serializeState(),
          }));
        }
        break;

      case 'snapshot':
        // l'invité reçoit l'état initial
        applySnapshot(msg.state);
        toast('📥 Carte synchronisée');
        break;

      case 'action':
        // recevoir une action d'un autre joueur
        applyAction(msg);
        break;

      case 'cursor':
        if(msg.from !== MP.myId)
          MP.cursors[msg.from] = { tx:msg.tx, ty:msg.ty,
            color: (MP.players.find(p=>p.id===msg.from)||{}).color || '#fff',
            name:  (MP.players.find(p=>p.id===msg.from)||{}).name  || '?',
            ts: Date.now() };
        break;

      case 'chat': {
        const entry = { name:msg.name, text:msg.text, col:(MP.players.find(p=>p.id===msg.from)||{}).color||'#fff' };
        MP.chat.push(entry);
        if(MP.chat.length > 30) MP.chat.shift();
        mpRenderChat();
        toast('💬 '+msg.name+': '+msg.text);
        break;
      }

      case 'player_list':
        MP.players = msg.players;
        MP.isAdmin = !!(MP.players.find(p=>p.id===MP.myId)||{}).isAdmin;
        for(const p of MP.players) ensureHomelessForOwner(p.id);
        for(const h of homeless) h.col = playerColor(h.owner);
        for(const p of MP.players) assignHomelessToHousing(p.id);
        mpUpdateUI();
        mpRenderPlayerList();
        // mettre à jour les couleurs des curseurs
        for(const p of MP.players)
          if(MP.cursors[p.id]) MP.cursors[p.id].color = p.color;
        break;

      case 'player_left':
        delete MP.cursors[msg.id];
        toast('👤 Joueur #'+msg.id+' a quitté la partie');
        mpRenderPlayerList();
        break;

      case 'auth_ok':
        MP.username = msg.username;
        MP.token    = msg.token;
        MP.myColor  = msg.color;
        MP.myName   = msg.username;
        for(const h of homeless) if(h.owner === MP.myId) h.col = msg.color;
        localStorage.setItem('fp_token', msg.token);
        $('mpAuthPwd').value = '';
        mpShowAuthError('');
        toast('👤 Connecté en tant que ' + msg.username);
        mpUpdateUI();
        // récupérer la liste des sauvegardes
        MP.ws.send(JSON.stringify({ type:'list_saves', token:MP.token }));
        break;

      case 'logout_ok':
        MP.username = null;
        MP.token = null;
        MP.saves = [];
        MP.myName = msg.name || 'Moi';
        MP.myColor = msg.color || MP.myColor;
        localStorage.removeItem('fp_token');
        $('mpAuthPwd').value = '';
        mpShowAuthError('');
        toast('Compte déconnecté');
        mpUpdateUI();
        mpRenderSaves();
        break;

      case 'auth_err':
        mpShowAuthError(msg.msg);
        break;

      case 'saves_list':
        MP.saves = msg.saves || [];
        mpRenderSaves();
        break;

      case 'save_ok':
        toast('💾 Sauvegarde "'+msg.name+'" enregistrée');
        $('mpSaveName').value = '';
        break;

      case 'save_err':
        toast('💾 ' + msg.msg, 'err');
        break;

      case 'permission_err':
        toast('⛔ ' + msg.msg, 'err');
        break;

      case 'save_deleted':
        toast('🗑️ Sauvegarde supprimée');
        break;

      case 'game_saved':
        if(msg.savedBy !== MP.username)
          toast('💾 '+msg.savedBy+' a sauvegardé la partie : "'+msg.name+'"');
        break;

      case 'game_loaded':
        applySnapshot(msg.state);
        toast('📂 Partie "'+msg.name+'" chargée par '+msg.loadedBy);
        break;

      case 'game_new_world':
        applySnapshot(msg.state);
        if(msg.config) WORLD = normalizeWorldConfig(msg.config);
        toast('🌍 Nouvelle carte créée par '+msg.createdBy);
        mpUpdateUI();
        break;

      case 'server_full':
        toast('⛔ '+msg.msg, 'err');
        break;
    }
  };
}

function mpDisconnect(){
  if(MP.ws){ MP.ws.close(); MP.ws = null; }
  MP.connected = false;
  MP.role = null;
  MP.isAdmin = false;
  MP.username = null;
  MP.token = null;
  MP.saves = [];
  mpUpdateUI();
}

function mpLogoutAccount(){
  localStorage.removeItem('fp_token');
  MP.username = null;
  MP.token = null;
  MP.saves = [];
  if(MP.ws && MP.connected) MP.ws.send(JSON.stringify({ type:'logout' }));
  mpShowAuthError('');
  $('mpAuthUser').value = '';
  $('mpAuthPwd').value = '';
  mpUpdateUI();
  mpRenderSaves();
}

// ---- interception des clics (via clickFn défini plus haut) ----
clickFn = function(x,y){
  if(!inMap(x,y)) return;
  const i = y*N+x;
  if(tool==='select'){ clickAt(x,y); return; }
  if(!MP.connected){
    toast('🌐 Connecte-toi au serveur multijoueur pour construire','err');
    return;
  }

  if(tool==='bulldoze'){
    if(bgrid[i]){
      // ne pas envoyer l'action si le bâtiment appartient à quelqu'un d'autre
      if(bgrid[i].owner && bgrid[i].owner !== MP.myId){ clickAt(x,y); return; }
      netSend({ type:'bulldoze_bld', bx:bgrid[i].x, by:bgrid[i].y });
    } else if(road[i]){
      netSend({ type:'bulldoze_road', i });
    } else if(terrain[i]===T.TREE){
      netSend({ type:'bulldoze_tree', i });
    }
    clickAt(x,y);
    return;
  }
  const v = canPlace(tool,x,y);
  if(!v.ok){ clickAt(x,y); return; }
  if((BUILD[tool].cost||0) > myWallet().money){ clickAt(x,y); return; }
  netSend({ type:'build', btype:tool, x, y });
  clickAt(x,y);
};

// ---- envoi du curseur réseau (ajouté à mousemove existant) ----
let _lastCursorTx = -1, _lastCursorTy = -1;
addEventListener('mousemove', () => {
  if(!MP.connected) return;
  if(mouse.tx !== _lastCursorTx || mouse.ty !== _lastCursorTy){
    _lastCursorTx = mouse.tx; _lastCursorTy = mouse.ty;
    MP.ws.send(JSON.stringify({ type:'cursor', tx:mouse.tx, ty:mouse.ty }));
  }
});

// ---- interception pause / speed pour diffusion réseau ----
$('bPause').onclick = ()=>{ togglePause(); if(MP.connected) netSend({ type:'pause' }); };

document.querySelectorAll('.spd').forEach(b=>{
  b.onclick = ()=>{
    speed = +b.dataset.s;
    document.querySelectorAll('.spd').forEach(x=> x.classList.toggle('on', x===b));
    if(paused){ paused=false; $('bPause').textContent='⏸'; $('bPause').classList.remove('on'); }
    if(MP.connected) netSend({ type:'speed', s:speed });
  };
});

// ---- rendu des curseurs (via drawFn défini plus haut) ----
drawFn = function(){
  draw();
  if(!MP.connected) return;
  const now = Date.now();
  ctx.setTransform(DPR*cam.z, 0, 0, DPR*cam.z, -cam.x*DPR*cam.z, -cam.y*DPR*cam.z);
  for(const cid in MP.cursors){
    const c = MP.cursors[cid];
    if(now - c.ts > 5000) continue;
    const [rx,ry] = rotIdx(c.tx, c.ty);
    const pt = iso(rx+0.5, ry+0.5);
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = c.color; ctx.lineWidth = 2;
    diamond(rx, ry, 1, 1); ctx.stroke();
    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = c.color; ctx.textAlign = 'center';
    ctx.fillText(c.name, pt[0], pt[1] - TH*0.7);
    ctx.restore();
  }
};

// ---- interface multijoueur ----
const INP = 'width:100%;box-sizing:border-box;background:#16202f;border:1px solid #36465e;'+
            'color:#e8eef7;border-radius:6px;padding:5px 8px;font-size:12px;margin-bottom:5px';
const INP2 = INP.replace('margin-bottom:5px','');
let mpNewCollapsed = true;

function mpInjectUI(){
  // bouton dans le topbar
  const sep = document.createElement('span'); sep.className = 'sep';
  const btn = document.createElement('button');
  btn.className = 'tbtn'; btn.id = 'bMP';
  btn.textContent = '🌐 Multijoueur'; btn.onclick = mpTogglePanel;
  $('topbar').appendChild(sep); $('topbar').appendChild(btn);

  // panneau principal (scrollable, assez haut)
  const panel = document.createElement('div');
  panel.id = 'mpPanel'; panel.className = 'panel';
  panel.style.cssText =
    'top:70px;left:12px;width:280px;max-height:calc(100vh - 90px);'+
    'overflow-y:auto;padding:12px 14px;font-size:13px;display:none;z-index:20';

  panel.innerHTML = `
<h3 style="margin:0 0 8px;font-size:15px">🌐 Multijoueur</h3>

<!-- connexion au serveur -->
<div id="mpConnBlock">
  <input id="mpUrl" type="text" placeholder="ws://localhost:8765"
    value="ws://${location.hostname}:8765" style="${INP}">
  <div style="display:flex;gap:6px">
    <button class="tbtn" id="mpBtnConn" style="flex:1">Connexion</button>
    <button class="tbtn" id="mpBtnDisc" style="flex:1;display:none">Déconnecter</button>
  </div>
</div>

<div id="mpStatus" style="color:#8fa3bf;font-style:italic;margin:6px 0">Non connecté</div>

<!-- auth (visible quand connecté mais non authentifié) -->
<div id="mpAuthBlock" style="display:none">
  <div style="color:#8fa3bf;font-size:11px;margin-bottom:4px">Compte joueur</div>
  <input id="mpAuthUser" type="text"     placeholder="Nom d'utilisateur" style="${INP}">
  <input id="mpAuthPwd"  type="password" placeholder="Mot de passe"      style="${INP}">
  <div id="mpAuthErr" style="color:#ff9a8a;font-size:11px;min-height:14px;margin-bottom:4px"></div>
  <div style="display:flex;gap:6px">
    <button class="tbtn" id="mpBtnLogin"    style="flex:1">Connexion</button>
    <button class="tbtn" id="mpBtnRegister" style="flex:1">Créer compte</button>
  </div>
</div>

<div id="mpAccountBlock" style="display:none">
  <div style="display:flex;gap:6px;align-items:center">
    <span id="mpAccountName" style="flex:1;color:#8fa3bf;font-size:11px"></span>
    <button class="tbtn" id="mpBtnSwitchAccount" style="padding:2px 8px;font-size:11px">Changer compte</button>
  </div>
</div>

<!-- section saves (visible quand authentifié) -->
<div id="mpNewBlock" style="display:none">
  <div style="border-top:1px solid #36465e;margin:8px 0"></div>
  <button class="tbtn" id="mpBtnNewToggle" style="width:100%;display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
    <span>🌍 Nouvelle carte</span><span id="mpNewChevron">▸</span>
  </button>
  <div id="mpNewContent" style="display:none">
    <label style="display:block;color:#8fa3bf;font-size:11px">Taille de carte</label>
    <input id="mpWorldSize" type="number" min="32" max="128" step="8" style="${INP}">
    <label style="display:block;color:#8fa3bf;font-size:11px">Joueurs max</label>
    <input id="mpMaxPlayers" type="number" min="1" max="32" step="1" style="${INP}">
    <label style="display:block;color:#8fa3bf;font-size:11px">Arbres / bois (%)</label>
    <input id="mpResTree" type="number" min="0" max="40" step="0.5" style="${INP}">
    <label style="display:block;color:#8fa3bf;font-size:11px">Fer (%)</label>
    <input id="mpResIron" type="number" min="0" max="40" step="0.5" style="${INP}">
    <label style="display:block;color:#8fa3bf;font-size:11px">Charbon (%)</label>
    <input id="mpResCoal" type="number" min="0" max="40" step="0.5" style="${INP}">
    <button class="tbtn" id="mpBtnNewWorld" style="width:100%">Créer la carte</button>
    <div id="mpWorldErr" style="color:#ff9a8a;font-size:11px;min-height:14px;margin-top:4px"></div>
  </div>
</div>

<div id="mpSaveBlock" style="display:none">
  <div style="border-top:1px solid #36465e;margin:8px 0"></div>
  <div style="color:#8fa3bf;font-size:11px;margin-bottom:4px">💾 Sauvegardes <span id="mpSaveLock"></span></div>
  <div style="display:flex;gap:5px;margin-bottom:5px">
    <input id="mpSaveName" type="text" placeholder="Nom de la sauvegarde"
      style="${INP2};flex:1;margin:0">
    <button class="tbtn" id="mpBtnSave" title="Sauvegarder">💾</button>
  </div>
  <div id="mpSaveList" style="max-height:130px;overflow-y:auto;margin-bottom:4px"></div>
  <div id="mpSaveErr" style="color:#ff9a8a;font-size:11px;min-height:14px"></div>
</div>

<!-- joueurs connectés -->
<div style="border-top:1px solid #36465e;margin:8px 0"></div>
<div style="color:#8fa3bf;font-size:11px;margin-bottom:4px">👥 Joueurs</div>
<div id="mpPlayers" style="margin-bottom:6px"></div>

<!-- chat -->
<div style="border-top:1px solid #36465e;margin:8px 0"></div>
<div id="mpChatBox" style="max-height:100px;overflow-y:auto;margin-bottom:5px;
     background:#16202f;border-radius:6px;padding:6px;font-size:11px"></div>
<div style="display:flex;gap:4px">
  <input id="mpChatIn" type="text" placeholder="Message…"
    style="flex:1;${INP2}">
  <button class="tbtn" id="mpBtnSend">↵</button>
</div>`;

  document.body.appendChild(panel);

  // --- événements ---
  $('mpBtnConn').onclick = ()=> mpConnect($('mpUrl').value.trim() || 'ws://localhost:8765');
  $('mpBtnDisc').onclick = mpDisconnect;
  $('mpBtnSwitchAccount').onclick = mpLogoutAccount;
  $('mpBtnNewToggle').onclick = ()=>{
    mpNewCollapsed = !mpNewCollapsed;
    mpRenderNewCollapse();
  };

  $('mpBtnLogin').onclick = ()=>{
    const u = $('mpAuthUser').value.trim(), p = $('mpAuthPwd').value;
    if(!u||!p){ mpShowAuthError('Remplis les deux champs'); return; }
    MP.ws.send(JSON.stringify({ type:'login', username:u, password:p }));
  };
  $('mpBtnRegister').onclick = ()=>{
    const u = $('mpAuthUser').value.trim(), p = $('mpAuthPwd').value;
    if(!u||!p){ mpShowAuthError('Remplis les deux champs'); return; }
    MP.ws.send(JSON.stringify({ type:'register', username:u, password:p }));
  };
  $('mpAuthPwd').addEventListener('keydown', e=>{
    if(e.key==='Enter') $('mpBtnLogin').click();
  });

  $('mpBtnSave').onclick = ()=>{
    if(!mpHasAdminRights()){ $('mpSaveErr').textContent = 'Réservé à l’hôte/admin'; return; }
    const name = $('mpSaveName').value.trim();
    if(!name){ $('mpSaveErr').textContent = 'Entre un nom'; return; }
    if(!MP.token){ $('mpSaveErr').textContent = 'Non authentifié'; return; }
    $('mpSaveErr').textContent = '';
    MP.ws.send(JSON.stringify({ type:'save_game', token:MP.token, name, state:serializeState() }));
  };
  $('mpSaveName').addEventListener('keydown', e=>{ if(e.key==='Enter') $('mpBtnSave').click(); });

  $('mpBtnNewWorld').onclick = ()=>{
    if(!mpHasAdminRights()){ $('mpWorldErr').textContent = 'Réservé à l’hôte/admin'; return; }
    if(!confirm('Créer une nouvelle carte ? La partie en cours sera remplacée pour tous les joueurs.')) return;
    const config = normalizeWorldConfig({
      size: $('mpWorldSize').value,
      maxPlayers: $('mpMaxPlayers').value,
      resources: {
        tree: $('mpResTree').value,
        iron: $('mpResIron').value,
        coal: $('mpResCoal').value,
      },
    });
    genWorld(config);
    MP.ws.send(JSON.stringify({ type:'new_world', config, state:serializeState() }));
    $('mpWorldErr').textContent = '';
  };

  $('mpBtnSend').onclick = mpSendChat;
  $('mpChatIn').addEventListener('keydown', e=>{ if(e.key==='Enter') mpSendChat(); });
}

function mpTogglePanel(){
  const p = $('mpPanel');
  p.style.display = p.style.display==='block' ? 'none' : 'block';
  if(p.style.display === 'block') mpSyncWorldInputs();
}

function mpUpdateUI(){
  const conn = $('mpBtnConn'), disc = $('mpBtnDisc'), st = $('mpStatus');
  if(!conn) return;

  if(MP.connected){
    conn.style.display  = 'none';
    disc.style.display  = '';
    $('mpAuthBlock').style.display = MP.username ? 'none' : '';
    $('mpAccountBlock').style.display = MP.username ? '' : 'none';
    $('mpSaveBlock').style.display = MP.username ? '' : 'none';
    $('mpNewBlock').style.display = mpHasAdminRights() ? '' : 'none';
    $('mpBtnSave').disabled = !mpHasAdminRights();
    $('mpSaveLock').textContent = mpHasAdminRights() ? '' : '(hôte/admin)';
    if(MP.username){
      st.textContent = (MP.role==='host'?'👑 ':MP.isAdmin?'🛡️ ':'👥 ')+MP.username;
      st.style.color = MP.myColor;
      $('mpAccountName').textContent = 'Compte: ' + MP.username;
    } else {
      st.textContent = (MP.role==='host'?'👑 Hôte':MP.isAdmin?'🛡️ Admin':'👥 Invité')+' · non identifié';
      st.style.color = '#8fa3bf';
    }
  } else {
    conn.style.display = '';
    disc.style.display = 'none';
    $('mpAuthBlock').style.display = 'none';
    $('mpAccountBlock').style.display = 'none';
    $('mpSaveBlock').style.display = 'none';
    $('mpNewBlock').style.display = 'none';
    st.textContent = 'Non connecté';
    st.style.color = '#8fa3bf';
  }
  mpSyncWorldInputs();
  mpRenderNewCollapse();
}

function mpRenderNewCollapse(){
  const body = $('mpNewContent'), chev = $('mpNewChevron');
  if(!body || !chev) return;
  body.style.display = mpNewCollapsed ? 'none' : '';
  chev.textContent = mpNewCollapsed ? '▸' : '▾';
}

function mpSyncWorldInputs(){
  if(!$('mpWorldSize')) return;
  $('mpWorldSize').value = WORLD.size;
  $('mpMaxPlayers').value = WORLD.maxPlayers;
  $('mpResTree').value = WORLD.resources.tree;
  $('mpResIron').value = WORLD.resources.iron;
  $('mpResCoal').value = WORLD.resources.coal;
}

function mpShowAuthError(msg){
  const el = $('mpAuthErr');
  if(el) el.textContent = msg;
}

function mpRenderPlayerList(){
  const el = $('mpPlayers');
  if(!el) return;
  el.innerHTML = MP.players.map(p=>
    '<div style="display:flex;align-items:center;gap:6px;margin:2px 0">'
    + '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:'+p.color+'"></span>'
    + '<span style="color:'+p.color+';flex:1">'+(p.isHost?'👑 ':p.isAdmin?'🛡️ ':'')
    + escHtml(p.name) + (p.username ? ' <span style="color:#8fa3bf;font-size:10px">('+escHtml(p.username)+')</span>' : '')
    + '</span>'
    + (mpHasAdminRights() && !p.isHost && !p.isAdmin && p.id !== MP.myId
      ? '<button class="tbtn" style="padding:1px 6px;font-size:11px" data-promote="'+p.id+'">Admin</button>' : '')
    + '</div>'
  ).join('');
  el.querySelectorAll('[data-promote]').forEach(btn=>{
    btn.onclick = ()=>{
      MP.ws.send(JSON.stringify({ type:'promote_admin', playerId:+btn.dataset.promote }));
    };
  });
}

function mpRenderSaves(){
  const el = $('mpSaveList');
  if(!el) return;
  if(!MP.saves.length){
    el.innerHTML = '<div style="color:#8fa3bf;font-size:11px;font-style:italic">Aucune sauvegarde</div>';
    return;
  }
  el.innerHTML = MP.saves.map(s=>{
    const d = new Date(s.date);
    const dateStr = d.toLocaleDateString('fr-FR')+' '+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    return '<div style="display:flex;align-items:center;gap:4px;margin:2px 0;padding:3px 4px;'+
           'background:#1d2939;border-radius:5px">'
      + '<span style="flex:1;font-size:12px">📄 '+escHtml(s.name)+'</span>'
      + '<span style="color:#8fa3bf;font-size:10px;white-space:nowrap">'+escHtml(dateStr)+'</span>'
      + '<button class="tbtn" style="padding:1px 6px;font-size:11px" title="Écraser cette sauvegarde" data-overwrite="'+escHtml(s.name)+'"'
      + (mpHasAdminRights() ? '' : ' disabled') + '>💾</button>'
      + '<button class="tbtn" style="padding:1px 6px;font-size:11px" data-load="'+escHtml(s.name)+'"'
      + (mpHasAdminRights() ? '' : ' disabled') + '>▶</button>'
      + '<button class="tbtn" style="padding:1px 6px;font-size:11px;color:#ff9a8a" data-del="'+escHtml(s.name)+'"'
      + (mpHasAdminRights() ? '' : ' disabled') + '>✕</button>'
      + '</div>';
  }).join('');

  el.querySelectorAll('[data-overwrite]').forEach(btn=>{
    btn.onclick = ()=>{
      if(!mpHasAdminRights()) return;
      const name = btn.dataset.overwrite;
      if(!confirm('Écraser la sauvegarde "'+name+'" avec la partie en cours ?')) return;
      MP.ws.send(JSON.stringify({ type:'save_game', token:MP.token, name, state:serializeState() }));
    };
  });

  el.querySelectorAll('[data-load]').forEach(btn=>{
    btn.onclick = ()=>{
      if(!mpHasAdminRights()) return;
      if(!confirm('Charger "'+btn.dataset.load+'" ? La partie en cours sera remplacée pour tous les joueurs.')) return;
      MP.ws.send(JSON.stringify({ type:'load_game', token:MP.token, name:btn.dataset.load }));
    };
  });
  el.querySelectorAll('[data-del]').forEach(btn=>{
    btn.onclick = ()=>{
      if(!mpHasAdminRights()) return;
      if(!confirm('Supprimer "'+btn.dataset.del+'" ?')) return;
      MP.ws.send(JSON.stringify({ type:'delete_save', token:MP.token, name:btn.dataset.del }));
    };
  });
}

function mpRenderChat(){
  const el = $('mpChatBox');
  if(!el) return;
  el.innerHTML = MP.chat.map(m=>
    '<div><span style="color:'+m.col+'">'+escHtml(m.name)+'</span>: '+escHtml(m.text)+'</div>'
  ).join('');
  el.scrollTop = el.scrollHeight;
}

function mpSendChat(){
  const inp = $('mpChatIn');
  const text = inp.value.trim();
  if(!text || !MP.connected) return;
  MP.ws.send(JSON.stringify({ type:'chat', text }));
  inp.value = '';
}

function escHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

mpInjectUI();
