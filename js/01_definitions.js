'use strict';
/* ===================== Factopolis =====================
   Factorio (chaînes de production) + City builder (population/ouvriers)
   + Transport Tycoon (camions sur routes).
   Rendu isométrique 2.5D rotatif (touche R). Canvas 2D, zéro dépendance. */

// ---------- configuration (voir config.js) ----------
const CFG = (typeof CONFIG !== 'undefined') ? CONFIG : {};
const DEFAULT_RESIDENT_NEEDS = ['goods','clothes'];
const DEFAULT_RESIDENT_FUSION_NEEDS = ['goods','clothes','bread'];
const DEFAULT_RESIDENT_BONUS = ['fish_fillet'];
function _resList(raw, def){
  const list = Array.isArray(raw) ? raw : def;
  const out = [];
  for(const r of list || []){
    if(typeof r === 'string' && r && !out.includes(r)) out.push(r);
  }
  return out;
}
function _resid(c, def){
  c = c || {};
  const required = _resList(c.ressourcesIndispensables, def.required || DEFAULT_RESIDENT_NEEDS);
  const fusionRequired = _resList(c.ressourcesFusion, def.fusionRequired || DEFAULT_RESIDENT_FUSION_NEEDS);
  const bonus = _resList(c.ressourcesBonus, def.bonus || DEFAULT_RESIDENT_BONUS);
  return {
    interval: c.intervalleConsommation ?? def.interval,
    income:   c.revenuParUnite        ?? def.income,
    popCap:   c.habitantsMax          ?? def.popCap,
    stockCap: c.stockMax              ?? def.stockCap,
    required,
    fusionRequired,
    bonus,
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
const T = { GRASS:0, WATER:1, TREE:2, IRON:3, COAL:4, WHEAT:5, COTTON:6 };
const DIRS  = [[1,0],[-1,0],[0,1],[0,-1]];
const DIRS8 = [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1],[1,1],[-1,-1]];
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

// ---------- horloge du jeu ----------
// 1 seconde de gtime = GAME_HOURS_PER_SEC heures dans le jeu.
// Par défaut : 1 gtime-seconde = 1 heure de jeu → 1 journée = 24 sec, 1 an ≈ 2h26 de jeu.
const GAME_HOURS_PER_SEC = CFG.jeu?.heuresParSeconde ?? 1;
const GAME_EPOCH_MS      = Date.UTC(1970, 0, 1); // 1er janvier 1970 00:00 UTC
const TOWN_RADIUS        = 20;  // cases — rayon d'appartenance à un village
const EXP_DEPTH  = 16;   // profondeur d'une tranche d'expansion (tuiles)
const EXP_MARGIN = 48;   // marge pré-générée de chaque côté (max 3 expansions / bord)

// ---------- véhicules persistants ----------
const BUS_STOP_RADIUS      = CFG.logistique?.arretBus?.rayon         ?? 8;
const BUS_FARE_FACTOR      = CFG.logistique?.arretBus?.tarif         ?? 1;
const BUS_INTRA_CITY_DIV   = CFG.logistique?.arretBus?.diviseurIntra ?? 3;
const BUS_DWELL_TIME       = (CFG.logistique?.arretBus?.tempsArret      ?? 2) / (CFG.jeu?.heuresParSeconde ?? 1); // gtime-s d'arrêt bus à quai
const VEHICLE_DWELL_TIME   = (CFG.logistique?.garage?.tempsArret         ?? 2) / (CFG.jeu?.heuresParSeconde ?? 1); // gtime-s d'arrêt véhicule chargement/déchargement
const BUS_STOP_FILL_TIME   = CFG.logistique?.arretBus?.tempsRemplissage ?? 6; // gtime-s de rush pour remplir (6 = 1 journée de pointe)
const BUS_OWNER_SHARE      = CFG.logistique?.arretBus?.partProprietaire     ?? 0.8;

const VEHICLE_TYPES = (()=>{
  const cfgV = CFG.logistique?.vehicules || {};
  const COLOR_MAP = {
    minerai:'#c0763a', plateau:'#8a7a5a', cereale:'#d4b842', marchandises:'#e6c84f',
    frigo:'#4fa6b8', citerne:'#64b7e8', bus:'#3a8fd4',
    // legacy
    bois:'#5e7a3a', ble:'#d7b348', coton:'#f1efe3', vetement:'#b98fcb',
    farine:'#eadfa8', pain:'#d99a45', poisson:'#4fa6b8', acier:'#7a8fa0',
  };
  const DEFS = {
    // --- types achetables ---
    minerai:     { nom:'Camion minerai',     icone:'🚛', resources:['iron','coal','dirt'],                                          cost:800,  capacite:15, speed:4.0 },
    plateau:     { nom:'Camion plateau',     icone:'🚚', resources:['wood','steel'],                                                cost:900,  capacite:14, speed:3.8 },
    cereale:     { nom:'Camion céréales',    icone:'🚜', resources:['wheat','cotton','flour'],                                      cost:600,  capacite:15, speed:4.0 },
    marchandises:{ nom:'Camion marchandises',icone:'🚐', resources:['goods','clothes','bread'],                                    cost:700,  capacite:12, speed:3.8 },
    frigo:       { nom:'Camion frigorifique',icone:'🚚', resources:['fish','fish_fillet'],                                         cost:750,  capacite:14, speed:3.8 },
    citerne:     { nom:'Camion citerne',     icone:'🚛', resources:['water','fish_oil'],                                           cost:750,  capacite:20, speed:3.5 },
    bus:         { nom:'Bus',                icone:'🚌', resources:[],                                                             cost:1500, capacite:40, speed:3.0 },
    // --- legacy (sauvegardes existantes, plus achetables) ---
    bois:        { nom:'Camion bois',        icone:'🚜', resources:['wood'],                   cost:600,  capacite:15, speed:4.0, buyDisabled:true },
    ble:         { nom:'Camion blé',         icone:'🚜', resources:['wheat'],                  cost:550,  capacite:15, speed:4.0, buyDisabled:true },
    coton:       { nom:'Chariot coton',      icone:'🛒', resources:['cotton'],                 cost:550,  capacite:15, speed:4.0, buyDisabled:true },
    vetement:    { nom:'Camion vêtements',   icone:'🚐', resources:['clothes'],                cost:650,  capacite:12, speed:3.8, buyDisabled:true },
    farine:      { nom:'Camion farine',      icone:'🚚', resources:['flour'],                  cost:650,  capacite:15, speed:3.8, buyDisabled:true },
    pain:        { nom:'Camion pain',        icone:'🚚', resources:['bread'],                  cost:700,  capacite:15, speed:3.8, buyDisabled:true },
    poisson:     { nom:'Chariot poisson',    icone:'🛒', resources:['fish','fish_fillet','fish_oil'], cost:650, capacite:14, speed:3.8, buyDisabled:true },
    acier:       { nom:'Camion acier',       icone:'🚚', resources:['steel'],                  cost:1000, capacite:12, speed:3.5, buyDisabled:true },
  };
  const out = {};
  for(const k in DEFS){
    const d = DEFS[k], c = cfgV[k] || {};
    out[k] = {
      nom:         c.nom        ?? d.nom,
      icone:       c.icone      ?? d.icone,
      resources:   c.ressources ?? d.resources,
      cost:        c.cout       ?? d.cost,
      capacite:    c.capacite   ?? d.capacite,
      speed:       c.vitesse    ?? d.speed,
      color:       COLOR_MAP[k],
      buyDisabled: d.buyDisabled ?? false,
    };
  }
  return out;
})();
const GARAGE_COST = CFG.logistique?.garage?.cout ?? 1200;
const BUS_STOP_COST = CFG.logistique?.arretBus?.cout ?? 250;

const RES = {
  iron:  { n:'Fer',                    c:'#d98a4f', ic:'🔩' },
  coal:  { n:'Charbon',                c:'#454552', ic:'⚫' },
  wood:  { n:'Bois',                   c:'#a4713d', ic:'🪵' },
  wheat: { n:'Blé',                    c:'#d7b348', ic:'🌾' },
  cotton:{ n:'Coton',                  c:'#f1efe3', ic:'☁️' },
  clothes:{ n:'Vêtement',              c:'#b98fcb', ic:'👕' },
  flour: { n:'Farine',                 c:'#eadfa8', ic:'🫙' },
  water: { n:'Eau',                    c:'#64b7e8', ic:'💧' },
  bread: { n:'Pain',                   c:'#d99a45', ic:'🍞' },
  fish:  { n:'Poisson',                c:'#4fa6b8', ic:'🐟' },
  fish_fillet: { n:'Filet de poisson', c:'#c7e7e9', ic:'🍣' },
  fish_oil:    { n:'Huile de poisson', c:'#d6b45c', ic:'🫒' },
  steel: { n:'Acier',                  c:'#a8bdd2', ic:'⚙️' },
  goods: { n:'Outils de construction', c:'#e6c84f', ic:'🔧' },
  dirt:  { n:'Terre',                  c:'#8B6347', ic:'🌑' },
};

const GRAPHIC_PACKS = {
  classic: {
    n: 'Classique',
    desc: 'Couleurs lisibles proches du rendu original.',
    mode: 'polygon',
    sky: ['#1c2740', '#0b101a'],
    grass: ['#74b048','#6ea944','#7ab84d','#68a23f'],
    water: ['#3590cf','#3187c2'],
    road: '#33373e',
    roadLine: '#4c525c',
    roof: 'flat',
    category: {},
    buildings: {},
  },
  brick: {
    n: 'Briques',
    desc: 'Toits chauds et bâtiments plus urbains.',
    mode: 'polygon',
    sky: ['#26384b', '#111820'],
    grass: ['#6d9d4a','#638f43','#78aa54','#5b883b'],
    water: ['#2f87b5','#2b799f'],
    road: '#3a3430',
    roadLine: '#5a524a',
    roof: 'tiles',
    category: {
      resid: '#b0644c',
      ind: '#8a5e45',
      storage: '#78613f',
    },
    buildings: {
      road: '#3a3430',
      house: '#b46d4f',
      duplex: '#a85f48',
      row: '#ad634d',
      residence: '#9a6a5a',
      tower: '#7a6b72',
      tower3: '#68647a',
      bigtower: '#6f7181',
      sky: '#5f6f86',
      depot: '#816b45',
      garage: '#56606c',
      tank: '#47728d',
    },
  },
  modern: {
    n: 'Moderne',
    desc: 'Façades froides, verre et routes plus nettes.',
    mode: 'polygon',
    sky: ['#203049', '#0d121a'],
    grass: ['#5f9f55','#57964f','#66aa5c','#4f8849'],
    water: ['#2c99d5','#228bc6'],
    road: '#2c3440',
    roadLine: '#596675',
    roof: 'glass',
    category: {
      resid: '#6f89a4',
      ind: '#63707d',
      storage: '#5f6b78',
    },
    buildings: {
      mine: '#6c625d',
      lumber: '#5f8151',
      farm: '#a19a4f',
      cotton_farm: '#d7d1b8',
      weaver: '#8f6b9f',
      pump: '#4e8aa2',
      mill: '#8a8f91',
      bakery: '#b9845d',
      smelter: '#75606a',
      factory: '#5d7088',
      plant: '#59626d',
      depot: '#667077',
      tank: '#4d7f99',
      garage: '#516178',
    },
  },
  industrial: {
    n: 'Industriel',
    desc: "Métal sombre, sols plus ternes et détails d'usine.",
    mode: 'polygon',
    sky: ['#202833', '#101216'],
    grass: ['#667d4b','#5f7445','#718656','#586d41'],
    water: ['#347f95','#2d6f82'],
    road: '#2c2c2c',
    roadLine: '#555555',
    roof: 'vents',
    category: {
      resid: '#7b6a5b',
      ind: '#5c6062',
      storage: '#575a50',
    },
    buildings: {
      mine: '#67594f',
      smelter: '#6b4b43',
      factory: '#4f5a66',
      plant: '#454b52',
      depot: '#5c5842',
      garage: '#454f63',
      tank: '#3d6476',
    },
  },
};

const GRAPHIC_PACK_REGISTRY_URL = 'assets/graphic-packs/packs.json';
const GRAPHIC_PACK_IMAGES = {};

function joinAssetUrl(base, src){
  if(!src) return '';
  if(/^(https?:|data:|blob:|\/)/.test(src)) return src;
  return base + src.replace(/^\.?\//, '');
}

function normalizeGraphicSprite(value, baseUrl){
  if(!value) return null;
  if(typeof value === 'string') value = { src:value };
  const out = Object.assign({}, value);
  if(out.src) out.src = joinAssetUrl(baseUrl, out.src);
  if(out.variants){
    const vars = {};
    for(const key in out.variants) vars[key] = normalizeGraphicSprite(out.variants[key], baseUrl);
    out.variants = vars;
  }
  if(out.views){
    const views = {};
    for(const key in out.views) views[key] = normalizeGraphicSprite(out.views[key], baseUrl);
    out.views = views;
  }
  return out;
}

function registerCommunityGraphicPack(manifest, manifestUrl){
  if(!manifest || !manifest.id) return null;
  const id = 'asset:' + String(manifest.id).replace(/[^a-zA-Z0-9_\-]/g, '_');
  const baseUrl = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
  const buildings = {};
  for(const key in (manifest.buildings || {}))
    buildings[key] = normalizeGraphicSprite(manifest.buildings[key], baseUrl);
  GRAPHIC_PACKS[id] = {
    n: manifest.name || manifest.id,
    desc: manifest.description || 'Pack graphique communautaire.',
    mode: 'sprite',
    fallback: GRAPHIC_PACKS[manifest.fallback] ? manifest.fallback : 'classic',
    baseUrl,
    tileWidth: manifest.tileWidth || 64,
    tileHeight: manifest.tileHeight || 32,
    defaultScale: manifest.defaultScale || 1,
    buildings,
  };
  return id;
}

async function loadCommunityGraphicPacks(){
  let registry;
  try {
    const res = await fetch(GRAPHIC_PACK_REGISTRY_URL, { cache:'no-store' });
    if(!res.ok) return [];
    registry = await res.json();
  } catch(e){ return []; }
  const entries = Array.isArray(registry) ? registry : (registry.packs || []);
  const loaded = [];
  for(const entry of entries){
    const manifestUrl = typeof entry === 'string' ? entry : entry.manifest;
    if(!manifestUrl) continue;
    const url = joinAssetUrl('assets/graphic-packs/', manifestUrl);
    try {
      const res = await fetch(url, { cache:'no-store' });
      if(!res.ok) continue;
      const id = registerCommunityGraphicPack(await res.json(), url);
      if(id) loaded.push(id);
    } catch(e){}
  }
  return loaded;
}

// Prix de vente inter-joueurs (par unité)
const TRADE_PRICES = (()=>{
  const cfg = CFG.commerce?.prix || {};
  return {
    iron:  cfg.fer          ?? 8,
    coal:  cfg.charbon      ?? 6,
    wood:  cfg.bois         ?? 5,
    wheat: cfg.ble          ?? 4,
    cotton: cfg.coton       ?? 6,
    clothes: cfg.vetement   ?? 18,
    flour: cfg.farine       ?? 7,
    water: cfg.eau          ?? 2,
    bread: cfg.pain         ?? 12,
    fish:  cfg.poisson      ?? 7,
    fish_fillet: cfg.filetPoisson ?? 14,
    fish_oil:    cfg.huilePoisson ?? 11,
    steel: cfg.acier        ?? 14,
    goods: cfg.marchandises ?? 10,
    dirt:  cfg.terre        ?? 1,
  };
})();

const PROD_CONFIG_KEYS = {
  mine:'mine',
  bucheron:'lumber',
  ferme:'farm',
  coton:'cotton_farm',
  tissage:'weaver',
  pompe:'pump',
  pecheur:'fisher',
  moulin:'mill',
  boulangerie:'bakery',
  poissonnerie:'fishery',
  fonderie:'smelter',
  usine:'factory',
};
const PROD_TYPE_TO_CONFIG_KEY = {};
for(const fr in PROD_CONFIG_KEYS) PROD_TYPE_TO_CONFIG_KEY[PROD_CONFIG_KEYS[fr]] = fr;

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
  cotton_farm:{ n:'Ferme de coton', ic:'☁️', hk:'', cost: CFG.production?.coton?.cout ?? 320,
             workers:2, time:3.0, col:'#d7d1b8', hgt:12, ind:true,
             upkeep: CFG.production?.coton?.entretien ?? 1.2,
             recipe:{ in:{}, out:{cotton:1} },
             desc:"À placer à 2 cases ou moins d'un champ de coton. Produit du coton." },
  weaver:  { n:'Usine de tissage', ic:'🧵', hk:'', cost: CFG.production?.tissage?.cout ?? 900,
             workers:4, time:3.8, col:'#8f6b9f', hgt:24, ind:true,
             upkeep: CFG.production?.tissage?.entretien ?? 2.4,
             recipe:{ in:{cotton:3}, out:{clothes:1} },
             desc:'3 cotons → 1 vêtement.' },
  pump:    { n:'Pompe',     ic:'💧', hk:'9', cost: CFG.production?.pompe?.cout    ?? 500,
             workers:1, time:2.5, col:'#4f86a8', hgt:14, ind:true,
             upkeep: CFG.production?.pompe?.entretien ?? 1.5,
             recipe:{ in:{}, out:{water:1} },
             desc:"À placer sur l'herbe au bord de l'eau. Produit de l'eau." },
  fisher:  { n:'Cabane de pêcheur', ic:'🎣', hk:'', cost: CFG.production?.pecheur?.cout ?? 420,
             workers:2, time:3.0, col:'#4f7f86', hgt:15, ind:true,
             upkeep: CFG.production?.pecheur?.entretien ?? 1.4,
             recipe:{ in:{}, out:{fish:1} },
             desc:"À placer sur l'herbe au bord de l'eau. Produit du poisson." },
  mill:    { n:'Moulin',    ic:'⚙️', hk:'', cost: CFG.production?.moulin?.cout   ?? 650,
             workers:3, time:3.2, col:'#b9a77a', hgt:24, ind:true,
             upkeep: CFG.production?.moulin?.entretien ?? 2,
             recipe:{ in:{wheat:2}, out:{flour:1} },
             desc:'2 blés → 1 farine.' },
  bakery:  { n:'Boulangerie', ic:'🥖', hk:'', cost: CFG.production?.boulangerie?.cout ?? 950,
             workers:4, time:3.5, col:'#c18149', hgt:24, ind:true,
             upkeep: CFG.production?.boulangerie?.entretien ?? 2.5,
             recipe:{ in:{coal:0.5, flour:2, water:1}, out:{bread:1} },
             desc:"½ charbon + 2 farines + eau → pain. Nécessite une citerne proche pour l'eau." },
  fishery: { n:'Poissonnerie', ic:'🐟', hk:'', cost: CFG.production?.poissonnerie?.cout ?? 850,
             workers:3, time:3.4, col:'#4d7f8a', hgt:22, ind:true,
             upkeep: CFG.production?.poissonnerie?.entretien ?? 2.2,
             recipe:{ in:{fish:2}, out:{fish_fillet:1, fish_oil:1} },
             desc:'2 poissons → 1 filet de poisson + 1 huile de poisson.' },
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
  plant:   { n:'Usine',     ic:'🏚️', hk:'5', cost: CFG.batiments?.usineAbandonee?.cout ?? 150, col:'#4e5663', hgt:18,
             desc:"Usine abandonnée. À convertir ensuite en aciérie, ferme, ferme de coton, tissage, moulin, boulangerie ou usine d'outils." },
  house:   { n:'Maison',    ic:'🏠', hk:'6', cost: CFG.batiments?.maison?.cout    ?? 100,
             col:'#9a7e5f', hgt:18, desc:'' },
  depot:   { n:'Entrepôt',        ic:'📦', hk:'7', cost: CFG.batiments?.entrepot?.cout  ?? 400,
             col:'#7a7048', hgt:22,
             desc:'Stocke et redistribue. Cliquer dessus pour choisir les ressources acceptées.' },
  market:  { n:'Marché',          ic:'🏬', hk:'M', cost: CFG.batiments?.marche?.cout    ?? 600,
             col:'#7a5a30', hgt:20,
             desc:'Stocke et vend des ressources aux autres joueurs. Configurer les ressources en vente depuis le panneau.' },
  tank:    { n:'Entrepôt citerne', ic:'🛢️', hk:'8', cost: CFG.batiments?.citerne?.cout ?? 450,
             col:'#3f6f8f', hgt:18,
             desc:"Stocke uniquement l'eau. À placer près des boulangeries." },
  garage:  { n:'Dépôt véhicules', ic:'🚛', hk:'0', cost: GARAGE_COST, col:'#3d4f6b', hgt:20,
             desc:'Achète et gère des véhicules de transport spécialisés.' },
  bus_stop:{ n:'Arrêt de bus',   ic:'🚏', hk:'', cost: BUS_STOP_COST, col:'#1e4a8a', hgt:12,
             desc:'Accueille les passagers du quartier (rayon '+BUS_STOP_RADIUS+' cases). Les bus transportent les habitants entre arrêts.' },
  bulldoze: { n:'Démolir',    ic:'🧨', hk:'B', desc:'Détruit routes, bâtiments (30 % remboursés) et arbres.' },
  terraform:{ n:'Bulldozer',  ic:'🚜', hk:'-', desc:'Rase les gisements (fer/charbon), les champs et les sapins en herbe.' },
  fill_water:{ n:'Remblai',   ic:'🪣', hk:'', desc:'Comble une tuile d\'eau en terre (10 terres requises). Nécessite une usine de terrassement à portée.' },
  terrassement: { n:'Usine de terrassement', ic:'🏗️', hk:'', cost: CFG.production?.terrassement?.cout ?? 700,
                  workers:3, time:1, col:'#7a6a52', hgt:20, ind:true,
                  upkeep: CFG.production?.terrassement?.entretien ?? 1.5,
                  recipe:{ in:{}, out:{} },
                  desc:'Reçoit de la terre (via camion minerai). Rayon d\'action '+
                       (CFG.production?.terrassement?.rayon ?? 10)+
                       ' cases : permet de combler l\'eau avec l\'outil Remblai (10 terres/tuile).' },
};

const PLANT_UPGRADES = {
  smelter: { label:'Aciérie',       type:'smelter', icon:'🔥' },
  farm:    { label:'Ferme',         type:'farm',    icon:'🌾' },
  cotton_farm:{ label:'Ferme de coton', type:'cotton_farm', icon:'☁️' },
  weaver:  { label:'Usine de tissage', type:'weaver', icon:'🧵' },
  mill:    { label:'Moulin',        type:'mill',    icon:'⚙️' },
  bakery:  { label:'Boulangerie',   type:'bakery',  icon:'🥖' },
  fishery: { label:'Poissonnerie',  type:'fishery', icon:'🐟' },
  factory: { label:'Outils de construction', type:'factory', icon:'🏭' },
  terrassement: { label:'Usine de terrassement', type:'terrassement', icon:'🏗️' },
};
// ---------- niveaux résidentiels ----------
// Un rectangle entièrement couvert de logements PLEINS plus petits fusionne
// en bâtiment du niveau correspondant (les deux orientations comptent).
const LEVELS = [
  { key:'house',     cfg:CFG.maison,                     n:'Maison',            ic:'🏠', shapes:[[1,1]],       col:'#9a7e5f', hgt:18,
    def:{ interval:8, income:25, popCap:5,   stockCap:10 } },
  { key:'duplex',    cfg:CFG.duplex ?? CFG.residentiel?.duplex, n:'Maison jumelée', ic:'🏡', shapes:[[2,1],[1,2]], col:'#8d7a52', hgt:24,
    def:{ interval:7, income:27, popCap:12,  stockCap:14 } },
  { key:'row',       cfg:CFG.rangee ?? CFG.residentiel?.rangee, n:'Maisons en rangée', ic:'🏘️', shapes:[[3,1],[1,3]], col:'#97705a', hgt:27,
    def:{ interval:6, income:28, popCap:20,  stockCap:18 } },
  { key:'residence', cfg:CFG.residence ?? CFG.residentiel?.residence, n:'Résidence', ic:'🏨', shapes:[[4,1],[1,4]], col:'#7a6a8a', hgt:34,
    def:{ interval:5, income:30, popCap:28,  stockCap:22 } },
  { key:'tower',     cfg:CFG.immeuble,                   n:'Immeuble',          ic:'🏢', shapes:[[2,2]],       col:'#6b5d8c', hgt:58,
    def:{ interval:4, income:25, popCap:30,  stockCap:25 } },
  { key:'bigtower',  cfg:CFG.grandImmeuble ?? CFG.residentiel?.grandImmeuble, n:'Grand immeuble', ic:'🏬', shapes:[[3,2],[2,3]], col:'#5d6da0', hgt:84,
    def:{ interval:3, income:28, popCap:60,  stockCap:40 } },
  { key:'tower3',    cfg:CFG.tour,                       n:'Tour',              ic:'🏙️', shapes:[[3,3]],       col:'#5a617a', hgt:105,
    def:{ interval:2.5, income:29, popCap:95, stockCap:60 } },
  { key:'sky',       cfg:CFG.gratteCiel ?? CFG.residentiel?.gratteCiel, n:'Gratte-ciel', ic:'🏙️', shapes:[[4,4]], col:'#4a5a78', hgt:130,
    def:{ interval:2, income:30, popCap:150, stockCap:80 } },
].map(L=> ({ key:L.key, n:L.n, ic:L.ic, col:L.col, hgt:L.hgt,
             shapes: L.cfg?.formes ?? L.shapes,
             resid: _resid(L.cfg, L.def) }));

(function applyLevels(){
  for(const L of LEVELS){
    const area = L.shapes[0][0]*L.shapes[0][1];
    if(L.key==='house'){
      Object.assign(BUILD.house, { resid:L.resid, area:1 });
      BUILD.house.desc = 'Consomme '+resNames(L.resid.required)+' → +1 habitant et +'+L.resid.income
        +' $ par habitant. Fusion : '+resNames(L.resid.fusionRequired)+'.';
      continue;
    }
    BUILD[L.key] = { n:L.n, ic:L.ic, col:L.col, hgt:L.hgt, cost:100*area, area,
      size:L.shapes[0][0], resid:L.resid,
      desc:'Fusion de logements pleins ('+L.shapes.map(s=>s[0]+'×'+s[1]).join(' ou ')
        +'). '+L.resid.popCap+' habitants.' };
  }
})();

function _residCfgOf(b){
  const type = typeof b === 'string' ? b : b?.type;
  return BUILD[type]?.resid || null;
}
function residRequiredOf(b){ return _residCfgOf(b)?.required || DEFAULT_RESIDENT_NEEDS; }
function residFusionRequiredOf(b){ return _residCfgOf(b)?.fusionRequired || DEFAULT_RESIDENT_FUSION_NEEDS; }
function residBonusOf(b){ return _residCfgOf(b)?.bonus || DEFAULT_RESIDENT_BONUS; }
function residDeliveryResourcesOf(b){
  const out = [];
  for(const r of [...residRequiredOf(b), ...residFusionRequiredOf(b), ...residBonusOf(b)]){
    if(RES[r] && !out.includes(r)) out.push(r);
  }
  return out;
}
function residHasAll(b, list){
  return list.every(r => (b.storage[r]||0) > 0);
}
function residConsumeAll(b, list){
  for(const r of list) b.storage[r] = Math.max(0, (b.storage[r]||0) - 1);
}
function resNames(list){
  return list.filter(r => RES[r]).map(r => RES[r].n.toLowerCase()).join(' + ');
}
// niveaux fusionnables, du plus grand au plus petit
const MERGE_ORDER = LEVELS.filter(L=>L.key!=='house')
  .sort((a,b)=> b.shapes[0][0]*b.shapes[0][1] - a.shapes[0][0]*a.shapes[0][1]);

// ---------- fusion industrielle ----------
// production d'un bâtiment fusionné = cases × facteur (palier ≤ taille)
const DEFAULT_IND_SHAPES = [[4,4],[3,2],[2,3],[2,2],[4,1],[1,4],[3,1],[1,3],[2,1],[1,2]];
function normalizeShapeList(raw, def=DEFAULT_IND_SHAPES){
  const list = Array.isArray(raw) && raw.length ? raw : def;
  const seen = new Set();
  const out = [];
  const add = (w,h)=>{
    w = Math.max(1, Math.floor(+w || 0));
    h = Math.max(1, Math.floor(+h || 0));
    if(!w || !h) return;
    for(const [sw,sh] of [[w,h],[h,w]]){
      const k = sw+','+sh;
      if(!seen.has(k)){ seen.add(k); out.push([sw,sh]); }
    }
  };
  for(const shape of list){
    if(Array.isArray(shape)) add(shape[0], shape[1]);
    else if(typeof shape === 'string'){
      const m = shape.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
      if(m) add(m[1], m[2]);
    }
  }
  return (out.length ? out : normalizeShapeList(def, DEFAULT_IND_SHAPES))
    .sort((a,b)=> (b[0]*b[1] - a[0]*a[1]) || (b[0] - a[0]));
}
const IND_SHAPES = normalizeShapeList(CFG.industrie?.formesFusion);
function configuredIndShapesFor(type){
  const fr = PROD_TYPE_TO_CONFIG_KEY[type] || type;
  const perType = CFG.industrie?.formesParType || {};
  return normalizeShapeList(
    CFG.production?.[fr]?.formesFusion
      ?? perType[type]
      ?? perType[fr]
      ?? CFG.industrie?.formesFusion,
    IND_SHAPES
  );
}
const IND_SHAPES_BY_TYPE = {};
const allIndShapes = [];
for(const fr in PROD_CONFIG_KEYS){
  const type = PROD_CONFIG_KEYS[fr];
  IND_SHAPES_BY_TYPE[type] = configuredIndShapesFor(type);
  for(const shape of IND_SHAPES_BY_TYPE[type]) allIndShapes.push(shape);
}
const IND_SHAPES_ALL = normalizeShapeList(allIndShapes, IND_SHAPES);
function indShapeAllowed(type,w,h){
  return (IND_SHAPES_BY_TYPE[type] || IND_SHAPES).some(([sw,sh]) => sw===w && sh===h);
}
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
  const isResid = !!BUILD[b.type]?.resid;
  const bx = b.x + b.w/2, by = b.y + b.h/2;
  let nearest = null, nearestDist = Infinity;
  for(const t of towns){
    const d = Math.hypot(bx - t.cx, by - t.cy);
    if(d < nearestDist){ nearestDist = d; nearest = t; }
  }
  if(nearest && nearestDist <= TOWN_RADIUS){
    b.townId = nearest.id;
  } else if(isResid){
    // Seuls les bâtiments résidentiels peuvent créer un nouveau village
    const name = generateTownName(Math.round(bx), Math.round(by));
    const t = { id: nextTownId++, name, cx: bx, cy: by };
    towns.push(t);
    b.townId = t.id;
    if(selectedTownId == null && ownedBy(b, myOwner())) selectedTownId = t.id;
    if(!silent) toast('🏘️ Nouveau village : ' + name, 'win');
  }
  // Les non-résidentiels sans village proche gardent townId=null
}

