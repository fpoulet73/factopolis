'use strict';
/* ===================== Factopolis =====================
   Factorio (chaînes de production) + City builder (population/ouvriers)
   + Transport Tycoon (camions sur routes).
   Rendu isométrique 2.5D rotatif (touche R). Canvas 2D, zéro dépendance. */

// ---------- configuration (voir config.js) ----------
const CFG = (typeof CONFIG !== 'undefined') ? CONFIG : {};
const DEFAULT_RESIDENT_NEEDS = ['fish_fillet'];
const DEFAULT_RESIDENT_UPGRADE_NEEDS = { goods:1 };
const DEFAULT_RESIDENT_BONUS = [];
function _resList(raw, def){
  const list = Array.isArray(raw) ? raw : def;
  const out = [];
  for(const r of list || []){
    if(typeof r === 'string' && r && !out.includes(r)) out.push(r);
  }
  return out;
}
function _resMap(raw, def){
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : def;
  const out = {};
  for(const k in (src || {})){
    const n = Math.max(0, Math.floor(+src[k] || 0));
    if(typeof k === 'string' && k && n > 0) out[k] = n;
  }
  return out;
}
function _resid(c, def){
  c = c || {};
  const required = _resList(c.ressourcesIndispensables, def.required || DEFAULT_RESIDENT_NEEDS);
  const upgradeTargets = _resMap(c.ressourcesUpgrade, def.upgradeTargets || DEFAULT_RESIDENT_UPGRADE_NEEDS);
  const bonus = _resList(c.ressourcesBonus, def.bonus || DEFAULT_RESIDENT_BONUS);
  return {
    interval: c.intervalleConsommation ?? def.interval,
    income:   c.revenuParUnite        ?? def.income,
    popCap:   c.habitantsMax          ?? def.popCap,
    stockCap: c.stockMax              ?? def.stockCap,
    required,
    upgradeTargets,
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
const TW = 64, TH = 36;  // taille d'une tuile iso à l'écran (36 pour perspective correcte)
const TW2 = TW/2, TH2 = TH/2;
const T = { GRASS:0, WATER:1, TREE:2, IRON:3, COAL:4, WHEAT:5, COTTON:6, SAND:7, CLAY:8,
            COPPER:9, GOLD:10, LIMESTONE:11, OIL:12 };
// Gisements exploitables par une mine (tuile → ressource extraite). Le sable et
// l'argile du littoral, le calcaire (carrière) et l'or s'extraient aussi à la mine.
const DEPOSIT_ORES = {
  [T.IRON]:'iron', [T.COAL]:'coal', [T.COPPER]:'copper_ore', [T.GOLD]:'gold_ore',
  [T.LIMESTONE]:'limestone', [T.SAND]:'sand', [T.CLAY]:'clay',
};
const isMineDeposit = ter => DEPOSIT_ORES[ter] != null;
// Tuiles « ressource » rasables au bulldozer (champs, arbres, gisements, nappes).
const isClearableTerrain = ter => ter === T.TREE || ter === T.WHEAT || ter === T.COTTON || ter === T.OIL || isMineDeposit(ter);
const DIRS  = [[1,0],[-1,0],[0,1],[0,-1]];
const DIRS8 = [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1],[1,1],[-1,-1]];
const RAIL_DIRS = [
  { dx:1, dy:0, bit:1, opposite:1 },
  { dx:-1, dy:0, bit:2, opposite:0 },
  { dx:0, dy:1, bit:4, opposite:3 },
  { dx:0, dy:-1, bit:8, opposite:2 },
  { dx:1, dy:-1, bit:16, opposite:5 },
  { dx:-1, dy:1, bit:32, opposite:4 },
  { dx:1, dy:1, bit:64, opposite:7 },
  { dx:-1, dy:-1, bit:128, opposite:6 },
];
function railDirDef(dx, dy){
  return RAIL_DIRS.find(d => d.dx === dx && d.dy === dy) || null;
}
// Un train ne peut pas tourner plus qu'à 45° : la voie suivante doit aller tout
// droit, ou à 45° à gauche/droite par rapport à son sens d'arrivée. Les virages
// à 90°, 135° ou demi-tour sont physiquement impossibles. (inDx,inDy) est le sens
// d'arrivée ; (0,0) signifie « entrée libre » (pas de sens connu), donc autorisé.
function railTurnAllowed(inDx, inDy, outDx, outDy){
  if(!inDx && !inDy) return true;
  let d = Math.abs(Math.atan2(inDy, inDx) - Math.atan2(outDy, outDx));
  if(d > Math.PI) d = 2 * Math.PI - d;
  return d <= Math.PI / 4 + 1e-6; // ≤ 45°
}
function railHas(mask, def){
  return !!(mask && def && (mask & def.bit));
}
function railLinkCount(mask){
  let n = 0;
  for(const def of RAIL_DIRS) if(mask & def.bit) n++;
  return n;
}
function normalizeLegacyRailGrid(raw){
  const out = new Uint8Array(raw.length);
  const hasTypedMask = Array.from(raw).some(v => v > 1);
  if(hasTypedMask) return Uint8Array.from(raw);
  for(let i = 0; i < raw.length; i++){
    if(!raw[i]) continue;
    const x = i % N, y = (i / N) | 0;
    let mask = 0;
    for(const def of RAIL_DIRS){
      const nx = x + def.dx, ny = y + def.dy;
      if(nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const ni = ny * N + nx;
      if(raw[ni]) mask |= def.bit;
    }
    out[i] = mask;
  }
  return out;
}
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
const EXP_DEPTH  = 32;   // profondeur d'une tranche d'expansion (tuiles)
const EXP_MARGIN = 48;   // marge pré-générée de chaque côté à la création du monde
const GROW_CHUNK = EXP_MARGIN; // tuiles ajoutées d'un coup quand la grille doit grandir (voir growMap)
const MAP_MAX_N  = 1024; // plafond de sécurité absolu sur la taille de grille (coût pathfinding O(N²)/tick)

// ---------- véhicules persistants ----------
const BUS_STOP_RADIUS      = CFG.logistique?.arretBus?.rayon         ?? 8;
const BUS_FARE_FACTOR      = CFG.logistique?.arretBus?.tarif         ?? 1;
const BUS_INTRA_CITY_DIV   = CFG.logistique?.arretBus?.diviseurIntra ?? 3;
const BUS_DWELL_TIME       = (CFG.logistique?.arretBus?.tempsArret      ?? 2) / (CFG.jeu?.heuresParSeconde ?? 1); // gtime-s d'arrêt bus à quai
const VEHICLE_DWELL_TIME   = (CFG.logistique?.garage?.tempsArret         ?? 2) / (CFG.jeu?.heuresParSeconde ?? 1); // gtime-s d'arrêt véhicule chargement/déchargement
const BUS_STOP_FILL_TIME   = CFG.logistique?.arretBus?.tempsRemplissage ?? 30; // gtime-s de rush pour remplir
const AIRBNB_RATE_DAY      = CFG.logistique?.airbnb?.tarifJour      ?? 200; // $/voyageur/jour pour l'hôte
const AIRBNB_RATE_DAY_LUX  = CFG.logistique?.airbnb?.tarifJourLuxe  ?? 500; // idem en maison de luxe
const BUS_OWNER_SHARE      = CFG.logistique?.arretBus?.partProprietaire     ?? 0.8;
const TRAIN_DWELL_TIME        = (CFG.logistique?.train?.tempsArret ?? 2.5) / (CFG.jeu?.heuresParSeconde ?? 1);
const TRAIN_STATION_STOP_TIME = CFG.logistique?.train?.tempsArretGareSecondes ?? 5;
// Améliorations moteur du train : { facteur, cout }. Le facteur multiplie vitesse + entretien.
const TRAIN_ENGINE_UPGRADES = Array.isArray(CFG.logistique?.train?.ameliorationsMoteur)
  ? CFG.logistique.train.ameliorationsMoteur
  : [ { facteur:1.5, cout:1500 }, { facteur:2, cout:3000 }, { facteur:2.5, cout:5000 }, { facteur:3, cout:8000 } ];
// Prix d'achat d'un wagon (tous types confondus).
const TRAIN_WAGON_COST = CFG.logistique?.train?.coutWagon ?? 10000;
// Durée d'un jour de jeu en gtime-secondes (24h / GAME_HOURS_PER_SEC)
const VEHICLE_MAINTENANCE_DAY  = 24 / GAME_HOURS_PER_SEC;
const VEHICLE_MAINTENANCE_RATE = CFG.logistique?.tauxHausseMensuelle ?? CFG.logistique?.train?.tauxHausseMensuelle ?? 0.03;
// Péage d'utilisation des rails : $ payés au propriétaire des rails par tuile
// empruntée qui ne lui appartient pas (réglé au moment de l'entretien du train).
const RAIL_USAGE_TAX = CFG.logistique?.train?.peageRailParTuile ?? 1;
const TRAIN_STATION_RADIUS    = CFG.logistique?.gare?.rayon               ?? 12;
const TRAIN_STATION_FILL_TIME = CFG.logistique?.gare?.tempsRemplissage    ?? 8;
const TRAIN_FARE_FACTOR       = CFG.logistique?.gare?.tarif               ?? 2;
const TRAIN_FREIGHT_FACTOR    = CFG.logistique?.gare?.tarifFret            ?? 0.5;

// Paramètres des ports / aéroports (voir config.js logistique.bateau / avion).
const PORT_RADIUS          = CFG.logistique?.bateau?.rayon     ?? 10;
const SHIP_FARE_FACTOR     = CFG.logistique?.bateau?.tarif     ?? 0.5;
const SHIP_FREIGHT_FACTOR  = CFG.logistique?.bateau?.tarifFret ?? 0.05;
const AIRPORT_RADIUS       = CFG.logistique?.avion?.rayon      ?? 16;
const PLANE_FREIGHT_FACTOR = CFG.logistique?.avion?.tarifFret ?? 0.12;
const PLANE_FARE_FACTOR    = CFG.logistique?.avion?.tarif      ?? 1.1;
const ALL_CARGO_RESOURCES  = ['iron','coal','wood','wheat','cotton','clothes','flour','water','bread','fish','fish_fillet','fish_oil','steel','goods','dirt',
  'copper_ore','gold_ore','limestone','sand','clay','oil','copper','copper_wire','gold','steel_beam','steel_plate','nails',
  'cement','concrete','glass','window','rope','chemicals','fuel','plastic','glue','paint','circuit',
  'furniture','appliances','jewelry','quantum_chip','helium3','xenite'];
// Familles de cargaison partagées par les camions achetés et les wagons :
// vrac (minerais, granulats, ciment), plateau (profilés, bobines), marchandises
// (produits finis, fragiles ou précieux) et citerne (liquides et gaz).
const CARGO_BULK   = ['iron','coal','dirt','copper_ore','gold_ore','limestone','sand','clay','cement','concrete'];
const CARGO_FLAT   = ['wood','steel','steel_beam','steel_plate','rope','copper','copper_wire','nails'];
const CARGO_GOODS  = ['goods','clothes','bread','glass','window','paint','plastic','glue','circuit','furniture','appliances','jewelry','gold','xenite','quantum_chip'];
const CARGO_LIQUID = ['water','fish_oil','oil','fuel','chemicals','helium3'];

const VEHICLE_TYPES = (()=>{
  const cfgV = CFG.logistique?.vehicules || {};
  const cfgShip = CFG.logistique?.bateau || {};
  const cfgPlane = CFG.logistique?.avion || {};
  const COLOR_MAP = {
    minerai:'#c0763a', plateau:'#8a7a5a', cereale:'#d4b842', marchandises:'#e6c84f',
    frigo:'#4fa6b8', citerne:'#64b7e8', bus:'#3a8fd4', train:'#4f5c6f',
    cargo_ship:'#2f5f8f', ferry:'#e8eef2', plane:'#f4f6f8', cargo_plane:'#d9b26a',
    // legacy
    bois:'#5e7a3a', ble:'#d7b348', coton:'#f1efe3', vetement:'#b98fcb',
    farine:'#eadfa8', pain:'#d99a45', poisson:'#4fa6b8', acier:'#7a8fa0',
  };
  const DEFS = {
    // --- types achetables ---
    minerai:     { nom:'Camion minerai',     icone:'🚛', resources:CARGO_BULK.slice(),                                             cost:800,  capacite:15, speed:4.0, maintenanceCost: cfgV.minerai?.coutEntretienJournalier      ?? 5  },
    plateau:     { nom:'Camion plateau',     icone:'🚚', resources:CARGO_FLAT.slice(),                                             cost:900,  capacite:14, speed:3.8, maintenanceCost: cfgV.plateau?.coutEntretienJournalier      ?? 5  },
    cereale:     { nom:'Camion céréales',    icone:'🚜', resources:['wheat','cotton','flour'],                                      cost:600,  capacite:15, speed:4.0, maintenanceCost: cfgV.cereale?.coutEntretienJournalier      ?? 4  },
    marchandises:{ nom:'Camion marchandises',icone:'🚐', resources:CARGO_GOODS.slice(),                                            cost:700,  capacite:12, speed:3.8, maintenanceCost: cfgV.marchandises?.coutEntretienJournalier ?? 5  },
    frigo:       { nom:'Camion frigorifique',icone:'🚚', resources:['fish','fish_fillet'],                                         cost:750,  capacite:14, speed:3.8, maintenanceCost: cfgV.frigo?.coutEntretienJournalier        ?? 5  },
    citerne:     { nom:'Camion citerne',     icone:'🚛', resources:CARGO_LIQUID.slice(),                                           cost:750,  capacite:20, speed:3.5, maintenanceCost: cfgV.citerne?.coutEntretienJournalier      ?? 5  },
    bus:         { nom:'Bus',                icone:'🚌', resources:[],                                                             cost:1500, capacite:40, speed:3.0, maintenanceCost: cfgV.bus?.coutEntretienJournalier           ?? 10 },
    train:       { nom:'Train',              icone:'🚂', resources:[],                                                             cost:(CFG.logistique?.train?.cout ?? 100000), capacite:0,  speed:2.9, maintenanceCost: CFG.logistique?.train?.coutEntretienJournalier ?? 80, mode:'rail' },
    // --- bateaux (port) et avions (aéroport) ---
    cargo_ship:  { nom:'Cargo',              icone:'🚢', resources:ALL_CARGO_RESOURCES.slice(), cost:cfgShip.cargo?.cout ?? 6000, capacite:cfgShip.cargo?.capacite ?? 60, speed:cfgShip.cargo?.vitesse ?? 2.2, maintenanceCost: cfgShip.cargo?.coutEntretienJournalier ?? 20, mode:'water' },
    ferry:       { nom:'Ferry',              icone:'⛴️', resources:[], passengers:true, cost:cfgShip.ferry?.cout ?? 4500, capacite:cfgShip.ferry?.capacite ?? 60, speed:cfgShip.ferry?.vitesse ?? 2.8, maintenanceCost: cfgShip.ferry?.coutEntretienJournalier ?? 16, mode:'water' },
    plane:       { nom:'Avion de ligne',     icone:'✈️', resources:[], passengers:true, cost:cfgPlane.avion?.cout ?? 18000, capacite:cfgPlane.avion?.capacite ?? 40, speed:cfgPlane.avion?.vitesse ?? 7, maintenanceCost: cfgPlane.avion?.coutEntretienJournalier ?? 45, mode:'air' },
    cargo_plane: { nom:'Avion cargo',       icone:'🛩️', resources:ALL_CARGO_RESOURCES.slice(), cost:cfgPlane.cargo?.cout ?? 24000, capacite:cfgPlane.cargo?.capacite ?? 80, speed:cfgPlane.cargo?.vitesse ?? 7, maintenanceCost: cfgPlane.cargo?.coutEntretienJournalier ?? 60, mode:'air' },
    // --- legacy (sauvegardes existantes, plus achetables) ---
    bois:        { nom:'Camion bois',        icone:'🚜', resources:['wood'],                   cost:600,  capacite:15, speed:4.0, buyDisabled:true, maintenanceCost: cfgV.bois?.coutEntretienJournalier     ?? 4 },
    ble:         { nom:'Camion blé',         icone:'🚜', resources:['wheat'],                  cost:550,  capacite:15, speed:4.0, buyDisabled:true, maintenanceCost: cfgV.ble?.coutEntretienJournalier      ?? 4 },
    coton:       { nom:'Chariot coton',      icone:'🛒', resources:['cotton'],                 cost:550,  capacite:15, speed:4.0, buyDisabled:true, maintenanceCost: cfgV.coton?.coutEntretienJournalier    ?? 4 },
    vetement:    { nom:'Camion vêtements',   icone:'🚐', resources:['clothes'],                cost:650,  capacite:12, speed:3.8, buyDisabled:true, maintenanceCost: cfgV.vetement?.coutEntretienJournalier ?? 4 },
    farine:      { nom:'Camion farine',      icone:'🚚', resources:['flour'],                  cost:650,  capacite:15, speed:3.8, buyDisabled:true, maintenanceCost: cfgV.farine?.coutEntretienJournalier   ?? 4 },
    pain:        { nom:'Camion pain',        icone:'🚚', resources:['bread'],                  cost:700,  capacite:15, speed:3.8, buyDisabled:true, maintenanceCost: cfgV.pain?.coutEntretienJournalier     ?? 4 },
    poisson:     { nom:'Chariot poisson',    icone:'🛒', resources:['fish','fish_fillet','fish_oil'], cost:650, capacite:14, speed:3.8, buyDisabled:true, maintenanceCost: cfgV.poisson?.coutEntretienJournalier ?? 4 },
    acier:       { nom:'Camion acier',       icone:'🚚', resources:['steel'],                  cost:1000, capacite:12, speed:3.5, buyDisabled:true, maintenanceCost: cfgV.acier?.coutEntretienJournalier    ?? 6 },
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
      color:           COLOR_MAP[k],
      buyDisabled:     d.buyDisabled ?? false,
      maintenanceCost: d.maintenanceCost ?? 0,
      mode:            d.mode || 'road',        // road | rail | water | air
      passengers:      !!(d.passengers || k === 'bus'),
    };
  }
  return out;
})();
const TRAIN_WAGON_TYPES = {
  minerai:       { nom:'Wagon minerai',       icone:'🪨', resources:CARGO_BULK.slice(),           capacite:20, color:'#9b6844' },
  cereale:       { nom:'Wagon céréales',      icone:'🌾', resources:['wheat','cotton','flour'],   capacite:20, color:'#c8a228' },
  marchandises:  { nom:'Wagon marchandises',  icone:'📦', resources:CARGO_GOODS.slice(),          capacite:18, color:'#3a6b9e' },
  plateau:       { nom:'Wagon plateau',       icone:'🪵', resources:CARGO_FLAT.slice(),           capacite:18, color:'#7a4928' },
  frigo:         { nom:'Wagon frigorifique',  icone:'🐟', resources:['fish','fish_fillet'],       capacite:18, color:'#5ea8c4' },
  citerne:       { nom:'Wagon citerne',       icone:'💧', resources:CARGO_LIQUID.slice(),         capacite:22, color:'#7a8c9e' },
  voiture:       { nom:'Voiture voyageurs',   icone:'🚃', resources:[],                           capacite:40, color:'#c8e040', passenger:true },
};

function trainWagonTypeKey(wagon){
  if(typeof wagon === 'string') return wagon;
  if(wagon && typeof wagon.type === 'string') return wagon.type;
  return null;
}

function trainWagonDef(wagon){
  const key = trainWagonTypeKey(wagon);
  return key ? (TRAIN_WAGON_TYPES[key] || null) : null;
}

function trainWagonSelectedResource(wagon){
  return wagon && typeof wagon === 'object' && typeof wagon.resource === 'string' ? wagon.resource : null;
}

const EMPTY_RES_MAP = Object.freeze({});

function trainWagonAcceptedResources(wagon){
  const def = trainWagonDef(wagon);
  if(!def) return [];
  const selected = trainWagonSelectedResource(wagon);
  return selected && def.resources.includes(selected) ? [selected] : def.resources.slice();
}

function trainCreateWagon(type, resource=null){
  const def = TRAIN_WAGON_TYPES[type];
  if(!def) return null;
  return {
    type,
    resource: resource && def.resources.includes(resource) ? resource : null,
  };
}

function trainNormalizeWagons(v){
  if(v?.vtype !== 'train'){
    return Array.isArray(v?.wagons) ? v.wagons : [];
  }
  if(!Array.isArray(v.wagons)) v.wagons = [];
  v.wagons = v.wagons
    .map(w => {
      if(typeof w === 'string') return trainCreateWagon(w);
      if(w && typeof w === 'object' && typeof w.type === 'string') return trainCreateWagon(w.type, w.resource || null);
      return null;
    })
    .filter(Boolean);
  return v.wagons;
}

function trainWagonCapacityForRes(v, res){
  if(v?.vtype !== 'train') return VEHICLE_TYPES[v?.vtype]?.capacite || 0;
  const wagons = trainNormalizeWagons(v);
  return wagons.reduce((sum, wagon) => {
    const w = trainWagonDef(wagon);
    return sum + (w && trainWagonAcceptedResources(wagon).includes(res) ? w.capacite : 0);
  }, 0);
}

// Chargement de chaque wagon d'un train : la cargaison (ou les voyageurs à bord) remplit les
// wagons dans l'ordre, chacun jusqu'à sa capacité. Retourne un tableau (indice du wagon → quantité).
function trainWagonLoads(v){
  if(v?.vtype !== 'train') return [];
  const wagons = trainNormalizeWagons(v);
  const loads = new Array(wagons.length).fill(0);
  let freight = v.res ? Math.max(0, v.cargo || 0) : 0;
  let pax = Math.max(0, v.passengersOnBoard || 0);
  wagons.forEach((wagon, i) => {
    const w = trainWagonDef(wagon);
    if(!w) return;
    if(w.passenger){ loads[i] = Math.min(w.capacite, pax); pax -= loads[i]; }
    else if(freight > 0 && trainWagonAcceptedResources(wagon).includes(v.res)){ loads[i] = Math.min(w.capacite, freight); freight -= loads[i]; }
  });
  return loads;
}

function trainTotalCapacity(v){
  if(v?.vtype !== 'train') return VEHICLE_TYPES[v?.vtype]?.capacite || 0;
  const wagons = trainNormalizeWagons(v);
  return wagons.reduce((sum, wagon) => sum + (trainWagonDef(wagon)?.capacite || 0), 0);
}

function trainAllowedResources(v){
  if(v?.vtype !== 'train') return VEHICLE_TYPES[v?.vtype]?.resources || [];
  const out = new Set();
  for(const wagon of trainNormalizeWagons(v)){
    for(const r of trainWagonAcceptedResources(wagon)) out.add(r);
  }
  return [...out];
}

function trainPassengerCapacity(v){
  if(v?.vtype !== 'train') return 0;
  const wagons = trainNormalizeWagons(v);
  return wagons.reduce((sum, wagon) => {
    const w = trainWagonDef(wagon);
    return sum + (w?.passenger ? w.capacite : 0);
  }, 0);
}

function vehiclePresentAtDepot(v){
  if(!v || v.state !== 'idle') return false;
  if(v.atDepot) return true;
  // Compatibilité anciennes sauvegardes / anciens états runtime :
  // un véhicule routier idle, déjà revenu sur son dépôt, doit être considéré
  // "au dépôt" même si le booléen atDepot n'avait pas encore été persisté.
  if(v.vtype !== 'train' && v.garageRef && v.currentBuilding === v.garageRef && (!Array.isArray(v.pts) || v.pts.length === 0)){
    v.atDepot = true;
    return true;
  }
  return false;
}

function vehicleDepotDepartureArmed(v){
  return !!(v && vehiclePresentAtDepot(v) && v.depotDepartureArmed);
}

function resetVehicleDepotDeparture(v){
  if(!v) return;
  v.depotDepartureArmed = false;
}

function trainPresentAtDepot(v){
  return !!(v && v.vtype === 'train' && vehiclePresentAtDepot(v));
}

function trainDepotDepartureArmed(v){
  return !!(v && v.vtype === 'train' && vehicleDepotDepartureArmed(v));
}

function resetTrainDepotDeparture(v){
  if(!v || v.vtype !== 'train') return;
  resetVehicleDepotDeparture(v);
}

const GARAGE_COST = CFG.logistique?.garage?.cout ?? 1200;
const BUS_STOP_COST = CFG.logistique?.arretBus?.cout ?? 250;
const TERRAFORM_LEVEL_COST = 25; // $ par tuile impactée (creuser/remonter d'un palier)
const TUNNEL_COST_PER_TILE = 60; // $ par tuile creusée pour un tunnel ferroviaire
const TUNNEL_MAX_LENGTH = 32;    // longueur max (tuiles) recherchée pour une sortie de tunnel

// cat : famille d'affichage (panneaux d'entrepôt, aide), cf. RES_CATEGORIES.
const RES = {
  iron:  { n:'Fer',                    c:'#d98a4f', ic:'🔩', cat:'base' },
  coal:  { n:'Charbon',                c:'#454552', ic:'⚫', cat:'base' },
  wood:  { n:'Bois',                   c:'#a4713d', ic:'🪵', cat:'base' },
  wheat: { n:'Blé',                    c:'#d7b348', ic:'🌾', cat:'base' },
  cotton:{ n:'Coton',                  c:'#f1efe3', ic:'☁️', cat:'base' },
  clothes:{ n:'Vêtement',              c:'#b98fcb', ic:'👕', cat:'food' },
  flour: { n:'Farine',                 c:'#eadfa8', ic:'🫙', cat:'food' },
  water: { n:'Eau',                    c:'#64b7e8', ic:'💧', cat:'base' },
  bread: { n:'Pain',                   c:'#d99a45', ic:'🍞', cat:'food' },
  fish:  { n:'Poisson',                c:'#4fa6b8', ic:'🐟', cat:'base' },
  fish_fillet: { n:'Filet de poisson', c:'#c7e7e9', ic:'🍣', cat:'food' },
  fish_oil:    { n:'Huile de poisson', c:'#d6b45c', ic:'🫒', cat:'food' },
  steel: { n:'Acier',                  c:'#a8bdd2', ic:'⚙️', cat:'metal' },
  goods: { n:'Outils de construction', c:'#e6c84f', ic:'🔧', cat:'build' },
  dirt:  { n:'Terre',                  c:'#8B6347', ic:'🌑', cat:'base' },
  // --- gisements et ressources de base ---
  copper_ore: { n:'Minerai de cuivre', c:'#c46a3a', ic:'🟠', cat:'base' },
  gold_ore:   { n:'Minerai d’or',      c:'#d8b23a', ic:'🟡', cat:'base' },
  limestone:  { n:'Calcaire',          c:'#d9d4c2', ic:'🪨', cat:'base' },
  sand:       { n:'Sable',             c:'#e8d28a', ic:'🏖️', cat:'base' },
  clay:       { n:'Argile',            c:'#c07a50', ic:'🧱', cat:'base' },
  oil:        { n:'Pétrole',           c:'#2a2630', ic:'🖤', cat:'base' },
  // --- métallurgie ---
  copper:      { n:'Cuivre',           c:'#d9804a', ic:'🥉', cat:'metal' },
  copper_wire: { n:'Fil de cuivre',    c:'#e8945a', ic:'➰', cat:'build' },
  gold:        { n:'Or',               c:'#f2c94c', ic:'🪙', cat:'metal' },
  nails:       { n:'Clous',            c:'#9aa6b2', ic:'📌', cat:'metal' },
  // --- matériaux de chantier ---
  steel_beam:  { n:'Poutrelle en acier', c:'#7f95ab', ic:'🪜', cat:'build' },
  steel_plate: { n:'Plaque en acier',  c:'#b9c7d6', ic:'🛡️', cat:'build' },
  cement:      { n:'Ciment',           c:'#b4b0a6', ic:'🧂', cat:'build' },
  concrete:    { n:'Béton',            c:'#8f9298', ic:'🔲', cat:'build' },
  glass:       { n:'Verre',            c:'#bfe6f2', ic:'🫧', cat:'build' },
  window:      { n:'Vitre',            c:'#8fd0ea', ic:'🪟', cat:'build' },
  rope:        { n:'Corde',            c:'#c9a46a', ic:'🪢', cat:'build' },
  paint:       { n:'Peinture jaune',   c:'#f2c230', ic:'🎨', cat:'build' },
  // --- chimie ---
  chemicals:   { n:'Produits chimiques', c:'#7fc97a', ic:'⚗️', cat:'chem' },
  fuel:        { n:'Carburant',        c:'#e06a3a', ic:'⛽', cat:'chem' },
  plastic:     { n:'Plastique',        c:'#e7e2f0', ic:'🧴', cat:'chem' },
  glue:        { n:'Colle',            c:'#e8cf7a', ic:'🍯', cat:'chem' },
  // --- électronique ---
  circuit:     { n:'Carte électronique', c:'#3f9a5a', ic:'💾', cat:'tech' },
  appliances:  { n:'Électroménager',   c:'#d8dde3', ic:'📺', cat:'lux' },
  quantum_chip:{ n:'Processeur quantique', c:'#b58cff', ic:'🔮', cat:'tech' },
  // --- biens de luxe ---
  furniture:   { n:'Meubles',          c:'#a0683a', ic:'🛋️', cat:'lux' },
  jewelry:     { n:'Bijoux',           c:'#ffd76a', ic:'💍', cat:'lux' },
  // --- ressources spatiales (rapportées par les fusées) ---
  helium3:     { n:'Hélium-3',         c:'#9fe6ff', ic:'⚛️', cat:'space' },
  xenite:      { n:'Xénite',           c:'#7a5cff', ic:'💠', cat:'space' },
};
// Noms courts (≤ 10 caractères) affichés sous les tuiles des entrepôts ; le nom
// complet reste dans l'infobulle.
const RES_SHORT = {
  fish_fillet:'Filet', fish_oil:'Huile', goods:'Outils', copper_ore:'M. cuivre', gold_ore:'M. or',
  copper_wire:'Fil cuivre', steel_beam:'Poutrelle', steel_plate:'Plaque', paint:'Peinture',
  chemicals:'Chimie', circuit:'Carte élec', appliances:'Électromén', quantum_chip:'Processeur',
};
for(const k in RES) RES[k].s = RES_SHORT[k] || RES[k].n;
// Familles d'affichage des ressources (ordre des sections dans les panneaux).
const RES_CATEGORIES = [
  { key:'base',  n:'Ressources de base',     ic:'⛏️' },
  { key:'food',  n:'Alimentation & textile', ic:'🍞' },
  { key:'metal', n:'Métallurgie',            ic:'⚙️' },
  { key:'build', n:'Matériaux de chantier',  ic:'🏗️' },
  { key:'chem',  n:'Chimie',                 ic:'🧪' },
  { key:'tech',  n:'Électronique',           ic:'💾' },
  { key:'lux',   n:'Biens de luxe',          ic:'💎' },
  { key:'space', n:'Ressources spatiales',   ic:'🚀' },
];
// Clés de RES groupées par famille, dans l'ordre de RES_CATEGORIES.
function resKeysByCategory(filter){
  return RES_CATEGORIES.map(c => ({ ...c, keys: Object.keys(RES).filter(k => (RES[k].cat || 'base') === c.key && (!filter || filter(k))) }))
    .filter(c => c.keys.length);
}
// Quantités → texte « 2 🪜 Poutrelle en acier, 3 🔲 Béton ».
function resAmountsText(map, sep = ', '){
  return Object.keys(map || {}).filter(r => RES[r] && map[r] > 0)
    .map(r => map[r] + ' ' + RES[r].ic + ' ' + RES[r].n).join(sep);
}
// Version compacte « 2🪜 3🔲 » (textes flottants, fantôme de placement).
function resAmountsIcons(map){
  return Object.keys(map || {}).filter(r => RES[r] && map[r] > 0).map(r => map[r] + RES[r].ic).join(' ');
}

const GRAPHIC_PACKS = {
  classic: {
    n: 'Classique',
    desc: 'Couleurs lisibles proches du rendu original.',
    mode: 'polygon',
    sky: ['#1c2740', '#0b101a'],
    grass: ['#74b048','#6ea944','#7ab84d','#68a23f'],
    water: ['#3590cf','#3187c2'],
    sand: ['#ccb56d','#d6c178','#c8af63'],
    clay: ['#9f6d52','#a9765a','#8f6249'],
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
    sand: ['#cdb579','#d9c488','#c6aa67'],
    clay: ['#9f6d56','#a87962','#91624d'],
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
    sand: ['#c7bb82','#d5c892','#bfae6e'],
    clay: ['#95695a','#a17361','#875c4d'],
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
    sand: ['#b6a36d','#c1ae76','#aa9662'],
    clay: ['#865d4d','#926654','#7a5446'],
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
// Incrémenté à chaque chargement d'image de pack : sert de signal au rendu Pixi
// pour re-baker les textures de bâtiments qui attendaient leur sprite.
let GRAPHIC_PACK_IMAGES_GEN = 0;

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
// Prix de vente aux habitants (par ressource consommée, par habitant).
const RESID_PRICES = (()=>{
  const cfg = CFG.economie?.prixVente || {};
  return {
    goods:       cfg.marchandises ?? 5,
    bread:       cfg.pain         ?? 6,
    clothes:     cfg.vetement     ?? 9,
    fish_fillet: cfg.filetPoisson ?? 8,
    fish:        cfg.poisson      ?? 4,
    fish_oil:    cfg.huilePoisson ?? 7,
    flour:       cfg.farine       ?? 4,
    water:       cfg.eau          ?? 1,
    wheat:       cfg.ble          ?? 2,
    cotton:      cfg.coton        ?? 3,
    iron:        cfg.fer          ?? 4,
    coal:        cfg.charbon      ?? 3,
    wood:        cfg.bois         ?? 2,
    steel:       cfg.acier        ?? 7,
    dirt:        cfg.terre        ?? 0,
    furniture:   cfg.meubles      ?? 5,
    appliances:  cfg.electromenager ?? 8,
    jewelry:     cfg.bijoux       ?? 12,
    quantum_chip:cfg.processeurQuantique ?? 20,
  };
})();

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
    // prix commerciaux (vente au marché, fret) des nouvelles ressources
    copper_ore: cfg.mineraiCuivre ?? 7,   gold_ore: cfg.mineraiOr ?? 18,  limestone: cfg.calcaire ?? 4,
    sand:       cfg.sable         ?? 3,   clay:     cfg.argile    ?? 3,   oil:       cfg.petrole  ?? 9,
    copper:     cfg.cuivre        ?? 16,  copper_wire: cfg.filCuivre ?? 10, gold:     cfg.or       ?? 70,
    nails:      cfg.clous         ?? 5,   steel_beam: cfg.poutrelle ?? 32, steel_plate: cfg.plaqueAcier ?? 16,
    cement:     cfg.ciment        ?? 9,   concrete: cfg.beton     ?? 12,  glass:     cfg.verre    ?? 9,
    window:     cfg.vitre         ?? 22,  rope:     cfg.corde     ?? 10,  paint:     cfg.peinture ?? 14,
    chemicals:  cfg.chimie        ?? 8,   fuel:     cfg.carburant ?? 18,  plastic:   cfg.plastique ?? 14,
    glue:       cfg.colle         ?? 14,  circuit:  cfg.carte     ?? 80,  furniture: cfg.meubles  ?? 60,
    appliances: cfg.electromenager ?? 140, jewelry: cfg.bijoux    ?? 60,  quantum_chip: cfg.processeurQuantique ?? 600,
    helium3:    cfg.helium3       ?? 160, xenite:   cfg.xenite    ?? 220,
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
  puitsPetrole:'oil_well',
  fonderieCuivre:'copper_smelter',
  trefilerie:'wire_mill',
  affinerieOr:'gold_refinery',
  laminoir:'rolling_mill',
  tolerie:'sheet_mill',
  clouterie:'nail_factory',
  cimenterie:'cement_plant',
  centraleBeton:'concrete_plant',
  verrerie:'glassworks',
  vitrerie:'glazier',
  corderie:'ropery',
  raffinerie:'refinery',
  usineChimique:'chem_plant',
  peinture:'paint_factory',
  electronique:'electronics_plant',
  ebenisterie:'furniture_factory',
  electromenager:'appliance_factory',
  joaillerie:'jeweler',
  laboQuantique:'quantum_lab',
};
const PROD_TYPE_TO_CONFIG_KEY = {};
for(const fr in PROD_CONFIG_KEYS) PROD_TYPE_TO_CONFIG_KEY[PROD_CONFIG_KEYS[fr]] = fr;

const BUILD = {
  select:  { n:'Inspecter', ic:'🔍', hk:'1', desc:'Cliquer sur un bâtiment pour voir ses stocks.' },
  road:    { n:'Route',     ic:'🛣️', hk:'2', cost: CFG.batiments?.route?.cout    ?? 10,
             desc:'Relie les bâtiments — les camions y circulent. Glisser pour tracer.' },
  rail:    { n:'Rail',      ic:'🚂', hk:'',  cost: CFG.batiments?.rail?.cout     ?? 12,
             desc:'Pose des rails en glissant, comme pour les routes.' },
  rail_signal:{ n:'Signal', ic:'🚦', hk:'',  cost: CFG.batiments?.signalRail?.cout ?? 20,
                desc:'Place un signal ferroviaire sur un segment de rail.' },
  rail_signal2:{ n:'Signal de jonction', ic:'🚥', hk:'', cost: CFG.batiments?.signalRail?.cout ?? 20,
                desc:'Feu à 2 lentilles : comme un signal normal, mais il reste rouge tant que tous les feux des voies suivantes sont rouges.' },
  train_station:{ n:'Gare', ic:'🚉', hk:'', cost: CFG.batiments?.gare?.cout ?? 100,
                  col:'#b98a55', hgt:12,
                  desc:'Construit une gare près des rails ou un quai directement sur une voie.' },
  train_platform:{ n:'Quai', ic:'▥', hk:'', cost: CFG.batiments?.gare?.cout ?? 100,
                   col:'#a98963', hgt:3,
                   desc:'Quai ferroviaire rattaché à une gare.' },
  tunnel:  { n:'Tunnel', ic:'🚇', hk:'', cost: TUNNEL_COST_PER_TILE,
             desc:'Sélectionne une tuile en pente : elle devient l\'entrée du tunnel. La sortie et le tracé '
               + 'sont calculés automatiquement de l\'autre côté du relief et affichés en surbrillance, puis '
               + 'une confirmation indique le coût total ('+TUNNEL_COST_PER_TILE+' $/tuile creusée).' },
  mine:    { n:'Mine',      ic:'⛏️', hk:'3', cost: CFG.production?.mine?.cout     ?? 450,
             workers:3, time:2.2, col:'#7d6457', hgt:16, ind:true,
             upkeep: CFG.production?.mine?.entretien     ?? 2,
             desc:'À placer sur un gisement : fer, charbon, cuivre, or (précieux), calcaire (carrière), sable ou argile du littoral. Extrait la ressource de la tuile.' },
  oil_well:{ n:'Puits de pétrole', ic:'🛢️', hk:'', cost: CFG.production?.puitsPetrole?.cout ?? 1800,
             workers:3, time:3.0, col:'#3a3540', hgt:20, ind:true,
             upkeep: CFG.production?.puitsPetrole?.entretien ?? 3,
             recipe:{ in:{}, out:{oil:1} },
             desc:'À placer sur une nappe de pétrole (taches sombres). Pompe le pétrole brut pour la raffinerie.' },
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
             desc:"Usine abandonnée. À spécialiser ensuite : alimentation (ferme, moulin, boulangerie…), métallurgie (aciérie, laminoir, tôlerie, cuivre, or), matériaux (cimenterie, béton, verrerie, vitrerie, corderie), chimie (raffinerie, usine chimique, peinture), électronique et biens de luxe." },
  house:   { n:'Maison',    ic:'🏠', hk:'6', cost: CFG.batiments?.maison?.cout    ?? 100,
             col:'#9a7e5f', hgt:18, desc:'' },
  depot:   { n:'Entrepôt',        ic:'📦', hk:'7', cost: CFG.batiments?.entrepot?.cout  ?? 400,
             col:'#7a7048', hgt:12, storageHub:true,
             desc:'Stocke et redistribue. Cliquer dessus pour choisir les ressources acceptées.' },
  market:  { n:'Marché',          ic:'🏬', hk:'M', cost: CFG.batiments?.marche?.cout    ?? 600,
             col:'#7a5a30', hgt:20, storageHub:true,
             desc:'Stocke et vend des ressources aux autres joueurs. Configurer les ressources en vente depuis le panneau.' },
  tank:    { n:'Entrepôt citerne', ic:'🛢️', hk:'8', cost: CFG.batiments?.citerne?.cout ?? 450,
             col:'#3f6f8f', hgt:18, storageHub:true,
             desc:"Stocke uniquement l'eau. À placer près des boulangeries." },
  garage:  { n:'Dépôt véhicules', ic:'🚛', hk:'0', cost: GARAGE_COST, col:'#3d4f6b', hgt:20,
             transportDepot:true,
             desc:'Achète et gère des véhicules de transport spécialisés.' },
  train_depot:{ n:'Dépôt de train',   ic:'🚂', hk:'', cost: CFG.batiments?.depotTrain?.cout ?? 800,
                 col:'#7f5a4d', hgt:24, transportDepot:true,
                 desc:'Dépôt ferroviaire. Réservé à l’achat et à la gestion des trains.' },
  bus_stop:{ n:'Arrêt de bus',   ic:'🚏', hk:'', cost: BUS_STOP_COST, col:'#1e4a8a', hgt:12,
             desc:'Accueille les passagers du quartier (rayon '+BUS_STOP_RADIUS+' cases). Les bus transportent les habitants entre arrêts.' },
  terraform:{ n:'Bulldozer',  ic:'🚜', hk:'B', desc:'Détruit routes, rails, bâtiments (30 % remboursés), arbres et champs, et rase les gisements (fer/charbon).' },
  fill_water:{ n:'Remblai',   ic:'🪣', hk:'', desc:'Comble une tuile d\'eau en terre (10 terres requises). Nécessite une usine de terrassement à portée.' },
  terraform_dig:{ n:'Creuser', ic:'⛏️', hk:'', cost: TERRAFORM_LEVEL_COST,
                  desc:'Baisse le niveau du terrain d\'un palier ('+TERRAFORM_LEVEL_COST+' $/tuile impactée). Nécessite un niveau > 0.' },
  terraform_raise:{ n:'Remonter', ic:'⛰️', hk:'', cost: TERRAFORM_LEVEL_COST,
                  desc:'Élève le niveau du terrain d\'un palier ('+TERRAFORM_LEVEL_COST+' $/tuile impactée).' },
  terraform_canal:{ n:'Canal', ic:'〰️', hk:'', cost: TERRAFORM_LEVEL_COST * 3,
                  desc:'Creuse une tuile de 3 niveaux et la met en eau, à niveau avec les berges (' + (TERRAFORM_LEVEL_COST * 3) + ' $/tuile). Se raccorde à l\'eau voisine : on peut tracer un canal en glissant.' },
  terrassement: { n:'Usine de terrassement', ic:'🏗️', hk:'', cost: CFG.production?.terrassement?.cout ?? 700,
                  workers:3, time:1, col:'#7a6a52', hgt:20, ind:true,
                  upkeep: CFG.production?.terrassement?.entretien ?? 1.5,
                  recipe:{ in:{}, out:{} },
                  desc:'Reçoit de la terre (via camion minerai). Rayon d\'action '+
                       (CFG.production?.terrassement?.rayon ?? 10)+
                       ' cases : permet de combler l\'eau avec l\'outil Remblai (10 terres/tuile).' },
};

// ---------- chaînes de production avancées ----------
// Usines obtenues en spécialisant une usine abandonnée (plant). Recette, temps,
// coût et entretien sont surchargés par config.js (clés françaises de
// PROD_CONFIG_KEYS) ; la description reprend la recette finale (applyProductionConfig).
// [type, nom, icône, ouvriers, couleur, hauteur, entrées, sorties, note]
const ADVANCED_FACTORIES = [
  ['copper_smelter',   'Fonderie de cuivre',     '♨️', 4, '#a0583a', 24, { copper_ore:2, coal:1 }, { copper:1 }, ''],
  ['wire_mill',        'Tréfilerie',             '🌀', 3, '#b8754a', 20, { copper:1 }, { copper_wire:2 }, 'Le fil de cuivre câble gares, tours de contrôle et électronique.'],
  ['gold_refinery',    'Affinerie d’or',         '🏅', 4, '#b8963a', 22, { gold_ore:3, chemicals:1 }, { gold:1 }, 'Lixiviation chimique du minerai précieux.'],
  ['rolling_mill',     'Laminoir',               '🔨', 4, '#6a7a8c', 22, { steel:2 }, { steel_beam:1 }, 'Poutrelles pour les charpentes des grands bâtiments.'],
  ['sheet_mill',       'Tôlerie',                '🗜️', 3, '#7f8fa0', 20, { steel:1 }, { steel_plate:1 }, 'Plaques pour hangars, quais et fusées.'],
  ['nail_factory',     'Clouterie',              '📌', 3, '#8a96a3', 18, { steel:1 }, { nails:4 }, ''],
  ['cement_plant',     'Cimenterie',             '🌋', 4, '#a39d8f', 26, { limestone:2, clay:1, coal:1 }, { cement:2 }, 'Four rotatif : calcaire et argile cuits au charbon.'],
  ['concrete_plant',   'Centrale à béton',       '🚧', 3, '#8f9298', 22, { cement:1, sand:2, water:1 }, { concrete:2 }, 'Nécessite une citerne d’eau proche.'],
  ['glassworks',       'Verrerie',               '🏺', 4, '#6fa8b8', 24, { sand:2, limestone:1, coal:1 }, { glass:2 }, ''],
  ['glazier',          'Vitrerie',               '🪟', 3, '#7cc0d8', 20, { glass:2 }, { window:1 }, 'Vitres pour les gares, terminaux et immeubles.'],
  ['ropery',           'Corderie',               '🪢', 3, '#b08a5a', 18, { cotton:3 }, { rope:2 }, 'Cordages d’amarrage pour les ports.'],
  ['refinery',         'Raffinerie',             '⛽', 5, '#5a5560', 30, { oil:3 }, { fuel:1, chemicals:2 }, 'Carburant (fusées) + produits chimiques.'],
  ['chem_plant',       'Usine chimique',         '🧪', 4, '#5f8a5a', 26, { chemicals:2, water:1 }, { plastic:1, glue:1 }, 'Nécessite une citerne d’eau proche.'],
  ['paint_factory',    'Usine de peinture',      '🎨', 3, '#c9a43a', 20, { chemicals:1, clay:1 }, { paint:2 }, 'Pigment d’ocre jaune (argile) : marquages des pistes, taxis et quais.'],
  ['electronics_plant','Usine électronique',     '🖥️', 5, '#3f6a8a', 26, { copper_wire:2, plastic:1, gold:1 }, { circuit:2 }, 'Cartes électroniques aux contacts plaqués or.'],
  ['furniture_factory','Ébénisterie',            '🪑', 4, '#8a5a32', 20, { wood:2, nails:2, glue:1 }, { furniture:1 }, 'Meubles demandés par les employés, cadres et patrons.'],
  ['appliance_factory','Usine d’électroménager', '🔌', 5, '#8fa0b0', 24, { circuit:1, steel_plate:1, plastic:1, copper_wire:1 }, { appliances:1 }, 'Électroménager pour les cadres et les patrons.'],
  ['jeweler',          'Joaillerie',             '💍', 3, '#c9a24a', 20, { gold:1, glass:1 }, { jewelry:2 }, 'Bijoux en or et cristal pour les patrons.'],
  ['quantum_lab',      'Laboratoire quantique',  '🔬', 6, '#5a4a8a', 30, { circuit:2, xenite:1, helium3:1 }, { quantum_chip:1 }, 'Exploite la xénite et l’hélium-3 rapportés de l’espace.'],
];
for(const [type, n, ic, workers, col, hgt, rin, rout, note] of ADVANCED_FACTORIES){
  const c = CFG.production?.[PROD_TYPE_TO_CONFIG_KEY[type]] || {};
  BUILD[type] = { n, ic, hk:'', cost: c.cout ?? 1200, workers, time: c.temps ?? 4, col, hgt, ind:true,
    upkeep: c.entretien ?? 3, recipe:{ in:{ ...rin }, out:{ ...rout } }, note, desc:note };
}

// ---------- centre spatial ----------
// Bâtiment 3×3 : assemble une fusée à partir des pièces livrées, la lance puis
// récupère la capsule et sa cargaison extraterrestre (cf. updateSpaceCenter).
const SPACE_CFG = CFG.centreSpatial || {};
const SPACE_ROCKET_PARTS  = _resMap(SPACE_CFG.fusee, { steel_plate:8, circuit:4, fuel:12, copper_wire:4 });
const SPACE_CARGO         = _resMap(SPACE_CFG.cargaison, { helium3:6, xenite:4 });
const SPACE_ASSEMBLY_TIME = Math.max(1, +SPACE_CFG.tempsAssemblage || 60);
const SPACE_MISSION_TIME  = Math.max(1, +SPACE_CFG.dureeMission || 90);
const SPACE_CENTER_SIZE   = Math.max(2, Math.min(4, Math.round(+SPACE_CFG.taille || 3)));
BUILD.space_center = { n:'Centre spatial', ic:'🚀', hk:'', cost: SPACE_CFG.cout ?? 60000,
  workers: SPACE_CFG.ouvriers ?? 12, time: SPACE_ASSEMBLY_TIME, col:'#c9d1da', hgt:40, ind:true,
  size: SPACE_CENTER_SIZE, noMerge:true, upkeep: SPACE_CFG.entretien ?? 25,
  desc:'Bâtiment '+SPACE_CENTER_SIZE+'×'+SPACE_CENTER_SIZE+' sur terrain plat. Reçoit des pièces de fusée ('+resAmountsText(SPACE_ROCKET_PARTS)
    +'), assemble la fusée puis la lance. Au retour de mission, la capsule rapporte '+resAmountsText(SPACE_CARGO)
    +' — des ressources introuvables sur Terre.' };

// ---------- lieux de loisirs ----------
// Les voyageurs arrivés à un point de transit voisin s'y rendent en priorité (avant
// un Airbnb), paient l'entrée au propriétaire puis repartent au bout de la durée de
// visite (cf. tickLeisureVisits, 06_simulation.js). Réglages : config.js `loisirs`.
const LEISURE_CFG = CFG.loisirs || {};
const LEISURE_AFFLUX = Math.max(1, +LEISURE_CFG.afflux || 10);
const LEISURE_FX_ZOOM = +LEISURE_CFG.zoomAnimation || 1.0; // zoom minimal des animations (drawLeisureFx)
// [type moteur, clé config, nom, icône, couleur, hauteur, défauts, description]
const LEISURE_DEFS = [
  ['restaurant',   'restaurant',      'Restaurant',            '🍽️', '#b8573a', 16, { cout:1500,  taille:1, capacite:20,  duree:1,   tarif:35,  ouvriers:2,  entretien:1 },  'Une table du quartier : repas rapide, clientèle fidèle.'],
  ['cinema',       'cinema',          'Cinéma',                '🎬', '#3a3f6a', 22, { cout:3000,  taille:2, capacite:60,  duree:1.5, tarif:25,  ouvriers:3,  entretien:2 },  'Une séance et du pop-corn.'],
  ['museum',       'musee',           'Musée',                 '🏛️', '#d8cfb8', 24, { cout:5000,  taille:2, capacite:50,  duree:2,   tarif:30,  ouvriers:3,  entretien:2 },  'Colonnade et collections : une visite culturelle.'],
  ['treetop',      'accrobranche',    'Parcours dans les arbres', '🧗', '#5a8a3a', 26, { cout:2500,  taille:2, capacite:30,  duree:1.5, tarif:45,  ouvriers:2,  entretien:1, pres:'arbres' }, 'Tyroliennes et ponts de singe : à poser près d’arbres.'],
  ['marina',       'baseNautique',    'Base nautique',         '🛶', '#3a8fb8', 14, { cout:4000,  taille:2, capacite:40,  duree:2,   tarif:55,  ouvriers:3,  entretien:2, pres:'eau' }, 'Kayaks et pédalos : à poser au bord de l’eau.'],
  ['tennis',       'tennis',          'Court de tennis',       '🎾', '#3f6fb8', 12, { cout:2000,  taille:2, capacite:24,  duree:1,   tarif:30,  ouvriers:1,  entretien:1 },  'Simple ou double : échanges du fond de court.'],
  ['basketball',   'basket',          'Terrain de basket',     '🏀', '#d9783a', 12, { cout:2500,  taille:2, capacite:40,  duree:1,   tarif:20,  ouvriers:2,  entretien:1 },  'Playground en plein air : dribbles et paniers à trois points.'],
  ['spa',          'spa',           'Thermes & spa',         '♨️', '#7fb8b0', 18, { cout:9000,  taille:2, capacite:40,  duree:3,   tarif:120, ouvriers:4,  entretien:3 },  'Bassins chauds et massages : une cure de détente.'],
  ['hotel',        'hotel',           'Hôtel',                 '🏨', '#c9b48a', 40, { cout:8000,  taille:2, capacite:80,  duree:12,  tarif:180, ouvriers:6,  entretien:4 },  'Séjour sur place : long et bien payé.'],
  ['concert_hall', 'salleConcert',    'Salle de concert',      '🎸', '#6a3a8a', 28, { cout:12000, taille:3, capacite:150, duree:2,   tarif:70,  ouvriers:6,  entretien:5 },  'Scène, lumières et foule.'],
  ['zoo',          'zoo',             'Zoo',                   '🦒', '#7a9a4a', 18, { cout:15000, taille:3, capacite:120, duree:3,   tarif:60,  ouvriers:8,  entretien:6 },  'Enclos, volière et bassin des otaries.'],
  ['casino',       'casino',          'Casino',                '🎰', '#a8302a', 30, { cout:20000, taille:3, capacite:100, duree:2.5, tarif:200, ouvriers:8,  entretien:8 },  'Néons et machines à sous : le plus lucratif par visiteur.'],
  ['baseball',     'baseball',        'Terrain de baseball',   '⚾', '#5f9a4a', 24, { cout:18000, taille:3, capacite:200, duree:1.5, tarif:40,  ouvriers:6,  entretien:6 },  'Lanceur, frappeur et coups de circuit sous les projecteurs.'],
  ['stadium',      'stade',          'Stade de foot',         '🏟️', '#9aa3ad', 30, { cout:30000, taille:4, capacite:400, duree:1.5, tarif:50,  ouvriers:10, entretien:10 }, 'Un match : énorme capacité, visite courte.'],
  ['theme_park',   'parcAttractions', 'Parc d’attractions',    '🎢', '#d94a6a', 44, { cout:40000, taille:4, capacite:300, duree:4,   tarif:110, ouvriers:14, entretien:12 }, 'Montagnes russes et grande roue : plusieurs jours de manèges.'],
];
// « 1 jour », « 1,5 jour », « 2 jours »
const leisureDaysText = d => String(d).replace('.', ',') + (d >= 2 ? ' jours' : ' jour');
const LEISURE_TYPES = [];
for(const [type, key, n, ic, col, hgt, def, note] of LEISURE_DEFS){
  const c = { ...def, ...(LEISURE_CFG.lieux?.[key] || {}) };
  const size = Math.max(1, Math.min(4, Math.round(+c.taille || 1)));
  const leisure = {
    capacity: Math.max(1, Math.round(+c.capacite || 1)),
    days:     Math.max(0.1, +c.duree || 1),   // jours de jeu sur place
    fee:      Math.max(0, +c.tarif || 0),
    near:     c.pres === 'arbres' || c.pres === 'eau' ? c.pres : null,
  };
  BUILD[type] = { n, ic, hk:'', cost: c.cout ?? 1000, workers: Math.max(0, Math.round(+c.ouvriers || 0)),
    col, hgt, size, noMerge:true, upkeep: +c.entretien || 0, leisure,
    desc: note + ' ' + size + '×' + size + ' cases · ' + leisure.capacity + ' visiteurs · '
      + leisureDaysText(leisure.days) + ' sur place · ' + leisure.fee + ' $ / visiteur.' };
  LEISURE_TYPES.push(type);
}
const isLeisure = b => !!b && !!BUILD[b.type]?.leisure;

const PLANT_UPGRADES = {
  smelter: { label:'Aciérie',       type:'smelter', icon:'🔥', cat:'metal' },
  farm:    { label:'Ferme',         type:'farm',    icon:'🌾', cat:'food' },
  cotton_farm:{ label:'Ferme de coton', type:'cotton_farm', icon:'☁️', cat:'food' },
  weaver:  { label:'Usine de tissage', type:'weaver', icon:'🧵', cat:'food' },
  mill:    { label:'Moulin',        type:'mill',    icon:'⚙️', cat:'food' },
  bakery:  { label:'Boulangerie',   type:'bakery',  icon:'🥖', cat:'food' },
  fishery: { label:'Poissonnerie',  type:'fishery', icon:'🐟', cat:'food' },
  factory: { label:'Outils de construction', type:'factory', icon:'🏭', cat:'build' },
  terrassement: { label:'Usine de terrassement', type:'terrassement', icon:'🏗️', cat:'build' },
};
// catégorie d'affichage des spécialisations avancées (panneau de l'usine abandonnée)
const ADVANCED_FACTORY_CATS = {
  copper_smelter:'metal', wire_mill:'metal', gold_refinery:'metal', rolling_mill:'metal', sheet_mill:'metal', nail_factory:'metal',
  cement_plant:'build', concrete_plant:'build', glassworks:'build', glazier:'build', ropery:'build',
  refinery:'chem', chem_plant:'chem', paint_factory:'chem',
  electronics_plant:'tech', quantum_lab:'tech',
  furniture_factory:'lux', appliance_factory:'lux', jeweler:'lux',
};
for(const [type, n, ic] of ADVANCED_FACTORIES)
  PLANT_UPGRADES[type] = { label:n, type, icon:ic, cat:ADVANCED_FACTORY_CATS[type] || 'build' };
const PLANT_UPGRADE_CATEGORIES = [
  { key:'food',  n:'Alimentation & textile' },
  { key:'metal', n:'Métallurgie' },
  { key:'build', n:'Matériaux de chantier' },
  { key:'chem',  n:'Chimie (pétrole)' },
  { key:'tech',  n:'Électronique & haute technologie' },
  { key:'lux',   n:'Biens de luxe' },
];

const DEPOT_TOOLBAR_ITEMS = [];
function registerDepotTool(item){
  if(!item || !item.key || !item.tool) return;
  if(DEPOT_TOOLBAR_ITEMS.some(o => o.key === item.key)) return;
  DEPOT_TOOLBAR_ITEMS.push(item);
}
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
      const reqPrice = L.resid.required.reduce((a,r)=>a+(RESID_PRICES[r]||0),0);
      const upgradeTxt = resTargetNames(L.resid.upgradeTargets);
      BUILD.house.desc = 'Consomme '+resNames(L.resid.required)+' → +1 habitant et +'+reqPrice
        +' $ par habitant.' + (upgradeTxt ? ' Upgrade : '+upgradeTxt+'.' : '');
      continue;
    }
    BUILD[L.key] = { n:L.n, ic:L.ic, col:L.col, hgt:L.hgt, cost:100*area, area,
      size:L.shapes[0][0], resid:L.resid,
      desc:'Fusion de logements pleins ('+L.shapes.map(s=>s[0]+'×'+s[1]).join(' ou ')
        +'). '+L.resid.popCap+' habitants.' };
  }
})();

