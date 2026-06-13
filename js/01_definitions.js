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
const T = { GRASS:0, WATER:1, TREE:2, IRON:3, COAL:4, WHEAT:5 };
const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
const OUTCAP = 12;       // stock max de sortie par ressource
const INCAP = 12;        // stock max d'entrée par ressource
const TRUCK_LOAD  = CFG.camions?.capacite ?? 6; // cargaison max d'un camion
const TRUCK_SPEED = CFG.camions?.vitesse ?? 3.4;// tuiles / seconde
const WALK_SPEED  = CFG.habitants?.vitesseMarche ?? 1.3; // piétons, tuiles / seconde
const STARVE_DELAY = CFG.penurie?.delai ?? 30; // secondes sans outils avant dégradation
const BONUS_GROWTH_THRESHOLD = CFG.habitants?.croissanceBonus?.seuilStock ?? 0.5;
const BONUS_GROWTH_INTERVAL  = CFG.habitants?.croissanceBonus?.intervalle  ?? 30;
const WALKER_COLS = ['#e2574c','#4ca3e2','#58c470','#e2a93f','#b06fd8','#ececec'];
const AUTO_SAVE_INTERVAL = 300; // secondes (5 minutes)
const AUTO_SAVE_MAX      = 5;   // nombre d'emplacements conservés
const AUTO_SAVE_KEY      = 'factopolis_autosaves';
const TOWN_RADIUS        = 20;  // cases — rayon d'appartenance à un village
const EXP_DEPTH  = 16;   // profondeur d'une tranche d'expansion (tuiles)
const EXP_MARGIN = 48;   // marge pré-générée de chaque côté (max 3 expansions / bord)

// ---------- véhicules persistants ----------
const VEHICLE_TYPES = (()=>{
  const cfgV = CFG.logistique?.vehicules || {};
  const COLOR_MAP = { minerai:'#c0763a', bois:'#5e7a3a', ble:'#d7b348', farine:'#eadfa8', citerne:'#64b7e8', pain:'#d99a45', acier:'#7a8fa0', marchandises:'#e6c84f' };
  const DEFS = {
    minerai:     { nom:'Camion minerai',     icone:'🚛', resources:['iron','coal'], cost:800,  capacite:15, speed:4.0 },
    bois:        { nom:'Camion bois',         icone:'🚜', resources:['wood'],        cost:600,  capacite:15, speed:4.0 },
    ble:         { nom:'Camion blé',          icone:'🚜', resources:['wheat'],       cost:550,  capacite:15, speed:4.0 },
    farine:      { nom:'Camion farine',       icone:'🚚', resources:['flour'],       cost:650,  capacite:15, speed:3.8 },
    citerne:     { nom:'Camion citerne',      icone:'🚛', resources:['water'],       cost:750,  capacite:20, speed:3.5 },
    pain:        { nom:'Camion pain',         icone:'🚚', resources:['bread'],       cost:700,  capacite:15, speed:3.8 },
    acier:       { nom:'Camion acier',        icone:'🚚', resources:['steel'],       cost:1000, capacite:12, speed:3.5 },
    marchandises:{ nom:'Camion outils',        icone:'🚐', resources:['goods'],       cost:700,  capacite:12, speed:3.5 },
  };
  const out = {};
  for(const k in DEFS){
    const d = DEFS[k], c = cfgV[k] || {};
    out[k] = {
      nom:      c.nom       ?? d.nom,
      icone:    c.icone     ?? d.icone,
      resources: c.ressources ?? d.resources,
      cost:     c.cout      ?? d.cost,
      capacite: c.capacite  ?? d.capacite,
      speed:    c.vitesse   ?? d.speed,
      color:    COLOR_MAP[k],
    };
  }
  return out;
})();
const GARAGE_COST = CFG.logistique?.garage?.cout ?? 1200;

const RES = {
  iron:  { n:'Fer',          c:'#d98a4f' },
  coal:  { n:'Charbon',      c:'#454552' },
  wood:  { n:'Bois',         c:'#a4713d' },
  wheat: { n:'Blé',          c:'#d7b348' },
  flour: { n:'Farine',       c:'#eadfa8' },
  water: { n:'Eau',          c:'#64b7e8' },
  bread: { n:'Pain',         c:'#d99a45' },
  steel: { n:'Acier',        c:'#a8bdd2' },
  goods: { n:'Outils de construction', c:'#e6c84f' },
};