// ---------- noms d'industrie par village ----------
const IND_NAMES = {
  mine:    ['Mine de Fer','Puits Noir','Mine Profonde','Mine Royale','Vieux Puits','Mine du Nord','Carrière Centrale','Mine de l\'Ouest','Mine des Anciens','Mine du Pic'],
  lumber:  ['Scierie du Bois','Bûcherie Verte','Scierie des Pins','Grand Moulin','Scierie Royale','Scierie du Moulin','Bûcherie Centrale','Scierie du Nord','Vieille Scierie','Bûcherie des Chênes'],
  farm:    ['Ferme des Blés','Domaine Doré','Ferme du Moulin','Grange Centrale','Ferme de la Plaine','Domaine des Épis','Ferme du Nord','Métairie Royale','Champ Fleuri','Ferme des Moissons'],
  cotton_farm:['Cotonnerie Blanche','Domaine du Coton','Champ des Toiles','Ferme Blanche','Clos des Fibres','Métairie du Linon','Champ Nuageux','Ferme des Balles'],
  weaver:  ['Atelier de Tissage','Maison des Toiles','Tissage Royal','Filature Centrale','Atelier des Draps','Tissage du Nord','Halle aux Étoffes','Manufacture Textile'],
  pump:    ['Pompe du Lac','Station des Rives','Pompe Centrale','Station Bleue','Pompe du Canal','Pompe des Berges','Station du Nord','Pompe Royale','Station Claire','Pompe de la Source'],
  fisher:  ['Cabane des Rives','Pêcherie du Lac','Cabane du Pont','Pêcherie Royale','Cabane des Filets','Pêcherie du Nord','Hutte du Pêcheur','Cabane des Berges','Pêcherie Claire','Port aux Poissons'],
  mill:    ['Moulin des Blés','Moulin Blanc','Moulin du Pont','Grand Moulin','Moulin de la Plaine','Moulin des Épis','Moulin du Nord','Moulin Royal','Moulin de la Vallée','Vieux Moulin'],
  bakery:  ['Boulangerie Centrale','Four des Blés','Boulangerie du Pont','Pain Doré','Boulangerie Royale','Fournil du Nord','Maison du Pain','Boulangerie des Épis','Grand Fournil','Pain de la Vallée'],
  fishery: ['Poissonnerie Centrale','Halle aux Poissons','Fileterie du Port','Poissonnerie Royale','Atelier des Filets','Poissonnerie du Nord','Fileterie Claire','Maison du Poisson','Halle des Rives','Fileterie des Berges'],
  smelter: ['Grande Forge','Fonderie du Feu','Forge Ardente','Forge du Roi','Fonderie Centrale','Vieille Forge','Forge des Maîtres','Fonderie du Nord','Forge Royale','Forge de la Vallée'],
  factory: ['Manufacture Centrale','Atelier du Peuple','Grande Usine','Fabrique Royale','Usine Municipale','Atelier des Arts','Grande Fabrique','Usine Centrale','Fabrique du Nord','Manufacture Royale'],
  terrassement: ['Chantier Central','Entreprise du Sol','Chantier des Berges','Remblai du Lac','Chantier Royal','Terrassement du Nord','Chantier des Rives','Entreprise de la Vallée','Grand Chantier','Chantier des Marais'],
  market: ['Grand Marché','Marché du Peuple','Halle aux Denrées','Marché Royal','Marché Central','Marché du Nord','Halle Centrale','Marché des Halles','Grand Bazar','Marché de la Place'],
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

// Retourne les bâtiments (non-morts) d'un village
function townBuildings(tid){
  return buildings.filter(b => !b.dead && b.townId === tid);
}

// Distance minimum bord-à-bord entre deux bâtiments (0 = adjacent ou superposé)
function buildingEdgeGap(a, b){
  const gapX = Math.max(0, Math.max(a.x - (b.x + (b.w||1)), b.x - (a.x + (a.w||1))));
  const gapY = Math.max(0, Math.max(a.y - (b.y + (b.h||1)), b.y - (a.y + (a.h||1))));
  return Math.max(gapX, gapY);
}

// Retourne les villages fusionnables avec t (min gap entre bâtiments ≤ MERGE_TOWN_GAP)
const MERGE_TOWN_GAP = 10;
function mergeableTowns(t){
  const aMems = townBuildings(t.id);
  if(!aMems.length) return [];
  const result = [];
  for(const other of towns){
    if(other.id === t.id) continue;
    const bMems = townBuildings(other.id);
    if(!bMems.length) continue;
    let minGap = Infinity;
    for(const a of aMems){
      for(const bld of bMems){
        const g = buildingEdgeGap(a, bld);
        if(g < minGap) minGap = g;
      }
    }
    if(minGap <= MERGE_TOWN_GAP) result.push({ town: other, gap: minGap });
  }
  return result;
}

// Fusionne srcId dans dstId : tous les bâtiments de srcId → dstId, supprime srcId
function mergeTowns(dstId, srcId){
  for(const b of buildings){
    if(!b.dead && b.townId === srcId) b.townId = dstId;
  }
  towns = towns.filter(t => t.id !== srcId);
  if(selectedTownId === srcId) selectedTownId = dstId;
}

// Réassigne tous les bâtiments de owner dans le rectangle [x1,y1]-[x2,y2] au village dstId
function reassignBuildingsInRect(dstId, x1, y1, x2, y2, owner){
  const rx1 = Math.min(x1,x2), rx2 = Math.max(x1,x2);
  const ry1 = Math.min(y1,y2), ry2 = Math.max(y1,y2);
  for(const b of buildings){
    if(b.dead) continue;
    if(owner != null && b.owner !== owner) continue;
    const bx2 = b.x + (b.w||1) - 1, by2 = b.y + (b.h||1) - 1;
    if(b.x <= rx2 && bx2 >= rx1 && b.y <= ry2 && by2 >= ry1){
      b.townId = dstId;
    }
  }
  // Supprimer les villages sans habitants résidentiels
  towns = towns.filter(t => buildings.some(b => !b.dead && b.townId === t.id && BUILD[b.type]?.resid));
}


const DEPOT_STOCK_PER_CELL  = CFG.entrepot?.stockParCase ?? 20;
const DEPOT_RADIUS_BASE     = CFG.entrepot?.rayonBase    ?? 5;
const DEPOT_RADIUS_FACTOR   = CFG.entrepot?.rayonFacteur ?? 3;
const depotRadiusOf = b => Math.round(DEPOT_RADIUS_BASE + Math.sqrt(b.w * b.h) * DEPOT_RADIUS_FACTOR);
const TANK_STOCK_PER_CELL  = CFG.citerne?.stockParCase ?? 40;
const TANK_RADIUS_BASE     = CFG.citerne?.rayonBase    ?? 5;
const TANK_RADIUS_FACTOR   = CFG.citerne?.rayonFacteur ?? 3;
const BAKERY_TANK_RADIUS   = CFG.citerne?.rayonBoulangerie ?? 8;
const tankRadiusOf = b => Math.round(TANK_RADIUS_BASE + Math.sqrt(b.w * b.h) * TANK_RADIUS_FACTOR);
const isStorageHub = b => b && (b.type === 'depot' || b.type === 'market' || b.type === 'tank');
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
  for(const fr in PROD_CONFIG_KEYS) if(p[fr]?.entretien != null) BUILD[PROD_CONFIG_KEYS[fr]].upkeep = p[fr].entretien;
})();

