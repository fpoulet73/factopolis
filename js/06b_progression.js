// ---------- progression : objectifs en parallèle et déblocages ----------
// Les objectifs forment un arbre : chacun s'ouvre quand ses prérequis (req) sont
// atteints, plusieurs sont donc actifs en même temps. Atteindre un objectif verse
// sa prime et débloque des fonctionnalités (unlocks) : bâtiments de la barre
// d'outils, spécialisations d'usine ou de magasin (clé du type moteur) et
// véhicules (« v:<type> »). Tout ce qui n'apparaît dans aucun unlocks est
// disponible dès le départ.
// Avancement par joueur dans le portefeuille : wallet.objDone = { id: 1 } (objectifs
// atteints) et wallet.objGranted = { id: 1 } (déblocages accordés d'office à une
// ancienne partie qui utilisait déjà ces fonctionnalités). Vérifié par la
// simulation autoritaire (hôte) ; les invités le reçoivent avec les portefeuilles.
// Progression désactivée (tout débloqué) en mode créatif ou si WORLD.progression === false
// (bac à sable des tests) ; les objectifs et leurs primes restent actifs.

const PROG_CHAPTERS = {
  village:   { n:'Le village',          ic:'🏡' },
  atelier:   { n:'L’atelier',           ic:'🔧' },
  ville:     { n:'La ville s’étend',    ic:'🏙️' },
  chantiers: { n:'Grands chantiers',    ic:'🏗️' },
  industrie: { n:'Industrie lourde',    ic:'🛢️' },
  tech:      { n:'Haute technologie',   ic:'💾' },
  espace:    { n:'Vers les étoiles',    ic:'🚀' },
};

const countOwned = (o, pred) => buildings.reduce((n, b) => n + (!b.dead && ownedBy(b, o) && pred(b) ? 1 : 0), 0);
const countVehicles = (o, pred) => vehicles.reduce((n, v) => n + (v.garageRef && ownedBy(v.garageRef, o) && pred(v) ? 1 : 0), 0);
const isRoadFreight = v => VEHICLE_TYPES[v.vtype]?.mode === 'road' && v.vtype !== 'bus';
const RESID_TOWER_KEYS = ['tower', 'bigtower', 'tower3', 'sky'];
const AIR_TOOLS = ['air_terminal', 'air_runway', 'air_taxi', 'air_parking', 'air_tower', 'air_deco', 'plane_depot'];
// Objectif « N habitants » : contrôle + jauge
const popGoal = n => ({ check:o => popTotal(o) >= n, prog:o => [popTotal(o), n] });
const countGoal = (n, pred) => ({ check:o => countOwned(o, pred) >= n, prog:o => [countOwned(o, pred), n] });

