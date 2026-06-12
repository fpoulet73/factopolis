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
let gtime = 0, eff = 1; // eff = snapshot du wallet courant, gardé pour statusOf
let selected = null, tool = 'select';
let speed = 1, paused = false;
let dispatchTimer = 0, taxTimer = 0, mergeTimer = 0, upkeepTimer = 0;
let autoSaveTimer = AUTO_SAVE_INTERVAL; // décompte en secondes (temps réel)
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
  resources: { tree: 8, wheat: 4, iron: 2, coal: 2 },
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
  vehicles = []; vehicleRouteMode = null; selectedVehicle = null; nextVehicleId = 0;
  towns = []; nextTownId = 0; selectedTownId = null; townLabelHits = [];
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
  // champs et gisements en taches
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
  placePatch(T.WHEAT, patchCount(WORLD.resources.wheat));
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

function newBuilding(type,x,y,w,h){
  const d = BUILD[type];
  const b = { type, x, y, w:w||d.size||1, h:h||d.size||1,
              storage:{}, inc:{}, prog:0, trucksOut:0, dead:false, owner:null };
  if(type==='mine')  b.ore = terrain[y*N+x]===T.IRON ? 'iron' : 'coal';
  if(type==='depot'){
    b.allow = {}; b.sellTo = {}; b.sellMin = {};
    for(const k in RES){ b.allow[k] = k !== 'water'; b.sellTo[k] = false; b.sellMin[k] = 0; }
  }
  if(type==='tank'){
    b.allow = { water:true };
    b.sellTo = { water:false };
  }
  if(type==='garage') b.vehicles = [];
  if(d.ind) b.paused = false;
  if(d.resid){ b.pop = 0; b.protectedPop = 0; b.ct = 0; b.bonusCt = 0; b.pending = 0; b.pendingProtected = 0; b.starve = 0; }
  return b;
}

function markStarterHomeIfNeeded(b){
  if(!b || b.type !== 'house') return;
  const w = walletOf(b.owner);
  if((w.starterHomesGranted||0) >= 2) return;
  b.starterHome = true;
  b.starterSlots = 1; // 1 slot de départ par maison initiale
  b.protectedPop = b.protectedPop || 0;
  w.starterHomes = (w.starterHomes||0) + 1;
  w.starterHomesGranted = (w.starterHomesGranted||0) + 1;
}

function ensureStarterProtectionForOwner(owner){
  const starterBuildings = buildings.filter(b=>
    !b.dead && ownedBy(b, owner) && BUILD[b.type]?.resid && b.starterHome
  );
  for(const b of starterBuildings){
    if((b.pop||0) > 0 && (b.protectedPop||0) < 1) b.protectedPop = 1;
  }
}

function normalizeStarterProtectionForOwner(owner){
  const owned = buildings
    .filter(b=>!b.dead && ownedBy(b, owner) && BUILD[b.type]?.resid)
    .sort((a,b)=> (a.y-b.y) || (a.x-b.x));
  let remaining = 2;
  for(const b of owned){
    const slots = b.starterHome ? Math.max(1, b.starterSlots || (b.protectedPop||0) || 1) : 0;
    if(slots > 0 && remaining > 0){
      const keep = Math.min(slots, remaining);
      b.starterHome = true;
      b.starterSlots = keep;
      b.protectedPop = Math.min(Math.max(b.protectedPop||0, Math.min(keep, b.pop||0)), b.pop||0);
      remaining -= keep;
    } else {
      b.starterHome = false;
      b.starterSlots = 0;
      b.protectedPop = 0;
      b.pendingProtected = 0;
    }
  }
  const current = 2 - remaining;
  const w = walletOf(owner);
  w.starterHomes = current;
  w.starterHomesGranted = Math.max(w.starterHomesGranted||0, current);
}

function ensureAllStarterProtections(){
  const owners = new Set();
  for(const b of buildings) if(BUILD[b.type].resid) owners.add(b.owner ?? MP.myId);
  for(const h of homeless) owners.add(h.owner ?? MP.myId);
  if(MP.myId != null) owners.add(MP.myId);
  for(const o of owners){
    normalizeStarterProtectionForOwner(o);
    ensureStarterProtectionForOwner(o);
  }
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
  if(b.type==='tank') return res === 'water' ? TANK_STOCK_PER_CELL * b.w * b.h : 0;
  if(b.type==='depot') return DEPOT_STOCK_PER_CELL * b.w * b.h;
  const r = recipeOf(b);
  // les stocks des bâtiments industriels fusionnés grandissent avec leur taille
  return ((r && res in r.out) ? OUTCAP : INCAP) * (BUILD[b.type].ind ? b.w*b.h : 1);
}

function accepts(b,res){
  if(b.paused) return false; // un site en pause ne reçoit plus de livraisons
  if(res === 'water'){
    if(b.type === 'tank') return true;
    if(b.type === 'bakery') return tankNear(b);
    return false;
  }
  if(b.type==='tank') return false;
  if(b.type==='depot') return b.allow?.[res] !== false;
  if(BUILD[b.type].resid){
    if(res !== 'goods' && res !== 'bread') return false;
    if(b.starterHome) return false; // maisons protégées : pas besoin de ravitaillement
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

function fieldNear(x,y,r){
  for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
    const a = x+dx, c = y+dy;
    if(inMap(a,c) && terrain[c*N+a]===T.WHEAT) return true;
  }
  return false;
}

function waterNear(x,y,r){
  for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
    const a = x+dx, c = y+dy;
    if(inMap(a,c) && terrain[c*N+a]===T.WATER) return true;
  }
  return false;
}

function tankNear(b){
  const center = centerOfBuilding(b);
  return buildings.some(o => {
    if(o.dead || o.type !== 'tank') return false;
    if(!ownedBy(o, b.owner)) return false;
    const oc = centerOfBuilding(o);
    return Math.max(Math.abs(oc.x - center.x), Math.abs(oc.y - center.y)) <= BAKERY_TANK_RADIUS;
  });
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
  const key = owner ?? MP.myId;
  const w = walletOf(key);
  if(w.homelessSeeded) return;
  const hasPresence =
    homeless.some(h=> (h.owner ?? MP.myId) === key)
    || walkers.some(wk=>wk.fromHomeless && wk.target && (wk.target.owner ?? MP.myId) === key)
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
    if(WALLETS[MP.myId ?? 0]) WALLETS[MP.myId ?? 0].homelessSeeded = true;
  }
}

