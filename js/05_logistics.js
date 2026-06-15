// ---------- logistique (camions) ----------
function tryDispatch(b, res, load = TRUCK_LOAD){
  const starts = adjRoadTiles(b);
  const senderHasRoad = starts.length > 0;
  dist.fill(-1);
  const q = [];
  for(const s of starts){ dist[s] = 0; prev[s] = -1; q.push(s); }
  for(let qi=0; qi<q.length; qi++){
    const c = q[qi], cx = c%N, cy = (c/N)|0;
    for(const [dx,dy] of DIRS8){
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
    const pumpToTank = b.type === 'pump' && res === 'water' && c.type === 'tank';
    // vérifier le rayon de l'expéditeur
    if(senderRadius < Infinity){
      const d2 = Math.max(Math.abs(centerOfBuilding(c).x - senderCenter.x),
                          Math.abs(centerOfBuilding(c).y - senderCenter.y));
      if(d2 > senderRadius) continue;
    }
    // vérifier le rayon de la cible si c'est un entrepôt
    if(!pumpToTank && isStorageHub(c)){
      const d2 = Math.max(Math.abs(centerOfBuilding(b).x - centerOfBuilding(c).x),
                          Math.abs(centerOfBuilding(b).y - centerOfBuilding(c).y));
      if(d2 > (c.type === 'tank' ? tankRadiusOf(c) : depotRadiusOf(c))) continue;
    }
    let bd = Infinity, bt = -1;
    for(const t of adjRoadTiles(c))
      if(dist[t]>=0 && dist[t]<bd){ bd = dist[t]; bt = t; }
    // Livraison directe (sans route) pour ind→ind dans le rayon
    const targetIsInd = !!BUILD[c.type]?.ind;
    const directOk = senderIsInd && targetIsInd;
    if(bt<0 && !directOk) continue;
    // l'entrepôt en dernier recours ; les logements déjà pleins après ceux qui grandissent
    const rcc = BUILD[c.type].resid;
    const full = !!rcc && c.pop >= rcc.popCap;
    // ratio de stock pour les logements (besoins multiples)
    const demand = rcc ? residDeliveryResourcesOf(c) : [];
    const residRatio = demand.length
      ? Math.min(...demand.map(r => ((c.storage[r]||0) + (c.inc[r]||0)) / (rcc.stockCap || 1)))
      : 0;
    // ratio de stock pour les bâtiments industriels (équité entre consommateurs)
    const cap = capOf(c, res);
    const indRatio = (targetIsInd && cap > 0)
      ? ((c.storage[res]||0) + (c.inc[res]||0)) / cap
      : 0;
    const stockRatio = rcc ? residRatio : indRatio;
    // distance réelle pour le score : route si disponible, sinon vol direct
    const distScore = bt >= 0 ? bd : Math.round(Math.hypot(
      centerOfBuilding(c).x - senderCenter.x,
      centerOfBuilding(c).y - senderCenter.y));
    // stockRatio élevé = déjà bien approvisionné → pénalité → distribution équitable
    const score = distScore + (isStorageHub(c) ? 500 : 0) + (full ? 200 : 0) + stockRatio * 150;
    if(score<bestScore){ bestScore = score; bestB = c; bestTile = bt; }
  }

  // Fallback pour les bâtiments de production : si aucune cible normale n'est trouvée,
  // envoyer à l'entrepôt le plus proche dans le rayon d'action de l'expéditeur.
  let fallbackB = null, fallbackTile = -1;
  if(!bestB && senderIsInd && !senderIsDepot){
    let fbDist = Infinity;
    for(const c of buildings){
      if(c===b || c.dead || !isStorageHub(c)) continue;
      if(c.type === 'tank') continue;
      if(c.allow?.[res] === false) continue;
      if(space(c,res) <= 0) continue;
      // respecter le rayon d'action de l'expéditeur
      if(senderRadius < Infinity){
        const d2 = Math.max(Math.abs(centerOfBuilding(c).x - senderCenter.x),
                            Math.abs(centerOfBuilding(c).y - senderCenter.y));
        if(d2 > senderRadius) continue;
      }
      let bd = Infinity, bt = -1;
      for(const t of adjRoadTiles(c))
        if(dist[t]>=0 && dist[t]<bd){ bd = dist[t]; bt = t; }
      if(bt<0) continue;
      if(bd < fbDist){ fbDist = bd; fallbackB = c; fallbackTile = bt; }
    }
  }

  const target     = bestB    ?? fallbackB;
  const targetTile = bestB ? bestTile : fallbackTile;
  if(!target) return false;

  const amt = Math.min(load, b.storage[res]);
  b.storage[res] -= amt;
  b.trucksOut++;
  target.inc[res] = (target.inc[res]||0) + amt;

  const C = i => ({ x:(i%N)*TILE+TILE/2, y:((i/N)|0)*TILE+TILE/2 });
  let pts;
  if(targetTile >= 0){
    // chemin routier : commence et termine sur la tuile de route adjacente au bâtiment
    const path = [];
    let t = targetTile;
    while(t!==-1){ path.push(t); t = prev[t]; }
    path.reverse();
    pts = path.map(C);
  } else {
    // vol direct (pas de route) : s'arrête au bord du bâtiment cible
    const bx = (b.x + b.w/2)*TILE, by = (b.y + b.h/2)*TILE;
    const tx = (target.x + target.w/2)*TILE, ty = (target.y + target.h/2)*TILE;
    const dx = tx - bx, dy = ty - by, len = Math.sqrt(dx*dx+dy*dy)||1;
    const stop = TILE * 0.5; // s'arrête à ~0.5 tuile du centre de la cible
    pts = [
      { x: bx, y: by },
      { x: tx - dx/len*stop, y: ty - dy/len*stop },
    ];
  }
  trucks.push({ pts, seg:0, t:0, res, amt, target, from:b });
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
        const rep = bgrid[tg.y*N+tg.x];
        tg = (rep && !rep.dead && accepts(rep,tk.res)) ? rep : null;
      }
      let delivered = 0;
      if(tg){
        const room = capOf(tg,tk.res) - (tg.storage[tk.res]||0);
        delivered = Math.min(Math.max(0,room), tk.amt);
        tg.storage[tk.res] = (tg.storage[tk.res]||0) + delivered;
      }
      const remaining = tk.amt - delivered;
      if(remaining > 0 && tryRedirect(tk, tg ?? tk.target, remaining)){
        // camion redirigé — reste dans trucks[], trucksOut inchangé
      } else {
        if(!tk.from.dead) tk.from.trucksOut--;
        trucks.splice(i,1);
      }
    }
  }
}