const OBJECTIVES = [
  // ── Le village ──
  { id:'house', ch:'village', ic:'🏠', txt:'Construis ta première maison', reward:300,
    check:o => countOwned(o, b => BUILD[b.type].resid) >= 1 },
  { id:'road', ch:'village', ic:'🛣️', txt:'Relie une maison à une route', reward:200, req:['house'],
    check:o => buildings.some(b => !b.dead && ownedBy(b, o) && BUILD[b.type].resid && adjRoadTiles(b).length > 0) },
  { id:'fisher', ch:'village', ic:'🎣', txt:'Construis une cabane de pêcheur au bord de l’eau', reward:300,
    unlocks:['pump', 'tank'], ...countGoal(1, b => b.type === 'fisher') },
  { id:'lumber', ch:'village', ic:'🪓', txt:'Installe un bûcheron près des arbres', reward:300,
    unlocks:['mine'], ...countGoal(1, b => b.type === 'lumber') },
  { id:'fishery', ch:'village', ic:'🐟', txt:'Transforme une usine abandonnée en poissonnerie', reward:400, req:['fisher'],
    unlocks:['shop', 'shop_food'], ...countGoal(1, b => b.type === 'fishery') },
  { id:'homes6', ch:'village', ic:'🏘️', txt:'Bâtis un hameau de 6 logements', reward:600, req:['road'],
    ...countGoal(6, b => BUILD[b.type].resid) },
  { id:'pop25', ch:'village', ic:'👥', txt:'Atteins 25 habitants', reward:800, req:['road'],
    unlocks:['farm', 'cotton_farm', 'mill', 'bakery', 'weaver'], ...popGoal(25) },
  { id:'grocery', ch:'village', ic:'🛒', txt:'Ouvre une épicerie (magasin spécialisé)', reward:600, req:['fishery'],
    unlocks:['market'], ...countGoal(1, b => b.type === 'shop_food') },

  // ── L'atelier ──
  { id:'mines', ch:'atelier', ic:'⛏️', txt:'Exploite une mine de fer et une mine de charbon', reward:600, req:['lumber'],
    unlocks:['smelter'],
    check:o => countOwned(o, b => b.type === 'mine' && b.ore === 'iron') >= 1 && countOwned(o, b => b.type === 'mine' && b.ore === 'coal') >= 1 },
  { id:'steel', ch:'atelier', ic:'🔥', txt:'Produis de l’acier : fer + charbon dans une aciérie', reward:1200, req:['mines'],
    unlocks:['factory', 'nail_factory'], ...countGoal(1, b => b.type === 'smelter') },
  { id:'tools', ch:'atelier', ic:'🔧', txt:'Fabrique des outils : acier + bois dans une usine d’outils', reward:1500, req:['steel'],
    unlocks:['garage', 'v:minerai', 'v:plateau', 'v:marchandises', 'v:cereale', 'shop_tools'], ...countGoal(1, b => b.type === 'factory') },
  { id:'bread', ch:'atelier', ic:'🥖', txt:'Cuis du pain : ferme, moulin et boulangerie (eau en citerne)', reward:1500, req:['pop25'],
    ...countGoal(1, b => b.type === 'bakery') },
  { id:'clothes', ch:'atelier', ic:'🧵', txt:'Tisse des vêtements : ferme de coton + usine de tissage', reward:1200, req:['pop25'],
    unlocks:['shop_supplies', 'ropery'], ...countGoal(1, b => b.type === 'weaver') },
  { id:'merge', ch:'atelier', ic:'🏡', txt:'Fais fusionner des maisons pleines (outils livrés)', reward:2000, req:['tools'],
    unlocks:['bus_stop', 'v:bus'], ...countGoal(1, b => BUILD[b.type].resid && b.type !== 'house' && !BUILD[b.type].lux) },
  { id:'truck', ch:'atelier', ic:'🚚', txt:'Achète un camion dans un dépôt de véhicules', reward:1000, req:['tools'],
    unlocks:['v:frigo', 'v:citerne'], check:o => countVehicles(o, isRoadFreight) >= 1 },
  { id:'savings', ch:'atelier', ic:'💰', txt:'Mets 15 000 $ de côté', reward:1500, req:['pop25'],
    unlocks:['terraform_dig', 'terraform_raise', 'terraform_canal', 'terrassement', 'fill_water'],
    check:(o, w) => (w?.money || 0) >= 15000, prog:(o, w) => [Math.floor(w?.money || 0), 15000] },

  // ── La ville s'étend ──
  { id:'pop100', ch:'ville', ic:'🏙️', txt:'Atteins 100 habitants', reward:3000, req:['merge'],
    unlocks:['cement_plant', 'concrete_plant', 'rolling_mill', 'sheet_mill', 'glassworks', 'glazier'], ...popGoal(100) },
  { id:'bus', ch:'ville', ic:'🚌', txt:'Mets un bus en service entre deux arrêts', reward:2000, req:['merge'],
    unlocks:['treetop'], check:o => countVehicles(o, v => v.vtype === 'bus' && v.state && v.state !== 'idle') >= 1 },
  { id:'stops4', ch:'ville', ic:'🚏', txt:'Dessers ta ville avec 4 arrêts de bus', reward:800, req:['merge'],
    ...countGoal(4, b => b.type === 'bus_stop') },
  { id:'fleet5', ch:'ville', ic:'🚛', txt:'Constitue une flotte de 5 camions', reward:2500, req:['truck'],
    check:o => countVehicles(o, isRoadFreight) >= 5, prog:o => [countVehicles(o, isRoadFreight), 5] },
  { id:'tower', ch:'ville', ic:'🏢', txt:'Fais pousser un immeuble (fusion 2×2 de logements)', reward:4000, req:['pop100'],
    ...countGoal(1, b => RESID_TOWER_KEYS.includes(b.type)) },
  { id:'lux', ch:'ville', ic:'💎', txt:'Construis une maison de luxe', reward:3000, req:['pop100'],
    ...countGoal(1, b => BUILD[b.type].resid && BUILD[b.type].lux) },
  { id:'pop250', ch:'ville', ic:'🌇', txt:'Atteins 250 habitants', reward:8000, req:['pop100'],
    unlocks:['zoo'], ...popGoal(250) },

  // ── Grands chantiers ──
  { id:'concrete', ch:'chantiers', ic:'🔲', txt:'Produis du béton : carrière de calcaire, cimenterie + centrale à béton', reward:3000, req:['pop100'],
    unlocks:['rail', 'rail_signal', 'rail_signal2', 'train_station', 'tunnel', 'train_depot', 'v:train'], ...countGoal(1, b => b.type === 'concrete_plant') },
  { id:'beams', ch:'chantiers', ic:'🪜', txt:'Lamine l’acier : laminoir (poutrelles) et tôlerie (plaques)', reward:3000, req:['pop100'],
    unlocks:['oil_well', 'refinery', 'copper_smelter', 'wire_mill'],
    check:o => countOwned(o, b => b.type === 'rolling_mill') >= 1 && countOwned(o, b => b.type === 'sheet_mill') >= 1 },
  { id:'glass', ch:'chantiers', ic:'🪟', txt:'Fabrique des vitres : verrerie (sable) + vitrerie', reward:3000, req:['pop100'],
    unlocks:['shop_diy'], ...countGoal(1, b => b.type === 'glazier') },
  { id:'station', ch:'chantiers', ic:'🚉', txt:'Construis un dépôt de train et deux gares', reward:5000, req:['concrete'],
    check:o => countOwned(o, b => b.type === 'train_depot') >= 1
      && new Set(buildings.filter(b => !b.dead && b.type === 'train_station' && ownedBy(b, o)).map(b => b.stationGroupId)).size >= 2 },
  { id:'train', ch:'chantiers', ic:'🚂', txt:'Mets un train en circulation', reward:8000, req:['station'],
    check:o => countVehicles(o, v => v.vtype === 'train' && v.state !== 'idle') >= 1 },
  { id:'trains3', ch:'chantiers', ic:'🚆', txt:'Fais rouler 3 trains en même temps', reward:15000, req:['train'],
    check:o => countVehicles(o, v => v.vtype === 'train' && v.state !== 'idle') >= 3,
    prog:o => [countVehicles(o, v => v.vtype === 'train' && v.state !== 'idle'), 3] },
  { id:'leisure', ch:'chantiers', ic:'🎟️', txt:'Ouvre un premier lieu de loisirs', reward:2500, req:['bus'],
    unlocks:['cinema', 'museum'], ...countGoal(1, b => isLeisure(b)) },

  // ── Industrie lourde ──
  { id:'oil', ch:'industrie', ic:'🛢️', txt:'Fore un puits de pétrole et construis une raffinerie', reward:6000, req:['beams'],
    unlocks:['chem_plant', 'paint_factory', 'gold_refinery', 'furniture_factory'],
    check:o => countOwned(o, b => b.type === 'oil_well') >= 1 && countOwned(o, b => b.type === 'refinery') >= 1 },
  { id:'copper', ch:'industrie', ic:'➰', txt:'Tréfile du fil de cuivre : fonderie de cuivre + tréfilerie', reward:3000, req:['beams'],
    unlocks:['electronics_plant'], ...countGoal(1, b => b.type === 'wire_mill') },
  { id:'paint', ch:'industrie', ic:'🎨', txt:'Produis de la peinture (produits chimiques + argile)', reward:2500, req:['oil'],
    unlocks:['boat_depot', 'v:cargo_ship', 'v:ferry', 'tennis', 'basketball'], ...countGoal(1, b => b.type === 'paint_factory') },
  { id:'furniture', ch:'industrie', ic:'🛋️', txt:'Meuble les classes aisées : clouterie, usine chimique (colle) + ébénisterie', reward:6000, req:['oil'],
    unlocks:['restaurant', 'spa', 'jeweler'], ...countGoal(1, b => b.type === 'furniture_factory') },
  { id:'port', ch:'industrie', ic:'⚓', txt:'Ouvre un port (matériaux de chantier dans un entrepôt proche)', reward:5000, req:['paint'],
    unlocks:['marina'], ...countGoal(1, b => b.type === 'boat_depot') },
  { id:'ship', ch:'industrie', ic:'🚢', txt:'Mets un bateau à l’eau', reward:4000, req:['port'],
    check:o => countVehicles(o, v => VEHICLE_TYPES[v.vtype]?.mode === 'water') >= 1 },
  { id:'visitors', ch:'industrie', ic:'🎡', txt:'Accueille 300 visiteurs dans tes lieux de loisirs', reward:5000, req:['leisure'],
    check:o => leisureVisitsOf(o) >= 300, prog:o => [leisureVisitsOf(o), 300] },

  // ── Haute technologie ──
  { id:'electronics', ch:'tech', ic:'💾', txt:'Fabrique des cartes électroniques (fil de cuivre, plastique, or)', reward:12000, req:['copper', 'oil'],
    unlocks:[...AIR_TOOLS, 'v:plane', 'v:cargo_plane', 'appliance_factory', 'concert_hall'], ...countGoal(1, b => b.type === 'electronics_plant') },
  { id:'appliances', ch:'tech', ic:'📺', txt:'Produis de l’électroménager', reward:10000, req:['electronics'],
    unlocks:['hotel'], ...countGoal(1, b => b.type === 'appliance_factory') },
  { id:'jewelry', ch:'tech', ic:'💍', txt:'Taille des bijoux dans une joaillerie (or + verre)', reward:8000, req:['furniture'],
    unlocks:['casino'], ...countGoal(1, b => b.type === 'jeweler') },
  { id:'airport', ch:'tech', ic:'✈️', txt:'Ouvre un aéroport fonctionnel (terminal, piste, taxi)', reward:8000, req:['electronics'],
    unlocks:['space_center'], check:o => countOwned(o, b => isActiveAirTerminal(b)) >= 1 },
  { id:'plane', ch:'tech', ic:'🛫', txt:'Achète ton premier avion', reward:10000, req:['airport'],
    check:o => countVehicles(o, v => VEHICLE_TYPES[v.vtype]?.mode === 'air') >= 1 },
  { id:'pop400', ch:'tech', ic:'🌆', txt:'Atteins 400 habitants', reward:20000, req:['pop250'],
    unlocks:['stadium', 'baseball'], ...popGoal(400) },
  { id:'sky', ch:'tech', ic:'🏙️', txt:'Élève un gratte-ciel (fusion 4×4)', reward:30000, req:['pop400'],
    unlocks:['theme_park'], ...countGoal(1, b => b.type === 'sky') },

  // ── Vers les étoiles ──
  { id:'rocket', ch:'espace', ic:'🚀', txt:'Lance une fusée depuis un centre spatial', reward:50000, req:['airport'],
    unlocks:['quantum_lab'], check:o => buildings.some(b => !b.dead && b.type === 'space_center' && ownedBy(b, o) && (b.launches || 0) >= 1) },
  { id:'quantum', ch:'espace', ic:'🔮', txt:'Produis un processeur quantique (xénite + hélium-3 de l’espace)', reward:80000, req:['rocket'],
    ...countGoal(1, b => b.type === 'quantum_lab') },
  { id:'pop1000', ch:'espace', ic:'🌃', txt:'Atteins 1 000 habitants', reward:60000, req:['pop400'],
    ...popGoal(1000) },
];
const OBJECTIVE_BY_ID = {};
// fonctionnalité → objectif qui la débloque
const FEATURE_UNLOCK = {};
for(const o of OBJECTIVES){
  o.req = o.req || [];
  o.unlocks = o.unlocks || [];
  OBJECTIVE_BY_ID[o.id] = o;
  for(const f of o.unlocks) FEATURE_UNLOCK[f] = o.id;
}