function assignHomelessToHousing(owner){
  if(!homeless?.length) return;
  for(const h of homeless)
    if(h.owner === owner) h.col = playerColor(owner);
  const homes = buildings
    .filter(b=>!b.dead && BUILD[b.type].resid && ownedBy(b, owner))
    .sort((a,b)=> (b.starterHome?1:0)-(a.starterHome?1:0) || (a.y-b.y) || (a.x-b.x));
  for(const home of homes){
    const rc = BUILD[home.type].resid;
    while(home.pop + home.pending < rc.popCap){
      const idx = homeless.findIndex(h=> h.owner === owner);
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
  const townId = b.townId ?? null;
  const evicted = makeResidentsHomeless(b);
  b.dead = true;
  buildings.splice(buildings.indexOf(b),1);
  setGrid(b,null);
  if(selected===b) selected = null;
  // retirer les véhicules du garage démoli
  if(b.type === 'garage' && b.vehicles){
    vehicles = vehicles.filter(v => v.garageRef !== b);
    if(vehicleRouteMode && vehicleRouteMode.vehicle.garageRef === b) vehicleRouteMode = null;
  }
  // supprimer la ville si tous ses bâtiments résidentiels sont détruits
  if(BUILD[b.type]?.resid && townId != null){
    const stillHasHouses = buildings.some(bl => !bl.dead && bl.townId === townId && BUILD[bl.type]?.resid);
    if(!stillHasHouses) towns = towns.filter(t => t.id !== townId);
  }
  const refund = Math.floor((BUILD[b.type].cost||0)*0.3);
  earnMoney(refund, 'rembours', walletOf(refundOwner ?? owner));
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

function plantUpgradeError(b, targetType){
  if(!b || b.dead || b.type !== 'plant') return 'Usine déjà spécialisée';
  if(!PLANT_UPGRADES[targetType]) return 'Type d\'usine invalide';
  if(targetType === 'farm' && !fieldNear(b.x, b.y, 2))
    return 'Aucun champ de blé à moins de 2 cases';
  return '';
}

function applyPlantUpgrade(b, targetType){
  const err = plantUpgradeError(b, targetType);
  if(err) return err;
  b.type = targetType;
  b.storage = {};
  b.inc = {};
  b.prog = 0;
  b.trucksOut = 0;
  b.paused = false;
  b.name = null;
  assignIndustryName(b);
  return '';
}

// ---------- construction ----------

// état multijoueur — déclaré ici car utilisé dans canPlace, clickAt et drawBuilding
const MP = {
  ws: null, myId: null, myColor: '#ffffff', myName: 'Moi',
  role: null, isAdmin: false, players: [], cursors: {}, chat: [], connected: false,
  username: null, token: null, saves: [],
  shutdownNotice: false,
  shutdownMessage: '',
};

const mpHasAdminRights = () => MP.connected && (MP.role === 'host' || MP.isAdmin);

const MP_ZONE = 20; // distance minimale entre bâtiments de joueurs différents

// Retourne l'id du joueur adverse le plus proche ayant un bâtiment à moins de MP_ZONE cases,
// ou null si la pose est libre.
function nearbyEnemyOwner(myId, cx, cy){
  if(!myId) return null; // solo : pas de restriction
  // Seuls les joueurs actuellement connectés comptent — évite les faux positifs
  // liés aux bâtiments créés par le joueur lui-même dans une session précédente
  // (où son ID de session était différent).
  const enemyIds = new Set(MP.players.filter(p => p.id !== myId).map(p => p.id));
  for(const b of buildings){
    if(!b.owner || b.owner === myId) continue;
    if(!enemyIds.has(b.owner)) continue; // ID orphelin → traiter comme neutre
    // distance Chebyshev (max des axes) entre centres — simple et rapide
    const bcx = b.x + (b.w-1)/2, bcy = b.y + (b.h-1)/2;
    if(Math.abs(cx - bcx) <= MP_ZONE && Math.abs(cy - bcy) <= MP_ZONE) return b.owner;
  }
  return null;
}

function canPlace(t,x,y){
  if(!inMap(x,y)) return { ok:false };
  const i = y*N+x, ter = terrain[i];
  if(t==='bulldoze') return { ok: !!(road[i] || bgrid[i] || ter===T.TREE || ter===T.WHEAT) };
  if(t==='terraform') return { ok: !bgrid[i] && (ter===T.TREE || ter===T.WHEAT || ter===T.IRON || ter===T.COAL) };
  if(road[i] || bgrid[i]) return { ok:false, msg:'Case occupée' };
  if(ter===T.WATER) return { ok:false, msg:"Impossible de construire sur l'eau" };
  if(t==='road'){
    if(ter!==T.GRASS) return { ok:false, msg:"Les routes se posent sur l'herbe (démolis les arbres ou champs)" };
    return { ok:true };
  }
  if(t==='mine'){
    if(ter!==T.IRON && ter!==T.COAL) return { ok:false, msg:'La mine doit être sur un gisement' };
  } else {
    if(ter!==T.GRASS) return { ok:false, msg:'Terrain non constructible' };
    if(t==='lumber' && !treeNear(x,y,2)) return { ok:false, msg:"Aucun arbre à moins de 2 cases" };
    if(t==='farm' && !fieldNear(x,y,2)) return { ok:false, msg:"Aucun champ de blé à moins de 2 cases" };
    if(t==='pump' && !waterNear(x,y,1)) return { ok:false, msg:"La pompe doit être au bord de l'eau" };
  }
  // zone d'exclusion multijoueur
  if(MP.connected && nearbyEnemyOwner(MP.myId, x, y))
    return { ok:false, msg:"Trop proche d'un autre joueur (−"+MP_ZONE+' cases)' };
  return { ok:true };
}

function clickAt(x,y){
  if(!inMap(x,y)) return;
  const i = y*N+x;

  // Mode assignation de route véhicule (intercepte avant tout le reste)
  if(vehicleRouteMode && tool === 'select'){
    const b = bgrid[i];
    if(b && !b.dead){
      if(vehicleRouteMode.step === 'source'){
        const v = vehicleRouteMode.vehicle;
        const vt = VEHICLE_TYPES[v.vtype];
        const myOwner = MP.myId;
        // Dépôt d'un autre joueur : autorisé seulement si sellTo actif pour ce véhicule
        if(b.owner !== myOwner && b.owner != null){
          if(b.type !== 'depot') return;
          const hasSellRes = vt.resources.some(r => b.sellTo?.[r]);
          if(!hasSellRes){
            toast('⛔ Ce dépôt ne vend pas les ressources de ce véhicule.','err'); return;
          }
          vehicleRouteMode.vehicle.source = b;
          vehicleRouteMode.step = 'dest';
          toast('🛒 Source (achat) : dépôt de '+(MP.players.find(p=>p.id===b.owner)||{}).name+'. Clique sur ta destination.');
        } else {
          vehicleRouteMode.vehicle.source = b;
          vehicleRouteMode.step = 'dest';
          toast('Source définie : '+BUILD[b.type].n+'. Clique sur la destination.');
        }
      } else {
        const vRef = vehicleRouteMode.vehicle;
        vRef.dest = b;
        vehicleRouteMode = null;
        startVehicleRoute(vRef);
        toast('Route définie ! Le véhicule commence sa tournée.','win');
      }
    }
    return;
  }

  if(tool==='select'){
    // Détecter si on clique sur un véhicule en mouvement (priorité sur les bâtiments)
    if(!vehicleRouteMode){
      const clickWx = x * TILE + TILE/2, clickWy = y * TILE + TILE/2;
      for(const veh of vehicles){
        if(!veh.pts || !veh.pts.length) continue;
        const a = veh.pts[veh.seg], bp = veh.pts[Math.min(veh.seg+1, veh.pts.length-1)];
        const wx = a.x + (bp.x-a.x)*veh.t, wy = a.y + (bp.y-a.y)*veh.t;
        if(Math.hypot(wx - clickWx, wy - clickWy) < TILE * 1.5){
          selectedVehicle = veh;
          selected = null;
          return;
        }
      }
    }
    selectedVehicle = null;
    selected = bgrid[i];
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
    } else if(terrain[i]===T.TREE || terrain[i]===T.WHEAT){
      terrain[i] = T.GRASS;
    }
    return;
  }
  if(tool==='terraform'){
    const ter = terrain[i];
    if(bgrid[i]){ toast('⛔ Démolissez d\'abord le bâtiment','err'); return; }
    if(ter===T.TREE || ter===T.WHEAT || ter===T.IRON || ter===T.COAL){
      terrain[i] = T.GRASS;
      if(MP.connected) netSend({ type:'terraform', i });
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
  b.owner = MP.myId;
  markStarterHomeIfNeeded(b);
  assignBuildingToTown(b);
  assignIndustryName(b);
  buildings.push(b);
  bgrid[i] = b;
  selected = b;
  if(BUILD[b.type].resid) assignHomelessToHousing(b.owner);
}

// ---------- logistique (camions) ----------
function tryDispatch(b,res){
  const starts = adjRoadTiles(b);
  const senderHasRoad = starts.length > 0;
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
  // Les bâtiments non-industriels sans route ne peuvent pas dispatcher
  const senderIsDepot = isStorageHub(b);
  const senderIsInd   = !!BUILD[b.type]?.ind;
  if(!senderHasRoad && !senderIsInd) return false;
  let bestB = null, bestScore = Infinity, bestTile = -1;
  // rayon d'action de l'expéditeur
  const senderRadius  = senderIsDepot ? (b.type === 'tank' ? tankRadiusOf(b) : depotRadiusOf(b))
                      : senderIsInd   ? indRadiusOf(b)
                      : Infinity;
  const senderCenter = centerOfBuilding(b);
  for(const c of buildings){
    if(c===b || c.dead || !accepts(c,res) || space(c,res)<=0) continue;
    if(res === 'water' && b.type === 'pump' && c.type === 'bakery') continue;
    if(isStorageHub(b) && isStorageHub(c)) continue;
    // Liaisons directes sans limite de rayon (portée = réseau routier uniquement)
    const millToBakery = b.type === 'mill'  && res === 'flour' && c.type === 'bakery';
    const pumpToTank   = b.type === 'pump'  && res === 'water' && c.type === 'tank';
    const noRangeLimit = millToBakery || pumpToTank;
    // vérifier le rayon de l'expéditeur
    if(!noRangeLimit && senderRadius < Infinity){
      const d2 = Math.max(Math.abs(centerOfBuilding(c).x - senderCenter.x),
                          Math.abs(centerOfBuilding(c).y - senderCenter.y));
      if(d2 > senderRadius) continue;
    }
    // vérifier le rayon de la cible si c'est un entrepôt ou un bâtiment industriel
    if(!pumpToTank && isStorageHub(c)){
      const d2 = Math.max(Math.abs(centerOfBuilding(b).x - centerOfBuilding(c).x),
                          Math.abs(centerOfBuilding(b).y - centerOfBuilding(c).y));
      if(d2 > (c.type === 'tank' ? tankRadiusOf(c) : depotRadiusOf(c))) continue;
    }
    if(!noRangeLimit && BUILD[c.type]?.ind){
      const d2 = Math.max(Math.abs(centerOfBuilding(b).x - centerOfBuilding(c).x),
                          Math.abs(centerOfBuilding(b).y - centerOfBuilding(c).y));
      if(d2 > indRadiusOf(c)) continue;
    }
    let bd = Infinity, bt = -1;
    for(const t of adjRoadTiles(c))
      if(dist[t]>=0 && dist[t]<bd){ bd = dist[t]; bt = t; }
    // Livraison directe (sans route) pour ind→ind dans le rayon, ou pour les liaisons spéciales
    const targetIsInd = !!BUILD[c.type]?.ind;
    const directOk = noRangeLimit || (senderIsInd && targetIsInd);
    if(bt<0 && !directOk) continue;
    // l'entrepôt en dernier recours ; les logements déjà pleins après ceux qui grandissent
    const rcc = BUILD[c.type].resid;
    const full = !!rcc && c.pop >= rcc.popCap;
    // pour les ressources vers les logements : priorité au stock le plus bas des deux ressources vitales
    const stockRatio = rcc
      ? Math.min(
          ((c.storage.goods||0) + (c.inc.goods||0)) / (rcc.stockCap || 1),
          ((c.storage.bread||0) + (c.inc.bread||0)) / (rcc.stockCap || 1)
        )
      : 0;
    // distance réelle pour le score : route si disponible, sinon vol direct
    const distScore = bt >= 0 ? bd : Math.round(Math.hypot(
      centerOfBuilding(c).x - senderCenter.x,
      centerOfBuilding(c).y - senderCenter.y));
    const score = distScore + (isStorageHub(c) ? 500 : 0) + (full ? 200 : 0) + stockRatio * 150;
    if(score<bestScore){ bestScore = score; bestB = c; bestTile = bt; }
  }
  if(!bestB) return false;

  const amt = Math.min(TRUCK_LOAD, b.storage[res]);
  b.storage[res] -= amt;
  b.trucksOut++;
  bestB.inc[res] = (bestB.inc[res]||0) + amt;

  const C = i => ({ x:(i%N)*TILE+TILE/2, y:((i/N)|0)*TILE+TILE/2 });
  let pts;
  if(bestTile >= 0){
    // chemin routier
    const path = [];
    let t = bestTile;
    while(t!==-1){ path.push(t); t = prev[t]; }
    path.reverse();
    pts = [
      { x:(b.x+b.w/2)*TILE, y:(b.y+b.h/2)*TILE },
      ...path.map(C),
      { x:(bestB.x+bestB.w/2)*TILE, y:(bestB.y+bestB.h/2)*TILE },
    ];
  } else {
    // vol direct (pas de route vers la cible)
    pts = [
      { x:(b.x+b.w/2)*TILE, y:(b.y+b.h/2)*TILE },
      { x:(bestB.x+bestB.w/2)*TILE, y:(bestB.y+bestB.h/2)*TILE },
    ];
  }
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

// ---------- logistique (véhicules persistants) ----------
function findRoadPath(fromB, toB){
  const starts = adjRoadTiles(fromB);
  if(!starts.length) return null;
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
  let bestTile = -1, bestDist = Infinity;
  for(const t of adjRoadTiles(toB))
    if(dist[t]>=0 && dist[t]<bestDist){ bestDist = dist[t]; bestTile = t; }
  if(bestTile < 0) return null;
  const path = [];
  let t = bestTile;
  while(t !== -1){ path.push(t); t = prev[t]; }
  path.reverse();
  const C = idx => ({ x:(idx%N)*TILE+TILE/2, y:((idx/N)|0)*TILE+TILE/2 });
  return [
    { x:(fromB.x+fromB.w/2)*TILE, y:(fromB.y+fromB.h/2)*TILE },
    ...path.map(C),
    { x:(toB.x+toB.w/2)*TILE, y:(toB.y+toB.h/2)*TILE },
  ];
}

function startVehicleRoute(v){
  if(!v.source || !v.dest || v.source.dead || v.dest.dead){ v.state = 'idle'; return; }
  // Cache la route complète pour la visualisation (style Transport Tycoon)
  const fwd = findRoadPath(v.source, v.dest);
  const bwd = findRoadPath(v.dest, v.source);
  v.vizRoute = { fwd: fwd || [], bwd: bwd || [] };
  const pts = findRoadPath(v.garageRef, v.source);
  if(!pts){ v.waitTimer = 5; v.currentBuilding = v.garageRef; return; }
  v.state = 'to_source';
  v.pts = pts; v.seg = 0; v.t = 0;
  v.cargo = 0; v.res = null;
  v.currentBuilding = null;
}

function returnToGarage(v){
  if(v.state === 'idle' || v.state === 'returning') return;
  const from = v.currentBuilding || v.garageRef;
  v.source = null; v.dest = null;
  v.vizRoute = null;
  v.cargo = 0; v.res = null;
  const pts = findRoadPath(from, v.garageRef);
  if(pts){
    v.state = 'returning';
    v.pts = pts; v.seg = 0; v.t = 0;
  } else {
    v.state = 'idle'; v.pts = [];
  }
}

function updateVehicles(dt){
  for(const v of vehicles){
    if(v.state === 'idle') continue;
    if(v.state !== 'returning' && (!v.source || v.source.dead || !v.dest || v.dest.dead)){
      v.state = 'idle'; v.cargo = 0; v.res = null; v.pts = []; continue;
    }
    // Timer d'attente (chemin non trouvé)
    if(v.waitTimer > 0){
      v.waitTimer -= dt;
      if(v.waitTimer > 0) continue;
      const from = v.currentBuilding || v.garageRef;
      const to = v.state === 'to_source' ? v.source : v.dest;
      const pts = findRoadPath(from, to);
      if(!pts){ v.waitTimer = 5; continue; }
      v.pts = pts; v.seg = 0; v.t = 0;
      // fall through to movement
    }
    if(!v.pts || !v.pts.length){ v.waitTimer = 5; continue; }
    const vt = VEHICLE_TYPES[v.vtype];
    let move = vt.speed * TILE * dt;
    while(move > 0 && v.seg < v.pts.length-1){
      const a = v.pts[v.seg], b = v.pts[v.seg+1];
      const d = Math.hypot(b.x-a.x, b.y-a.y) || 1;
      const remain = (1-v.t)*d;
      if(move >= remain){ move -= remain; v.seg++; v.t = 0; }
      else { v.t += move/d; move = 0; }
    }
    if(v.seg >= v.pts.length-1){
      if(v.state === 'returning'){
        v.state = 'idle'; v.pts = [];
        v.currentBuilding = v.garageRef;
        continue;
      }
      if(v.state === 'to_source'){
        v.currentBuilding = v.source;
        // Charger la ressource
        const src = v.source;
        const isInterPlayer = src.owner != null && src.owner !== (v.garageRef.owner ?? null);
        let res = null, maxAmt = 0;
        for(const r of vt.resources){
          // Respecter le seuil minimum de vente si c'est un commerce inter-joueurs
          const minStock = isInterPlayer ? (src.sellMin?.[r] || 0) : 0;
          const amt = Math.max(0, (src.storage[r]||0) - minStock);
          if(amt > maxAmt){ maxAmt = amt; res = r; }
        }
        if(res && maxAmt > 0){
          const take = Math.min(vt.capacite, maxAmt);
          // Commerce inter-joueurs : paiement si la source appartient à un autre joueur
          if(src.owner != null && src.owner !== (v.garageRef.owner ?? null)){
            const cost = take * (TRADE_PRICES[res] || 0);
            const buyerWallet  = walletOf(v.garageRef.owner);
            const sellerWallet = walletOf(src.owner);
            if(buyerWallet.money < cost){
              // Pas assez d'argent : attendre
              v.waitTimer = 5; continue;
            }
            buyerWallet.money  -= cost;
            buyerWallet.fin.construction = (buyerWallet.fin.construction||0) + cost; // colonne "achats"
            sellerWallet.money += cost;
            sellerWallet.fin.ventes = (sellerWallet.fin.ventes||0) + cost;
          }
          src.storage[res] -= take;
          v.cargo = take; v.res = res;
        } else {
          v.cargo = 0; v.res = null;
        }
        const pts = findRoadPath(v.source, v.dest);
        if(!pts){ v.waitTimer = 5; continue; }
        v.state = 'to_dest';
        v.pts = pts; v.seg = 0; v.t = 0;
      } else {
        v.currentBuilding = v.dest;
        // Décharger la cargaison
        if(v.cargo > 0 && v.res){
          const dst = v.dest;
          const canDeposit = accepts(dst, v.res)
            && !(v.res === 'water' && v.source?.type === 'pump' && dst.type === 'bakery');
          const room = canDeposit ? Math.max(0, capOf(dst, v.res) - (dst.storage[v.res]||0)) : 0;
          const deposit = Math.min(v.cargo, room);
          if(deposit > 0) dst.storage[v.res] = (dst.storage[v.res]||0) + deposit;
          v.cargo = 0; v.res = null;
        }
        const pts = findRoadPath(v.dest, v.source);
        if(!pts){ v.waitTimer = 5; continue; }
        v.state = 'to_source';
        v.pts = pts; v.seg = 0; v.t = 0;
      }
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
    const w = walletOf(b.owner); // wallet du propriétaire du bâtiment
    const r = recipeOf(b);
    if(r && !b.paused){
      let outOK = true, inOK = true;
      for(const k in r.out) if((b.storage[k]||0) >= capOf(b,k)) outOK = false;
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
        if((b.storage.bread||0) > 0) b.storage.bread--; // consommé si présent, pas obligatoire
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
      const maxTrucks = isStorageHub(b)
        ? 4 + b.w * b.h          // entrepôt : plus de camions pour servir plusieurs destinations
        : 2 + ((b.w*b.h)>>1);    // production : limite standard
      if(b.trucksOut >= maxTrucks) continue;
      const r = recipeOf(b);

      if(isStorageHub(b)){
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
  updateVehicles(dt);
  updateWalkers(dt);

  taxTimer += dt;
  if(taxTimer >= ECO.taxeInterval){
    taxTimer = 0;
    // taxes par wallet : taux plein si l'habitant travaille, /3 sinon
    for(const k in WALLETS){
      const oid = +k;
      const w = WALLETS[k];
      // Travailleurs effectivement actifs (industrie non pausée et stock de sortie non plein)
      let activeWorkers = 0;
      for(const b of buildings){
        if(b.dead || !ownedBy(b, oid) || !BUILD[b.type]?.ind || b.paused) continue;
        const r = recipeOf(b);
        if(!r) continue;
        let outFull = true;
        for(const rk in r.out){ if((b.storage[rk]||0) < OUTCAP){ outFull = false; break; } }
        if(!outFull) activeWorkers += workersAllocatedOf(b);
      }
      const total   = popTotal(oid);
      const working = Math.min(total, activeWorkers);
      const idle    = total - working;
      const t = ECO.taxe * working + (ECO.taxe / 3) * idle;
      earnMoney(t, 'taxes', w);
    }
  }

  upkeepTimer += dt;
  if(upkeepTimer >= IND_UPKEEP_INTERVAL){
    upkeepTimer = 0;
    for(const b of buildings){
      const u = upkeepOf(b);
      if(u <= 0) continue;
      const w = walletOf(b.owner);
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
    const oid = +k;
    const w = WALLETS[k];
    if(w.mi == null) w.mi = 0;
    // n'afficher le toast que si c'est le joueur courant
    if(w.mi < MILESTONES.length && popTotal(oid) >= MILESTONES[w.mi]){
      if(+k === MP.myId)
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
    if(!b.starterHome && ((b.storage.goods||0) <= 0 || (b.storage.bread||0) <= 0)) return null; // pas approvisionné (hors maisons protégées)
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
        let goods = 0, bread = 0, pop = 0, protectedPop = 0, wasSel = false;
        const owner = set[0].owner||null;
        for(const o of set){
          goods += o.storage.goods||0;
          bread += o.storage.bread||0;
          pop += o.pop;
          protectedPop += o.protectedPop||0;
          if(o===selected) wasSel = true;
          o.dead = true;
          setGrid(o,null);
        }
        buildings = buildings.filter(o=> !o.dead);
        const t = newBuilding(L.key, x, y, w, h);
        t.owner = owner;
        t.townId = set[0].townId ?? null; // hériter le village du premier composant
        t.pop = Math.min(d.resid.popCap, pop);
        t.protectedPop = Math.min(t.pop, protectedPop);
        t.starterHome = t.protectedPop > 0 || set.some(o => o.starterHome);
        // Conserver le nombre total de slots de départ absorbés
        t.starterSlots = set.reduce((s, o) => s + (o.starterSlots || (o.starterHome ? 1 : 0)), 0);
        t.storage.goods = Math.min(d.resid.stockCap, goods);
        t.storage.bread = Math.min(d.resid.stockCap, bread);
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
  const costOf = i => road[i] ? 1 : (terrain[i]===T.TREE ? 6 : (terrain[i]===T.WHEAT ? 4 : 3));

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
  let breadPool = b.storage.bread||0;
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
    // distribuer marchandises et pain équitablement entre les nouvelles maisons
    const shareG = Math.min(houseStockCap, Math.floor(goodsPool / area));
    const shareB = Math.min(houseStockCap, Math.floor(breadPool / area));
    h.storage.goods = shareG;
    h.storage.bread = shareB;
    goodsPool -= shareG;
    breadPool  -= shareB;
    buildings.push(h);
    setGrid(h,h);
    newHouses.push(h);
    if(wasSel && x===b.x && y===b.y) selected = h;
  }
  // donner le reste aux premières maisons
  for(const h of newHouses){
    if(goodsPool <= 0 && breadPool <= 0) break;
    if(goodsPool > 0){
      const space = houseStockCap - (h.storage.goods||0);
      const give = Math.min(space, goodsPool);
      h.storage.goods += give; goodsPool -= give;
    }
    if(breadPool > 0){
      const space = houseStockCap - (h.storage.bread||0);
      const give = Math.min(space, breadPool);
      h.storage.bread += give; breadPool -= give;
    }
  }
  if(excess > 0) spawnLeavers(bgrid[b.y*N+b.x], excess);
  toast('📉 '+BUILD[b.type].n+' sans outils : défusion'
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
  // Couleur spécifique pour les mines selon le minerai
  const bCol = (b.type==='mine' && b.ore) ? (b.ore==='iron' ? '#8a5c3a' : '#4a4a5a') : d.col;
  const tc = prism(rx0, ry0, rx0+rw, ry0+rh, hgt, bCol);

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
  // Indicateur "en vente" : petit $ doré sur le dépôt
  if(!drawFast && b.type === 'depot' && b.sellTo && Object.values(b.sellTo).some(v=>v)){
    ctx.save();
    ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f0c060';
    ctx.fillText('$', tc[0] + TW*rw*0.3, tc[1] - 3);
    ctx.restore();
  }
  // Contour vert clignotant sur les dépôts éligibles lors de l'assignation de route (source)
  if(vehicleRouteMode && vehicleRouteMode.step === 'source' && b.type === 'depot'){
    const myOid = MP.connected ? MP.myId : null;
    if(b.owner != null && b.owner !== myOid){
      const vt = VEHICLE_TYPES[vehicleRouteMode.vehicle.vtype];
      if(vt.resources.some(r => b.sellTo?.[r])){
        ctx.strokeStyle = '#f0c060'; ctx.lineWidth = 1.5;
        ctx.setLineDash([4,3]);
        diamond(rx0, ry0, rw, rh); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
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

function drawVehicleRoute(veh){
  if(!veh.vizRoute) return;
  const drawPath = (pts, color) => {
    if(!pts || pts.length < 2) return;
    ctx.beginPath();
    let first = true;
    for(const pt of pts){
      const [sx, sy] = worldPxToIso(pt.x, pt.y);
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
    const [r1x,r1y] = rotIdx(b.x, b.y);
    const [r2x,r2y] = rotIdx(b.x+b.w-1, b.y+b.h-1);
    const rx0 = Math.min(r1x,r2x), ry0 = Math.min(r1y,r2y);
    const rw = Math.abs(r1x-r2x)+1, rh = Math.abs(r1y-r2y)+1;
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.globalAlpha = 0.9;
    diamond(rx0, ry0, rw, rh); ctx.stroke();
    ctx.restore();
  };
  highlightBld(veh.source, '#4dd9ff');
  highlightBld(veh.dest,   '#ffaa44');
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
    const [ix] = iso(ruc, rvc);

    // Trouver le point le plus haut (min Y iso) parmi tous les bâtiments du village
    let topIsoY = Infinity;
    for(const b of members){
      const [ru, rv] = rotF(b.x + b.w/2, b.y + b.h/2);
      const [, biy] = iso(ru, rv);
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

function drawVehicle(veh){
  if(!veh.pts || !veh.pts.length) return;
  const a = veh.pts[veh.seg], b = veh.pts[Math.min(veh.seg+1, veh.pts.length-1)];
  const wx = a.x + (b.x-a.x)*veh.t, wy = a.y + (b.y-a.y)*veh.t;
  const [u,v] = rotF(wx/TILE, wy/TILE);
  const [du,dv] = rotDir(b.x-a.x, b.y-a.y);
  const alongU = Math.abs(du) >= Math.abs(dv);
  const au = alongU ? 0.30 : 0.18, av = alongU ? 0.18 : 0.30;
  const vt = VEHICLE_TYPES[veh.vtype];
  const c = iso(u, v);
  ctx.fillStyle = 'rgba(0,0,0,.20)';
  ctx.beginPath(); ctx.ellipse(c[0]+1, c[1]+1, 13, 6, 0, 0, 7); ctx.fill();
  prism(u-au, v-av, u+au, v+av, 6, '#39404c');
  prism(u-au*0.72, v-av*0.72, u+au*0.72, v+av*0.72, 9, vt.color, 6);
  if(!drawFast && veh.cargo > 0){
    const label = vt.icone + ' ' + veh.cargo;
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 2;
    ctx.strokeText(label, c[0], c[1] - TH);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, c[0], c[1] - TH);
  }
  // Cercle blanc si sélectionné
  if(veh === selectedVehicle){
    ctx.save();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.ellipse(c[0], c[1], 16, 8, 0, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }
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
  const depotRadiusSel = selected && !selected.dead && selected.type === 'depot' ? {
    center: centerOfBuilding(selected),
    r: depotRadiusOf(selected),
  } : null;
  const tankRadiusSel = selected && !selected.dead && selected.type === 'tank' ? {
    center: centerOfBuilding(selected),
    r: tankRadiusOf(selected),
  } : null;
  const indRadiusSel = selected && !selected.dead && BUILD[selected.type]?.ind ? {
    center: centerOfBuilding(selected),
    r: indRadiusOf(selected),
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
      if(!drawFast && t===T.WHEAT){
        const hs = hash(x,y), c = iso(rx+0.5, ry+0.5);
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
  if(['mine','lumber','farm','pump','mill','bakery','smelter','factory'].includes(tool) && !drawFast){
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

    for(const veh of vehicles){
      if(veh.state === 'idle' || !veh.pts || !veh.pts.length) continue;
      const a = veh.pts[veh.seg], b = veh.pts[Math.min(veh.seg+1, veh.pts.length-1)];
      const wx = a.x + (b.x-a.x)*veh.t, wy = a.y + (b.y-a.y)*veh.t;
      const [u,v] = rotF(wx/TILE, wy/TILE);
      sprites.push({ k:Math.floor(v)*1024 + Math.floor(u) + 0.52, f:()=>drawVehicle(veh) });
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

  // Parcours du véhicule sélectionné (style Transport Tycoon)
  if(selectedVehicle && !selectedVehicle.garageRef?.dead)
    drawVehicleRoute(selectedVehicle);

  // Noms des villages au centre de chaque groupe de maisons
  drawTownLabels();

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
  const town = ensureSelectedTown();
  const pop = town ? townPopTotal(town.id) : popTotal();
  const cap = town ? townHousingCap(town.id) : housingCap();
  const jobs = town ? townReachableJobs(town.id) : jobsTotal();
  const workers = town ? townAllocatedWorkers(town.id) : Math.min(popTotal(), jobs);
  const mEl = $('hMoney');
  const myMoney = myWallet().money;
  mEl.textContent = Math.floor(myMoney).toLocaleString('fr-FR');
  mEl.style.color = myMoney < 0 ? '#ff8a7a' : '';
  const townEl = $('hTown');
  if(townEl) townEl.textContent = town ? town.name : '—';
  $('hPop').textContent = pop + ' / ' + cap;
  $('hJobs').textContent = workers + ' / ' + jobs;
  $('hTrucks').textContent = trucks.length;
  // Compteur sauvegarde auto
  const cdEl = $('autoSaveCountdown');
  if(cdEl){
    const s = Math.ceil(autoSaveTimer);
    cdEl.textContent = s >= 60 ? 'dans '+(Math.ceil(s/60))+' min' : 'dans '+s+' s';
  }
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
    + row('Ventes d\'outils','ventes','+','in')
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
    if(b.starterHome) return 'Maison de départ protégée (pas besoin de ravitaillement)';
    const hasGoods = (b.storage.goods||0) > 0, hasBread = (b.storage.bread||0) > 0;
    if(hasGoods && hasBread) return 'Consomme outils + pain…';
    if(hasGoods) return 'Consomme outils… — manque de pain (montée en niveau bloquée)';
    if(b.pop > (b.protectedPop||0) && b.starve > 0)
      return '⚠️ Pénurie d\'outils ! Dégradation dans '+Math.max(0,Math.ceil(STARVE_DELAY-b.starve))+' s';
    return 'Attend des outils de construction';
  }
  if(b.type==='depot') return 'Stocke et redistribue';
  if(b.type==='tank') return 'Stocke l’eau pour les boulangeries proches';
  if(b.type==='garage'){
    const active = (b.vehicles||[]).filter(v=>v.state!=='idle').length;
    return active > 0 ? active+' véhicule(s) en tournée' : 'Aucun véhicule en service';
  }
  if(b.type === 'plant') return 'Usine abandonnée — choisir une spécialisation';
  if(b.type === 'bakery' && !tankNear(b)) return '⚠️ Aucune citerne proche pour recevoir l’eau';
  if(b.paused) return 'En pause — ouvriers libérés';
  const r = recipeOf(b);
  if(!r) return '';
  for(const k in r.out) if((b.storage[k]||0) >= capOf(b,k)) return 'Stock de sortie plein';
  for(const k in r.in)  if((b.storage[k]||0) <  r.in[k]) return 'Manque : '+RES[k].n;
  const req = workersRequiredOf(b);
  if(req && workersAllocatedOf(b) < req)
    return "Production à "+Math.round(workersAllocatedOf(b)/req*100)+" % (manque d'ouvriers à portée)";
  return 'En production';
}

function renderInfo(){
  const p = $('info');

  // --- Véhicule sélectionné ---
  if(selectedVehicle){
    if(selectedVehicle.garageRef?.dead){ selectedVehicle = null; }
    else {
      const veh = selectedVehicle;
      const vt = VEHICLE_TYPES[veh.vtype];
      const stateLabel = { idle:'En attente 💤', to_source:'Vers source 🔵', to_dest:'Vers destination 🟠', returning:'Retour au dépôt 🏪' }[veh.state] || veh.state;
      const srcName = veh.source && !veh.source.dead ? BUILD[veh.source.type].n : '—';
      const dstName = veh.dest   && !veh.dest.dead   ? BUILD[veh.dest.type].n  : '—';
      let h = '<h3><span style="font-size:22px">'+vt.icone+'</span> '+vt.nom+'</h3>';
      h += '<div class="status">'+stateLabel+'</div>';
      h += '<div class="row"><span>Cargaison</span><b>'+(veh.cargo > 0 ? veh.cargo+' '+(veh.res ? RES[veh.res].n : '') : 'Vide')+'</b></div>';
      h += '<div class="row"><span>Source</span><b style="color:#4dd9ff">'+srcName+'</b></div>';
      h += '<div class="row"><span>Destination</span><b style="color:#ffaa44">'+dstName+'</b></div>';
      h += '<div class="row"><span>Capacité</span><b>'+vt.capacite+'</b></div>';
      h += '<div class="row"><span>Vitesse</span><b>'+vt.speed+' cases/s</b></div>';
      h += '<div style="margin-top:8px;display:flex;gap:4px">'
         + '<button class="tbtn" style="flex:1" id="bVehRoute">🔁 Nouvelle route</button>'
         + '</div>';
      if(veh.state !== 'idle' && veh.state !== 'returning')
        h += '<button class="tbtn" style="width:100%;margin-top:4px" id="bVehReturn">🏪 Retour au dépôt</button>';
      h += '<button class="tbtn" style="width:100%;margin-top:4px;color:#ff9a8a" id="bVehSell">🗑️ Vendre (+'
         + Math.floor(vt.cost*0.5)+' $)</button>';
      p.style.display = 'block';
      if(p._html === h) return;
      p._html = h; p._b = null;
      p.innerHTML = h;
      $('bVehRoute').onclick = ()=>{
        vehicleRouteMode = { vehicle:veh, step:'source' };
        setTool('select');
        toast('🔁 Clique sur le bâtiment SOURCE pour '+vt.nom+'.');
        p._html = null;
      };
      const retBtn = $('bVehReturn');
      if(retBtn) retBtn.onclick = ()=>{
        returnToGarage(veh);
        toast('🏪 '+vt.nom+' retourne au dépôt.');
        p._html = null;
      };
      $('bVehSell').onclick = ()=>{
        const refund = Math.floor(vt.cost * 0.5);
        earnMoney(refund, 'rembours');
        vehicles.splice(vehicles.indexOf(veh), 1);
        const g = veh.garageRef;
        if(g) g.vehicles = (g.vehicles||[]).filter(v=>v!==veh);
        if(vehicleRouteMode?.vehicle === veh) vehicleRouteMode = null;
        selectedVehicle = null;
        toast('🗑️ Véhicule vendu (+'+refund+' $)');
        p._html = null;
      };
      return;
    }
  }

  if(!selected || selected.dead){ p.style.display = 'none'; return; }
  const b = selected, d = BUILD[b.type];
  let h = '<h3><span style="font-size:22px">'+d.ic+'</span>'+d.n+'</h3>';
  h += '<div class="status">'+statusOf(b)+'</div>';
  if(!adjRoadTiles(b).length)
    h += '<div class="warn">⚠️ Aucune route adjacente — pas de camions !</div>';
  if(b.type === 'plant'){
    const canUpgrade = !MP.connected || !b.owner || b.owner === MP.myId;
    h += '<div style="margin-top:8px;color:#8fa3bf">Spécialisation</div>';
    h += '<div style="font-size:11px;color:#8fa3bf;margin-bottom:4px">Choisir une seule fois le type d\'usine.</div>';
    for(const key in PLANT_UPGRADES){
      const opt = PLANT_UPGRADES[key];
      const d2 = BUILD[opt.type];
      const err = plantUpgradeError(b, opt.type);
      h += '<button class="tbtn" style="width:100%;text-align:left;margin-top:3px" data-plant-upgrade="'+opt.type+'"'
        + (!canUpgrade || err ? ' disabled' : '') + '>'
        + opt.icon+' '+opt.label+' <span style="color:#8fa3bf">— '+(d2.cost||0)+' $</span>'
        + (err ? ' <span style="color:#ff9a8a">('+escHtml(err)+')</span>' : '')
        + '</button>';
    }
  }
  if(d.workers) h += '<div class="row"><span>Ouvriers</span><b>'+workersAllocatedOf(b)+' / '+workersRequiredOf(b)+'</b></div>';
  if(d.ind && b.w*b.h>1)
    h += '<div class="row"><span>Taille / production</span><b>'+b.w+'×'+b.h
       + ' — ×'+prodMult(b).toFixed(1)+'</b></div>';
  if(d.ind)
    h += '<div class="row"><span>Entretien</span><b>'+(Math.round(upkeepOf(b)*10)/10)
       + ' $ / '+IND_UPKEEP_INTERVAL+' s</b></div>';
  if(d.ind && b.name)
    h += '<div class="row"><span>Nom</span><b style="color:#9fd4f0">🏭 '+escHtml(b.name)+'</b></div>';
  if(d.ind)
    h += '<div class="row"><span>Rayon d\'action</span><b style="color:#ff8c42">'+indRadiusOf(b)+' cases</b></div>';
  if(b.type === 'bakery')
    h += '<div class="row"><span>Citerne proche</span><b style="color:'+(tankNear(b) ? '#9fe8a0' : '#ff9a8a')+'">'
       + (tankNear(b) ? 'oui' : 'non') + ' / '+BAKERY_TANK_RADIUS+' cases</b></div>';
  if(d.resid)
    h += '<div class="row"><span>Habitants</span><b>'+b.pop+' / '+d.resid.popCap+'</b></div>';
  if(d.resid){
    const town = getTownOf(b);
    if(town) h += '<div class="row"><span>Village</span><b style="color:#e8d48b">🏘️ '+escHtml(town.name)
      +'</b></div>';
  }
  if(d.resid && !b.starterHome){
    const incomePerCycle = d.resid.income * Math.max(1, b.pop);
    const ratePerMin = b.pop > 0 ? Math.round(incomePerCycle / d.resid.interval * 60) : 0;
    h += '<div class="row"><span>Revenu / outil livré</span><b>'+incomePerCycle+' $</b></div>';
    h += '<div class="row"><span>Intervalle conso.</span><b>'+d.resid.interval+' s</b></div>';
    h += '<div class="row"><span>Revenu / min</span><b style="color:#9fe8a0">~'+ratePerMin+' $</b></div>';
  }
  if(d.resid)
    h += '<div class="row"><span>Rayon travail</span><b>'+workRadiusOf(b)+' cases</b></div>';
  // Stocks : pour les usines, séparer entrée / recette / sortie
  const r2 = recipeOf(b);
  const inKeys  = d.ind && r2 ? Object.keys(r2.in||{})  : [];
  const outKeys = d.ind && r2 ? Object.keys(r2.out||{}) : [];
  const inSet   = new Set(inKeys), outSet = new Set(outKeys);
  const extraKeys = Object.keys(b.storage).filter(k => b.storage[k]>0 && !inSet.has(k) && !outSet.has(k));
  const showStock = (k) => {
    const cap = capOf(b,k), val = b.storage[k]||0;
    h += '<div class="row"><span>'+RES[k].n+'</span><b>'+val+' / '+cap+'</b></div>';
    h += '<div class="bar"><i style="width:'+Math.min(100,100*val/cap)+'%;background:'+RES[k].c+'"></i></div>';
  };
  if(d.ind && r2){
    // entrées (toujours affichées)
    if(inKeys.length) h += '<div style="margin-top:8px"></div>';
    inKeys.forEach(showStock);
    // recette
    const fmt = obj => Object.entries(obj).map(([k,v]) => (v>1?v+'×':'')+RES[k].n).join(' + ');
    const lhs  = inKeys.length ? fmt(r2.in)+' → ' : '';
    const time = Math.round(r2.time*10)/10;
    h += '<div class="row" style="margin:6px 0 2px"><span style="color:#8fa3bf">Recette</span>'
       + '<b style="color:#d4e8ff">'+lhs+fmt(r2.out)
       + ' <span style="color:#8fa3bf;font-weight:normal">/ '+time+'s</span></b></div>';
    // sortie (toujours affichée)
    outKeys.forEach(showStock);
    // ressources hors recette (rare)
    if(extraKeys.length){
      extraKeys.forEach(showStock);
    }
  } else {
    // bâtiments non-industriels (logements, entrepôts…)
    const allKeys = [...new Set([
      ...Object.keys(b.storage).filter(k=>b.storage[k]>0 || (b.inc[k]||0)>0),
    ])];
    if(allKeys.length){
      h += '<div style="margin-top:8px;color:#8fa3bf">Stocks</div>';
      allKeys.forEach(showStock);
    }
  }
  if(b.type==='depot'){
    h += '<div class="row"><span>Rayon d\'action</span><b style="color:#ffd700">'+depotRadiusOf(b)+' cases</b></div>';
    if(b.w*b.h > 1)
      h += '<div class="row"><span>Taille</span><b>'+b.w+'×'+b.h+'</b></div>';
    h += '<div style="margin-top:8px;color:#8fa3bf">Ressources acceptées</div><div>';
    for(const k in RES){
      if(k === 'water') continue;
      const on = b.allow?.[k] !== false;
      h += '<button class="tbtn flt'+(on?' on':'')+'" data-r="'+k+'">'
         + '<span class="dot" style="background:'+RES[k].c+'"></span>'+RES[k].n+'</button>';
    }
    h += '</div>';
    // Section vente inter-joueurs (toujours visible pour permettre l'accès solo aussi)
    const myOid = MP.myId;
    const isOwner = !b.owner || b.owner === myOid;
    if(isOwner){
      h += '<div style="margin-top:8px;color:#f0c060;font-size:11px">🛒 Vente aux autres joueurs</div>';
      h += '<div style="font-size:10px;color:#8fa3bf;margin-bottom:3px">Prix par unité · cliquer pour activer/désactiver</div>';
      for(const k in RES){
        if(k === 'water') continue;
        const on = !!b.sellTo?.[k];
        const price = TRADE_PRICES[k];
        const minStock = b.sellMin?.[k] || 0;
        h += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">'
           + '<button class="tbtn sell-toggle'+(on?' on':'')+'" data-sell="'+k+'" style="flex:1;'
           + (on ? 'border-color:#f0c060;color:#f0c060' : '')+'">'
           + '<span class="dot" style="background:'+RES[k].c+'"></span>'
           + RES[k].n+' <span style="color:#8fa3bf">'+price+' $</span></button>';
        if(on){
          h += '<span style="color:#8fa3bf;font-size:10px;white-space:nowrap">Min stock</span>'
             + '<button class="tbtn sell-min-dec" data-sell-min="'+k+'" style="padding:2px 6px">−</button>'
             + '<span style="min-width:24px;text-align:center;font-size:11px">'+minStock+'</span>'
             + '<button class="tbtn sell-min-inc" data-sell-min="'+k+'" style="padding:2px 6px">+</button>';
        }
        h += '</div>';
      }
    }
  }
  if(b.type==='tank'){
    h += '<div class="row"><span>Rayon d\'action</span><b style="color:#64b7e8">'+tankRadiusOf(b)+' cases</b></div>';
    h += '<div class="row"><span>Stockage</span><b>Eau uniquement</b></div>';
  }
  if(b.type==='garage'){
    const bvehicles = b.vehicles || [];
    h += '<div class="row"><span>Véhicules</span><b>'+bvehicles.length+'</b></div>';
    // Instruction mode assignation route
    if(vehicleRouteMode && bvehicles.some(v=>v===vehicleRouteMode.vehicle)){
      const step = vehicleRouteMode.step;
      h += '<div class="warn" style="background:#1a2e1a;border-color:#3d8c3d;color:#9fe8a0">'
         + (step==='source' ? '🔁 Clique sur le bâtiment SOURCE' : '🔁 Clique sur la DESTINATION')
         + '</div>';
    }
    if(bvehicles.length){
      h += '<div style="margin-top:8px;color:#8fa3bf">Véhicules assignés</div>';
      for(const v of bvehicles){
        const vt = VEHICLE_TYPES[v.vtype];
        const srcName = v.source && !v.source.dead ? BUILD[v.source.type].n : '—';
        const dstName = v.dest   && !v.dest.dead   ? BUILD[v.dest.type].n  : '—';
        const stateLabel = v.state==='idle' ? 'En attente'
          : v.state==='to_source' ? 'Vers source' : 'Vers destination';
        const cargoStr = v.cargo > 0 ? ' · '+v.cargo+(v.res ? ' '+RES[v.res].n : '') : '';
        h += '<div style="padding:5px 0;border-bottom:1px solid #2a3a50">'
           + '<div>'+vt.icone+' <b>'+vt.nom+'</b></div>'
           + '<div style="font-size:11px;color:#8fa3bf">'+stateLabel+cargoStr+'</div>'
           + '<div style="font-size:11px;color:#8fa3bf">'+srcName+' → '+dstName+'</div>'
           + '<div style="display:flex;gap:4px;margin-top:3px">'
           + '<button class="tbtn" style="flex:1;font-size:11px" data-route-v="'+v.id+'">🔁 Route</button>'
           + '<button class="tbtn" style="font-size:11px;color:#ff9a8a" data-sell-v="'+v.id+'">🗑️ Vendre</button>'
           + '</div></div>';
      }
    }
    h += '<div style="margin-top:8px;color:#8fa3bf">Acheter un véhicule</div>';
    for(const vk in VEHICLE_TYPES){
      const vt = VEHICLE_TYPES[vk];
      h += '<button class="tbtn" style="width:100%;text-align:left;margin-top:2px" data-buy-v="'+vk+'">'
         + vt.icone+' '+vt.nom+' <span style="color:#8fa3bf">— '+vt.cost+' $</span></button>';
    }
  }
  const canControl = !b.owner || b.owner === MP.myId;
  if(d.ind && canControl)
    h += '<button class="tbtn" id="bPauseBld">'+(b.paused ? '▶ Reprendre' : '⏸ Mettre en pause')+'</button>';
  h += '<button class="tbtn" id="bDemol">🧨 Démolir (+'+Math.floor((d.cost||0)*0.3)+' $)</button>';
  p.style.display = 'block';
  if(p._html === h && p._b === b) return; // ne pas reconstruire le DOM sous la souris
  p._html = h; p._b = b;
  p.innerHTML = h;
  p.querySelectorAll('[data-plant-upgrade]').forEach(btn=>{
    btn.onclick = ()=>{
      const targetType = btn.dataset.plantUpgrade;
      const err = plantUpgradeError(b, targetType);
      if(err){ toast('⛔ '+err, 'err'); return; }
      if(MP.connected && b.owner && b.owner !== MP.myId){
        toast('⛔ Ce bâtiment appartient à un autre joueur','err'); return;
      }
      const targetDef = BUILD[targetType];
      const cost = targetDef.cost || 0;
      if(myWallet().money < cost){ toast('Fonds insuffisants ('+cost+' $)','err'); return; }
      const label = (PLANT_UPGRADES[targetType]||{}).label || targetDef.n;
      if(!confirm('Créer '+label+' pour '+cost+' $ ? Ce choix sera définitif.')) return;
      spendMoney(cost, 'construction');
      const upgradeErr = applyPlantUpgrade(b, targetType);
      if(upgradeErr){ toast('⛔ '+upgradeErr, 'err'); return; }
      if(MP.connected) netSend({ type:'upgrade_plant', x:b.x, y:b.y, targetType });
      selected = b;
      p._html = null;
      renderInfo();
      toast('🏭 Usine créée : '+targetDef.n, 'win');
    };
  });
  p.querySelectorAll('.flt').forEach(btn=>{
    btn.onclick = ()=>{
      b.allow[btn.dataset.r] = b.allow[btn.dataset.r] === false;
      p._html = null; // forcer le rafraîchissement
    };
  });
  p.querySelectorAll('.sell-toggle').forEach(btn=>{
    btn.onclick = ()=>{
      if(!b.sellTo) b.sellTo = {};
      b.sellTo[btn.dataset.sell] = !b.sellTo[btn.dataset.sell];
      p._html = null;
    };
  });
  p.querySelectorAll('.sell-min-dec').forEach(btn=>{
    btn.onclick = ()=>{
      if(!b.sellMin) b.sellMin = {};
      const k = btn.dataset.sellMin;
      b.sellMin[k] = Math.max(0, (b.sellMin[k]||0) - 10);
      p._html = null;
    };
  });
  p.querySelectorAll('.sell-min-inc').forEach(btn=>{
    btn.onclick = ()=>{
      if(!b.sellMin) b.sellMin = {};
      const k = btn.dataset.sellMin;
      b.sellMin[k] = (b.sellMin[k]||0) + 10;
      p._html = null;
    };
  });
  if(b.type === 'garage'){
    p.querySelectorAll('[data-route-v]').forEach(btn=>{
      btn.onclick = ()=>{
        const vid = +btn.dataset.routeV;
        const v = vehicles.find(vv=>vv.id===vid);
        if(!v) return;
        vehicleRouteMode = { vehicle:v, step:'source' };
        setTool('select');
        toast('🔁 Clique sur le bâtiment SOURCE pour '+VEHICLE_TYPES[v.vtype].nom+'.');
        p._html = null;
      };
    });
    p.querySelectorAll('[data-sell-v]').forEach(btn=>{
      btn.onclick = ()=>{
        const vid = +btn.dataset.sellV;
        const v = vehicles.find(vv=>vv.id===vid);
        if(!v) return;
        const refund = Math.floor(VEHICLE_TYPES[v.vtype].cost * 0.5);
        earnMoney(refund, 'rembours');
        vehicles.splice(vehicles.indexOf(v), 1);
        b.vehicles = (b.vehicles||[]).filter(vv=>vv!==v);
        if(vehicleRouteMode && vehicleRouteMode.vehicle===v) vehicleRouteMode = null;
        toast('🗑️ Véhicule vendu (+'+refund+' $)');
        p._html = null;
      };
    });
    p.querySelectorAll('[data-buy-v]').forEach(btn=>{
      btn.onclick = ()=>{
        const vtype = btn.dataset.buyV;
        const vt = VEHICLE_TYPES[vtype];
        if(!vt) return;
        if(myWallet().money < vt.cost){ toast('Fonds insuffisants ('+vt.cost+' $)','err'); return; }
        spendMoney(vt.cost, 'construction');
        const v = {
          id: nextVehicleId++,
          vtype,
          garageRef: b,
          source: null, dest: null,
          state: 'idle',
          cargo: 0, res: null,
          pts: [], seg: 0, t: 0,
          waitTimer: 0,
          currentBuilding: b,
        };
        vehicles.push(v);
        b.vehicles = b.vehicles || [];
        b.vehicles.push(v);
        toast(vt.icone+' '+vt.nom+' acheté ! Définis sa route avec 🔁 Route.','win');
        p._html = null;
      };
    });
  }
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
    if(k === 'garage'){
      const sep = document.createElement('div');
      sep.style.cssText = 'padding:4px 6px 2px;font-size:10px;color:#8fa3bf;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap';
      sep.textContent = '🚛 Logistique';
      bar.appendChild(sep);
    }
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

function selectTownLabelAt(x,y){
  for(let i=townLabelHits.length-1; i>=0; i--){
    const h = townLabelHits[i];
    if(x >= h.x && x <= h.x+h.w && y >= h.y && y <= h.y+h.h){
      selectedTownId = h.id;
      const t = towns.find(t=>t.id === h.id);
      if(t) toast('🏘️ Village sélectionné : ' + t.name);
      hudTimer = 0;
      updateHUD(0);
      return true;
    }
  }
  return false;
}

// clickFn : indirection pour permettre au module multijoueur d'intercepter les clics
let clickFn = clickAt;

cv.addEventListener('mousedown', e=>{
  updateMouseTile(e);
  if(e.button===0){
    mouse.lDown = true;
    if(selectTownLabelAt(e.clientX, e.clientY)){ mouse.lDown = false; return; }
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
  if(mouse.lDown && (tool==='road'||tool==='bulldoze'||tool==='terraform') && (mouse.tx!==ptx || mouse.ty!==pty))
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
  if(e.code==='Escape'){ setTool('select'); selected = null; vehicleRouteMode = null; selectedVehicle = null; }
  if(e.code==='KeyH') toggleHelp();
  if(e.code==='KeyR') rotate(e.shiftKey ? -1 : 1);
  if(e.code==='KeyB') setTool('bulldoze');
  if(e.code.startsWith('Digit')){
    const d = +e.code.slice(5);
    const key = String(d);
    const toolKey = TOOL_ORDER.find(k => BUILD[k]?.hk === key);
    if(toolKey) setTool(toolKey);
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
  // Décompte sauvegarde auto (temps réel, pas affecté par speed/pause)
  autoSaveTimer -= rdt;
  if(autoSaveTimer <= 0){
    autoSaveTimer = AUTO_SAVE_INTERVAL;
    performAutoSave();
  }
  requestAnimationFrame(frame);
}

buildToolbar();
genWorld();
$('help').style.display = 'block';
renderAutoSaves();
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
      ore:b.ore||null, allow:b.allow||null, sellTo:b.sellTo||null, sellMin:b.sellMin||null, paused:b.paused||false, owner:b.owner||null,
      starterHome:!!b.starterHome, starterSlots:b.starterSlots||0, townId:b.townId??null, name:b.name||null,
    })),
    towns: towns.map(t => ({ id:t.id, name:t.name, cx:t.cx, cy:t.cy })),
    nextTownId,
    vehicles: vehicles.map(v => ({
      id: v.id, vtype: v.vtype,
      garageX: v.garageRef.x, garageY: v.garageRef.y,
      sourceX: v.source && !v.source.dead ? v.source.x : null,
      sourceY: v.source && !v.source.dead ? v.source.y : null,
      destX:   v.dest   && !v.dest.dead   ? v.dest.x   : null,
      destY:   v.dest   && !v.dest.dead   ? v.dest.y   : null,
      state: v.state, cargo: v.cargo, res: v.res || null,
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
  vehicles = []; vehicleRouteMode = null; nextVehicleId = 0;
  towns = []; nextTownId = 0; selectedTownId = null; townLabelHits = [];
  bgrid = new Array(N*N).fill(null);
  selected = null;

  // Restaurer les villes
  if(Array.isArray(d.towns)){
    towns = d.towns.map(t => ({ id:t.id, name:t.name, cx:t.cx, cy:t.cy }));
    nextTownId = d.nextTownId ?? (towns.reduce((m,t)=>Math.max(m,t.id),-1) + 1);
  }

  for(const o of d.buildings){
    if(!BUILD[o.type]) continue;
    const b = newBuilding(o.type, o.x, o.y, o.w, o.h);
    Object.assign(b, {
      storage:o.storage||{}, inc:o.inc||{},
      prog:o.prog||0, trucksOut:0,
      pop:o.pop||0, protectedPop:o.protectedPop||0,
      ct:o.ct||0, pending:o.pending||0, pendingProtected:o.pendingProtected||0, starve:o.starve||0,
    });
    if(o.ore)   b.ore   = o.ore;
    if(o.allow) b.allow = o.allow;
    if(o.sellTo) b.sellTo = o.sellTo;
    if(o.sellMin) b.sellMin = o.sellMin;
    if(o.paused != null) b.paused = o.paused;
    if(o.owner  != null) b.owner  = o.owner;
    if(o.starterHome) b.starterHome = true;
    if(o.starterSlots) b.starterSlots = o.starterSlots;
    if(o.townId != null) b.townId = o.townId;
    if(o.name   != null) b.name   = o.name;
    buildings.push(b);
    setGrid(b,b);
  }
  // Migration : assign townId aux maisons sans village et noms aux industries sans nom
  for(const b of buildings){
    if(BUILD[b.type]?.resid && b.townId == null) assignBuildingToTown(b, true);
    if(BUILD[b.type]?.ind   && !b.name)          assignIndustryName(b);
  }
  ensureSelectedTown();
  for(const k in WALLETS) WALLETS[k].starterHomes = 0;
  for(const b of buildings){
    if(!b.starterHome) continue;
    const w = walletOf(b.owner);
    const slots = b.starterSlots || Math.max(1, b.protectedPop || 0);
    w.starterHomes = Math.min(2, (w.starterHomes||0) + slots);
    w.starterHomesGranted = Math.max(w.starterHomesGranted||0, w.starterHomes);
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
    for(const h of homeless) walletOf(h.owner).homelessSeeded = true;
  }
  // Restaurer les véhicules persistants
  if(Array.isArray(d.vehicles)){
    for(const sv of d.vehicles){
      if(!VEHICLE_TYPES[sv.vtype]) continue;
      const garage = buildings.find(b=>b.x===sv.garageX && b.y===sv.garageY && b.type==='garage');
      if(!garage) continue;
      const source = sv.sourceX != null ? buildings.find(b=>b.x===sv.sourceX && b.y===sv.sourceY) : null;
      const dest   = sv.destX   != null ? buildings.find(b=>b.x===sv.destX   && b.y===sv.destY)   : null;
      const v = {
        id: sv.id ?? nextVehicleId,
        vtype: sv.vtype,
        garageRef: garage,
        source: source || null,
        dest: dest || null,
        state: 'idle',
        cargo: sv.cargo || 0, res: sv.res || null,
        pts: [], seg: 0, t: 0,
        waitTimer: 0, currentBuilding: garage,
      };
      nextVehicleId = Math.max(nextVehicleId, v.id + 1);
      // Recalculer le chemin si la route était en cours
      if(source && dest && sv.state !== 'idle'){
        const from = sv.state === 'to_dest' ? source : garage;
        const to   = sv.state === 'to_dest' ? dest   : source;
        const pts = findRoadPath(from, to);
        if(pts){ v.pts = pts; v.state = sv.state; }
        // Recompute viz route
        const fwd = findRoadPath(source, dest);
        const bwd = findRoadPath(dest, source);
        v.vizRoute = { fwd: fwd || [], bwd: bwd || [] };
      }
      garage.vehicles = garage.vehicles || [];
      garage.vehicles.push(v);
      vehicles.push(v);
    }
  }
}

// ---- patch minimal d'une action entrante ----
function applyAction(msg){
  const { act } = msg;
  switch(act.type){
    case 'road':   road[act.i] = 1; break;
    case 'bulldoze_road': road[act.i] = 0; earnMoney(3, 'rembours', walletOf(msg.from)); break;
    case 'bulldoze_tree': terrain[act.i] = T.GRASS; break;
    case 'terraform': terrain[act.i] = T.GRASS; break;
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
      assignBuildingToTown(b);
      assignIndustryName(b);
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
    case 'upgrade_plant': {
      const b = bgrid[act.y*N+act.x];
      if(!b || b.owner !== msg.from) break;
      const targetType = act.targetType;
      const err = plantUpgradeError(b, targetType);
      if(err) break;
      const cost = BUILD[targetType].cost || 0;
      const wSender = walletOf(msg.from);
      wSender.money -= cost;
      wSender.fin.construction = (wSender.fin.construction||0) + cost;
      applyPlantUpgrade(b, targetType);
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
    MP.shutdownNotice = false;
    MP.shutdownMessage = '';
    toast('🌐 Connecté au serveur multijoueur');
    mpUpdateUI();
    // tentative de reprise de session via token stocké
    const saved = localStorage.getItem('fp_token');
    if(saved) ws.send(JSON.stringify({ type:'resume', token:saved }));
  };

  ws.onclose = () => {
    const stopped = MP.shutdownNotice;
    MP.connected = false;
    MP.role = null;
    MP.isAdmin = false;
    MP.players = [];
    MP.cursors = {};
    MP.username = null;
    MP.token = null;
    MP.saves = [];
    MP.shutdownNotice = false;
    const closeMsg = MP.shutdownMessage || 'Serveur arrêté';
    MP.shutdownMessage = '';
    toast(stopped ? '🔌 '+closeMsg : '🔌 Déconnecté du serveur','err');
    mpUpdateUI();
    mpRenderPlayerList();
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
        resetSelectedTown();
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
        resetSelectedTown();
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
        ensureSelectedTown();
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
        renderAutoSaves();
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
        resetSelectedTown();
        toast('📂 Partie "'+msg.name+'" chargée par '+msg.loadedBy);
        break;

      case 'game_new_world':
        applySnapshot(msg.state);
        if(msg.config) WORLD = normalizeWorldConfig(msg.config);
        resetSelectedTown();
        toast('🌍 Nouvelle carte créée par '+msg.createdBy);
        mpUpdateUI();
        break;

      case 'server_full':
        toast('⛔ '+msg.msg, 'err');
        break;

      case 'server_shutdown':
        MP.shutdownNotice = true;
        MP.shutdownMessage = msg.msg || 'Serveur arrêté';
        if(MP.ws) MP.ws.close();
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
    } else if(terrain[i]===T.TREE || terrain[i]===T.WHEAT){
      netSend({ type:'bulldoze_tree', i });
    }
    clickAt(x,y);
    return;
  }
  if(tool==='terraform'){
    const ter = terrain[i];
    if(!bgrid[i] && (ter===T.TREE || ter===T.WHEAT || ter===T.IRON || ter===T.COAL)){
      netSend({ type:'terraform', i });
      clickAt(x,y);
    }
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
    <label style="display:block;color:#8fa3bf;font-size:11px">Champs de blé (%)</label>
    <input id="mpResWheat" type="number" min="0" max="40" step="0.5" style="${INP}">
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
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
  <div style="color:#8fa3bf;font-size:11px">🔄 Sauvegardes auto</div>
  <span id="autoSaveCountdown" style="color:#6e8aa0;font-size:10px"></span>
</div>
<div id="autoSaveList" style="max-height:130px;overflow-y:auto;margin-bottom:4px"></div>

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
        wheat: $('mpResWheat').value,
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
  renderAutoSaves();
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
  $('mpResWheat').value = WORLD.resources.wheat;
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
  const saves = MP.saves.filter(s => !/^[\[_]Auto[\]_ ]/i.test(s.name));
  if(!saves.length){
    el.innerHTML = '<div style="color:#8fa3bf;font-size:11px;font-style:italic">Aucune sauvegarde</div>';
    return;
  }
  el.innerHTML = saves.map(s=>{
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

// ---------- sauvegarde automatique ----------
function loadAutoSaves(){
  try { return JSON.parse(localStorage.getItem(AUTO_SAVE_KEY) || '[]'); } catch(e){ return []; }
}

function performAutoSave(){
  if(!buildings.length) return; // monde non initialisé
  const saves = loadAutoSaves();
  const lastSlot = saves.length > 0 ? saves[saves.length - 1].slot : 0;
  const nextSlot = (lastSlot % AUTO_SAVE_MAX) + 1;
  const entry = { slot: nextSlot, date: new Date().toISOString(), state: serializeState() };
  const updated = saves.filter(s => s.slot !== nextSlot);
  updated.push(entry);
  // conserver uniquement les MAX dernières
  const trimmed = updated.slice(-AUTO_SAVE_MAX);
  try {
    localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(trimmed));
  } catch(e){
    toast('⚠️ Sauvegarde auto impossible (stockage plein)', 'err');
    return;
  }
  renderAutoSaves();
  toast('💾 Sauvegarde auto — emplacement '+nextSlot+'/'+AUTO_SAVE_MAX);
  // Envoyer aussi au serveur si connecté et admin
  if(MP.connected && mpHasAdminRights() && MP.token){
    MP.ws.send(JSON.stringify({
      type: 'save_game', token: MP.token,
      name: '[Auto] ' + nextSlot,
      state: serializeState(),
    }));
  }
}

function renderAutoSaves(){
  const el = $('autoSaveList');
  if(!el) return;
  const localSaves = loadAutoSaves().sort((a,b)=> new Date(b.date) - new Date(a.date));
  // sauvegardes auto côté serveur (noms correspondant au pattern _Auto_*)
  const serverAutoSaves = (MP.saves || []).filter(s => /^[\[_]Auto[\]_ ]/i.test(s.name))
    .sort((a,b) => new Date(b.date) - new Date(a.date));

  if(!localSaves.length && !serverAutoSaves.length){
    el.innerHTML = '<div style="color:#8fa3bf;font-size:11px;font-style:italic">Aucune sauvegarde auto</div>';
    return;
  }

  const localHtml = localSaves.map(s => {
    const d = new Date(s.date);
    const dateStr = d.toLocaleDateString('fr-FR')+' '
      + d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    return '<div style="display:flex;align-items:center;gap:4px;margin:2px 0;padding:3px 4px;'
      + 'background:#1d2939;border-radius:5px">'
      + '<span style="flex:1;font-size:12px">🔄 Auto-'+s.slot+'</span>'
      + '<span style="color:#8fa3bf;font-size:10px;white-space:nowrap">'+dateStr+'</span>'
      + '<button class="tbtn" style="padding:1px 6px;font-size:11px" data-autoload="'+s.slot+'">▶</button>'
      + '</div>';
  }).join('');

  const serverHtml = serverAutoSaves.map(s => {
    const d = new Date(s.date);
    const dateStr = d.toLocaleDateString('fr-FR')+' '
      + d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    return '<div style="display:flex;align-items:center;gap:4px;margin:2px 0;padding:3px 4px;'
      + 'background:#1d2939;border-radius:5px">'
      + '<span style="flex:1;font-size:12px">🌐 '+escHtml(s.name)+'</span>'
      + '<span style="color:#8fa3bf;font-size:10px;white-space:nowrap">'+escHtml(dateStr)+'</span>'
      + '<button class="tbtn" style="padding:1px 6px;font-size:11px" data-svautoload="'+escHtml(s.name)+'"'
      + (mpHasAdminRights() ? '' : ' disabled') + '>▶</button>'
      + '</div>';
  }).join('');

  el.innerHTML = localHtml + serverHtml;

  el.querySelectorAll('[data-autoload]').forEach(btn=>{
    btn.onclick = ()=>{
      const slot = +btn.dataset.autoload;
      const sv = loadAutoSaves().find(s => s.slot === slot);
      if(!sv) return;
      const d = new Date(sv.date);
      const label = d.toLocaleDateString('fr-FR')+' '+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
      if(!confirm('Charger la sauvegarde automatique du '+label+' ?')) return;
      applySnapshot(sv.state);
      autoSaveTimer = AUTO_SAVE_INTERVAL;
      toast('📥 Sauvegarde auto chargée', 'win');
    };
  });

  el.querySelectorAll('[data-svautoload]').forEach(btn=>{
    btn.onclick = ()=>{
      if(!mpHasAdminRights()) return;
      const name = btn.dataset.svautoload;
      if(!confirm('Charger "'+name+'" ? La partie en cours sera remplacée pour tous les joueurs.')) return;
      MP.ws.send(JSON.stringify({ type:'load_game', token:MP.token, name }));
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