// Redirige un camion depuis `currentBuilding` vers la prochaine destination disponible.
// Cherche d'abord un consommateur, sinon l'entrepôt le plus proche.
// Retourne true si le camion a été redirigé.
function tryRedirect(tk, currentBuilding, remaining){
  const res = tk.res;
  // Rayon d'action de l'expéditeur original (même contrainte que tryDispatch)
  const fromB = tk.from && !tk.from.dead ? tk.from : null;
  const fromIsDepot = fromB && isStorageHub(fromB);
  const fromIsInd   = fromB && !!BUILD[fromB.type]?.ind;
  const fromRadius  = !fromB        ? Infinity
    : fromIsDepot ? (fromB.type === 'tank' ? tankRadiusOf(fromB) : depotRadiusOf(fromB))
    : fromIsInd   ? indRadiusOf(fromB)
    : Infinity;
  const fromCenter = fromB ? centerOfBuilding(fromB) : null;

  // BFS depuis les routes adjacentes au bâtiment courant
  dist.fill(-1);
  const q = [];
  for(const s of adjRoadTiles(currentBuilding)){ dist[s] = 0; prev[s] = -1; q.push(s); }
  for(let qi=0; qi<q.length; qi++){
    const c = q[qi], cx = c%N, cy = (c/N)|0;
    for(const [dx,dy] of DIRS8){
      const x = cx+dx, y = cy+dy;
      if(!inMap(x,y)) continue;
      const ni = y*N+x;
      if(road[ni] && dist[ni]<0){ dist[ni] = dist[c]+1; prev[ni] = c; q.push(ni); }
    }
  }
  let bestB = null, bestScore = Infinity, bestTile = -1;
  for(const c of buildings){
    if(c === currentBuilding || c.dead) continue;
    if(!accepts(c, res) || space(c, res) <= 0) continue;
    // Respecter le rayon d'action de l'expéditeur original
    if(fromRadius < Infinity && fromCenter){
      const d2 = Math.max(Math.abs(centerOfBuilding(c).x - fromCenter.x),
                          Math.abs(centerOfBuilding(c).y - fromCenter.y));
      if(d2 > fromRadius) continue;
    }
    // Respecter le rayon de la cible si c'est un entrepôt
    if(isStorageHub(c) && fromCenter){
      const d2 = Math.max(Math.abs(fromCenter.x - centerOfBuilding(c).x),
                          Math.abs(fromCenter.y - centerOfBuilding(c).y));
      if(d2 > (c.type === 'tank' ? tankRadiusOf(c) : depotRadiusOf(c))) continue;
    }
    let bd = Infinity, bt = -1;
    for(const t of adjRoadTiles(c))
      if(dist[t]>=0 && dist[t]<bd){ bd = dist[t]; bt = t; }
    if(bt < 0) continue;
    const cap = capOf(c, res);
    const ratio = cap > 0 ? ((c.storage[res]||0) + (c.inc[res]||0)) / cap : 1;
    const score = bd + (isStorageHub(c) ? 400 : 0) + ratio * 100;
    if(score < bestScore){ bestScore = score; bestB = c; bestTile = bt; }
  }
  if(!bestB) return false;

  bestB.inc[res] = (bestB.inc[res]||0) + remaining;
  const C = i2 => ({ x:(i2%N)*TILE+TILE/2, y:((i2/N)|0)*TILE+TILE/2 });
  const path = [];
  let t = bestTile;
  while(t !== -1){ path.push(t); t = prev[t]; }
  path.reverse();
  tk.target = bestB;
  tk.amt    = remaining;
  tk.pts    = path.map(C);
  tk.seg = 0; tk.t = 0;
  return true;
}