// surcharge des recettes et coûts par config.js (clés françaises)
(function applyProductionConfig(){
  const p = CFG.production || {};
  for(const fr in PROD_CONFIG_KEYS){
    const c = p[fr];
    if(!c) continue;
    const b = BUILD[PROD_CONFIG_KEYS[fr]];
    if(c.temps != null) b.time = c.temps;
    if(c.cout  != null) b.cost = c.cout;
    if(fr==='mine'){ if(c.quantite != null) b.qty = c.quantite; continue; }
    if(c.entree) b.recipe.in  = c.entree;
    if(c.sortie) b.recipe.out = c.sortie;
  }
  // coûts des bâtiments civils
  const bats = CFG.batiments || {};
  if(bats.route?.cout          != null) BUILD.road.cost   = bats.route.cout;
  if(bats.usineAbandonee?.cout != null) BUILD.plant.cost  = bats.usineAbandonee.cout;
  if(bats.maison?.cout         != null) BUILD.house.cost  = bats.maison.cout;
  if(bats.entrepot?.cout       != null) BUILD.depot.cost  = bats.entrepot.cout;
  if(bats.citerne?.cout        != null) BUILD.tank.cost   = bats.citerne.cout;
})();

const TOOL_ORDER = ['select','road','mine','lumber','fisher','plant','house','depot','market','tank','pump','garage','bus_stop','bulldoze','terraform','fill_water'];
const MILESTONES = [25, 50, 100, 200, 400];