// ---------- classes d'habitants ----------
// Logements basiques : ouvriers. Maisons de luxe : la classe monte à chaque
// agrandissement (ouvriers → employés → cadres → patrons).
const RESIDENT_CLASS_ORDER = ['ouvrier', 'employe', 'cadre', 'patron'];
const RESIDENT_CLASSES = (()=>{
  const def = {
    ouvrier: { nom:'Ouvrier', pluriel:'Ouvriers', icone:'👷', taxe:1, revenu:1 },
    employe: { nom:'Employé', pluriel:'Employés', icone:'👔', taxe:2, revenu:2 },
    cadre:   { nom:'Cadre',   pluriel:'Cadres',   icone:'💼', taxe:4, revenu:4 },
    patron:  { nom:'Patron',  pluriel:'Patrons',  icone:'🎩', taxe:8, revenu:8 },
  };
  const c = CFG.classesHabitants || {};
  const out = {};
  for(const k of RESIDENT_CLASS_ORDER) out[k] = { key:k, ...def[k], ...(c[k] || {}) };
  return out;
})();
function residClassOf(b){
  const type = typeof b === 'string' ? b : b?.type;
  const k = BUILD[type]?.classe;
  return RESIDENT_CLASSES[k] ? k : 'ouvrier';
}
function residClassDef(b){ return RESIDENT_CLASSES[residClassOf(b)]; }