function syncIncomingReservations(){
  for(const b of buildings) b.inc = {};
  for(const tk of trucks){
    if(!tk.target || tk.target.dead || !tk.res || !tk.amt) continue;
    tk.target.inc[tk.res] = (tk.target.inc[tk.res]||0) + tk.amt;
  }
}

function syncResidentReservations(){
  for(const b of buildings){
    if(!BUILD[b.type]?.resid) continue;
    b.pending = 0;
    b.pendingProtected = 0;
  }
  for(const wk of walkers){
    const tg = wk.target;
    if(wk.leaving || !tg || tg.dead || !BUILD[tg.type]?.resid) continue;
    tg.pending = (tg.pending||0) + 1;
    if(wk.protectedResident) tg.pendingProtected = (tg.pendingProtected||0) + 1;
  }
}

// ---------- logistique (véhicules persistants) ----------
function vehicleIdSeed(){
  return MP.connected && MP.myId != null ? MP.myId * 100000 + nextVehicleId : nextVehicleId;
}

function createPersistentVehicle(vtype, garage, id=null){
  if(!VEHICLE_TYPES[vtype] || !garage || garage.dead || garage.type !== 'garage') return null;
  const v = {
    id: id ?? vehicleIdSeed(),
    vtype,
    garageRef: garage,
    source: null, dest: null,
    state: 'idle',
    cargo: 0, res: null,
    pts: [], seg: 0, t: 0,
    waitTimer: 0,
    currentBuilding: garage,
  };
  const numericId = Number(v.id);
  if(Number.isFinite(numericId)) nextVehicleId = Math.max(nextVehicleId, numericId + 1);
  else nextVehicleId++;
  vehicles.push(v);
  garage.vehicles = garage.vehicles || [];
  garage.vehicles.push(v);
  return v;
}

function removePersistentVehicle(v){
  if(!v) return false;
  const i = vehicles.indexOf(v);
  if(i >= 0) vehicles.splice(i, 1);
  const g = v.garageRef;
  if(g) g.vehicles = (g.vehicles||[]).filter(vv=>vv!==v);
  if(vehicleRouteMode && vehicleRouteMode.vehicle===v) vehicleRouteMode = null;
  if(selectedVehicle === v) selectedVehicle = null;
  return i >= 0;
}

function vehicleRouteEndpointOk(b, vtype_override){
  const vt = vtype_override || vehicleRouteMode?.vehicle?.vtype;
  if(vt === 'bus') return b?.type === 'bus_stop';
  return isStorageHub(b);
}

function buildingChebyshevDistance(a, b){
  const ac = centerOfBuilding(a), bc = centerOfBuilding(b);
  return Math.max(Math.abs(ac.x - bc.x), Math.abs(ac.y - bc.y));
}

function vehicleCanServeRoute(v, res=null){
  if(!v?.source || !v?.dest || v.source.dead || v.dest.dead) return false;
  if(!vehicleRouteEndpointOk(v.source, v.vtype) || !vehicleRouteEndpointOk(v.dest, v.vtype)) return false;
  if(v.vtype === 'bus') return true;
  const resource = res || VEHICLE_TYPES[v.vtype]?.resources?.[0] || null;
  if(resource === 'water' && v.source.type === 'tank')
    return buildingChebyshevDistance(v.source, v.dest) <= tankRadiusOf(v.source);
  return true;
}