function leisureVisitsOf(o){
  let n = 0;
  for(const b of buildings) if(!b.dead && isLeisure(b) && ownedBy(b, o)) n += b.visitsTotal || 0;
  return Math.floor(n);
}

// ---------- état de progression ----------
const progressionActive = () => WORLD?.progression !== false && WORLD?.mode !== 'creative';
// Portefeuille en lecture seule (n'en crée pas) : owner null/undefined = joueur courant.
const progWallet = owner => WALLETS[owner ?? currentWalletOwner()] || null;
const objectiveDone = (w, id) => !!w?.objDone?.[id];
const objectiveOpen = (w, o) => !objectiveDone(w, o.id) && o.req.every(r => objectiveDone(w, r));

// Fonctionnalité accessible ? (clé BUILD, type de spécialisation ou « v:<véhicule> »)
function featureUnlocked(key, owner){
  if(!progressionActive()) return true;
  const id = FEATURE_UNLOCK[key];
  if(!id) return true;
  const w = progWallet(owner);
  return objectiveDone(w, id) || !!w?.objGranted?.[id];
}
function featureLabel(key){
  if(key.startsWith('v:')){ const v = VEHICLE_TYPES[key.slice(2)]; return v ? v.icone + ' ' + v.nom : key; }
  const up = PLANT_UPGRADES[key] || SHOP_UPGRADES[key];
  if(up) return up.icon + ' ' + up.label;
  const d = BUILD[key];
  return d ? d.ic + ' ' + d.n : key;
}
// Message affiché quand on tente d'utiliser une fonctionnalité verrouillée.
function featureLockedMsg(key){
  const o = OBJECTIVE_BY_ID[FEATURE_UNLOCK[key]];
  return '🔒 ' + featureLabel(key) + ' : se débloque avec l’objectif « ' + (o ? o.txt : '?') + ' »';
}

