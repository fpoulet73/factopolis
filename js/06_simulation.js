// ---------- simulation ----------

// Multiplicateur de vitesse de pêche selon les tuiles poissons dans le rayon
// Retourne ×1 si aucune, ×2 / ×2.5 / ×3 / ×3.5 pour 1/2/3/4+ tuiles poissons
function fisherFishBonus(b){
  // getFishTiles() est défini dans 07_rendering.js, disponible à l'exécution
  const fishTiles = getFishTiles();
  const cx = b.x + Math.floor((b.w || 1) / 2);
  const cy = b.y + Math.floor((b.h || 1) / 2);
  const r  = FISHER_FISH_RADIUS;
  let count = 0;
  for(let dy = -r; dy <= r; dy++){
    for(let dx = -r; dx <= r; dx++){
      if(Math.sqrt(dx * dx + dy * dy) > r) continue;
      const nx = cx + dx, ny = cy + dy;
      if(nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      if(fishTiles.has(ny * N + nx)) count++;
    }
  }
  return count;
}

// Règle le péage d'utilisation des rails accumulé par un train : le propriétaire
// du train (payerId) paie RAIL_USAGE_TAX par tuile empruntée à chaque propriétaire
// de rails concerné. Détaillé par joueur pour l'affichage des finances.
function settleRailToll(v, payerId, fx, fy){
  if(!v || !v.railTollOwed) return;
  const payer = walletOf(payerId);
  let totalPaid = 0;
  for(const k in v.railTollOwed){
    const tiles = v.railTollOwed[k];
    const ownerId = +k;
    if(tiles <= 0 || ownerId === payerId) continue;
    const amount = tiles * RAIL_USAGE_TAX;
    if(amount <= 0) continue;
    payer.money -= amount;
    payer.fin.peagePaye += amount;
    payer.peageDetail.paid[ownerId] = (payer.peageDetail.paid[ownerId] || 0) + amount;
    const receiver = walletOf(ownerId);
    receiver.money += amount;
    receiver.fin.peageRecu += amount;
    receiver.peageDetail.recv[payerId] = (receiver.peageDetail.recv[payerId] || 0) + amount;
    totalPaid += amount;
  }
  v.railTollOwed = {};
  vehicleLedger(v, -totalPaid);
  if(totalPaid > 0 && fx != null)
    addFloat(fx, fy - 0.7, '−'+(Math.round(totalPaid*10)/10)+' $ 🛤️', '#ff8c42');
}

// ---------- objectifs (progression guidée) ----------
// Fil d'objectifs par joueur, du premier logement aux trains/ports/aéroports,
// chacun récompensé d'une prime. Vérifié par la simulation autoritaire (solo ou
// hôte) ; l'avancement voyage dans le portefeuille (wallet.objIndex).
const countOwned = (o, pred) => buildings.reduce((n, b) => n + (!b.dead && ownedBy(b, o) && pred(b) ? 1 : 0), 0);
const OBJECTIVES = [
  { ic:'🏠', txt:'Construis ta première maison', reward:300, check:o => countOwned(o, b => BUILD[b.type].resid) >= 1 },
  { ic:'🛣️', txt:'Relie une maison à une route', reward:200, check:o => buildings.some(b => !b.dead && ownedBy(b, o) && BUILD[b.type].resid && adjRoadTiles(b).length > 0) },
  { ic:'🎣', txt:'Construis une cabane de pêcheur au bord de l’eau', reward:300, check:o => countOwned(o, b => b.type === 'fisher') >= 1 },
  { ic:'🐟', txt:'Transforme une usine abandonnée en poissonnerie', reward:400, check:o => countOwned(o, b => b.type === 'fishery') >= 1 },
  { ic:'👥', txt:'Atteins 25 habitants', reward:800, check:o => popTotal(o) >= 25 },
  { ic:'🔥', txt:'Produis de l’acier : mines de fer et de charbon + aciérie', reward:1200, check:o => countOwned(o, b => b.type === 'smelter') >= 1 },
  { ic:'🔧', txt:'Fabrique des outils : bûcheron + usine d’outils', reward:1500, check:o => countOwned(o, b => b.type === 'factory') >= 1 },
  { ic:'🏡', txt:'Fais fusionner des maisons pleines (outils livrés)', reward:2000, check:o => countOwned(o, b => BUILD[b.type].resid && b.type !== 'house' && !BUILD[b.type].lux) >= 1 },
  { ic:'🚚', txt:'Achète un camion ou un bus (dépôt de véhicules)', reward:1000, check:o => vehicles.some(v => VEHICLE_TYPES[v.vtype]?.mode === 'road' && v.garageRef && ownedBy(v.garageRef, o)) },
  { ic:'🏙️', txt:'Atteins 100 habitants', reward:3000, check:o => popTotal(o) >= 100 },
  { ic:'🚉', txt:'Construis un dépôt de train et deux gares', reward:5000, check:o => countOwned(o, b => b.type === 'train_depot') >= 1
      && new Set(buildings.filter(b => !b.dead && b.type === 'train_station' && ownedBy(b, o)).map(b => b.stationGroupId)).size >= 2 },
  { ic:'🚂', txt:'Mets un train en circulation', reward:8000, check:o => vehicles.some(v => v.vtype === 'train' && v.state !== 'idle' && v.garageRef && ownedBy(v.garageRef, o)) },
  // matériaux de chantier : ports, aéroports et usines avancées en exigent dans un entrepôt proche
  { ic:'🔲', txt:'Produis du béton : carrière de calcaire, cimenterie + centrale à béton', reward:3000, check:o => countOwned(o, b => b.type === 'concrete_plant') >= 1 },
  { ic:'🪜', txt:'Lamine l’acier : laminoir (poutrelles) et tôlerie (plaques)', reward:3000, check:o => countOwned(o, b => b.type === 'rolling_mill') >= 1 && countOwned(o, b => b.type === 'sheet_mill') >= 1 },
  { ic:'🪟', txt:'Fabrique des vitres : verrerie (sable) + vitrerie', reward:3000, check:o => countOwned(o, b => b.type === 'glazier') >= 1 },
  { ic:'🛢️', txt:'Fore un puits de pétrole et construis une raffinerie', reward:6000, check:o => countOwned(o, b => b.type === 'oil_well') >= 1 && countOwned(o, b => b.type === 'refinery') >= 1 },
  { ic:'⚓', txt:'Ouvre un port ou un aéroport (matériaux de chantier dans un entrepôt proche)', reward:5000, check:o => countOwned(o, b => b.type === 'boat_depot' || isActiveAirTerminal(b)) >= 1 },
  { ic:'🛋️', txt:'Meuble les classes aisées : clouterie, usine chimique (colle) + ébénisterie', reward:6000, check:o => countOwned(o, b => b.type === 'furniture_factory') >= 1 },
  { ic:'🌆', txt:'Atteins 400 habitants', reward:20000, check:o => popTotal(o) >= 400 },
  { ic:'💾', txt:'Fabrique des cartes électroniques (fil de cuivre, plastique, or)', reward:12000, check:o => countOwned(o, b => b.type === 'electronics_plant') >= 1 },
  { ic:'🚀', txt:'Lance une fusée depuis un centre spatial', reward:50000, check:o => buildings.some(b => !b.dead && b.type === 'space_center' && ownedBy(b, o) && (b.launches || 0) >= 1) },
  { ic:'🔮', txt:'Produis un processeur quantique (xénite + hélium-3 de l’espace)', reward:80000, check:o => countOwned(o, b => b.type === 'quantum_lab') >= 1 },
];
// Déphasé d'une demi-seconde des fusions (mergeTimer) : les deux tâches périodiques
// ne tombent plus dans la même image.
let objectivesTimer = 0.5;
const MERGE_PASSES = [() => tryMerge(), () => tryMergeHangars(), () => tryExpandLuxury(),
  () => tryMergeInd(), () => tryMergeDepot(), () => tryMergeTrainStations()];
let mergeQueue = [];
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
    if(w.objIndex == null){
      // Première vérification (nouvelle partie ou ancienne sauvegarde) : les
      // objectifs déjà remplis sont validés sans prime.
      let i = 0;
      while(i < OBJECTIVES.length && OBJECTIVES[i].check(o)) i++;
      w.objIndex = i;
      continue;
    }
    const obj = OBJECTIVES[w.objIndex];
    if(!obj || !obj.check(o)) continue;
    if(settling){ w.objIndex++; continue; } // déjà rempli au chargement : validé sans prime
    earnMoney(obj.reward, 'primes', w);
    w.objIndex++;
  }
}

