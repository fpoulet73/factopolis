const COLORS = ['#e25e4c','#4ca3e2','#58c470','#e2a93f','#b06fd8','#f0a040','#40d0c0','#e0e0e0'];

// ---------- état ----------
let terrain, road, bgrid, buildings, trucks, walkers, homeless, floats;
let vehicles = [];        // véhicules persistants
let vehicleRouteMode = null; // { vehicle, step:'source'|'dest' } ou null
let selectedVehicle = null;  // véhicule sélectionné
let nextVehicleId = 0;
let towns = [];           // villages / villes
let nextTownId = 0;
let selectedTownId = null;
let townLabelHits = [];
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
let dispatchTimer = 0, taxTimer = 0, mergeTimer = 0, upkeepTimer = 0, busStopTimer = 0;
let autoSaveTimer = AUTO_SAVE_INTERVAL; // décompte en secondes (temps réel)
const FIN_ZERO = ()=> ({ ventes:0, taxes:0, rembours:0, construction:0, entretien:0, expansion:0 });
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
    hideColorMarkers: saved.hideColorMarkers ?? false,
    graphicPack: GRAPHIC_PACKS[saved.graphicPack] || /^asset:/.test(saved.graphicPack || '') ? saved.graphicPack : 'classic',
  };
})();
function saveUIOptions(){ localStorage.setItem('factopolis_ui_options', JSON.stringify(UI_OPTIONS)); }
const ZOOM_MAX = 2.4;
const ZOOM_WHEEL_SENS = 0.0022;
const CAM_SMOOTH = 18;
let zoomActiveUntil = 0;
let drawFast = false;

// ---------- wallets (économie par joueur) ----------
let WALLETS = {};
const walletOf  = oid => {
  const k = oid ?? MP.myId ?? 0;
  if(!WALLETS[k]) WALLETS[k] = { money:2500, fin:FIN_ZERO(), finHist:[], finTimer:0, mi:0, eff:1, homelessSeeded:false, starterHomes:0 };
  if(WALLETS[k].starterHomes == null) WALLETS[k].starterHomes = 0;
  if(WALLETS[k].starterHomesGranted == null) WALLETS[k].starterHomesGranted = WALLETS[k].starterHomes || 0;
  return WALLETS[k];
};
const myWallet  = () => walletOf(MP.myId);
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
  resources: { tree: 8, wheat: 4, cotton: 1, iron: 2, coal: 2 },
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
      wheat: clampNum(r.wheat, 0, 40, WORLD_DEFAULTS.resources.wheat),
      cotton: clampNum(r.cotton, 0, 40, WORLD_DEFAULTS.resources.cotton),
      iron: clampNum(r.iron, 0, 40, WORLD_DEFAULTS.resources.iron),
      coal: clampNum(r.coal, 0, 40, WORLD_DEFAULTS.resources.coal),
    },
  };
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
  const N_PLAY = WORLD.size;
  const N_FULL_MAP = N_PLAY + 2 * EXP_MARGIN;
  setMapSize(N_FULL_MAP);
  terrain = new Uint8Array(N*N);
  road = new Uint8Array(N*N);
  bgrid = new Array(N*N).fill(null);
  buildings = []; trucks = []; walkers = []; homeless = []; floats = [];
  vehicles = []; vehicleRouteMode = null; selectedVehicle = null; nextVehicleId = 0;
  towns = []; nextTownId = 0; selectedTownId = null; townLabelHits = [];
  WALLETS = {}; gtime = 0;
  selected = null; dispatchTimer = 0; taxTimer = 0; mergeTimer = 0; upkeepTimer = 0; busStopTimer = 0;
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
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    if(inPlay(x,y)) continue;
    const h=0.55*n1(x,y)+0.30*n2(x,y)+0.15*n3(x,y);
    terrain[y*N+x]=h<0.40?T.WATER:T.GRASS;
  }
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

function townReachableJobs(townId){
  const homes = townHomes(townId);
  const seen = new Set();
  let total = 0;
  for(const home of homes){
    const radius = workRadiusOf(home);
    for(const job of buildings){
      if(job.dead || job.paused || !ownedBy(job, home.owner)) continue;
      const req = workersRequiredOf(job);
      if(req <= 0 || seen.has(job)) continue;
      if(buildingDistance(home, job) <= radius){
        seen.add(job);
        total += req;
      }
    }
  }
  return total;
}

function townAllocatedWorkers(townId){
  return buildings.reduce((s,b)=>s+((b.workersByTown && b.workersByTown[townId]) || 0), 0);
}

function refreshWorkerAllocation(){
  for(const b of buildings){ b.workersAssigned = 0; b.workersByTown = {}; }
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
  for(const k in WALLETS){
    const oid = +k;
    const req = jobsTotal(oid);
    const assigned = buildings.filter(b=>ownedBy(b,oid)).reduce((s,b)=>s+workersAllocatedOf(b),0);
    WALLETS[k].eff = req > 0 ? Math.min(1, assigned / req) : 1;
  }
}