// Prix de vente inter-joueurs (par unité)
const TRADE_PRICES = (()=>{
  const cfg = CFG.commerce?.prix || {};
  return {
    iron:  cfg.fer          ?? 8,
    coal:  cfg.charbon      ?? 6,
    wood:  cfg.bois         ?? 5,
    wheat: cfg.ble          ?? 4,
    flour: cfg.farine       ?? 7,
    water: cfg.eau          ?? 2,
    bread: cfg.pain         ?? 12,
    steel: cfg.acier        ?? 14,
    goods: cfg.marchandises ?? 10,
  };
})();

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
  farm:    { n:'Ferme',     ic:'🌾', hk:'5', cost: CFG.production?.ferme?.cout    ?? 300,
             workers:2, time:3.0, col:'#9b8a3d', hgt:12, ind:true,
             upkeep: CFG.production?.ferme?.entretien ?? 1.2,
             recipe:{ in:{}, out:{wheat:1} },
             desc:"À placer à 2 cases ou moins d'un champ de blé. Produit du blé." },
  pump:    { n:'Pompe',     ic:'💧', hk:'9', cost: CFG.production?.pompe?.cout    ?? 500,
             workers:1, time:2.5, col:'#4f86a8', hgt:14, ind:true,
             upkeep: CFG.production?.pompe?.entretien ?? 1.5,
             recipe:{ in:{}, out:{water:1} },
             desc:"À placer sur l'herbe au bord de l'eau. Produit de l'eau." },
  mill:    { n:'Moulin',    ic:'⚙️', hk:'', cost: CFG.production?.moulin?.cout   ?? 650,
             workers:3, time:3.2, col:'#b9a77a', hgt:24, ind:true,
             upkeep: CFG.production?.moulin?.entretien ?? 2,
             recipe:{ in:{wheat:1}, out:{flour:1} },
             desc:'Blé → farine.' },
  bakery:  { n:'Boulangerie', ic:'🥖', hk:'', cost: CFG.production?.boulangerie?.cout ?? 950,
             workers:4, time:3.5, col:'#c18149', hgt:24, ind:true,
             upkeep: CFG.production?.boulangerie?.entretien ?? 2.5,
             recipe:{ in:{flour:1, water:1}, out:{bread:1} },
             desc:'Farine + eau → pain. Nécessite une citerne proche pour recevoir l’eau.' },
  smelter: { n:'Fonderie',  ic:'🔥', hk:'6', cost: CFG.production?.fonderie?.cout ?? 900,
             workers:4, time:3.5, col:'#8a4f3d', hgt:26, ind:true,
             upkeep: CFG.production?.fonderie?.entretien ?? 3,
             recipe:{ in:{iron:1, coal:1}, out:{steel:1} },
             desc:'Fer + charbon → acier.' },
  factory: { n:'Usine',     ic:'🏭', hk:'7', cost: CFG.production?.usine?.cout    ?? 1400,
             workers:5, time:4, col:'#5a6a86', hgt:30, ind:true,
             upkeep: CFG.production?.usine?.entretien    ?? 4,
             recipe:{ in:{steel:1, wood:1}, out:{goods:1} },
             desc:'Acier + bois → outils de construction.' },
  plant:   { n:'Usine',     ic:'🏚️', hk:'5', cost: 0, col:'#4e5663', hgt:18,
             desc:"Usine abandonnée. À convertir ensuite en aciérie, ferme, moulin, boulangerie ou usine d'outils." },
  house:   { n:'Maison',    ic:'🏠', hk:'6', cost: CFG.batiments?.maison?.cout    ?? 100,
             col:'#9a7e5f', hgt:18, desc:'' },
  depot:   { n:'Entrepôt',        ic:'📦', hk:'7', cost: CFG.batiments?.entrepot?.cout  ?? 400,
             col:'#7a7048', hgt:22,
             desc:'Stocke et redistribue. Cliquer dessus pour choisir les ressources acceptées.' },
  tank:    { n:'Entrepôt citerne', ic:'🛢️', hk:'8', cost: CFG.batiments?.citerne?.cout ?? 450,
             col:'#3f6f8f', hgt:18,
             desc:'Stocke uniquement l’eau. À placer près des boulangeries.' },
  garage:  { n:'Dépôt véhicules', ic:'🏪', hk:'0', cost: GARAGE_COST, col:'#3d4f6b', hgt:20,
             desc:'Achète et gère des véhicules de transport spécialisés.' },
  bulldoze: { n:'Démolir',    ic:'🧨', hk:'B', desc:'Détruit routes, bâtiments (30 % remboursés) et arbres.' },
  terraform:{ n:'Bulldozer',  ic:'🚜', hk:'-', desc:'Rase les gisements (fer/charbon), les champs et les sapins en herbe.' },
};