// Rappel court (panneaux) : « 🔒 Objectif : … »
function featureLockHint(key){
  const o = OBJECTIVE_BY_ID[FEATURE_UNLOCK[key]];
  return '🔒 Objectif : ' + (o ? o.ic + ' ' + o.txt : '?');
}

// Ancienne partie (ou première vérification) : objectifs déjà remplis validés sans
// prime, en suivant l'arbre ; les fonctionnalités déjà utilisées par le joueur
// restent accessibles (leur objectif est accordé d'office).
function initObjectiveProgress(w, o){
  w.objDone = {};
  w.objGranted = w.objGranted || {};
  let changed = true;
  while(changed){
    changed = false;
    for(const obj of OBJECTIVES)
      if(objectiveOpen(w, obj) && obj.check(o, w)){ w.objDone[obj.id] = 1; changed = true; }
  }
  const used = new Set();
  for(const b of buildings) if(!b.dead && ownedBy(b, o)) used.add(b.type);
  for(const v of vehicles) if(v.garageRef && ownedBy(v.garageRef, o)) used.add('v:' + v.vtype);
  if(typeof railOwner !== 'undefined' && railOwner){
    const rid = o == null ? -1 : o;
    for(let i = 0; i < railOwner.length; i++) if(rail[i] && railOwner[i] === rid){ used.add('rail'); break; }
  }
  for(const f of used){
    const id = FEATURE_UNLOCK[f];
    if(id && !w.objDone[id]) w.objGranted[id] = 1;
  }
  delete w.objIndex; // ancien fil linéaire
}