// ---------- centre spatial ----------
// Cycle d'une fusée : assemblage sur le pas de tir (toutes les pièces en stock +
// ouvriers) → décollage (pièces consommées) → mission (sans ouvriers, même en
// pause) → retour de la capsule, dont la cargaison extraterrestre entre en stock.
function updateSpaceCenter(b, dt, w){
  if(b.spacePhase === 'flight'){
    b.prog += dt;
    if(b.prog < SPACE_MISSION_TIME) return;
    b.prog = 0;
    b.spacePhase = null;
    const got = {};
    for(const k in SPACE_CARGO){
      const before = b.storage[k] || 0;
      b.storage[k] = Math.min(capOf(b, k), before + SPACE_CARGO[k]);
      if(b.storage[k] > before) got[k] = b.storage[k] - before;
    }
    if(typeof spaceCenterPhaseChanged === 'function') spaceCenterPhaseChanged(b, null);
    addFloat(b.x + (b.w - 1) / 2, b.y, '🪂 +' + resAmountsIcons(got), '#9fe6ff');
    if(ownedBy(b, myOwner())) toast('🪂 Capsule récupérée : +' + resAmountsText(got), 'win', eventTargetForBuilding(b));
    if(typeof publishNews === 'function')
      publishNews('capsule:' + b.x + ',' + b.y, '🪂', 'Retour triomphal : la capsule de ' + (b.name || 'la mission') + ' s’est posée !',
        'Les ingénieurs ouvrent la soute : ' + resAmountsText(got).toLowerCase() + ', des matériaux inconnus sur Terre.', eventTargetForBuilding(b));
    return;
  }
  if(b.paused) return;
  for(const k in SPACE_ROCKET_PARTS) if((b.storage[k] || 0) < SPACE_ROCKET_PARTS[k]) return; // pièces manquantes
  if(Object.keys(SPACE_CARGO).every(k => (b.storage[k] || 0) >= capOf(b, k))) return;   // soute pleine : rien à rapporter
  b.prog += dt * (workersRequiredOf(b) ? workersAllocatedOf(b) / workersRequiredOf(b) : w.eff);
  if(b.prog < SPACE_ASSEMBLY_TIME) return;
  b.prog = 0;
  for(const k in SPACE_ROCKET_PARTS) b.storage[k] -= SPACE_ROCKET_PARTS[k];
  b.spacePhase = 'flight';
  b.launches = (b.launches || 0) + 1;
  if(typeof spaceCenterPhaseChanged === 'function') spaceCenterPhaseChanged(b, 'flight');
  addFloat(b.x + (b.w - 1) / 2, b.y, '🚀 Décollage !', '#ffd27a');
  if(ownedBy(b, myOwner())) toast('🚀 ' + (b.name || 'Centre spatial') + ' : lancement n°' + b.launches + ' réussi ! Retour dans ' + SPACE_MISSION_TIME + ' s.', 'win', eventTargetForBuilding(b));
  if(typeof publishNews === 'function')
    publishNews('fusee:' + b.x + ',' + b.y, '🚀', 'Décollage historique depuis ' + (b.name || 'le centre spatial') + ' !',
      'Dans un grondement assourdissant, la première fusée perce les nuages. Sa capsule doit rapporter des ressources venues de l’espace.', eventTargetForBuilding(b));
}

// Expédition d'un bâtiment (camions automatiques) — cf. boucle répartie dans update().
let dispatchCursor = 0, dispatchBudget = 0;
function dispatchBuilding(b){
  if(!b || b.dead) return;
  const maxTrucks = isStorageHub(b)
    ? 4 + b.w * b.h          // entrepôt : plus de camions pour servir plusieurs destinations
    : 2 + ((b.w*b.h)>>1);    // production : limite standard
  if(b.trucksOut >= maxTrucks) return;
  const r = recipeOf(b);

  if(isStorageHub(b)){
    // entrepôt : dispatcher toutes les ressources avec demande, seuil = 1 unité
    for(const k in b.storage){
      if(b.trucksOut >= maxTrucks) break;
      if((b.storage[k]||0) < 1) continue;
      if(b.allow?.[k] === false) continue;
      tryDispatch(b, k);
    }
  } else if(BUILD[b.type]?.resid || b.type === 'terrassement'){
    // logements et puits purs : ne ré-expédient jamais leur stock
  } else {
    // bâtiment de production : tenter un dispatch pour chaque ressource éligible
    // (indépendamment — une sortie bloquée ne bloque pas les autres)
    for(const k in b.storage){
      if(b.trucksOut >= maxTrucks) break;
      if(b.storage[k] < 10) continue;
      const inRecipeOut = r && k in r.out;
      const isByproduct  = !r || !(k in r.in);
      if(inRecipeOut || isByproduct) tryDispatch(b, k, 10);
    }
  }
}