// ---------- maisons de luxe ----------
// Ligne résidentielle à part : une maison de luxe ne fusionne jamais avec ses
// voisines, elle s'agrandit sur les cases libres autour d'elle (tryExpandLuxury,
// 06_simulation.js). Ses habitants doublent à chaque agrandissement et leur
// classe progresse. Débloquée à LUX_UNLOCK_POP habitants (wallet.luxeUnlocked).
const LUX_CFG = CFG.maisonLuxe || {};
const LUX_UNLOCK_POP = LUX_CFG.seuilHabitants ?? 100;
const LUX_COST_MULT = LUX_CFG.multiplicateurCout ?? 5;
const LUX_LEVELS = [
  { key:'lux_house',  cfg:LUX_CFG.maison,  n:'Maison de luxe', ic:'💎', shapes:[[1,1]],       col:'#b08a5a', hgt:22, classe:'ouvrier',
    def:{ interval:60, popCap:5, stockCap:10, required:['fish_fillet'], upgradeTargets:{ goods:60, clothes:30 }, bonus:['fish_oil'] } },
  { key:'lux_villa',  cfg:LUX_CFG.villa,   n:'Villa',          ic:'🏡', shapes:[[2,1],[1,2]], col:'#c09a62', hgt:26, classe:'employe',
    def:{ interval:40, popCap:10, stockCap:14, required:['fish_fillet','bread'], upgradeTargets:{ goods:150, clothes:75 }, bonus:['fish_oil'] } },
  { key:'lux_manor',  cfg:LUX_CFG.manoir,  n:'Manoir',         ic:'🏰', shapes:[[2,2]],       col:'#a88a66', hgt:34, classe:'cadre',
    def:{ interval:30, popCap:20, stockCap:20, required:['fish_fillet','bread','clothes'], upgradeTargets:{ goods:300, clothes:150 }, bonus:['fish_oil'] } },
  { key:'lux_estate', cfg:LUX_CFG.domaine, n:'Domaine',        ic:'⛲', shapes:[[3,3]],       col:'#9a8a70', hgt:36, classe:'patron',
    def:{ interval:20, popCap:40, stockCap:30, required:['fish_fillet','bread','clothes'], upgradeTargets:{}, bonus:['fish_oil'] } },
].map((L, rank) => ({ key:L.key, n:L.n, ic:L.ic, col:L.col, hgt:L.hgt, rank,
             classe: RESIDENT_CLASSES[L.cfg?.classe] ? L.cfg.classe : L.classe,
             shapes: normalizeLuxShapes(L.cfg?.formes ?? L.shapes),
             resid: _resid(L.cfg, L.def) }));