function findRoadPath(fromB, toB){
  const starts = adjRoadTiles(fromB);
  if(!starts.length) return null;
  dist.fill(-1);
  const q = [];
  for(const s of starts){ dist[s] = 0; prev[s] = -1; q.push(s); }
  for(let qi=0; qi<q.length; qi++){
    const c = q[qi], cx = c%N, cy = (c/N)|0;
    for(const [dx,dy] of DIRS8){
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
  return path.map(C);
}

function busEarnRevenue(v, numPassengers, routeLen, departStop, arrivalStop){
  if(numPassengers <= 0 || !departStop || !arrivalStop) return;
  const dist = Math.max(1, routeLen ?? 1);
  const baseRev = numPassengers * dist * BUS_FARE_FACTOR;
  const sameCity = departStop.townId != null && departStop.townId === arrivalStop.townId;
  const revenue = Math.round(sameCity ? baseRev / BUS_INTRA_CITY_DIV : baseRev);
  const dOwner = departStop.owner ?? v.garageRef.owner ?? null;
  const aOwner = arrivalStop.owner ?? dOwner;
  if(dOwner !== null && aOwner !== null && dOwner !== aOwner){
    // Le propriétaire du bus (garageRef) reçoit BUS_OWNER_SHARE, l'autre joueur le reste
    const busOwner = v.garageRef.owner ?? dOwner;
    const otherOwner = busOwner === dOwner ? aOwner : dOwner;
    const busShare   = Math.max(1, Math.round(revenue * BUS_OWNER_SHARE));
    const otherShare = Math.max(0, revenue - busShare);
    earnMoney(busShare,   'ventes', walletOf(busOwner));
    if(otherShare > 0) earnMoney(otherShare, 'ventes', walletOf(otherOwner));
    addFloat(arrivalStop.x + 0.5, arrivalStop.y, '+'+busShare+' $ 🚌', '#4dd9ff');
  } else {
    earnMoney(revenue, 'ventes', walletOf(dOwner));
    addFloat(arrivalStop.x + 0.5, arrivalStop.y, '+'+revenue+' $ 🚌', sameCity ? '#a0c8e8' : '#ffe9a0');
  }
}

function startVehicleRoute(v){
  if(!v.source || !v.dest || v.source.dead || v.dest.dead){ v.state = 'idle'; return; }
  if(!vehicleCanServeRoute(v)){
    v.source = null; v.dest = null; v.state = 'idle'; v.pts = []; v.vizRoute = null;
    return;
  }
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
    // Timer d'attente (arrêt en gare ou chemin non trouvé)
    if(v.waitTimer > 0){
      v.waitTimer -= dt;
      if(v.waitTimer > 0) continue;
      if(v.busReady){
        // Chemin déjà prêt (arrêt passager) : on repart directement
        v.busReady = false;
      } else {
        const from = v.currentBuilding || v.garageRef;
        const to = v.state === 'to_source' ? v.source : v.dest;
        const pts = findRoadPath(from, to);
        if(!pts){ v.waitTimer = 5; continue; }
        v.pts = pts; v.seg = 0; v.t = 0;
      }
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
        if(v.vtype === 'bus'){
          // Encaisser les passagers retour (chargés à la destination au voyage précédent)
          if(v.cargo > 0){
            busEarnRevenue(v, v.cargo, v.busRouteDistance, v.dest, v.source);
            v.cargo = 0;
          }
          // Charger les passagers aller depuis l'arrêt source
          const available = Math.floor(v.source.passengers || 0);
          const take = Math.min(vt.capacite, available);
          v.source.passengers = Math.max(0, (v.source.passengers || 0) - take);
          v.cargo = take;
          v.res = null;
          const pts = findRoadPath(v.source, v.dest);
          if(!pts){ v.waitTimer = 5; continue; }
          v.busRouteDistance = pts.length - 2;
          v.state = 'to_dest';
          v.pts = pts; v.seg = 0; v.t = 0;
          v.waitTimer = BUS_DWELL_TIME; v.busReady = true; // arrêt passager
          continue;
        }
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
          if(!vehicleCanServeRoute(v, res)){
            v.cargo = 0; v.res = null; v.waitTimer = 5; continue;
          }
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
        v.waitTimer = VEHICLE_DWELL_TIME; v.busReady = true; // arrêt chargement
      } else {
        v.currentBuilding = v.dest;
        if(v.vtype === 'bus'){
          // Encaisser le revenu des passagers aller
          if(v.cargo > 0){
            busEarnRevenue(v, v.cargo, v.busRouteDistance, v.source, v.dest);
            v.cargo = 0;
          }
          // Charger les passagers retour depuis l'arrêt de destination
          const available = Math.floor(v.dest.passengers || 0);
          const take = Math.min(vt.capacite, available);
          v.dest.passengers = Math.max(0, (v.dest.passengers || 0) - take);
          v.cargo = take;
          const pts = findRoadPath(v.dest, v.source);
          if(!pts){ v.waitTimer = 5; continue; }
          v.state = 'to_source';
          v.pts = pts; v.seg = 0; v.t = 0;
          v.waitTimer = BUS_DWELL_TIME; v.busReady = true; // arrêt passager
          continue;
        }
        // Décharger la cargaison
        if(v.cargo > 0 && v.res){
          const dst = v.dest;
          const canDeposit = accepts(dst, v.res)
            && vehicleCanServeRoute(v, v.res)
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
        v.waitTimer = VEHICLE_DWELL_TIME; v.busReady = true; // arrêt déchargement
      }
    }
  }
}