const PLANT_UPGRADES = {
  smelter: { label:'Aciérie',       type:'smelter', icon:'🔥' },
  farm:    { label:'Ferme',         type:'farm',    icon:'🌾' },
  mill:    { label:'Moulin',        type:'mill',    icon:'⚙️' },
  bakery:  { label:'Boulangerie',   type:'bakery',  icon:'🥖' },
  factory: { label:'Outils de construction', type:'factory', icon:'🏭' },
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
      BUILD.house.desc = 'Consomme outils de construction (+ pain si disponible) → +1 habitant et +'+L.resid.income
        +' $ par habitant. Pain requis pour monter en niveau.';
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
const IND_RADIUS_BASE   = CFG.industrie?.rayonBase    ?? 6;
const IND_RADIUS_FACTOR = CFG.industrie?.rayonFacteur ?? 4;
const indRadiusOf = b => Math.round(IND_RADIUS_BASE + Math.sqrt(b.w * b.h) * IND_RADIUS_FACTOR);
const upkeepOf = b => (BUILD[b.type].upkeep||0) * b.w*b.h * indFactor(b.w*b.h)
                      * (b.paused ? PAUSE_UPKEEP : 1);

// ---------- système de villes / villages ----------
const TOWN_P1     = ['Beau','Grand','Mont','Val','Haut','Bois','Clair','Fort','Pierre','Roche',
                     'Belle','Fleury','Vic','Bar','Vau','Isle','Pont','Char','Mar','Bray'];
const TOWN_P2     = ['ville','bourg','mont','court','val','lac','ay','ac','ieu','ois','en',
                     'tot','eux','eau','ef','ais'];
const TOWN_SAINTS = ['Pierre','Paul','Jean','Louis','Martin','Nicolas','Étienne','Michel',
                     'Georges','André','Luc','Marc','Rémi','Denis','Julien'];
const TOWN_LA     = ['Rochelle','Forêt','Plaine','Croix','Chapelle','Ferté','Tour','Motte'];
const TOWN_LE     = ['Bourg','Moulin','Château','Hameau','Plessis','Mesnil'];

function generateTownName(seedX, seedY){
  // Hash déterministe basé sur la position (cohérence multijoueur)
  let s = (Math.imul(seedX, 73856093) ^ Math.imul(seedY, 19349663)) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
  const r = n => { s = (Math.imul(s ^ (s >>> 13), 0x9e3779b9 + s)) >>> 0; return s % n; };
  const type = r(5);
  if(type === 0) return 'Saint-' + TOWN_SAINTS[r(TOWN_SAINTS.length)];
  if(type === 1) return 'La '    + TOWN_LA[r(TOWN_LA.length)];
  if(type === 2) return 'Le '    + TOWN_LE[r(TOWN_LE.length)];
  return TOWN_P1[r(TOWN_P1.length)] + TOWN_P2[r(TOWN_P2.length)];
}

function assignBuildingToTown(b, silent = false){
  if(!BUILD[b.type]?.resid) return;
  const bx = b.x + b.w/2, by = b.y + b.h/2;
  let nearest = null, nearestDist = Infinity;
  for(const t of towns){
    const d = Math.hypot(bx - t.cx, by - t.cy);
    if(d < nearestDist){ nearestDist = d; nearest = t; }
  }
  if(nearest && nearestDist <= TOWN_RADIUS){
    b.townId = nearest.id;
  } else {
    const name = generateTownName(Math.round(bx), Math.round(by));
    const t = { id: nextTownId++, name, cx: bx, cy: by };
    towns.push(t);
    b.townId = t.id;
    if(selectedTownId == null && ownedBy(b, myOwner())) selectedTownId = t.id;
    if(!silent) toast('🏘️ Nouveau village : ' + name, 'win');
  }
}

// ---------- noms d'industrie par village ----------
const IND_NAMES = {
  mine:    ['Mine de Fer','Puits Noir','Mine Profonde','Mine Royale','Vieux Puits','Mine du Nord','Carrière Centrale','Mine de l\'Ouest','Mine des Anciens','Mine du Pic'],
  lumber:  ['Scierie du Bois','Bûcherie Verte','Scierie des Pins','Grand Moulin','Scierie Royale','Scierie du Moulin','Bûcherie Centrale','Scierie du Nord','Vieille Scierie','Bûcherie des Chênes'],
  farm:    ['Ferme des Blés','Domaine Doré','Ferme du Moulin','Grange Centrale','Ferme de la Plaine','Domaine des Épis','Ferme du Nord','Métairie Royale','Champ Fleuri','Ferme des Moissons'],
  pump:    ['Pompe du Lac','Station des Rives','Pompe Centrale','Station Bleue','Pompe du Canal','Pompe des Berges','Station du Nord','Pompe Royale','Station Claire','Pompe de la Source'],
  mill:    ['Moulin des Blés','Moulin Blanc','Moulin du Pont','Grand Moulin','Moulin de la Plaine','Moulin des Épis','Moulin du Nord','Moulin Royal','Moulin de la Vallée','Vieux Moulin'],
  bakery:  ['Boulangerie Centrale','Four des Blés','Boulangerie du Pont','Pain Doré','Boulangerie Royale','Fournil du Nord','Maison du Pain','Boulangerie des Épis','Grand Fournil','Pain de la Vallée'],
  smelter: ['Grande Forge','Fonderie du Feu','Forge Ardente','Forge du Roi','Fonderie Centrale','Vieille Forge','Forge des Maîtres','Fonderie du Nord','Forge Royale','Forge de la Vallée'],
  factory: ['Manufacture Centrale','Atelier du Peuple','Grande Usine','Fabrique Royale','Usine Municipale','Atelier des Arts','Grande Fabrique','Usine Centrale','Fabrique du Nord','Manufacture Royale'],
};
const IND_AREA_RADIUS = 30; // rayon de déduplication des noms

function assignIndustryName(b){
  if(!BUILD[b.type]?.ind) return;
  const names = IND_NAMES[b.type];
  if(!names || b.name) return;
  const bx = b.x + (b.w||1)/2, by = b.y + (b.h||1)/2;
  // Noms déjà utilisés par des industries du même type dans le même secteur
  const used = new Set(
    buildings
      .filter(o => !o.dead && o.type === b.type && o.name)
      .filter(o => Math.hypot((o.x+(o.w||1)/2) - bx, (o.y+(o.h||1)/2) - by) <= IND_AREA_RADIUS)
      .map(o => o.name)
  );
  const pick = names.find(n => !used.has(n));
  b.name = pick || (names[0] + ' ' + (used.size + 1));
}

function getTownOf(b){
  if(b.townId != null) return towns.find(t => t.id === b.townId) || null;
  const bx = b.x + b.w/2, by = b.y + b.h/2;
  let nearest = null, nearestDist = Infinity;
  for(const t of towns){
    const d = Math.hypot(bx - t.cx, by - t.cy);
    if(d < nearestDist){ nearestDist = d; nearest = t; }
  }
  return nearest && nearestDist <= TOWN_RADIUS ? nearest : null;
}

function townCenterOf(t){
  // Centroïde des bâtiments résidentiels vivants de ce village
  let sx = 0, sy = 0, n = 0;
  for(const b of buildings){
    if(b.dead || b.townId !== t.id || !BUILD[b.type]?.resid) continue;
    sx += b.x + b.w/2; sy += b.y + b.h/2; n++;
  }
  return n > 0 ? [sx/n, sy/n] : [t.cx, t.cy];
}

function townPopulation(t){
  let pop = 0;
  for(const b of buildings){
    if(!b.dead && b.townId === t.id && BUILD[b.type]?.resid) pop += b.pop||0;
  }
  return pop;
}

// ---------- fusion entrepôt ----------
const DEPOT_STOCK_PER_CELL  = CFG.entrepot?.stockParCase ?? 20;
const DEPOT_RADIUS_BASE     = CFG.entrepot?.rayonBase    ?? 5;
const DEPOT_RADIUS_FACTOR   = CFG.entrepot?.rayonFacteur ?? 3;
const depotRadiusOf = b => Math.round(DEPOT_RADIUS_BASE + Math.sqrt(b.w * b.h) * DEPOT_RADIUS_FACTOR);
const TANK_STOCK_PER_CELL  = CFG.citerne?.stockParCase ?? 40;
const TANK_RADIUS_BASE     = CFG.citerne?.rayonBase    ?? 5;
const TANK_RADIUS_FACTOR   = CFG.citerne?.rayonFacteur ?? 3;
const BAKERY_TANK_RADIUS   = CFG.citerne?.rayonBoulangerie ?? 8;
const tankRadiusOf = b => Math.round(TANK_RADIUS_BASE + Math.sqrt(b.w * b.h) * TANK_RADIUS_FACTOR);
const isStorageHub = b => b && (b.type === 'depot' || b.type === 'tank');
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
  const map = { mine:'mine', bucheron:'lumber', ferme:'farm', pompe:'pump', moulin:'mill', boulangerie:'bakery', fonderie:'smelter', usine:'factory' };
  for(const fr in map) if(p[fr]?.entretien != null) BUILD[map[fr]].upkeep = p[fr].entretien;
})();

// surcharge des recettes et coûts par config.js (clés françaises)
(function applyProductionConfig(){
  const p = CFG.production || {};
  const map = { mine:'mine', bucheron:'lumber', ferme:'farm', pompe:'pump', moulin:'mill', boulangerie:'bakery', fonderie:'smelter', usine:'factory' };
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
  if(bats.citerne?.cout  != null) BUILD.tank.cost   = bats.citerne.cout;
})();

const TOOL_ORDER = ['select','road','mine','lumber','plant','house','depot','tank','pump','garage','bulldoze','terraform'];
const MILESTONES = [25, 50, 100, 200, 400];