function update(dt){
  gtime += dt;
  roadTick++; // nouveau pas : la liste des véhicules routiers est reconstruite à la demande
  objectivesTimer += dt;
  if(objectivesTimer >= 1){ objectivesTimer = 0; updateObjectives(); if(typeof updateNews === 'function') updateNews(); }
  let starved = null;

  ensureAllStarterProtections();
  refreshWorkerAllocationIfNeeded();
  syncIncomingReservations();
  syncResidentReservations();
  // eff du joueur courant (pour statusOf)
  eff = myWallet().eff;

  for(const b of buildings){
    const w = walletOf(b.owner); // wallet du propriétaire du bâtiment
    // Stock « livré par train » jamais supérieur au stock réel (les camions ont pu
    // en sortir) : sinon une nouvelle production serait prise pour du déjà-payé.
    if(b.trainReceived){
      for(const k in b.trainReceived){
        const s = b.storage[k] || 0;
        if(b.trainReceived[k] > s) b.trainReceived[k] = s;
      }
    }
    const r = recipeOf(b);
    if(b.type === 'space_center') updateSpaceCenter(b, dt, w);
    else if(r && !b.paused){
      let outOK = true, inOK = true;
      const activeOuts = Object.keys(r.out).filter(k => !b.blockedOut?.[k]);
      // si tous les outputs sont bloqués, stopper la production pour ne pas consommer les inputs
      if(Object.keys(r.out).length > 0 && activeOuts.length === 0) outOK = false;
      // La production ne s'arrête que si TOUTES les sorties sont pleines : un
      // sous-produit sans débouché (huile de la poissonnerie…) ne doit pas bloquer
      // le produit principal. L'excédent d'une sortie pleine est simplement perdu.
      else if(activeOuts.length && activeOuts.every(k => (b.storage[k]||0) >= capOf(b,k))) outOK = false;
      for(const k in r.in)             if((b.storage[k]||0) <  r.in[k]) inOK = false;
      if(outOK && inOK){
        b.prog += dt * (workersRequiredOf(b) ? workersAllocatedOf(b) / workersRequiredOf(b) : w.eff);
        if(b.prog >= r.time){
          b.prog = 0;
          for(const k in r.in)  b.storage[k] -= r.in[k];
          const outBonus = b.type === 'fisher' ? fisherFishBonus(b) : 0;
          for(const k of activeOuts) b.storage[k] = Math.min(capOf(b,k), (b.storage[k]||0) + r.out[k] + outBonus);
          // 2% de chance d'extraire de la terre en plus lors d'un cycle de mine
          if(b.type === 'mine' && Math.random() < 0.02 && !b.blockedOut?.['dirt']){
            b.storage['dirt'] = (b.storage['dirt']||0) + 1;
          }
        }
      }
    }
    const rc = BUILD[b.type].resid;
    if(rc && !b.starterHome && residHasAll(b, residRequiredOf(b))){
      b.starve = 0;
      b.ct += dt;
      if(b.ct >= rc.interval){
        b.ct = 0;
        const pop = Math.max(1, b.pop);
        // Revenu = somme des prix de vente des ressources consommées ce cycle × habitants.
        const consumed = [...residRequiredOf(b)];
        residConsumeAll(b, residRequiredOf(b));
        const bonusResources = residBonusOf(b).filter(r => (b.storage[r]||0) > 0);
        for(const r of bonusResources){ b.storage[r]--; consumed.push(r); }
        // les classes aisées (maisons de luxe) dépensent davantage par habitant
        const classMult = residClassDef(b).revenu;
        let income = 0;
        for(const r of consumed){
          const part = Math.round((RESID_PRICES[r]||0) * pop * classMult);
          if(part){ income += part; recordVente(w, 'res', r, part); }
        }
        earnMoney(income, 'ventes', w);
        addFloat(b.x + (b.w-1)/2, b.y, '+'+income+' $', '#ffe9a0');
        if(b.pop + b.pending < rc.popCap) spawnWalker(b);
      }
    } else if(rc && b.starterHome){
      b.starve = 0; // maison protégée : pas de pénurie
      b.ct += dt;
      if(b.ct >= rc.interval){
        b.ct = 0;
        // Maison de départ : ne consomme rien, mais « vend » ses ressources requises.
        const pop = Math.max(1, b.pop);
        let income = 0;
        for(const r of residRequiredOf(b)){
          const part = Math.round((RESID_PRICES[r]||0) * pop);
          if(part){ income += part; recordVente(w, 'res', r, part); }
        }
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
      const req = residRequiredOf(b);
      const stockFull = req.length
        ? Math.min(...req.map(r => (b.storage[r]||0) / rc.stockCap))
        : 1;
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
    // une maison de luxe garde son domaine : ses habitants partent un à un
    if(b.w*b.h > 1 && !BUILD[b.type].lux) splitBuilding(b);
    else leaveOne(b);
  }

  // Fusions : une passe par pas de simulation plutôt que les six dans la même image
  // (≈20 ms cumulés sur une grande ville = à-coup visible chaque seconde).
  mergeTimer += dt;
  if(mergeTimer >= 1){ mergeTimer = 0; mergeQueue = MERGE_PASSES.slice(); }
  if(mergeQueue.length) mergeQueue.shift()();

  // Expédition automatique : TOUS les bâtiments étaient traités d'un coup toutes les
  // 0,7 s (une recherche de route par ressource) → une image longue à chaque cycle,
  // perçue comme un bond des trains. Le travail est désormais réparti : chaque pas
  // traite la part de bâtiments correspondant à son temps (un cycle complet reste
  // de 0,7 s de jeu, mais sans pic).
  dispatchTimer += dt;
  dispatchBudget += buildings.length * dt / 0.7;
  let dispatchN = Math.min(buildings.length, Math.floor(dispatchBudget));
  dispatchBudget -= dispatchN;
  while(dispatchN-- > 0 && buildings.length){
    if(dispatchCursor >= buildings.length) dispatchCursor = 0;
    dispatchBuilding(buildings[dispatchCursor++]);
  }

  updateTrucks(dt);
  updateVehicles(dt);
  updateWalkers(dt);
  tickSortantsToHomes(dt);

  // Rapatrier sur la gare les compteurs éventuellement accumulés sur un arrêt
  // de bus fusionné (notamment dans les sauvegardes créées avant cette règle).
  for(const b of buildings){
    if(b.dead || b.type !== 'bus_stop') continue;
    // (avant : recherche de gare liée sur TOUS les bâtiments, pour chaque arrêt, à chaque pas)
    if(!((b.passengersEntrant || 0) > 0 || (b.passagersSortant || 0) > 0 || (b.passengers || 0) > 0)) continue;
    const station = transitHubLinkedRepresentative(b);
    if(!station) continue;
    if((b.passengers || 0) > 0){
      // habitants déjà en attente à l'arrêt → cumulés aux passagers entrants de la gare
      station.passengersEntrantPending = (station.passengersEntrantPending || 0) + b.passengers;
      b.passengers = 0;
    }
    if((b.passengersEntrant || 0) > 0){
      station.passengersEntrantPending = (station.passengersEntrantPending || 0) + b.passengersEntrant;
      b.passengersEntrant = 0;
    }
    if((b.passagersSortant || 0) > 0){
      station.passagersSortant = (station.passagersSortant || 0) + b.passagersSortant;
      b.passagersSortant = 0;
    }
  }

  // Les arrivées bus -> gare sont appliquées après les mouvements du tick,
  // pour éviter qu'un train à quai les embarque immédiatement.
  for(const b of buildings){
    if(b.dead || (!isTerminalHub(b))) continue;
    if((b.passengersEntrantPending || 0) > 0){
      b.passengersEntrant = (b.passengersEntrant || 0) + b.passengersEntrantPending;
      b.passengersEntrantPending = 0;
    }
  }

  taxTimer += dt;
  if(taxTimer >= ECO.taxeInterval){
    taxTimer = 0;
    // taxes par wallet : taux plein si l'habitant travaille, /3 sinon
    for(const k in WALLETS){
      const oid = walletOwnerOf(k);
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
      // multiplicateur moyen de taxe des classes d'habitants (1 si que des ouvriers)
      const t = (ECO.taxe * working + (ECO.taxe / 3) * idle) * popTaxMultiplier(oid, total);
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
      addFloat(b.x+(b.w-1)/2, b.y, '−'+(Math.round(u*10)/10)+' $', '#ff3030');
    }
  }

  for(const v of vehicles){
    const baseCost = VEHICLE_TYPES[v.vtype]?.maintenanceCost ?? 0;
    if(baseCost <= 0) continue;
    // Migration : véhicules achetés avant l'ajout du système d'entretien
    if(v.boughtAtGtime == null){ v.boughtAtGtime = gtime; v.maintenanceDaysPaid = 0; }
    const days = v.maintenanceDaysPaid || 0;
    const nextDue = v.boughtAtGtime + VEHICLE_MAINTENANCE_DAY * (days + 1);
    if(gtime < nextDue) continue;
    const completedMonths = Math.floor(days / 30);
    const cost = Math.round(baseCost * (v.engineMult || 1) * Math.pow(1 + VEHICLE_MAINTENANCE_RATE, completedMonths));
    v.maintenanceDaysPaid = days + 1;
    const garage = v.garageRef;
    if(!garage || garage.dead) continue;
    const w = walletOf(garage.owner);
    w.money -= cost; w.fin.entretienVehicules += cost;
    vehicleLedger(v, -cost);
    let fx, fy;
    if(v.pts?.length > 0 && v.state !== 'idle'){
      const seg = Math.min(v.seg || 0, v.pts.length - 1);
      const a = v.pts[seg], b = v.pts[Math.min(seg + 1, v.pts.length - 1)];
      const t = v.t || 0;
      fx = (a.x + (b.x - a.x) * t) / TILE - 0.5;
      fy = (a.y + (b.y - a.y) * t) / TILE - 0.5;
    } else {
      fx = garage.x + (garage.w - 1) / 2;
      fy = garage.y;
    }
    addFloat(fx, fy, '−'+cost+' $ '+VEHICLE_TYPES[v.vtype].icone, '#ff3030');
    // Régler le péage d'utilisation des rails accumulé depuis le dernier entretien.
    settleRailToll(v, garage.owner, fx, fy);
  }

  // historique financier par wallet
  const curDate = new Date(GAME_EPOCH_MS + (gtime||0) * GAME_HOURS_PER_SEC * 3600000);
  const curYM = curDate.getUTCFullYear()+'-'+String(curDate.getUTCMonth()+1).padStart(2,'0');
  for(const k in WALLETS){
    const w = WALLETS[k];
    // Instantané du cumul au début de chaque mois de jeu (colonnes du panneau finances).
    if(w.finMonth !== curYM){
      w.finMonth = curYM;
      const vd = w.ventesDetail || { res:{}, veh:{} };
      const pd = w.peageDetail  || { recv:{}, paid:{} };
      (w.finMonthSnaps ||= []).push({
        ym:    curYM,
        fin:   { ...w.fin },
        vres:  { ...(vd.res||{}) },  vveh:  { ...(vd.veh||{}) },
        precv: { ...(pd.recv||{}) }, ppaid: { ...(pd.paid||{}) },
      });
      while(w.finMonthSnaps.length > 4) w.finMonthSnaps.shift(); // 3 mois affichés + sécurité
    }
  }

  // milestones par wallet
  for(const k in WALLETS){
    const oid = walletOwnerOf(k);
    const w = WALLETS[k];
    if(w.mi == null) w.mi = 0;
    // n'afficher le toast que si c'est le joueur courant
    if(w.mi < MILESTONES.length && popTotal(oid) >= MILESTONES[w.mi]){
      if(oid === myOwner())
        toast('🎉 '+MILESTONES[w.mi]+' habitants ! Ta ville prospère.','win');
      w.mi++;
    }
    // déblocage définitif des maisons de luxe (l'annonce est faite par l'UI)
    if(!w.luxeUnlocked && popTotal(oid) >= LUX_UNLOCK_POP) w.luxeUnlocked = true;
  }

  for(let i=floats.length-1;i>=0;i--){
    floats[i].life -= dt;
    if(floats[i].life <= 0) floats.splice(i,1);
  }

  // (fumée : animée par la boucle de rendu, cf. stepSmoke dans 07_rendering.js)

  // Arrêts de bus / gares : mise à jour des max toutes les 3s
  // Somme par ville = habitants sans travail, répartis sur les arrêts/gares proches des habitations.
  busStopTimer += dt;
  const updateBusMax = busStopTimer >= 3;
  if(updateBusMax) busStopTimer = 0;
  if(updateBusMax){ refreshTransitPassengerCaps(); enforceTransitCoherence(); }
  // Passagers arrivés qui n'ont trouvé aucun bus :
  // Arrêt de bus, gare, port, aéroport : les voyageurs arrivés qui ne sont pas partis
  // redeviennent passagers entrants après 3 jours (pas de retour à la maison pour le moment).
  {
    const dtc = Math.min(dt, 0.5) * GAME_HOURS_PER_SEC;
    for(const b of buildings){
      if(b.dead || (!isTransitHub(b))) continue;
      if(!(b.passagersSortant >= 1)){ b._sortantAge = 0; continue; }
      // transfert par passagers entiers : les deux compteurs changent ensemble
      b._sortantAge = (b._sortantAge || 0) + b.passagersSortant * Math.min(1, dtc / 72);
      const moved = Math.min(Math.floor(b._sortantAge), Math.floor(b.passagersSortant));
      if(moved >= 1){
        b._sortantAge -= moved;
        b.passagersSortant -= moved;
        const key = b.type === 'bus_stop' ? 'passengers' : 'passengersEntrant'; // « entrants » d'un arrêt de bus
        b[key] = (b[key] || 0) + moved;
      }
    }
  }
  // Remplissage continu sur 3 jours (72 heures de jeu)
  const BUS_FILL_RATE_SECS = 3 * 24 / GAME_HOURS_PER_SEC; // gtime-secondes pour remplir à 100%
  // Quota par cycle de 3 jours : le total généré ne dépasse pas passengersMax sur la période
  passengerCycleTimer += dt;
  const resetPassengerCycle = passengerCycleTimer >= BUS_FILL_RATE_SECS;
  if(resetPassengerCycle) passengerCycleTimer = 0;
  for(const b of buildings){
    if(b.dead || b.type !== 'bus_stop') continue;
    // (plafond par joueur : enforceTransitCoherence, pas par arrêt)
    const max = b.passengersMax || 0;
    if(resetPassengerCycle || b.passengersQuota == null) b.passengersQuota = max;
    if(max > 0 && (b.passengersQuota || 0) > 0 && (b.passengers || 0) < max){
      const rate = max / BUS_FILL_RATE_SECS;
      const fillAmount = Math.min(b.passengersQuota, rate * Math.min(dt, 0.5), max - (b.passengers || 0));
      b.passengers = (b.passengers || 0) + fillAmount;
      b.passengersQuota -= fillAmount;
    }
    // ancien compteur « travailleurs » des sauvegardes d'avant : simples voyageurs arrivés
    if((b.passengersEntrant || 0) > 0){
      b.passagersSortant = (b.passagersSortant || 0) + b.passengersEntrant;
      b.passengersEntrant = 0;
    }
  }

  // Gares : génération de passagers entrants depuis les habitants sans travail de la ville (continu, 3 jours)
  for(const b of buildings){
    if(b.dead || (!isTerminalHub(b))) continue;
    if(b.passengersEntrant == null){ b.passengersEntrant = 0; b.passengersEntrantMax = 0; b.passagersSortant = 0; }
    const maxE = b.passengersEntrantMax || 0;
    // (le plafond « habitants sans travail » est appliqué par joueur, pas par gare :
    // enforceTransitCoherence ; le maximum d'une pièce de gare ne reflète pas
    // les passagers amenés par les bus ou les trains)
    if(resetPassengerCycle || b.passengersEntrantQuota == null) b.passengersEntrantQuota = maxE;
    if(maxE > 0 && (b.passengersEntrantQuota || 0) > 0 && (b.passengersEntrant || 0) < maxE){
      const rate = maxE / BUS_FILL_RATE_SECS;
      const fillAmount = Math.min(b.passengersEntrantQuota, rate * Math.min(dt, 0.5), maxE - (b.passengersEntrant || 0));
      b.passengersEntrant = (b.passengersEntrant || 0) + fillAmount;
      b.passengersEntrantQuota -= fillAmount;
    }
  }
}

// un rectangle w×h entièrement couvert de logements pleins strictement plus
// petits → fusion en bâtiment de niveau supérieur
function checkRect(x,y,w,h,targetLevel=null){
  const area = w*h, set = [];
  const owner = bgrid[y*N+x]?.owner ?? null;
  for(let yy=y; yy<y+h; yy++) for(let xx=x; xx<x+w; xx++){
    const b = bgrid[yy*N+xx];
    if(!b) return null;
    const rc = BUILD[b.type].resid;
    if(!rc) return null;                                        // pas un logement
    if(BUILD[b.type].lux) return null;                          // le luxe s'agrandit seul (tryExpandLuxury)
    if((b.owner ?? null) !== owner) return null;                // jamais entre deux joueurs
    if(b.w*b.h >= area) return null;                            // pas plus petit
    if(b.x<x || b.y<y || b.x+b.w>x+w || b.y+b.h>y+h) return null; // déborde du rectangle
    if(b.pop < rc.popCap) return null;                          // pas plein
    if(!residUpgradeSatisfied(b)) return null;                  // compteur d'upgrade incomplet
    if(!set.includes(b)) set.push(b);
  }
  return set;
}

// rectangle couvert de bâtiments de production IDENTIQUES plus petits → fusion
function checkRectInd(x,y,w,h){
  const area = w*h;
  const first = bgrid[y*N+x];
  if(!first || !BUILD[first.type].ind || BUILD[first.type].noMerge) return null;
  const type = first.type, ore = first.ore;
  const set = [];
  for(let yy=y; yy<y+h; yy++) for(let xx=x; xx<x+w; xx++){
    const b = bgrid[yy*N+xx];
    if(!b || b.type!==type || b.paused) return null;
    if((b.owner ?? null) !== (first.owner ?? null)) return null; // jamais entre deux joueurs
    if(b.w*b.h >= area) return null;
    if(b.x<x || b.y<y || b.x+b.w>x+w || b.y+b.h>y+h) return null;
    if(type==='mine' && b.ore!==ore) return null;
    if(!set.includes(b)) set.push(b);
  }
  return set;
}

function tryMergeInd(){
  const anchors = mergeAnchors(b => !!BUILD[b.type]?.ind && !BUILD[b.type].noMerge && !b.paused);
  if(anchors.length < 2) return false;
  for(const [w,h] of IND_SHAPES_ALL){
    for(const [x, y] of anchors){
      if(x > N-w || y > N-h) continue;
      const set = checkRectInd(x,y,w,h);
      if(!set) continue;
      const type = set[0].type, ore = set[0].ore, owner = set[0].owner||null;
      if(!indShapeAllowed(type, w, h)) continue;
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
        +' — production ×'+prodMult(t).toFixed(1)+' !','win', eventTargetForBuilding(t));
      return true;
    }
  }
  return false;
}

function tryMerge(){
  // Seuls les logements pleins peuvent fusionner : origines candidates = ceux-là.
  const anchors = mergeAnchors(b => !!BUILD[b.type]?.resid && !BUILD[b.type].lux && b.pop >= BUILD[b.type].resid.popCap);
  if(anchors.length < 2) return;
  for(const L of MERGE_ORDER){
    for(const [w,h] of L.shapes){
      for(const [x, y] of anchors){
        if(x > N-w || y > N-h) continue;
        const set = checkRect(x,y,w,h,L);
        if(!set) continue;
        const d = BUILD[L.key];
        const stock = {};
        let pop = 0, protectedPop = 0, wasSel = false;
        const owner = set[0].owner||null;
        for(const o of set){
          for(const k in o.storage) stock[k] = (stock[k]||0) + o.storage[k];
          evictGuests(o);
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
        if(set.every(o => o.airbnbOnly)) t.airbnbOnly = true;
        // Conserver le nombre total de slots de départ absorbés
        t.starterSlots = set.reduce((s, o) => s + (o.starterSlots || (o.starterHome ? 1 : 0)), 0);
        for(const k in stock) if(RES[k]) t.storage[k] = Math.min(d.resid.stockCap, stock[k]);
        buildings.push(t);
        setGrid(t,t);
        if(wasSel) selected = t;
        toast('🏗️ '+set.length+' logements pleins → '+d.n+' ('+w+'×'+h+') !','win', eventTargetForBuilding(t));
        // grands paliers d'urbanisme à la une de la Gazette (une fois par partie)
        const NEWS_LEVELS = { tower:['🏢','Le premier immeuble sort de terre','Les grues ont disparu : la ville prend de la hauteur.'],
          tower3:['🏙️','Une tour domine désormais l’horizon','Les citadins se pressent aux fenêtres du dernier étage.'],
          sky:['🌆','Le premier gratte-ciel touche les nuages !','Une prouesse d’ingénierie : la région entre dans la cour des grandes métropoles.'] };
        const nl = NEWS_LEVELS[L.key];
        if(nl && typeof publishNews === 'function'){
          const town = typeof newsTownName === 'function' ? newsTownName(t) : '';
          publishNews('niveau:' + L.key, nl[0], nl[1] + (town ? ' à ' + town : '') + ' !', nl[2], eventTargetForBuilding(t));
        }
        return; // une fusion à la fois : la liste vient d'être modifiée
      }
    }
  }
}

// ---------- maisons de luxe : agrandissement par absorption ----------
// Même déclencheur qu'une fusion (logement plein + outils livrés), mais la maison
// ne s'étend JAMAIS sur des cases vides : elle absorbe uniquement des maisons de
// luxe voisines du même propriétaire que le joueur a posées à côté. Le bâtiment
// est modifié en place (mêmes habitants, stocks et références des camions),
// seuls son type, son emprise et la classe de ses habitants changent.

// Emprise du niveau suivant : rectangle contenant l'emprise actuelle dont toutes
// les cases ajoutées sont occupées par des maisons de luxe voisines (du même
// propriétaire) entièrement incluses dans le rectangle. On préfère celui qui
// longe le plus de route, puis le moins décalé par rapport à la maison d'origine.
// null : niveau maximal, ou pas assez de maisons de luxe voisines.
function luxExpansionRect(b){
  const next = luxNextLevelOf(b);
  if(!next) return null;
  let best = null, bestScore = -Infinity;
  for(const [W, H] of next.shapes){
    if(W < b.w || H < b.h || W*H <= b.w*b.h) continue;
    for(let y = b.y + b.h - H; y <= b.y; y++) for(let x = b.x + b.w - W; x <= b.x; x++){
      if(x < 0 || y < 0 || x+W > N || y+H > N) continue;
      const absorb = new Set();
      let ok = true;
      for(let yy = y; yy < y+H && ok; yy++) for(let xx = x; xx < x+W; xx++){
        if(xx >= b.x && xx < b.x+b.w && yy >= b.y && yy < b.y+b.h) continue;
        const o = bgrid[yy*N+xx];
        if(!o || o === b || o.dead || !BUILD[o.type]?.lux || (o.owner ?? null) !== (b.owner ?? null)
           || o.x < x || o.y < y || o.x+o.w > x+W || o.y+o.h > y+H){ ok = false; break; }
        absorb.add(o);
      }
      if(!ok) continue;
      const score = adjRoadTiles({ x, y, w:W, h:H }).length * 100 - (b.x - x) - (b.y - y);
      if(score > bestScore){ bestScore = score; best = { x, y, w:W, h:H, type:next.key, absorb:[...absorb] }; }
    }
  }
  return best;
}

// Prête à s'agrandir dès qu'il y a la place : pleine, compteur d'upgrade atteint.
function luxReadyToExpand(b){
  if(!BUILD[b.type]?.lux || b.starterHome || !luxNextLevelOf(b)) return false;
  return b.pop >= BUILD[b.type].resid.popCap && residUpgradeSatisfied(b);
}

function expandLuxuryHouse(b, rect){
  const before = residClassDef(b);
  b.design = Math.floor(Math.random() * ART_VARIANTS); // nouveau design à chaque agrandissement
  const popCapNext = BUILD[rect.type].resid.popCap;
  for(const o of rect.absorb || []){
    for(const k in o.storage) b.storage[k] = (b.storage[k]||0) + o.storage[k];
    evictGuests(o);
    b.pop = Math.min(popCapNext, (b.pop||0) + (o.pop||0));
    if(o === selected) selected = b;
    o.dead = true;
    setGrid(o, null);
  }
  if(rect.absorb?.length) buildings = buildings.filter(o => !o.dead);
  setGrid(b, null);
  b.type = rect.type; b.x = rect.x; b.y = rect.y; b.w = rect.w; b.h = rect.h;
  setGrid(b, b);
  // nouveau palier : compteur d'upgrade repris à zéro (les outils en route
  // compteront pour le suivant), stocks bornés par la nouvelle capacité
  b.upgradeProgress = {};
  b.upgradePaused = {};
  for(const k in b.storage){
    const cap = capOf(b, k);
    if(cap > 0) b.storage[k] = Math.min(cap, b.storage[k]);
    else delete b.storage[k];
  }
  normalizeResidentialUpgradeState(b);
  b._accV = null; // cache d'accès routier des sprites (js/pixi/sprites.js)
  const d = BUILD[b.type], cls = residClassDef(b);
  toast('💎 '+d.n+' ('+b.w+'×'+b.h+') : les '+before.pluriel.toLowerCase()+' deviennent '
    + cls.pluriel.toLowerCase()+' '+cls.icone+' !', 'win', eventTargetForBuilding(b));
  if(!luxNextLevelOf(b) && typeof publishNews === 'function'){
    const town = typeof newsTownName === 'function' ? newsTownName(b) : '';
    publishNews('niveau:' + b.type, '⛲', 'Un premier domaine de prestige ouvre ses grilles' + (town ? ' à ' + town : '') + ' !',
      'Piscine, court de tennis et jardins à la française : les patrons de la région ont trouvé leur adresse.', eventTargetForBuilding(b));
  }
}

function tryExpandLuxury(){
  for(const b of buildings){
    if(b.dead || !luxReadyToExpand(b)) continue;
    const rect = luxExpansionRect(b);
    if(rect) expandLuxuryHouse(b, rect);
  }
}

// Multiplicateur moyen de la taxe par habitant selon les classes (cf.
// CFG.classesHabitants) : 1 tant que la ville ne compte que des ouvriers.
function popTaxMultiplier(oid, total = popTotal(oid)){
  if(!(total > 0)) return 1;
  let weighted = 0;
  for(const b of buildings){
    if(b.dead || !b.pop || !ownedBy(b, oid)) continue;
    weighted += b.pop * residClassDef(b).taxe;
  }
  return weighted / total;
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
  const costOf = i => road[i] ? 1 : (terrain[i]===T.TREE ? 6 : ((terrain[i]===T.WHEAT || terrain[i]===T.COTTON) ? 4 : 3));

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
    // Tuile sur le bord de la zone jouable (a au moins un voisin hors masque)
    if(x<=0||y<=0||x>=N-1||y>=N-1||mapMask[i-1]===0||mapMask[i+1]===0||mapMask[i-N]===0||mapMask[i+N]===0){ goal=i; break; }
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
  if(b.airbnbOnly) return; // maison réservée aux locataires Airbnb : pas de nouvel habitant du propriétaire
  if(walkers.length > 80){ growPop(b); return; }
  const pts = pathToEdge(b);
  if(!pts){ growPop(b); return; } // logement enclavé : arrivée instantanée
  b.pending++;
  walkers.push({ id: nextWalkerId++, pts, seg:0, t:0, target:b,
                 col: playerColor(b.owner),
                 phase: Math.random()*7 });
}

// n habitants quittent le bâtiment à pied (la population est déjà décomptée)
function spawnLeavers(b, n){
  for(let i=0; i<n && walkers.length<=80; i++){
    const pts = pathToEdge(b);
    if(!pts) return;
    walkers.push({ id: nextWalkerId++, pts:[...pts].reverse(), seg:0, t:0, target:null, leaving:true,
                   col: playerColor(b.owner),
                   phase: Math.random()*7 });
  }
}

function residentialSplitPlan(b){
  const totalArea = b.w * b.h;
  const candidates = [];
  for(let rank=0; rank<LEVELS.length; rank++){
    const L = LEVELS[rank];
    if(L.key === b.type) continue;
    for(const [w,h] of L.shapes){
      const area = w * h;
      if(area <= 0 || area >= totalArea || w > b.w || h > b.h) continue;
      candidates.push({ type:L.key, w, h, area, rank });
    }
  }
  candidates.sort((a,b)=> (b.area-a.area) || (b.rank-a.rank));

  const filled = new Array(b.w * b.h).fill(false);
  const fits = (x,y,w,h)=>{
    if(x+w > b.w || y+h > b.h) return false;
    for(let yy=y; yy<y+h; yy++) for(let xx=x; xx<x+w; xx++)
      if(filled[yy*b.w+xx]) return false;
    return true;
  };
  const mark = (x,y,w,h,val)=>{
    for(let yy=y; yy<y+h; yy++) for(let xx=x; xx<x+w; xx++) filled[yy*b.w+xx] = val;
  };
  const scoreOf = plan => plan.reduce((s,p)=>s + p.area*p.area*100 + p.rank*10, 0) - plan.length;

  const search = plan => {
    let first = -1;
    for(let i=0; i<filled.length; i++) if(!filled[i]){ first = i; break; }
    if(first < 0) return { plan:plan.slice(), score:scoreOf(plan) };
    const x = first % b.w, y = (first / b.w) | 0;
    let best = null;
    for(const c of candidates){
      if(!fits(x,y,c.w,c.h)) continue;
      mark(x,y,c.w,c.h,true);
      plan.push({ type:c.type, x:b.x+x, y:b.y+y, w:c.w, h:c.h, area:c.area });
      const out = search(plan);
      if(out && (!best || out.score > best.score)) best = out;
      plan.pop();
      mark(x,y,c.w,c.h,false);
    }
    return best;
  };

  const best = search([]);
  if(best) return best.plan;
  const fallback = [];
  for(let y=b.y; y<b.y+b.h; y++) for(let x=b.x; x<b.x+b.w; x++)
    fallback.push({ type:'house', x, y, w:1, h:1, area:1 });
  return fallback;
}

// pénurie : un bâtiment fusionné se sépare en meilleure combinaison inférieure,
// l'excédent d'habitants quitte la ville
function splitBuilding(b){
  if((b.pop||0) <= (b.protectedPop||0)) return;
  evictGuests(b);
  const splitPlan = residentialSplitPlan(b);
  const lowerPopCap = splitPlan.reduce((s,p)=>s + BUILD[p.type].resid.popCap, 0);
  const wasSel = selected===b;
  const owner = b.owner ?? null;
  let pop = b.pop;
  let protectedPop = b.protectedPop||0;
  const pools = {};
  for(const k in b.storage) if(RES[k]) pools[k] = b.storage[k]||0;
  const excess = Math.max(0, pop - lowerPopCap);
  b.dead = true;
  buildings.splice(buildings.indexOf(b),1);
  setGrid(b,null);
  pop -= excess;
  const newHomes = [];
  for(const piece of splitPlan){
    const h = newBuilding(piece.type, piece.x, piece.y, piece.w, piece.h);
    const rc = BUILD[piece.type].resid;
    h.owner = owner;
    h.pop = Math.min(rc.popCap, pop);
    pop -= h.pop;
    h.protectedPop = Math.min(h.pop, protectedPop);
    h.starterHome = h.protectedPop > 0;
    protectedPop -= h.protectedPop;
    h.starve = 0;
    if(b.airbnbOnly) h.airbnbOnly = true;
    buildings.push(h);
    setGrid(h,h);
    newHomes.push(h);
    if(wasSel && piece.x===b.x && piece.y===b.y) selected = h;
  }

  // distribuer les stocks résidentiels entre les bâtiments issus de la défusion
  for(const k in pools){
    const homes = newHomes.filter(h => capOf(h,k) > 0);
    if(!homes.length) continue;
    for(const h of homes){
      if(pools[k] <= 0) break;
      const share = Math.min(capOf(h,k), Math.floor(pools[k] / homes.length));
      if(share <= 0) continue;
      h.storage[k] = (h.storage[k]||0) + share;
      pools[k] -= share;
    }
    for(const h of homes){
      if(pools[k] <= 0) break;
      const give = Math.min(capOf(h,k) - (h.storage[k]||0), pools[k]);
      if(give <= 0) continue;
      h.storage[k] = (h.storage[k]||0) + give;
      pools[k] -= give;
    }
  }
  if(excess > 0) spawnLeavers(bgrid[b.y*N+b.x], excess);
  toast('📉 '+BUILD[b.type].n+' sans '+resNames(residRequiredOf(b))+' : défusion'
    + (excess>0 ? ', '+excess+" habitants s'en vont" : ''),'err',
    eventTargetForBuilding(newHomes[0]) || eventTargetForTile(b.x, b.y, BUILD[b.type].n));
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

// Voyageurs arrivés (sortants) d'un arrêt / gare / port / aéroport : s'il y a une maison
// non pleine à portée, ils la rejoignent à pied (1 par seconde et par point de transit).
// Maison du même joueur : ils y sont déjà comptés comme habitants, ils quittent le compteur.
// Maison d'un autre joueur : ils s'y installent (nouvel habitant à leur arrivée).
let sortantsHomeTimer = 0;
function tickSortantsToHomes(dt){
  sortantsHomeTimer += dt;
  if(sortantsHomeTimer < 1) return;
  const elapsed = sortantsHomeTimer;
  sortantsHomeTimer = 0;
  tickGuestsExpire(elapsed);
  tickLeisureVisits();
  for(const hub of buildings){
    if(hub.dead || !(hub.passagersSortant >= 1)) continue;
    if(!isTransitHub(hub)) continue;
    if(hub.type === 'train_station' && trainStationGroupRepresentative(hub.stationGroupId) !== hub) continue;
    const radius = hub.type === 'train_station' ? TRAIN_STATION_RADIUS
      : hub.type === 'boat_depot' ? PORT_RADIUS : hub.type === 'air_terminal' ? AIRPORT_RADIUS : BUS_STOP_RADIUS;
    // priorité aux lieux de loisirs à portée (avant un logement / un Airbnb)
    sendSortantsToLeisure(hub, radius, elapsed);
    if(!(hub.passagersSortant >= 1)) continue;
    let best = null, bd = Infinity;
    for(const h of buildings){
      if(h.dead || !BUILD[h.type]?.resid) continue;
      if((h.pop || 0) + (h.pending || 0) >= BUILD[h.type].resid.popCap) continue;
      if(h.airbnbOnly && !(hub.owner != null && h.owner != null && h.owner !== hub.owner)) continue; // réservé aux autres joueurs
      const d = buildingDistance(h, hub);
      if(d <= radius && d < bd){ bd = d; best = h; }
    }
    if(!best) continue;
    hub.passagersSortant -= 1;
    if(hub.owner != null && best.owner != null && best.owner !== hub.owner) moveInFromHub(hub, best);
    else spawnTransitWalkers(hub, best, 1);
  }
}
// ---------- lieux de loisirs ----------
// Visiteurs d'un lieu : lots { t: heure d'arrivée (gtime), n, o: joueur d'origine } dans
// l'ordre d'arrivée. Ils comptent parmi les passagers de leur joueur (transitByOwner) :
// ce sont des habitants sans travail sortis, ils ne sont pas remplacés pendant la visite.
const leisureVisitorsOf = b => (b.visitors || []).reduce((s, g) => s + g.n, 0);
// Capacité utile : réduite au prorata des employés en poste.
function leisureCapacityOf(b){
  const L = BUILD[b.type]?.leisure;
  if(!L) return 0;
  const req = workersRequiredOf(b);
  return Math.floor(L.capacity * (req > 0 ? workersAllocatedOf(b) / req : 1));
}
const leisureStaySecs = b => (BUILD[b.type]?.leisure?.days || 1) * 24 / GAME_HOURS_PER_SEC;
// Voyageurs arrivés au point de transit `hub` → lieux de loisirs à portée, le plus proche
// d'abord, au plus LEISURE_AFFLUX par heure de jeu écoulée.
function sendSortantsToLeisure(hub, radius, elapsed = 1){
  let budget = Math.min(Math.floor(hub.passagersSortant), Math.max(1, Math.round(LEISURE_AFFLUX * elapsed * GAME_HOURS_PER_SEC)));
  if(budget < 1) return;
  const near = [];
  for(const b of buildings){
    if(b.dead || !isLeisure(b)) continue;
    const free = leisureCapacityOf(b) - leisureVisitorsOf(b);
    if(free < 1) continue;
    const d = buildingDistance(b, hub);
    if(d <= radius) near.push({ b, d, free });
  }
  if(!near.length) return;
  near.sort((a, c) => a.d - c.d);
  for(const { b, free } of near){
    const n = Math.min(budget, free);
    hub.passagersSortant -= n;
    budget -= n;
    admitVisitors(b, hub, n);
    if(budget < 1) break;
  }
}
// `n` visiteurs venus de `hub` entrent dans le lieu `b` : l'entrée est payée au propriétaire.
function admitVisitors(b, hub, n){
  (b.visitors ||= []).push({ t: gtime, n, o: hub.owner ?? null });
  b.visitsTotal = (b.visitsTotal || 0) + n;
  const fee = Math.round(n * (BUILD[b.type].leisure.fee || 0));
  if(fee > 0){
    earnMoney(fee, 'loisirs', walletOf(b.owner));
    b.leisureIncome = (b.leisureIncome || 0) + fee;
    addFloat(b.x + (b.w-1)/2, b.y, '+'+fee+' $', '#ffc2ea');
  }
  spawnTransitWalkers(hub, b, n);
}
// Fin de visite : les visiteurs repartent en passagers entrants du point de transit le
// plus proche (de préférence un point de leur joueur d'origine).
function sendVisitorsToTransit(b, n, origin = null){
  let hub = null, bd = Infinity, any = null, ad = Infinity;
  for(const s of buildings){
    if(!isTransitHub(s)) continue;
    const d = buildingDistance(s, b);
    if(d < ad){ ad = d; any = s; }
    if((s.owner ?? null) === origin && d < bd){ bd = d; hub = s; }
  }
  hub = hub || any;
  if(!hub) return; // plus aucun point de transit : ils rentrent par leurs propres moyens
  const rep = hub.type === 'train_station'
    ? ((typeof trainStationGroupRepresentative === 'function' && trainStationGroupRepresentative(hub.stationGroupId)) || hub) : hub;
  const inKey = rep.type === 'bus_stop' ? 'passengers' : 'passengersEntrant';
  rep[inKey] = (rep[inKey] || 0) + n;
  spawnTransitWalkers(b, rep, n);
}
function tickLeisureVisits(){
  for(const b of buildings){
    if(b.dead || !b.visitors) continue;
    const stay = leisureStaySecs(b);
    while(b.visitors.length && gtime - b.visitors[0].t >= stay){
      const g = b.visitors.shift();
      sendVisitorsToTransit(b, g.n, g.o);
    }
    if(!b.visitors.length) delete b.visitors;
  }
}
// Lieu démoli : tous ses visiteurs repartent aussitôt.
function evictVisitors(b){
  if(!b.visitors) return;
  const list = b.visitors;
  delete b.visitors;
  for(const g of list) sendVisitorsToTransit(b, g.n, g.o);
}

// Un voyageur du point de transit `hub` emménage dans la maison `home` (d'un autre joueur) :
// piéton réservant une place (pending), habitant ajouté à son arrivée (updateWalkers).
function moveInFromHub(hub, home){
  if(walkers.length > 80){ growPop(home); return; }
  const A = { x:(hub.x + (hub.w||1)/2)*TILE, y:(hub.y + (hub.h||1)/2)*TILE };
  const B = { x:(home.x + (home.w||1)/2)*TILE, y:(home.y + (home.h||1)/2)*TILE };
  home.pending = (home.pending || 0) + 1;
  walkers.push({ id: nextWalkerId++, pts:[A, B], seg:0, t:0, target:home, guest:true, guestOwner:hub.owner ?? null,
                 col: playerColor(home.owner), phase: Math.random()*7 });
}
// Un voyageur installé chez un autre joueur n'y reste qu'une semaine de jeu : ensuite il
// retourne au point de transit le plus proche (arrêt, gare, port, aéroport) en passager entrant.
const GUEST_STAY_SECS = 7 * 24 / GAME_HOURS_PER_SEC;
// invité = { t: heure d'arrivée (gtime), o: joueur d'origine } (ancien format : nombre = heure)
const guestStart = g => typeof g === 'number' ? g : g.t;
// Un invité de la maison `h` repart : habitant retiré, passager entrant du point de transit
// le plus proche (à défaut, il quitte la ville).
function sendGuestToTransit(h){
  if(h.pop <= (h.protectedPop || 0)) return;
  h.pop--;
  addFloat(h.x, h.y-0.5, '−1 👤', '#ff9a8a');
  let hub = null, bd = Infinity;
  for(const s of buildings){
    if(s.dead || !isTransitHub(s)) continue;
    const d = buildingDistance(s, h);
    if(d < bd){ bd = d; hub = s; }
  }
  if(!hub){ spawnLeavers(h, 1); return; }
  const rep = hub.type === 'train_station'
    ? ((typeof trainStationGroupRepresentative === 'function' && trainStationGroupRepresentative(hub.stationGroupId)) || hub) : hub;
  const inKey = rep.type === 'bus_stop' ? 'passengers' : 'passengersEntrant';
  rep[inKey] = (rep[inKey] || 0) + 1;
  spawnTransitWalkers(h, rep, 1);
}
// Maison fusionnée, divisée, agrandie ou détruite : ses invités repartent AVANT que sa
// population soit reprise ; les autres habitants suivent le sort habituel (nouveau
// logement ou départ de la ville).
function evictGuests(h){
  if(!h.guests) return;
  const n = Math.min(h.guests.length, h.pop || 0);
  delete h.guests;
  for(let i = 0; i < n; i++) sendGuestToTransit(h);
}
function tickGuestsExpire(elapsed = 0){
  for(const h of buildings){
    if(h.dead || !h.guests) continue;
    if(h.guests.length > h.pop) h.guests.length = Math.max(0, h.pop); // départs « pénurie » entre-temps
    // revenu Airbnb de l'hôte, au prorata du temps écoulé (tarif par voyageur et par jour de jeu)
    if(elapsed > 0 && h.guests.length){
      const rate = BUILD[h.type]?.lux ? AIRBNB_RATE_DAY_LUX : AIRBNB_RATE_DAY;
      earnMoney(h.guests.length * rate * elapsed * GAME_HOURS_PER_SEC / 24, 'airbnb', walletOf(h.owner));
    }
    while(h.guests.length && gtime - guestStart(h.guests[0]) >= GUEST_STAY_SECS){
      h.guests.shift();
      sendGuestToTransit(h);
    }
    if(!h.guests.length) delete h.guests;
  }
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
      if(wk.leaving){ if(wk.cj) deliverCommuters(wk.cj.jx, wk.cj.jy, wk.cj.key, wk.cj.n, wk.cj.field); walkers.splice(i,1); continue; } // parti pour de bon
      let tg = wk.target;
      if(tg.dead){
        // bâtiment disparu (fusion ou split) : chercher un logement incomplet proche
        const ox = tg.x, oy = tg.y;
        let best = null, bestPop = Infinity;
        for(const c of buildings){
          if(c.dead || !BUILD[c.type].resid) continue;
          if(c.pop + c.pending >= BUILD[c.type].resid.popCap || (c.airbnbOnly && !wk.guest)) continue;
          const d = Math.abs(c.x - ox) + Math.abs(c.y - oy);
          if(d < 4 && c.pop < bestPop){ bestPop = c.pop; best = c; }
        }
        tg = best;
      } else {
        tg.pending--;
        if(wk.protectedResident) tg.pendingProtected = Math.max(0, (tg.pendingProtected||0) - 1);
      }
      if(tg){
        const before = tg.pop;
        growPop(tg, wk.protectedResident);
        if(wk.guest && tg.pop > before) (tg.guests || (tg.guests = [])).push({ t:gtime, o:wk.guestOwner ?? null }); // séjour limité à une semaine
      }
      else if(wk.fromHomeless){
        const exit = randomExitPoint();
        walkers.push({
          id: nextWalkerId++,
          pts:[wk.pts[wk.pts.length-1], exit],
          seg:0, t:0, target:null, leaving:true,
          col:wk.col, phase:wk.phase,
        });
      }
      walkers.splice(i,1);
    }
  }
}