// Déphasé d'une demi-seconde des fusions (mergeTimer) : les deux tâches périodiques
// ne tombent plus dans la même image.
let objectivesTimer = 0.5;
// Après le chargement d'une partie / la réception d'un état de l'hôte, l'état du monde peut
// être incomplet ou en cours de synchronisation : pendant ce court délai, un objectif déjà
// rempli est validé SANS prime ni annonce (la prime n'est versée qu'à l'accomplissement réel).
let objectivesSettleUntil = performance.now() + 6000;
function objectivesSettle(){ objectivesSettleUntil = performance.now() + 6000; }
function updateObjectives(){
  if(typeof MP !== 'undefined' && MP.connected && MP.role === 'guest') return; // l'hôte est seul juge (primes dans son état)
  const settling = performance.now() < objectivesSettleUntil;
  for(const k in WALLETS){
    const w = WALLETS[k], o = walletOwnerOf(k);
    if(!w.objDone){ initObjectiveProgress(w, o); continue; }
    for(const obj of OBJECTIVES){
      if(!objectiveOpen(w, obj) || !obj.check(o, w)) continue;
      w.objDone[obj.id] = 1;
      if(!settling) earnMoney(obj.reward, 'primes', w); // déjà rempli au chargement : validé sans prime
    }
  }
}