function normalizeLuxShapes(list){
  const out = [];
  for(const s of list || []){
    const w = Math.max(1, Math.floor(+s?.[0] || 0)), h = Math.max(1, Math.floor(+s?.[1] || 0));
    for(const [a, c] of [[w, h], [h, w]]) if(!out.some(o => o[0] === a && o[1] === c)) out.push([a, c]);
  }
  return out.length ? out : [[1,1]];
}
(function applyLuxLevels(){
  for(const L of LUX_LEVELS){
    const sizes = L.shapes.filter(s => s[0] <= s[1]).map(s => s[0]+'×'+s[1]).join(' ou ');
    const cls = RESIDENT_CLASSES[L.classe];
    BUILD[L.key] = { n:L.n, ic:L.ic, col:L.col, hgt:L.hgt, area:L.shapes[0][0]*L.shapes[0][1],
      resid:L.resid, lux:true, luxRank:L.rank, classe:L.classe,
      desc: L.rank === 0
        ? 'Logement haut de gamme (débloqué à '+LUX_UNLOCK_POP+' habitants). Plein et approvisionné en outils, il s\'agrandit sur les cases libres voisines : '
          + LUX_LEVELS.slice(1).map(o => o.n.toLowerCase()+' '+o.shapes[0][0]*o.shapes[0][1]+' cases ('+RESIDENT_CLASSES[o.classe].pluriel.toLowerCase()+')').join(', ')
          + '. Le nombre d\'habitants double à chaque agrandissement ('+LUX_LEVELS.map(o => o.resid.popCap).join(' → ')+').'
        : 'Maison de luxe agrandie ('+sizes+'). '+L.resid.popCap+' '+cls.pluriel.toLowerCase()+'.' };
  }
})();
function luxNextLevelOf(b){
  const d = BUILD[typeof b === 'string' ? b : b?.type];
  return d?.lux ? (LUX_LEVELS[d.luxRank + 1] || null) : null;
}
// Déblocage par joueur, définitif une fois le seuil franchi (cf. update()).
function luxuryUnlocked(owner = myOwner()){
  const w = WALLETS[owner ?? currentWalletOwner()];
  if(w?.luxeUnlocked) return true;
  return Array.isArray(buildings) && popTotal(owner ?? null) >= LUX_UNLOCK_POP; // monde pas encore créé au démarrage
}

function _residCfgOf(b){
  const type = typeof b === 'string' ? b : b?.type;
  return BUILD[type]?.resid || null;
}
function residRequiredOf(b){ return _residCfgOf(b)?.required || DEFAULT_RESIDENT_NEEDS; }
function residUpgradeTargetsOf(b){ return _residCfgOf(b)?.upgradeTargets || EMPTY_RES_MAP; }
function residUpgradeResourcesOf(b){ return Object.keys(residUpgradeTargetsOf(b)).filter(r => RES[r]); }
function residUpgradeTargetOf(b,res){ return residUpgradeTargetsOf(b)[res] || 0; }
function residUpgradeProgressOf(b,res){ return Math.max(0, Math.floor(b?.upgradeProgress?.[res] || 0)); }
function residUpgradeIncomingOf(b,res){ return Math.max(0, Math.floor(b?.upgradeInc?.[res] || 0)); }
function residUpgradePaused(b,res){ return !!(b?.upgradePaused?.[res]); }
function residUpgradeRemainingOf(b,res){ return Math.max(0, residUpgradeTargetOf(b,res) - residUpgradeProgressOf(b,res)); }
function residUpgradeSatisfied(b){
  for(const r of residUpgradeResourcesOf(b))
    if(residUpgradeRemainingOf(b, r) > 0) return false;
  return true;
}
function residConsumesResource(b,res){
  return residRequiredOf(b).includes(res) || residBonusOf(b).includes(res);
}
function residBonusOf(b){ return _residCfgOf(b)?.bonus || DEFAULT_RESIDENT_BONUS; }
function residDeliveryResourcesOf(b){
  const out = [];
  const upgradeDemand = residUpgradeResourcesOf(b)
    .filter(r => !residUpgradePaused(b, r) && residUpgradeRemainingOf(b, r) > 0);
  for(const r of [...residRequiredOf(b), ...upgradeDemand, ...residBonusOf(b)]){
    if(RES[r] && !out.includes(r)) out.push(r);
  }
  return out;
}
function residSupplyRatio(b,res){
  if(residConsumesResource(b, res)){
    const cap = _residCfgOf(b)?.stockCap || 1;
    return ((b.storage[res]||0) + (b.inc[res]||0)) / cap;
  }
  const target = residUpgradeTargetOf(b, res);
  if(residUpgradePaused(b, res)) return 1;
  if(target > 0) return (residUpgradeProgressOf(b, res) + residUpgradeIncomingOf(b, res)) / target;
  return 1;
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
function resTargetNames(targets){
  return Object.keys(targets || {})
    .filter(r => RES[r] && targets[r] > 0)
    .map(r => targets[r]+' '+RES[r].n.toLowerCase())
    .join(' + ');
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
const FISHER_FISH_RADIUS = CFG.production?.pecheur?.rayonPeche ?? 5;
const fisherRadiusOf = () => FISHER_FISH_RADIUS;
// « cases » comptées pour les ouvriers et l'entretien : un bâtiment d'un seul tenant
// (centre spatial) compte une fois, une usine fusionnée autant que de cases.
const indAreaOf = b => BUILD[b.type]?.noMerge ? 1 : b.w * b.h;
const upkeepOf = b => (BUILD[b.type].upkeep||0) * indAreaOf(b) * indFactor(indAreaOf(b))
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

// « de » + nom propre avec contraction/élision françaises :
// Le Château → du Château, Les Ormes → des Ormes, Avignon → d’Avignon.
function deNom(name){
  const s = String(name || '');
  if(/^Le\s/.test(s)) return 'du ' + s.slice(3);
  if(/^Les\s/.test(s)) return 'des ' + s.slice(4);
  if(/^[AEIOUYÂÊÎÔÉÈ]/i.test(s)) return 'd’' + s;
  return 'de ' + s;
}

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
  oil_well: ['Puits de l\'Or Noir','Derrick du Nord','Puits Central','Forage des Plaines','Puits Royal','Derrick de la Vallée','Forage Profond','Puits du Couchant'],
  copper_smelter: ['Fonderie Rouge','Cuivrerie Centrale','Fonderie du Cuivre','Fourneau Royal','Cuivrerie du Nord','Fonderie des Mines'],
  wire_mill: ['Tréfilerie Centrale','Câblerie du Nord','Tréfilerie Royale','Fils & Câbles','Câblerie de la Vallée','Tréfilerie des Forges'],
  gold_refinery: ['Affinerie Royale','Comptoir de l\'Or','Affinerie du Nord','Maison de l\'Or','Affinerie des Monts','Raffinerie d\'Or'],
  rolling_mill: ['Laminoir Central','Grand Laminoir','Laminoir du Nord','Profilés Royaux','Laminoir des Forges','Aciérie des Poutres'],
  sheet_mill: ['Tôlerie Centrale','Tôlerie du Nord','Presses Royales','Tôlerie des Forges','Grande Tôlerie','Tôlerie de la Vallée'],
  nail_factory: ['Clouterie Centrale','Clouterie du Nord','Pointerie Royale','Clouterie des Forges','Vieille Clouterie'],
  cement_plant: ['Cimenterie Centrale','Cimenterie des Calcaires','Four à Chaux','Cimenterie du Nord','Grande Cimenterie','Cimenterie Royale'],
  concrete_plant: ['Centrale à Béton','Bétonnière du Nord','Béton des Plaines','Centrale du Chantier','Béton Royal','Bétonnerie Centrale'],
  glassworks: ['Verrerie Centrale','Verrerie des Sables','Cristallerie Royale','Verrerie du Nord','Souffleurs de Verre','Grande Verrerie'],
  glazier: ['Vitrerie Centrale','Miroiterie Royale','Vitrerie du Nord','Atelier des Vitres','Vitrerie de la Place'],
  ropery: ['Corderie Royale','Corderie du Port','Corderie Centrale','Atelier des Cordages','Corderie du Nord'],
  refinery: ['Raffinerie Centrale','Raffinerie du Nord','Grande Raffinerie','Raffinerie des Plaines','Raffinerie Royale','Pétrochimie de la Vallée'],
  chem_plant: ['Usine Chimique Centrale','Chimie du Nord','Laboratoires Réunis','Chimie des Plaines','Grande Chimie','Chimie Royale'],
  paint_factory: ['Peintures Centrales','Couleurs du Nord','Ocres Royales','Peintures de la Vallée','Atelier des Couleurs'],
  electronics_plant: ['Électronique Centrale','Circuits du Nord','Silicium Royal','Composants Réunis','Électronique de la Vallée','Grande Électronique'],
  furniture_factory: ['Ébénisterie Royale','Meubles du Nord','Atelier des Ébénistes','Mobilier Central','Ébénisterie de la Vallée'],
  appliance_factory: ['Électroménager Central','Appareils du Nord','Usine des Appareils','Électroménager Royal','Foyer Moderne'],
  jeweler: ['Joaillerie Royale','Maison des Bijoux','Orfèvrerie Centrale','Joaillerie du Nord','Bijouterie de la Place'],
  quantum_lab: ['Laboratoire Quantique','Institut des Qubits','Centre de Recherche','Labo Stellaire','Institut Quantique Royal'],
  space_center: ['Centre Spatial','Cosmodrome','Base de Lancement','Spatioport','Centre Spatial du Nord','Cosmodrome Royal'],
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

function nearestTownToPoint(x, y){
  let nearest = null, nearestDist = Infinity;
  for(const t of towns){
    const d = Math.hypot(x - t.cx, y - t.cy);
    if(d < nearestDist){ nearestDist = d; nearest = t; }
  }
  return nearest;
}

function trainStationGroupPieces(groupId){
  return buildings.filter(b => !b.dead && (b.type === 'train_station' || b.type === 'train_platform') && b.stationGroupId === groupId);
}

function assignTrainStationName(groupId){
  if(groupId == null) return;
  const pieces = trainStationGroupPieces(groupId);
  if(!pieces.length) return;
  const cx = pieces.reduce((sum, b) => sum + b.x + (b.w || 1) / 2, 0) / pieces.length;
  const cy = pieces.reduce((sum, b) => sum + b.y + (b.h || 1) / 2, 0) / pieces.length;
  const town = nearestTownToPoint(cx, cy);
  const baseTownName = town ? town.name : generateTownName(Math.round(cx), Math.round(cy));
  const baseName = 'Gare ' + deNom(baseTownName);
  const used = new Set(
    buildings
      .filter(b => !b.dead && (b.type === 'train_station' || b.type === 'train_platform'))
      .filter(b => b.stationGroupId != null && b.stationGroupId !== groupId && b.name)
      .map(b => b.name)
  );
  let name = baseName, suffix = 2;
  while(used.has(name)) name = baseName + ' ' + (suffix++);
  for(const piece of pieces) piece.name = name;
}

function assignTrainDepotName(b){
  if(!b || b.dead || b.type !== 'train_depot' || b.name) return;
  const cx = b.x + (b.w || 1) / 2;
  const cy = b.y + (b.h || 1) / 2;
  const town = nearestTownToPoint(cx, cy);
  const baseTownName = town ? town.name : generateTownName(Math.round(cx), Math.round(cy));
  const baseName = 'Dépôt ' + deNom(baseTownName);
  const used = new Set(
    buildings
      .filter(o => !o.dead && o.type === 'train_depot' && o !== b && o.name)
      .map(o => o.name)
  );
  let name = baseName, suffix = 2;
  while(used.has(name)) name = baseName + ' ' + (suffix++);
  b.name = name;
}

function assignTrainVehicleName(v){
  if(!v || v.dead || v.vtype !== 'train' || v.name) return;
  const depot = v.garageRef || null;
  const cx = depot ? (depot.x + (depot.w || 1) / 2) : 0;
  const cy = depot ? (depot.y + (depot.h || 1) / 2) : 0;
  const town = nearestTownToPoint(cx, cy);
  const baseTownName = depot?.name || (town ? town.name : generateTownName(Math.round(cx), Math.round(cy)));
  const baseName = 'Train ' + baseTownName;
  const used = new Set(
    vehicles
      .filter(o => o && o !== v && o.vtype === 'train' && o.name)
      .map(o => o.name)
  );
  let name = baseName, suffix = 2;
  while(used.has(name)) name = baseName + ' ' + (suffix++);
  v.name = name;
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


const DEPOT_STOCK_PER_CELL  = CFG.entrepot?.stockParCase ?? 40;
const MARKET_STOCK_PER_CELL = CFG.marche?.stockParCase ?? 20; // le marché n'est pas concerné par le doublement des entrepôts
const DEPOT_RADIUS_BASE     = CFG.entrepot?.rayonBase    ?? 5;
const DEPOT_RADIUS_FACTOR   = CFG.entrepot?.rayonFacteur ?? 3;
const depotRadiusOf = b => Math.round(DEPOT_RADIUS_BASE + Math.sqrt(b.w * b.h) * DEPOT_RADIUS_FACTOR);

const TANK_STOCK_PER_CELL  = CFG.citerne?.stockParCase ?? 40;
const TANK_RADIUS_BASE     = CFG.citerne?.rayonBase    ?? 5;
const TANK_RADIUS_FACTOR   = CFG.citerne?.rayonFacteur ?? 3;
const BAKERY_TANK_RADIUS   = CFG.citerne?.rayonBoulangerie ?? 8;
const tankRadiusOf = b => Math.round(TANK_RADIUS_BASE + Math.sqrt(b.w * b.h) * TANK_RADIUS_FACTOR);
const isStorageHub = b => !!(b && BUILD[b.type]?.storageHub);
const isStorageDepot = b => !!(b && BUILD[b.type]?.storageHub && b.type !== 'tank');
const isVehicleDepot = b => !!(b && BUILD[b.type]?.transportDepot);
const depotStoredVehicles = b => isVehicleDepot(b)
  ? (b.vehicles || []).filter(v => !v.garageRef?.dead && v.currentBuilding === b && v.state === 'idle')
  : [];
const depotHasStoredVehicles = b => depotStoredVehicles(b).length > 0;

// Valeur d'achat totale d'un véhicule : base + wagons + améliorations moteur.
// La revente (ou la destruction du dépôt) rembourse 50 % de cette valeur.
function vehiclePurchaseValue(v){
  if(!v) return 0;
  let total = VEHICLE_TYPES[v.vtype]?.cost || 0;
  if(v.vtype === 'train'){
    total += (Array.isArray(v.wagons) ? v.wagons.length : 0) * TRAIN_WAGON_COST;
    for(const up of TRAIN_ENGINE_UPGRADES) if(up.facteur <= (v.engineMult || 1)) total += up.cout || 0;
  }
  return total;
}
function vehicleResaleValue(v){ return Math.floor(vehiclePurchaseValue(v) * 0.5); }

// Tous les véhicules rattachés au dépôt (à quai OU en transit).
function depotAllVehicles(b){
  return isVehicleDepot(b)
    ? vehicles.filter(v => v.garageRef === b && !v.garageRef?.dead)
    : [];
}

// Valeur totale (coût d'achat) de tous les véhicules rattachés au dépôt.
function depotVehicleValue(b){
  let total = 0;
  for(const v of depotAllVehicles(b)) total += vehiclePurchaseValue(v);
  return total;
}

BUILD.depot.stockPerCell = DEPOT_STOCK_PER_CELL;
BUILD.market.stockPerCell = MARKET_STOCK_PER_CELL;
BUILD.tank.stockPerCell = TANK_STOCK_PER_CELL;
BUILD.depot.radiusOf = depotRadiusOf;
BUILD.market.radiusOf = depotRadiusOf;
BUILD.tank.radiusOf = tankRadiusOf;

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
  const owner = bgrid[y*N+x]?.owner ?? null;
  for(let yy=y; yy<y+h; yy++) for(let xx=x; xx<x+w; xx++){
    const b = bgrid[yy*N+xx];
    if(!b || b.type !== 'depot') return null;
    if((b.owner ?? null) !== owner) return null; // jamais de fusion entre joueurs
    if(b.w*b.h >= area) return null;          // déjà aussi grand ou plus grand
    if(b.x<x || b.y<y || b.x+b.w>x+w || b.y+b.h>y+h) return null;
    if(!set.includes(b)) set.push(b);
  }
  return set.length ? set : null;
}

// Coins haut-gauche candidats d'un rectangle de fusion : la tuile (x,y) d'un
// rectangle valide est forcément l'origine d'un des bâtiments fusionnés. On ne
// teste donc que ces origines (triées comme l'ancien balayage ligne par ligne)
// au lieu de toutes les tuiles de la carte pour chaque forme.
function mergeAnchors(filter){
  return buildings.filter(b => !b.dead && filter(b))
    .map(b => [b.x, b.y])
    .sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
}

function tryMergeDepot(){
  const anchors = mergeAnchors(b => b.type === 'depot');
  if(anchors.length < 2) return false;
  for(const [w,h] of DEPOT_SHAPES){
    for(const [x, y] of anchors){
      if(x > N-w || y > N-h) continue;
      const set = checkRectDepot(x,y,w,h);
      if(!set) continue;
      const owner = set[0].owner||null;
      const store = {}, allow = {}, trainAllow = {}, sellTo = {}, sellMin = {};
      for(const k in RES){ allow[k] = false; trainAllow[k] = false; sellTo[k] = false; sellMin[k] = 0; }
      let wasSel = false;
      for(const o of set){
        for(const k in o.storage) store[k] = (store[k]||0) + o.storage[k];
        // une ressource est refusée dans le grand entrepôt seulement si TOUS les petits la refusent
        for(const k in RES){
          if(o.allow?.[k] !== false) allow[k] = true;
          if(o.trainAllow?.[k]) trainAllow[k] = true;
          if(o.sellTo?.[k]) sellTo[k] = true;
          sellMin[k] = Math.max(sellMin[k], o.sellMin?.[k] || 0);
        }
        if(o === selected) wasSel = true;
        o.dead = true;
        setGrid(o, null);
      }
      buildings = buildings.filter(o=> !o.dead);
      const t = newBuilding('depot', x, y, w, h);
      t.owner = owner;
      t.allow = allow; t.trainAllow = trainAllow; t.sellTo = sellTo; t.sellMin = sellMin;
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
  // maisons de luxe : multiple du prix (final) d'une maison basique ; les niveaux
  // agrandis gardent ce prix (remboursement à la démolition)
  for(const L of LUX_LEVELS) BUILD[L.key].cost = Math.round((BUILD.house.cost || 0) * LUX_COST_MULT);
})();

// Recette lisible : « 2 🟠 + 1 ⚫ → 1 🥉 » ; long=true : noms complets ;
// long='full' : icône + nom (« 2 ⚙️ acier → 1 🪜 poutrelle en acier »).
function recipeText(rec, long = false){
  const fmt = r => long === 'full' ? RES[r].ic + ' ' + RES[r].n.toLowerCase() : long ? RES[r].n.toLowerCase() : RES[r].ic;
  const side = m => Object.keys(m || {}).filter(r => RES[r]).map(r => m[r] + ' ' + fmt(r)).join(' + ');
  const lhs = side(rec?.in);
  return (lhs ? lhs + ' → ' : '') + side(rec?.out);
}
// description des usines avancées : recette finale (après config.js) + note
for(const [type] of ADVANCED_FACTORIES){
  const d = BUILD[type];
  d.desc = recipeText(d.recipe, true) + '.' + (d.note ? ' ' + d.note : '');
}

// ---------- matériaux de chantier ----------
// Grands bâtiments : en plus du prix, des matériaux stockés dans un entrepôt du
// joueur dont le rayon couvre la case (cf. buildMaterialsError, 03_buildings_population.js).
const BUILD_MATERIALS_ON = CFG.materiauxChantier?.actif !== false;
const BUILD_MATERIALS = (()=>{
  const raw = CFG.materiauxChantier?.batiments || {};
  const out = {};
  for(const type in raw){
    const m = _resMap(raw[type], {});
    if(Object.keys(m).length) out[type] = m;
  }
  return out;
})();
// Matériaux exigés pour un type (null si aucun). Le placement de l'outil « Gare »
// pose un quai sur un rail : la clé est alors train_platform.
const buildMaterialsOf = type => BUILD_MATERIALS[type] || null;

const TOOL_ORDER = ['select','road','rail','mine','lumber','fisher','oil_well','plant','house','space_center','restaurant','depot','market','tank','pump','garage','bus_stop','air_terminal','air_runway','air_taxi','air_parking','air_tower','air_deco','terraform','fill_water','terraform_dig','terraform_raise','terraform_canal'];
const MILESTONES = [25, 50, 100, 200, 400];
