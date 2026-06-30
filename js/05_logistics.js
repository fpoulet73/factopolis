// ---------- logistique (camions et véhicules) ----------
function roadMoveAllowed(cx, cy, x, y){
  const dx = x - cx, dy = y - cy;
  if(Math.abs(dx) !== 1 || Math.abs(dy) !== 1) return true;
  return !(road[cy*N+x] || road[y*N+cx]);
}

const TRAFFIC_LIGHT_GREEN = 6;
const TRAFFIC_LIGHT_ALL_RED = 1.1;
const VEHICLE_STOP_GAP   = TILE * 0.82;  // distance d'arrêt devant le feu
const VEHICLE_FOLLOW_GAP = TILE * 0.42;  // espacement en file (juste sans se toucher)
const TRAIN_SIGNAL_STOP_GAP = TILE * 0.56;

function roadTileFromPoint(p){
  const x = Math.floor(p.x / TILE), y = Math.floor(p.y / TILE);
  return inMap(x, y) && road[y*N+x] ? { x, y, i:y*N+x } : null;
}

function roadDegreeAt(x, y){
  let n = 0;
  for(const [dx,dy] of DIRS8){
    const nx = x + dx, ny = y + dy;
    if(!inMap(nx,ny) || !road[ny*N+nx]) continue;
    if(!roadMoveAllowed(x, y, nx, ny)) continue;
    n++;
  }
  return n;
}

function isTrafficIntersectionTile(tile){
  return !!tile && roadDegreeAt(tile.x, tile.y) >= 4;
}

function trafficAxisForMove(from, to){
  const dx = to.x - from.x, dy = to.y - from.y;
  return Math.abs(dx) >= Math.abs(dy) ? 'ew' : 'ns';
}

function trafficGreenAxis(tile){
  const cycle = TRAFFIC_LIGHT_GREEN * 2 + TRAFFIC_LIGHT_ALL_RED * 2;
  const offset = ((tile.x * 7 + tile.y * 11) % 5) * 0.35;
  const t = (gtime + offset) % cycle;
  if(t < TRAFFIC_LIGHT_GREEN) return 'ew';
  if(t < TRAFFIC_LIGHT_GREEN + TRAFFIC_LIGHT_ALL_RED) return 'none';
  if(t < TRAFFIC_LIGHT_GREEN * 2 + TRAFFIC_LIGHT_ALL_RED) return 'ns';
  return 'none';
}

function trafficLightAllows(fromPoint, toPoint){
  if(UI_OPTIONS.disableTrafficLights) return true;
  const from = roadTileFromPoint(fromPoint), to = roadTileFromPoint(toPoint);
  if(!from || !to || !isTrafficIntersectionTile(to)) return true;
  const dx = to.x - from.x, dy = to.y - from.y;
  if(Math.abs(dx) + Math.abs(dy) !== 1) return true;  // approche diagonale : pas de feu sur sa voie
  return trafficGreenAxis(to) === trafficAxisForMove(from, to);
}

function segmentKey(pts, seg){
  if(!pts || seg < 0 || seg >= pts.length-1) return null;
  const a = pts[seg], b = pts[seg+1];
  return Math.round(a.x)+','+Math.round(a.y)+'>'+Math.round(b.x)+','+Math.round(b.y);
}

function reverseSegmentKey(pts, seg){
  if(!pts || seg < 0 || seg >= pts.length-1) return null;
  const a = pts[seg], b = pts[seg+1];
  return Math.round(b.x)+','+Math.round(b.y)+'>'+Math.round(a.x)+','+Math.round(a.y);
}

// Vrai s'il n'y a aucun véhicule venant en sens inverse sur le segment seg (et seg+1)
function noOncoming(unit, seg){
  const rKey = reverseSegmentKey(unit.pts, seg);
  if(!rKey) return true;
  for(const other of movingRoadUnits(unit)){
    if(segmentKey(other.pts, other.seg) === rKey) return false;
  }
  return true;
}

function movingRoadUnits(except){
  const out = [];
  for(const tk of trucks) if(tk !== except && tk.pts && tk.seg < tk.pts.length-1) out.push(tk);
  for(const v of vehicles) if(v !== except && v.state !== 'idle' && v.pts && v.seg < v.pts.length-1) out.push(v);
  return out;
}

function limitByTrafficAhead(unit, desiredT){
  const key = segmentKey(unit.pts, unit.seg);
  if(!key) return desiredT;
  const a = unit.pts[unit.seg], b = unit.pts[unit.seg+1];
  const len = Math.hypot(b.x-a.x, b.y-a.y) || 1;
  let maxT = desiredT;
  let wouldBlock = false;
  for(const other of movingRoadUnits(unit)){
    if(segmentKey(other.pts, other.seg) !== key) continue;
    if(other.t <= unit.t) continue;
    const allowed = other.t - VEHICLE_FOLLOW_GAP / len;
    if(allowed < desiredT - 1e-6) wouldBlock = true;
    maxT = Math.min(maxT, allowed);
  }
  // Dépassement par la droite : pas de véhicule en sens inverse sur ce segment ni le suivant
  if(wouldBlock && noOncoming(unit, unit.seg) && noOncoming(unit, unit.seg + 1)){
    unit.overtaking = true;
    return desiredT;
  }
  if(!wouldBlock) unit.overtaking = false;
  return Math.max(unit.t, maxT);
}

function nextSegmentIsBlocked(unit){
  const nextSeg = unit.seg + 1;
  if(nextSeg >= unit.pts.length-1) return false;
  const key = segmentKey(unit.pts, nextSeg);
  if(!key) return false;
  const a = unit.pts[nextSeg], b = unit.pts[nextSeg+1];
  const len = Math.hypot(b.x-a.x, b.y-a.y) || 1;
  for(const other of movingRoadUnits(unit)){
    if(segmentKey(other.pts, other.seg) !== key) continue;
    if(other.t * len < VEHICLE_FOLLOW_GAP) return true;
  }
  // Si en cours de dépassement, bloquer si trafic en sens inverse sur le segment suivant
  if(unit.overtaking && !noOncoming(unit, nextSeg)) return true;
  return false;
}

function advanceRoadUnit(unit, move){
  while(move > 0 && unit.seg < unit.pts.length-1){
    const a = unit.pts[unit.seg], b = unit.pts[unit.seg+1];
    const d = Math.hypot(b.x-a.x, b.y-a.y) || 1;
    const redLight = !trafficLightAllows(a, b);
    const segBlocked = !redLight && nextSegmentIsBlocked(unit);
    if(redLight || segBlocked){
      const gap = redLight ? VEHICLE_STOP_GAP : VEHICLE_FOLLOW_GAP;
      const tStop = Math.max(0, 1 - gap / d);
      if(unit.t < tStop - 1e-6){
        const desiredT = Math.min(tStop, unit.t + move / d);
        unit.t = limitByTrafficAhead(unit, desiredT);
      }
      break;
    }
    const desiredT = Math.min(1, unit.t + move / d);
    const limitedT = limitByTrafficAhead(unit, desiredT);
    if(limitedT < desiredT - 1e-6){
      unit.t = limitedT;
      break;
    }
    const used = (limitedT - unit.t) * d;
    unit.t = limitedT;
    move -= used;
    if(unit.t < 1 - 1e-6) break;
    unit.seg++;
    unit.t = 0;
    unit.overtaking = false; // réévaluer sur chaque nouveau segment
  }
}

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
      if(!roadMoveAllowed(cx, cy, x, y)) continue;
      if(road[ni] && dist[ni]<0){ dist[ni] = dist[c]+1; prev[ni] = c; q.push(ni); }
    }
  }
  const senderIsDepot = isStorageHub(b);
  const senderIsInd   = !!BUILD[b.type]?.ind;
  if(!senderHasRoad && !senderIsInd) return false;

  let bestB = null, bestScore = Infinity, bestTile = -1;

  // rayon d'action de l'expéditeur
  const senderRadius = senderIsInd
    ? indRadiusOf(b)  // les industries ont un rayon basé sur leur taille
    : (b.type === 'tank' ? tankRadiusOf(b) : depotRadiusOf(b));

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

    // chemin vers la cible
    let bd = Infinity, bt = -1;
    for(const t of adjRoadTiles(c))
      if(dist[t]>=0 && dist[t]<bd){ bd = dist[t]; bt = t; }
    const targetIsInd = !!BUILD[c.type]?.ind;
    // Livraison directe : ind→ind ou via depot (pas de route requise)
    const directOk = senderIsInd && targetIsInd || isStorageHub(b);
    if(bt<0 && !directOk) continue;

    // score pour la distribution équitable
    const rcc = BUILD[c.type].resid;
    const full = !!rcc && c.pop >= rcc.popCap;
    const demand = rcc ? residDeliveryResourcesOf(c) : [];
    const residRatio = demand.length ? Math.min(...demand.map(r => ((c.storage[r]||0) + (c.inc[r]||0)) / (rcc.stockCap || 1))) : 0;
    const cap = capOf(c, res);
    const indRatio = (targetIsInd && cap > 0) ? ((c.storage[res]||0) + (c.inc[res]||0)) / cap : 0;
    const stockRatio = rcc ? residRatio : indRatio;

    // distance réelle : route si disponible, sinon vol direct
    const distScore = bt >= 0 ? bd : Math.round(Math.hypot(
      centerOfBuilding(c).x - senderCenter.x,
      centerOfBuilding(c).y - senderCenter.y));
    const score = distScore + (isStorageHub(c) ? 500 : 0) + (full ? 200 : 0) + stockRatio * 150;

    if(score < bestScore){
      bestScore = score;
      bestB = c;
      bestTile = bt;
    }
  }

  // fallback pour industries sans cible normale
  let fallbackB = null, fallbackTile = -1;
  if(!bestB && senderIsInd && !senderIsDepot){
    let fbDist = Infinity;
    for(const c of buildings){
      if(c===b || c.dead || !isStorageHub(c)) continue;
      if(c.type === 'tank') continue;
      if(c.allow?.[res] === false) continue;
      if(space(c,res) <= 0) continue;
      // rayon d'action de l'expéditeur
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

  // tracer le chemin vers la cible
  const C = i => ({ x:(i%N)*TILE+TILE/2, y:((i/N)|0)*TILE+TILE/2 });
  let pts;
  if(targetTile >= 0){
    const path = [];
    let t = targetTile;
    while(t!==-1){ path.push(t); t = prev[t]; }
    path.reverse();
    pts = path.map(C);
  } else {
    // vol direct : s'arrête au bord du bâtiment cible
    const bx = (b.x + b.w/2)*TILE, by = (b.y + b.h/2)*TILE;
    const tx = (target.x + target.w/2)*TILE, ty = (target.y + target.h/2)*TILE;
    const dx = tx - bx, dy = ty - by, len = Math.sqrt(dx*dx+dy*dy)||1;
    const stop = TILE * 0.5; // arrête à ~0.5 tuile du centre de la cible
    pts = [
      { x: bx, y: by },
      { x: tx - dx/len*stop, y: ty - dy/len*stop },
    ];
  }
  trucks.push({ id: nextTruckId++, pts, seg:0, t:0, res, amt, target, from:b });
  return true;
}

function updateTrucks(dt){
  for(let i=trucks.length-1;i>=0;i--){
    const tk = trucks[i];
    let move = TRUCK_SPEED*TILE*dt;
    advanceRoadUnit(tk, move);
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
      if(!roadMoveAllowed(cx, cy, x, y)) continue;
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

function adjRailTiles(b){
  const out = [];
  const seen = new Set();
  const push = idx => {
    if(seen.has(idx) || !rail[idx]) return;
    seen.add(idx);
    out.push(idx);
  };
  const pieces = b?.stationGroupId != null
    ? buildings.filter(piece => isTrainStationPiece(piece) && piece.stationGroupId === b.stationGroupId)
    : [b];
  for(const piece of pieces){
    const w = piece.w || 1, h = piece.h || 1;
    for(let y = piece.y; y < piece.y + h; y++)
      for(let x = piece.x; x < piece.x + w; x++)
        if(inMap(x, y)) push(y * N + x);
    // Rails use eight directions, so the four corner tiles are valid entrances.
    for(let y = piece.y - 1; y <= piece.y + h; y++){
      for(let x = piece.x - 1; x <= piece.x + w; x++){
        if(!inMap(x, y)) continue;
        if(x >= piece.x && x < piece.x + w && y >= piece.y && y < piece.y + h) continue;
        push(y * N + x);
      }
    }
  }
  return out;
}

function trainStationStopTiles(b, fromB=null, startTile=null){
  if(!isTrainStationPiece(b) || b.stationGroupId == null) return adjRailTiles(b);
  const pieces = buildings.filter(piece => !piece.dead && isTrainStationPiece(piece) && piece.stationGroupId === b.stationGroupId);
  const stationPieces = pieces.filter(piece => piece.type === 'train_station');
  const stationLength = stationPieces.length;
  const platforms = pieces.filter(piece => piece.type === 'train_platform');
  const tracks = new Map();
  for(const piece of platforms){
    const [dx, dy] = String(piece.stationAxis || '0,0').split(',').map(Number);
    const trackKey = String(piece.stationAxis || '0,0') + '|' + ((piece.x * dy) - (piece.y * dx));
    if(!tracks.has(trackKey)) tracks.set(trackKey, { dx, dy, pieces:[] });
    tracks.get(trackKey).pieces.push(piece);
  }
  const out = [];
  const seen = new Set();
  const push = idx => {
    if(idx == null || seen.has(idx) || !rail[idx]) return;
    seen.add(idx);
    out.push(idx);
  };
  const approachX = startTile != null ? ((startTile % N) + 0.5) : (fromB ? (fromB.x + (fromB.w || 1) * 0.5) : null);
  const approachY = startTile != null ? (((startTile / N) | 0) + 0.5) : (fromB ? (fromB.y + (fromB.h || 1) * 0.5) : null);
  for(const track of tracks.values()){
    if(track.pieces.length < stationLength) continue;
    let first = track.pieces[0], last = track.pieces[0];
    let firstPos = first.x * track.dx + first.y * track.dy;
    let lastPos = firstPos;
    for(const piece of track.pieces){
      const pos = piece.x * track.dx + piece.y * track.dy;
      if(pos < firstPos){ first = piece; firstPos = pos; }
      if(pos > lastPos){ last = piece; lastPos = pos; }
    }
    if(approachX == null || approachY == null){
      push(first.y * N + first.x);
      push(last.y * N + last.x);
      continue;
    }
    const approachPos = approachX * track.dx + approachY * track.dy;
    push(approachPos <= (firstPos + lastPos) * 0.5
      ? (last.y * N + last.x)
      : (first.y * N + first.x));
  }
  return out.length ? out : adjRailTiles(b);
}

function railEdgeSignalState(x, y, def){
  const nx = x + def.dx, ny = y + def.dy;
  if(!inMap(nx, ny)) return { own:null, opposite:null };
  return {
    own: railSignalDefAt(x, y, def.bit),
    opposite: railSignalDefAt(nx, ny, RAIL_DIRS[def.opposite].bit),
  };
}

function railEdgeAllowsDirection(x, y, def){
  const nx = x + def.dx, ny = y + def.dy;
  if(!inMap(nx, ny)) return false;
  return !!(rail[ny * N + nx] & RAIL_DIRS[def.opposite].bit);
}

function railEdgePassableForPath(x, y, def, vehicle=null){
  const signals = railEdgeSignalState(x, y, def);
  // Sens ferroviaire :
  // - signal sur la face d'arrivée => mouvement autorisé dans ce sens
  // - signal uniquement sur la face de départ => sens inverse uniquement
  // - aucun signal sur l'arête => bidirectionnel
  if(!signals.opposite){
    if(signals.own) return false;
    return true;
  }
  // Feu forcé au rouge par le joueur => sens interdit : aucun itinéraire ne peut
  // emprunter cette arête dans ce sens.
  if(signals.opposite.forcedRed) return false;
  const nx = x + def.dx, ny = y + def.dy;
  if(!inMap(nx, ny)) return false;
  const curBlock = railBlocks?.blockByTile?.[y * N + x] ?? -1;
  const nextBlock = railBlocks?.blockByTile?.[ny * N + nx] ?? -1;
  if(nextBlock < 0 || nextBlock === curBlock) return true;
  const ownBlock = vehicle?.currentRailBlock ?? -1;
  if(nextBlock === ownBlock) return true;
  // La barrière physique doit refléter EXACTEMENT le feu affiché : un train ne
  // franchit l'arête que si son feu est vert. railSignalAspect tient compte de
  // l'occupation par les locos ET par la queue de wagons d'un autre train, ce
  // que la simple lecture de railBlockOccupancy ratait (le train passait alors
  // un feu visuellement rouge tant que seule une queue occupait le canton).
  return railSignalAspect(signals.opposite, vehicle);
}

function railEdgeDirectionAllowedForPath(x, y, def){
  const signals = railEdgeSignalState(x, y, def);
  // Vérification statique uniquement :
  // - respecte le sens imposé par les signaux
  // - ignore l'occupation momentanée des cantons, qui relève du mouvement
  //   et non du calcul global d'itinéraire
  if(!signals.opposite){
    if(signals.own) return false;
    return true;
  }
  // Un feu forcé au rouge ne ferme PAS la voie au niveau de l'itinéraire : c'est
  // un simple « stop » sur le trajet. Le train doit pouvoir planifier une route
  // qui le traverse puis avancer jusqu'à lui ; l'arrêt physique devant le feu
  // rouge est géré dynamiquement par railEdgePassableForPath. Sinon, un feu
  // rouge plus loin empêcherait le train de franchir les feux verts en amont.
  const nx = x + def.dx, ny = y + def.dy;
  if(!inMap(nx, ny)) return false;
  return true;
}

function railNextSignalAllowsDirection(x, y, def){
  const startX = x + def.dx, startY = y + def.dy;
  if(!inMap(startX, startY)) return false;
  const firstState = railEdgeSignalState(x, y, def);
  if(firstState.own || firstState.opposite){
    return !!(firstState.opposite && railSignalAspect(firstState.opposite));
  }

  // Cherche le premier feu rencontré après cette sortie, même si une autre
  // bifurcation se trouve avant lui. La recherche avance par distance : un
  // feu plus éloigné ne peut donc pas masquer un feu rouge plus proche.
  const q = [{ x:startX, y:startY, incoming:def.opposite, distance:0 }];
  const seen = new Set([startX + ',' + startY + ',' + def.opposite]);
  let signalDistance = Infinity;
  let foundSignal = false;
  for(let qi = 0; qi < q.length; qi++){
    const cur = q[qi];
    if(cur.distance > signalDistance) break;
    const inDx = -RAIL_DIRS[cur.incoming].dx, inDy = -RAIL_DIRS[cur.incoming].dy;
    for(const forward of railConnectedDefsAt(cur.x, cur.y)){
      if(forward.bit === RAIL_DIRS[cur.incoming]?.bit) continue;
      if(!railTurnAllowed(inDx, inDy, forward.dx, forward.dy)) continue;
      const nx = cur.x + forward.dx, ny = cur.y + forward.dy;
      if(!inMap(nx, ny)) continue;
      const ni = ny * N + nx;
      if(!rail[ni] || !(rail[ni] & RAIL_DIRS[forward.opposite].bit)) continue;
      const state = railEdgeSignalState(cur.x, cur.y, forward);
      if(state.own || state.opposite){
        foundSignal = true;
        signalDistance = cur.distance;
        if(state.opposite && railSignalAspect(state.opposite)) return true;
        continue;
      }
      if(cur.distance >= signalDistance) continue;
      const key = nx + ',' + ny + ',' + forward.opposite;
      if(seen.has(key)) continue;
      seen.add(key);
      q.push({ x:nx, y:ny, incoming:forward.opposite, distance:cur.distance + 1 });
    }
  }
  // Sans feu en aval, la voie reste utilisable. Si le premier niveau de feux
  // trouvé ne contient aucun vert, cette sortie d'embranchement est refusée.
  return !foundSignal;
}

// Une tuile est un aiguillage si, en excluant le retour vers `previousTile`,
// elle offre plus d'une sortie franchissable. Utilisé aussi bien pour la tuile
// courante du train que pour une tuile en aval (pré-décision d'itinéraire).
function railTileIsJunction(tile, previousTile){
  if(tile == null || tile < 0 || !rail[tile]) return false;
  const x = tile % N, y = (tile / N) | 0;
  const inDx = previousTile != null && previousTile >= 0 ? x - (previousTile % N) : 0;
  const inDy = previousTile != null && previousTile >= 0 ? y - ((previousTile / N) | 0) : 0;
  let exits = 0;
  for(const def of railConnectedDefsAt(x, y)){
    const nx = x + def.dx, ny = y + def.dy;
    if(!inMap(nx, ny) || ny * N + nx === previousTile) continue;
    if(!railTurnAllowed(inDx, inDy, def.dx, def.dy)) continue;
    const ni = ny * N + nx;
    if(!rail[ni] || !(rail[ni] & RAIL_DIRS[def.opposite].bit)) continue;
    if(!railEdgeDirectionAllowedForPath(x, y, def)) continue;
    exits++;
  }
  return exits > 1;
}

function trainAtRailJunction(v){
  if(!v?.pathTiles?.length || v.t > 1e-6) return false;
  const cur = v.pathTiles[v.seg] ?? -1;
  if(cur < 0) return false;
  const previous = v.seg > 0 ? (v.pathTiles[v.seg - 1] ?? -1) : -1;
  return railTileIsJunction(cur, previous);
}

// Pré-décision d'aiguillage : lorsque la tuile juste devant la locomotive est un
// aiguillage et que la branche actuellement planifiée est fermée (canton occupé
// ou feu rouge), on choisit dès maintenant la bonne branche et on réécrit la
// queue de l'itinéraire — SANS toucher à v.seg/v.t. Ainsi la locomotive amorce
// directement la courbe vers la voie qu'elle empruntera réellement, sans montrer
// un engagement sur une voie puis une correction visible vers l'autre.
function predecideTrainJunction(v){
  if(!v?.pathTiles?.length || v.t > 1e-6) return false;
  const seg = v.seg;
  if(seg + 2 >= v.pathTiles.length) return false; // il faut aiguillage + une branche au-delà
  const curTile = v.pathTiles[seg];
  const junctionTile = v.pathTiles[seg + 1];
  if(curTile < 0 || junctionTile < 0) return false;
  if(!railTileIsJunction(junctionTile, curTile)) return false;
  // Déjà tranché pour cet aiguillage : ne pas recalculer à chaque frame.
  if(v.railPredecidedJunctionTile === junctionTile) return false;
  const plannedBranch = v.pathTiles[seg + 2];
  const jx = junctionTile % N, jy = (junctionTile / N) | 0;
  const bx = plannedBranch % N, by = (plannedBranch / N) | 0;
  const branchDef = railDirDef(bx - jx, by - jy);
  const plannedBranchOpen = branchDef
    && railEdgePassableForPath(jx, jy, branchDef, v)
    && railNextSignalAllowsDirection(jx, jy, branchDef);
  if(plannedBranchOpen){ v.railPredecidedJunctionTile = junctionTile; return false; }
  // Branche planifiée fermée : choisir une autre sortie depuis l'aiguillage.
  const targetB = v.state === 'returning' ? v.garageRef : (v.state === 'to_source' ? v.source : v.dest);
  if(!targetB || targetB.dead) return false;
  const decision = findRailPathFromDecision(v, targetB, junctionTile, curTile);
  if(!decision || decision.tiles.length < 2) return false;
  // Conserver le préfixe jusqu'à l'aiguillage (inclus via decision.tiles[0]) et
  // remplacer toute la queue par la branche retenue.
  v.pathTiles = v.pathTiles.slice(0, seg + 1).concat(decision.tiles);
  v.pts = v.pts.slice(0, seg + 1).concat(decision.pts);
  v.railPredecidedJunctionTile = junctionTile;
  return true;
}

function trainTargetTileAvailable(tile, vehicle=null, startTiles=null){
  const blockId = railBlocks?.blockByTile?.[tile] ?? -1;
  if(blockId < 0) return true;
  const ownBlock = vehicle?.currentRailBlock ?? -1;
  if(blockId !== ownBlock && (railBlockOccupancy?.[blockId] ?? 0) > 0) return false;

  const tx = tile % N, ty = (tile / N) | 0;
  let candidateDistance = Infinity;
  for(const start of (startTiles || [])){
    const sx = start % N, sy = (start / N) | 0;
    candidateDistance = Math.min(candidateDistance, Math.max(Math.abs(tx - sx), Math.abs(ty - sy)));
  }

  // Une réservation de quai est souple : le train le plus proche garde la
  // priorité. Sans cela, un train très éloigné peut réserver un quai vide et
  // forcer un train déjà à l'entrée à attendre derrière une voie occupée.
  for(const other of vehicles){
    if(other === vehicle || other.vtype !== 'train' || other.state === 'idle') continue;
    const endTile = other.pathTiles?.length ? other.pathTiles[other.pathTiles.length - 1] : -1;
    if(endTile < 0 || (railBlocks?.blockByTile?.[endTile] ?? -1) !== blockId) continue;
    const otherDistance = Math.max(0,
      (other.pathTiles.length - 1) - (other.seg || 0) - Math.max(0, Math.min(1, other.t || 0)));
    const candidateWins = Number.isFinite(candidateDistance) && (
      candidateDistance < otherDistance - 0.5
      || (Math.abs(candidateDistance - otherDistance) <= 0.5
        && Number(vehicle?.id ?? Infinity) < Number(other.id ?? Infinity))
    );
    if(!candidateWins) return false;
  }
  return true;
}

function railReachableExits(tile, vehicle=null){
  if(tile == null || tile < 0 || !rail[tile]) return 0;
  const x = tile % N, y = (tile / N) | 0;
  let n = 0;
  for(const def of RAIL_DIRS){
    if(!(rail[tile] & def.bit) || !railEdgePassableForPath(x, y, def, vehicle) || !railNextSignalAllowsDirection(x, y, def)) continue;
    const nx = x + def.dx, ny = y + def.dy;
    if(!inMap(nx, ny)) continue;
    const ni = ny * N + nx;
    const other = RAIL_DIRS[def.opposite];
    if(!rail[ni] || !(rail[ni] & other.bit)) continue;
    n++;
  }
  return n;
}

function findRailPath(fromB, toB, startTile=null, vehicle=null, previousTile=null, blockedFirstTiles=null, skipFirstSignalCheck=false){
  const starts = startTile != null ? [startTile] : adjRailTiles(fromB);
  let targetTiles = isTrainStationPiece(toB) ? trainStationStopTiles(toB, fromB, startTile) : adjRailTiles(toB);
  if(isTrainStationPiece(toB)){
    const availableTargets = targetTiles.filter(tile => trainTargetTileAvailable(tile, vehicle, starts));
    // Préférer un quai libre, mais conserver une route si tous les quais sont
    // momentanément occupés. Sinon les trains restent dans leur gare actuelle,
    // gardent leur canton et peuvent verrouiller tout le réseau en boucle.
    if(availableTargets.length) targetTiles = availableTargets;
  }
  const targets = new Set(targetTiles);
  if(!starts.length || !targets.size) return null;
  const prevRail = new Int32Array(N * N).fill(-2);
  const q = [];
  for(const s of starts){
    if(!rail[s]) continue;
    prevRail[s] = -1;
    q.push(s);
  }
  let found = -1;
  for(let qi = 0; qi < q.length && found < 0; qi++){
    const cur = q[qi];
    if(targets.has(cur)){ found = cur; break; }
    const cx = cur % N, cy = (cur / N) | 0;
    const mask = rail[cur] || 0;
    const firstHop = prevRail[cur] === -1;
    // Sens d'arrivée sur `cur` pour interdire les virages > 45°. Connu via le
    // parent BFS, ou via `previousTile` pour la toute première tuile.
    let inDx = 0, inDy = 0;
    if(prevRail[cur] >= 0){
      inDx = cx - (prevRail[cur] % N); inDy = cy - ((prevRail[cur] / N) | 0);
    } else if(startTile != null && cur === startTile && previousTile != null){
      inDx = cx - (previousTile % N); inDy = cy - ((previousTile / N) | 0);
    }
    for(const def of RAIL_DIRS){
      if(!(mask & def.bit)) continue;
      if(!railTurnAllowed(inDx, inDy, def.dx, def.dy)) continue;
      if(!railEdgeDirectionAllowedForPath(cx, cy, def)) continue;
      if(firstHop && !skipFirstSignalCheck && !railNextSignalAllowsDirection(cx, cy, def)) continue;
      const nx = cx + def.dx, ny = cy + def.dy;
      if(!inMap(nx, ny)) continue;
      const ni = ny * N + nx;
      if(startTile != null && cur === startTile && previousTile != null && ni === previousTile) continue;
      if(startTile != null && cur === startTile && blockedFirstTiles?.has(ni)) continue;
      const other = RAIL_DIRS[def.opposite];
      if(!rail[ni] || !(rail[ni] & other.bit) || prevRail[ni] !== -2) continue;
      prevRail[ni] = cur;
      q.push(ni);
    }
  }
  if(found < 0) return null;
  const tiles = [];
  for(let t = found; t !== -1; t = prevRail[t]) tiles.push(t);
  tiles.reverse();
  const pts = tiles.map(idx => ({ x:(idx % N) * TILE + TILE / 2, y:((idx / N) | 0) * TILE + TILE / 2 }));
  return { tiles, pts };
}

function railPathNextSignalAllows(tiles){
  if(!Array.isArray(tiles) || tiles.length < 2) return true;
  for(let i = 0; i < tiles.length - 1; i++){
    const cur = tiles[i], next = tiles[i + 1];
    const cx = cur % N, cy = (cur / N) | 0;
    const nx = next % N, ny = (next / N) | 0;
    const def = railDirDef(nx - cx, ny - cy);
    if(!def) return false;
    const state = railEdgeSignalState(cx, cy, def);
    if(state.own || state.opposite)
      return !!(state.opposite && railSignalAspect(state.opposite));
  }
  return true;
}

// Signalisation par cantons : un train n'a besoin que du PREMIER feu vert (canton
// immédiatement devant lui libre). Les feux plus éloignés sont gérés au fil de
// l'avance, feu par feu. On contrôle donc la passabilité uniquement jusqu'au
// premier feu franchi, sans exiger que tout l'itinéraire soit dégagé.
function railPathFirstBlockPassable(tiles, vehicle=null){
  for(let i = 0; i < tiles.length - 1; i++){
    const cx = tiles[i] % N, cy = (tiles[i] / N) | 0;
    const nx = tiles[i + 1] % N, ny = (tiles[i + 1] / N) | 0;
    const def = railDirDef(nx - cx, ny - cy);
    if(!def) return false;
    if(!railEdgePassableForPath(cx, cy, def, vehicle)) return false;
    // Premier feu franchi => les cantons suivants ne nous concernent plus ici.
    if(railEdgeSignalState(cx, cy, def).opposite) break;
  }
  return true;
}

function findRailPathFromDecision(v, targetB, curTile, previousTile=null){
  const cx = curTile % N, cy = (curTile / N) | 0;
  const inDx = previousTile != null ? cx - (previousTile % N) : 0;
  const inDy = previousTile != null ? cy - ((previousTile / N) | 0) : 0;
  let best = null;
  for(const def of RAIL_DIRS){
    if(!((rail[curTile] || 0) & def.bit)) continue;
    if(!railTurnAllowed(inDx, inDy, def.dx, def.dy)) continue;
    if(!railEdgeDirectionAllowedForPath(cx, cy, def)) continue;
    const nx = cx + def.dx, ny = cy + def.dy;
    if(!inMap(nx, ny)) continue;
    const nextTile = ny * N + nx;
    if(nextTile === previousTile) continue;
    if(!rail[nextTile] || !(rail[nextTile] & RAIL_DIRS[def.opposite].bit)) continue;

    // Chaque branche est calculée indépendamment. Le contrôle du feu est fait
    // ensuite sur le chemin exact obtenu, jamais sur une branche voisine.
    const tail = findRailPath(
      v.currentBuilding || v.garageRef,
      targetB,
      nextTile,
      v,
      curTile,
      null,
      true
    );
    if(!tail?.tiles?.length) continue;
    const tiles = [curTile, ...tail.tiles];
    // Priorité absolue : la branche qui mène le plus DIRECTEMENT à la destination,
    // même si son premier canton est occupé (feu rouge). Le train s'engage vers
    // cette branche et patiente au feu jusqu'au dégagement — il ne se détourne PAS
    // vers une branche plus longue uniquement parce qu'elle est verte. L'arrêt
    // physique au feu rouge est assuré ensuite par trainNextMoveState.
    // À distance ÉGALE seulement, on préfère la branche dont le premier feu est
    // déjà vert (« si le premier feu vert amène à sa destination, il le prend »).
    const passable = railPathFirstBlockPassable(tiles, v);
    const better = !best
      || tiles.length < best.tiles.length
      || (tiles.length === best.tiles.length && passable && !best.passable);
    if(better){
      best = {
        tiles,
        pts:tiles.map(idx => ({ x:(idx % N) * TILE + TILE / 2, y:((idx / N) | 0) * TILE + TILE / 2 })),
        passable,
      };
    }
  }
  return best;
}

function trainTileIndex(v){
  if(!v?.pathTiles?.length) return -1;
  return v.pathTiles[Math.max(0, Math.min(v.pathTiles.length - 1, v.seg))] ?? -1;
}

// Empreinte DISCRÈTE d'un train pour la signalisation de cantons : la tuile de
// la loco (pathTiles[seg]) plus les tuiles réellement couvertes par les wagons
// derrière elle. Contrairement à trainOccupiedBlockTiles (qui sert au veto de
// démolition et inclut volontairement le nez flottant du railTrail), on EXCLUT
// ce nez interpolé : à l'arrêt devant un feu rouge il déborde sur la tuile
// suivante et ferait croire à tort que le canton AVANT est occupé (auto-rouge).
function trainBlockFootprintTiles(v){
  const set = new Set();
  if(v?.vtype !== 'train') return set;
  const locoTile = trainTileIndex(v);
  if(locoTile < 0) return set;
  set.add(locoTile);
  const wagonCount = v.wagons?.length || 0;
  if(wagonCount <= 0) return set;
  let collected = 0;
  let prevTile = locoTile;
  // 1) Source fiable quand la loco a déjà progressé sur l'itinéraire courant :
  //    les tuiles déjà franchies (pathTiles avant seg) portent les wagons.
  if(v.seg > 0 && Array.isArray(v.pathTiles)){
    for(let i = v.seg - 1; i >= 0 && collected < wagonCount; i--){
      const t = v.pathTiles[i] ?? -1;
      if(t < 0 || t === prevTile) continue;
      set.add(t); prevTile = t; collected++;
    }
  }
  // 2) Sinon (arrêt en gare seg=0, itinéraire fraîchement recalculé), la queue
  //    n'est plus dans pathTiles : on lit le railTrail en partant de la loco et
  //    en ignorant le nez flottant qui précède sa tuile discrète.
  if(collected < wagonCount && Array.isArray(v.railTrail)){
    let reachedLoco = false;
    for(let i = v.railTrail.length - 1; i >= 0 && collected < wagonCount; i--){
      const p = v.railTrail[i];
      if(!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue;
      const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
      if(tx < 0 || ty < 0 || tx >= N || ty >= N) continue;
      const t = ty * N + tx;
      if(!reachedLoco){ if(t === locoTile) reachedLoco = true; continue; }
      if(t === prevTile) continue;
      set.add(t); prevTile = t; collected++;
    }
  }
  return set;
}

// Tuiles physiquement occupées par la "boîte englobante" d'un train, pour la
// signalisation de cantons. Limité à wagons.length + 1 tuiles uniques (loco
// + wagons réels) — on ne compte pas la queue interpolée du railTrail qui
// n'est là que pour le lissage visuel des wagons.
function trainOccupiedBlockTiles(v){
  const set = new Set();
  if(v?.vtype !== 'train') return set;
  const wagonCount = v.wagons?.length || 0;
  const maxTiles = wagonCount + 1;
  if(Array.isArray(v.railTrail)){
    const seen = new Set();
    let collected = 0;
    for(let i = v.railTrail.length - 1; i >= 0 && collected < maxTiles; i--){
      const p = v.railTrail[i];
      if(!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue;
      const tx = Math.floor(p.x / TILE);
      const ty = Math.floor(p.y / TILE);
      if(tx < 0 || ty < 0 || tx >= N || ty >= N) continue;
      const tileIdx = ty * N + tx;
      if(seen.has(tileIdx)) continue;
      seen.add(tileIdx);
      set.add(tileIdx);
      collected++;
    }
  }
  // Toujours inclure la tuile loco (au cas où railTrail est vide/stale).
  const locoTile = trainTileIndex(v);
  if(locoTile >= 0) set.add(locoTile);
  return set;
}

// Renvoie l'ensemble des tuiles couvertes par le railTrail complet. Sert
// uniquement au rendu / debug éventuel, pas au veto de démolition, car le
// trail inclut une queue visuelle interpolée qui peut dépasser les tuiles
// réellement occupées par la loco et les wagons.
function trainOccupiedTileIndices(v){
  const set = trainOccupiedBlockTiles(v);
  if(!v || v.vtype !== 'train' || !Array.isArray(v.railTrail)) return set;
  for(const p of v.railTrail){
    if(!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue;
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);
    if(tx < 0 || ty < 0 || tx >= N || ty >= N) continue;
    set.add(ty * N + tx);
  }
  return set;
}

// Renvoie le premier train non-idle occupant la tuile (x, y), sinon null.
// Utilisé pour interdire la démolition de rail sous un train en mouvement.
// On se limite aux tuiles physiquement occupées (loco + wagons réels), sans
// compter toute la queue de lissage du railTrail.
function tileOccupiedByTrain(x, y){
  if(!Number.isInteger(x) || !Number.isInteger(y)) return null;
  const i = y * N + x;
  for(const v of vehicles){
    if(v.vtype !== 'train' || v.state === 'idle') continue;
    if(trainOccupiedBlockTiles(v).has(i)) return v;
  }
  return null;
}

function rebuildRailBlockOccupancy(){
  if(!railBlocks?.count){
    railBlockOccupancy = null;
    return;
  }
  // OCCUPATION "LOCO SEULE" : chaque train est compté une fois dans le canton
  // où se trouve sa loco. Sert à la réservation de cantons / sortie de dépôt.
  // L'aspect des feux (railSignalAspect) ne s'appuie PAS sur ce compteur : il
  // lit l'empreinte physique complète (loco + wagons) via trainOccupiedBlockTiles
  // pour que la queue garde le feu rouge tant qu'elle n'a pas libéré le canton.
  const occ = new Int16Array(railBlocks.count);
  for(const v of vehicles){
    if(v.vtype !== 'train' || v.state === 'idle') continue;
    const tile = trainTileIndex(v);
    const blockId = tile >= 0 ? (railBlocks.blockByTile?.[tile] ?? -1) : -1;
    v.currentRailBlock = blockId;
    if(blockId >= 0) occ[blockId]++;
  }
  railBlockOccupancy = occ;
}

// Aspect d'un feu (vert = true, rouge = false). `ignoreVehicle` permet à un
// train d'interroger le feu qui le concerne sans se compter lui-même comme
// occupant du canton qu'il va franchir (loco déjà entrée ou queue de wagons).
// Aspect « canton » d'un feu : rouge si forcé manuellement ou si un train occupe
// le canton protégé. C'est le comportement commun à TOUS les feux.
function railBlockSignalClear(sig, ignoreVehicle=null){
  // Feu rouge forcé manuellement par le joueur : toujours rouge (arrêt).
  if(sig.forcedRed) return false;
  const def = RAIL_DIRS.find(d => d.bit === sig.bit);
  if(!def) return false;
  const nx = sig.x + def.dx, ny = sig.y + def.dy;
  if(!inMap(nx, ny)) return false;
  const guardedBlock = railBlocks?.blockByTile?.[sig.y * N + sig.x] ?? -1;
  if(guardedBlock < 0) return false;
  // Le feu est rouge dès qu'un train occupe le canton protégé, que ce soit par
  // sa loco OU par sa queue de wagons. On lit l'empreinte DISCRÈTE (loco + tuiles
  // des wagons), fiable même à l'arrêt en gare (pathTiles=1 tuile) ou après un
  // recalcul d'itinéraire, et SANS le nez flottant qui déborderait sur le canton
  // suivant et rendrait le feu rouge à tort devant un train arrêté.
  for(const v of (vehicles ?? [])){
    if(v === ignoreVehicle) continue;
    if(v.vtype !== 'train' || v.state === 'idle') continue;
    for(const tile of trainBlockFootprintTiles(v)){
      if((railBlocks?.blockByTile?.[tile] ?? -1) === guardedBlock) return false;
    }
  }
  return true;
}

// Feu de jonction (2 lentilles) : vrai si AU MOINS une voie suivante est libre,
// c.-à-d. si le PREMIER feu d'une des branches en aval est vert (ou s'il n'y a
// aucun feu du tout en aval). Faux uniquement si TOUTES les branches butent sur
// un premier feu rouge.
//
// On évalue le premier feu de CHAQUE branche indépendamment : un feu rouge proche
// sur une branche ne doit pas masquer un feu vert plus lointain sur une autre
// branche (sinon une jonction qui débouche sur plusieurs quais reste rouge dès
// que la branche la plus courte est occupée). On n'explore donc pas au-delà du
// premier feu rencontré sur une branche, mais on poursuit toutes les autres.
function railJunctionDownstreamClear(sig){
  const def = RAIL_DIRS.find(d => d.bit === sig.bit);
  if(!def) return true;
  // Le train protégé traverse (sig.x,sig.y) puis poursuit dans le sens -def.
  // « incoming » pointe vers la tuile d'où il vient, soit la direction def.
  const incoming = RAIL_DIRS.indexOf(def);
  const q = [{ x:sig.x, y:sig.y, incoming }];
  const seen = new Set([sig.x + ',' + sig.y + ',' + incoming]);
  let foundSignal = false;
  for(let qi = 0; qi < q.length; qi++){
    const cur = q[qi];
    const inDx = -RAIL_DIRS[cur.incoming].dx, inDy = -RAIL_DIRS[cur.incoming].dy;
    for(const forward of railConnectedDefsAt(cur.x, cur.y)){
      if(forward.bit === RAIL_DIRS[cur.incoming]?.bit) continue;
      if(!railTurnAllowed(inDx, inDy, forward.dx, forward.dy)) continue;
      const nx = cur.x + forward.dx, ny = cur.y + forward.dy;
      if(!inMap(nx, ny)) continue;
      const ni = ny * N + nx;
      if(!rail[ni] || !(rail[ni] & RAIL_DIRS[forward.opposite].bit)) continue;
      const state = railEdgeSignalState(cur.x, cur.y, forward);
      if(state.own || state.opposite){
        // Premier feu de cette branche : on tranche ici et on n'explore pas
        // au-delà. Vert -> une voie est libre. Rouge -> cette branche est fermée,
        // mais les autres branches restent à examiner.
        foundSignal = true;
        if(state.opposite && railSignalAspect(state.opposite)) return true;
        continue;
      }
      const key = nx + ',' + ny + ',' + forward.opposite;
      if(seen.has(key)) continue;
      seen.add(key);
      q.push({ x:nx, y:ny, incoming:forward.opposite });
    }
  }
  // Sans aucun feu en aval, la voie reste libre : un feu de jonction sans feux
  // suivants se comporte comme un feu normal.
  return !foundSignal;
}

// Garde anti-récursion : un feu de jonction dont une voie suivante mène (via une
// boucle) à lui-même ne doit pas se réévaluer indéfiniment.
const railAspectGuard = new Set();

function railSignalAspect(sig, ignoreVehicle=null){
  // Rouge forcé manuellement par le joueur : toujours rouge, quel que soit le type.
  if(sig.forcedRed) return false;
  // Lentille du BAS (signal normal) : rouge si le canton protégé est occupé.
  if(!railBlockSignalClear(sig, ignoreVehicle)) return false;
  if(sig.kind === 'junction'){
    // Lentille du HAUT : rouge si AUCUNE voie suivante n'est disponible. Le train
    // s'arrête dès qu'UNE des deux lentilles est rouge -> il ne franchit le feu
    // que lorsque le canton est libre ET qu'au moins une voie suivante est libre.
    const key = railSignalKey(sig.x, sig.y, sig.bit);
    if(railAspectGuard.has(key)) return true;
    railAspectGuard.add(key);
    const downstreamClear = railJunctionDownstreamClear(sig);
    railAspectGuard.delete(key);
    if(!downstreamClear) return false;
  }
  return true;
}

function prepareRailTrip(v, fromB, toB, startTile=null, previousTile=null, skipFirstSignalCheck=false){
  let path = findRailPath(fromB, toB, startTile, v, previousTile, null, skipFirstSignalCheck);
  let decisionPreviousTile = previousTile;
  // Après un arrêt en gare, interdire systématiquement la tuile précédente
  // peut bloquer certains quais en cul-de-sac ou certaines géométries de sortie.
  // On préfère d'abord éviter le demi-tour, puis on autorise ce repli si aucun
  // trajet valide n'existe autrement.
  if(!path && startTile != null && previousTile != null){
    path = findRailPath(fromB, toB, startTile, v, null, null, skipFirstSignalCheck);
    decisionPreviousTile = null;
  }
  if(!path) return false;
  v.pts = path.pts;
  v.pathTiles = path.tiles;
  v.seg = 0;
  v.t = 0;
  v.railDecisionPreviousTile = decisionPreviousTile;
  v.railPathEntryFromTile = previousTile ?? null;
  seedTrainTrail(v, path.tiles, previousTile);
  return true;
}

function trainTrailPoint(tile){
  return { x:(tile % N) * TILE + TILE / 2, y:((tile / N) | 0) * TILE + TILE / 2 };
}

function trimTrainTrail(v){
  if(!Array.isArray(v.railTrail) || v.railTrail.length < 3) return;
  const keepDistance = ((v.wagons?.length || 0) + 2) * TILE * 0.80 + TILE * 2;
  let distance = 0;
  let first = v.railTrail.length - 1;
  for(let i = v.railTrail.length - 1; i > 0; i--){
    const a = v.railTrail[i], b = v.railTrail[i - 1];
    distance += Math.hypot(a.x - b.x, a.y - b.y);
    first = i - 1;
    if(distance >= keepDistance) break;
  }
  if(first > 0) v.railTrail.splice(0, first);
}

function recordTrainTrailPoint(v, x, y, force=false){
  if(!Number.isFinite(x) || !Number.isFinite(y)) return;
  if(!Array.isArray(v.railTrail)) v.railTrail = [];
  const last = v.railTrail[v.railTrail.length - 1];
  if(last){
    const distance = Math.hypot(x - last.x, y - last.y);
    if(distance < 0.01) return;
    if(!force && distance < 2) return;
  }
  v.railTrail.push({ x, y });
  trimTrainTrail(v);
}

// Conserve une vraie voie derrière la locomotive. Cet historique ne doit pas
// être remplacé lors d'un arrêt ou d'un recalcul d'itinéraire : les wagons
// occupent encore les tuiles déjà parcourues.
function seedTrainTrail(v, pathTiles, previousTile=null){
  if(!pathTiles?.length) return;
  const startTile = pathTiles[0];
  const start = trainTrailPoint(startTile);
  const last = v.railTrail?.[v.railTrail.length - 1];
  if(last && Math.hypot(last.x - start.x, last.y - start.y) < 2){
    recordTrainTrailPoint(v, start.x, start.y, true);
    return;
  }

  const nextTile = pathTiles[1] ?? null;
  const wantedDistance = ((v.wagons?.length || 0) + 2) * TILE * 0.80;
  const backwards = [startTile];
  const seen = new Set(backwards);
  let newerTile = nextTile;
  let currentTile = startTile;
  let preferredTile = previousTile;
  let distance = 0;
  while(distance < wantedDistance){
    const cx = currentTile % N, cy = (currentTile / N) | 0;
    const nx0 = newerTile == null ? cx : newerTile % N;
    const ny0 = newerTile == null ? cy : (newerTile / N) | 0;
    const backDx = cx - nx0, backDy = cy - ny0;
    let best = -1, bestScore = -Infinity;
    for(const def of railConnectedDefsAt(cx, cy)){
      const nx = cx + def.dx, ny = cy + def.dy;
      if(!inMap(nx, ny)) continue;
      const tile = ny * N + nx;
      if(tile === newerTile || seen.has(tile)) continue;
      if(!rail[tile] || !(rail[tile] & RAIL_DIRS[def.opposite].bit)) continue;
      let score = def.dx * backDx + def.dy * backDy;
      if(tile === preferredTile) score += 100;
      if(score > bestScore){ best = tile; bestScore = score; }
    }
    if(best < 0) break;
    const a = trainTrailPoint(currentTile), b = trainTrailPoint(best);
    distance += Math.hypot(a.x - b.x, a.y - b.y);
    backwards.push(best);
    seen.add(best);
    newerTile = currentTile;
    currentTile = best;
    preferredTile = null;
  }
  v.railTrail = backwards.reverse().map(trainTrailPoint);
}

function ensureTrainTrail(v){
  if(Array.isArray(v.railTrail) && v.railTrail.length >= 2) return;
  if(!v.pathTiles?.length) return;
  const seg = Math.max(0, Math.min(v.seg || 0, v.pathTiles.length - 1));
  if(seg > 0){
    v.railTrail = v.pathTiles.slice(0, seg + 1).map(trainTrailPoint);
    trimTrainTrail(v);
  } else {
    seedTrainTrail(v, v.pathTiles, v.railPathEntryFromTile ?? v.railPreviousTile ?? null);
  }
  if(v.pts?.length > seg){
    const a = v.pts[seg], b = v.pts[Math.min(seg + 1, v.pts.length - 1)];
    recordTrainTrailPoint(v, a.x + (b.x - a.x) * (v.t || 0), a.y + (b.y - a.y) * (v.t || 0), true);
  }
}

function trainOrderStopKey(b){
  if(!b || b.dead) return null;
  if(isTrainStationPiece(b) && b.stationGroupId != null) return 'station:' + b.stationGroupId;
  return (b.type || 'b') + ':' + b.x + ',' + b.y;
}

function trainDepotExitPreview(v){
  if(v?.vtype !== 'train') return null;
  if(!syncTrainOrders(v) || !v.source || !v.dest || v.source.dead || v.dest.dead) return null;
  return findRailPath(v.garageRef, v.source, null, v);
}

function trainCanLeaveDepotNow(v){
  if(!trainPresentAtDepot(v)) return { ok:false, reason:'not_in_depot' };
  const path = trainDepotExitPreview(v);
  if(!path?.tiles?.length) return { ok:false, reason:'no_path' };
  const firstTile = path.tiles[0];
  const firstBlock = railBlocks?.blockByTile?.[firstTile] ?? -1;
  if(firstBlock >= 0 && (railBlockOccupancy?.[firstBlock] ?? 0) > 0)
    return { ok:false, reason:'occupied', path, firstTile, firstBlock };
  return { ok:true, path, firstTile, firstBlock };
}

function roadCanLeaveDepotNow(v){
  if(!v || v.vtype === 'train') return { ok:false, reason:'not_road_vehicle' };
  if(!vehiclePresentAtDepot(v)) return { ok:false, reason:'not_in_depot' };
  if(!v.source || !v.dest || v.source.dead || v.dest.dead || !vehicleCanServeRoute(v))
    return { ok:false, reason:'route_missing' };
  const path = findRoadPath(v.garageRef, v.source);
  if(!path?.length) return { ok:false, reason:'no_path' };
  return { ok:true, path };
}

function setVehicleDepotDeparture(v, armed){
  if(v?.vtype === 'train') return setTrainDepotDeparture(v, armed);
  if(!v) return { ok:false, reason:'no_vehicle' };
  if(!vehiclePresentAtDepot(v)) return { ok:false, reason:'not_in_depot' };
  if(!armed){
    resetVehicleDepotDeparture(v);
    return { ok:true, armed:false };
  }
  const dep = roadCanLeaveDepotNow(v);
  if(!dep.ok) return dep;
  v.depotDepartureArmed = true;
  return { ok:true, armed:true, waiting:false, path:dep.path };
}

function vehicleDepotFlagState(v){
  if(v?.vtype === 'train') return trainDepotFlagState(v);
  if(!vehiclePresentAtDepot(v) || !v.source || !v.dest || v.source.dead || v.dest.dead) return null;
  const armed = vehicleDepotDepartureArmed(v);
  const dep = armed ? roadCanLeaveDepotNow(v) : null;
  return {
    armed,
    canLeaveNow: armed ? !!dep?.ok : false,
    reason: armed ? (dep?.reason || null) : null,
  };
}

function setTrainDepotDeparture(v, armed){
  if(v?.vtype !== 'train') return { ok:false, reason:'not_train' };
  if(!trainPresentAtDepot(v)) return { ok:false, reason:'not_in_depot' };
  if(!armed){
    v.depotDepartureArmed = false;
    return { ok:true, armed:false };
  }
  if((v.orders?.length || 0) < 2 || !syncTrainOrders(v) || !vehicleCanServeRoute(v))
    return { ok:false, reason:'route_missing' };
  const dep = trainCanLeaveDepotNow(v);
  if(dep.reason === 'no_path') return dep;
  v.depotDepartureArmed = true;
  return { ok:true, armed:true, waiting:!dep.ok, path:dep.path, firstTile:dep.firstTile };
}

function trainDepotFlagState(v){
  if(!trainPresentAtDepot(v) || (v.orders?.length || 0) < 2) return null;
  const armed = trainDepotDepartureArmed(v);
  const dep = armed ? trainCanLeaveDepotNow(v) : null;
  return {
    armed,
    canLeaveNow: armed ? !!dep?.ok : false,
    reason: armed ? (dep?.reason || null) : null,
  };
}

function rememberTrainArrivalDirection(v){
  if(!v?.pathTiles?.length) return;
  const last = v.pathTiles.length - 1;
  v.railContinueTile = v.pathTiles[last] ?? null;
  v.railPreviousTile = last > 0 ? (v.pathTiles[last - 1] ?? null) : null;
}

function holdTrainAtArrival(v){
  const tile = v.railContinueTile;
  if(tile == null){
    v.pts = [];
    v.pathTiles = [];
    return;
  }
  v.pts = [{ x:(tile % N) * TILE + TILE / 2, y:((tile / N) | 0) * TILE + TILE / 2 }];
  v.pathTiles = [tile];
  v.seg = 0;
  v.t = 0;
}

function trainStopDurationFor(building){
  return isTrainStationPiece(building) ? TRAIN_STATION_STOP_TIME : TRAIN_DWELL_TIME;
}

function trainNextScheduledStop(v){
  if(v?.vtype !== 'train' || !Array.isArray(v.orders) || v.orders.length < 2) return null;
  if(v.state === 'to_source') return v.dest;
  return v.dest;
}

function trainEarnPassengerRevenue(v, numPassengers, departStop, arrivalStop){
  if(numPassengers <= 0 || !departStop || !arrivalStop) return;
  const dx = Math.abs((arrivalStop.x + (arrivalStop.w||1)/2) - (departStop.x + (departStop.w||1)/2));
  const dy = Math.abs((arrivalStop.y + (arrivalStop.h||1)/2) - (departStop.y + (departStop.h||1)/2));
  const dist = Math.max(1, Math.round(dx + dy));
  const revenue = Math.round(numPassengers * dist * TRAIN_FARE_FACTOR);
  const owner = v.garageRef?.owner ?? null;
  const ownerWallet = walletOf(owner);
  earnMoney(revenue, 'vehicules', ownerWallet);
  recordVente(ownerWallet, 'veh', 'train', revenue);
  addFloat(arrivalStop.x + (arrivalStop.w-1)/2, arrivalStop.y, '+'+revenue+' $ 🚃', '#c8e040');
}

// Transaction commerciale inter-joueurs : l'acheteur paie le vendeur au tarif
// TRADE_PRICES pour jusqu'à `qty` unités de `res`. Retourne la quantité
// réellement échangée (plafonnée par les fonds de l'acheteur ; 0 si pas de prix
// ou si l'opération n'est pas inter-joueurs). Mouvements financiers identiques
// au commerce des camions (cf. updateVehicles).
function applyInterPlayerTrade(buyerOwner, sellerOwner, res, qty){
  if(qty <= 0 || buyerOwner == null || sellerOwner == null || buyerOwner === sellerOwner) return 0;
  const price = TRADE_PRICES[res] || 0;
  if(price <= 0) return 0;
  const buyer = walletOf(buyerOwner), seller = walletOf(sellerOwner);
  const maxAffordable = Math.floor(buyer.money / price);
  const take = Math.min(qty, Math.max(0, maxAffordable));
  if(take <= 0) return 0;
  const cost = take * price;
  buyer.money -= cost;
  buyer.fin.construction = (buyer.fin.construction||0) + cost; // colonne « achats »
  seller.money += cost;
  seller.fin.ventes = (seller.fin.ventes||0) + cost;
  recordVente(seller, 'res', res, cost);
  return take;
}

function trainProcessStop(v, stopB, nextStop){
  if(!v || !stopB || stopB.dead) return;

  // --- passagers ---
  const passCap = trainPassengerCapacity(v);
  if(passCap > 0){
    // Résoudre la pièce principale du groupe (passengersEntrant/passagersSortant sur train_station)
    const stationMain = (isTrainStationPiece(stopB) && stopB.stationGroupId != null)
      ? (trainStationGroupRepresentative(stopB.stationGroupId) || stopB)
      : stopB;
    // Déposer les passagers à bord → passagers sortants de cette gare + revenu
    const onBoard = v.passengersOnBoard || 0;
    if(onBoard > 0){
      const boardMain = v.passengerBoardStop
        ? (trainStationGroupRepresentative(v.passengerBoardStop.stationGroupId) || v.passengerBoardStop)
        : stationMain;
      trainEarnPassengerRevenue(v, onBoard, boardMain, stationMain);
      stationMain.passagersSortant = (stationMain.passagersSortant || 0) + onBoard;
      v.passengersOnBoard = 0;
      v.passengerBoardStop = null;
    }
    // Embarquer les passagers entrants de cette gare (si arrêt suivant existe)
    if(nextStop && isTrainStationPiece(stopB)){
      const waiting = Math.floor(stationMain.passengersEntrant || 0);
      const take = Math.min(passCap, waiting);
      if(take > 0){
        stationMain.passengersEntrant = Math.max(0, stationMain.passengersEntrant - take);
        v.passengersOnBoard = take;
        v.passengerBoardStop = stopB;
      }
    }
  }

  // Déterminer le mode pour cet arrêt (load/unload/load_unload)
  // v.orderIndex pointe toujours vers l'arrêt courant après syncTrainOrders — plus fiable que indexOf
  // (indexOf retourne toujours la 1re occurrence si un arrêt apparaît 2× dans le circuit)
  const stopIdx = (v.orderIndex != null && v.orderIndex >= 0) ? v.orderIndex : -1;
  const mode = (stopIdx >= 0 && v.orderModes?.[stopIdx]) || 'load_unload';
  const canUnload = mode === 'unload' || mode === 'load_unload';
  const canLoad = mode === 'load' || mode === 'load_unload';

  // --- fret ---
  // Pour les gares, utiliser le dépôt fusionné (collé à la gare) comme hub de fret.
  // trainStationLinkedDepot parcourt TOUTES les pièces du groupe → fonctionne quel que soit le quai.
  // Fallback pour quai isolé (stationGroupId == null) : chercher un dépôt directement adjacent.
  const linkedDepot = isTrainStationPiece(stopB) ? trainStationLinkedDepot(stopB) : null;
  const directDepot = (!linkedDepot && isTrainStationPiece(stopB))
    ? buildings.find(b => !b.dead && isStorageDepot(b) && buildingEdgeGap(stopB, b) === 0)
    : null;
  const freightHub = linkedDepot || directDepot || (isStorageHub(stopB) ? stopB : null);

  let unloadedRes = null;
  if(canUnload && v.cargo > 0 && v.res && freightHub){
    const trainOwner = v.garageRef?.owner ?? null;
    const hubOwner   = freightHub.owner ?? null;
    const interPlayer = hubOwner != null && trainOwner != null && hubOwner !== trainOwner;
    const room = Math.max(0, capOf(freightHub, v.res) - (freightHub.storage[v.res]||0));
    let deposit = Math.min(v.cargo, room);
    // Commerce inter-joueurs : le propriétaire du hub achète la marchandise livrée.
    if(interPlayer) deposit = applyInterPlayerTrade(hubOwner, trainOwner, v.res, deposit);
    if(deposit > 0){
      freightHub.storage[v.res] = (freightHub.storage[v.res]||0) + deposit;
      unloadedRes = v.res;
      if(!interPlayer){
        // Revenu de fret (même propriétaire) : différé à mi-temps d'arrêt (voir updateTrainVehicle)
        const loadB = v.cargoLoadStop;
        if(loadB && loadB !== stopB){
          const cx = stopB.x + (stopB.w||1)/2, cy = stopB.y + (stopB.h||1)/2;
          const lx = loadB.x + (loadB.w||1)/2,  ly = loadB.y + (loadB.h||1)/2;
          const dist = Math.max(1, Math.round(Math.abs(cx - lx) + Math.abs(cy - ly)));
          const revenue = Math.round(deposit * (TRADE_PRICES[v.res] || 1) * dist * TRAIN_FREIGHT_FACTOR);
          if(revenue > 0)
            v.pendingFreightRevenue = (v.pendingFreightRevenue || 0) + revenue;
        }
      }
    }
    v.cargo -= deposit;
    if(v.cargo <= 0){ v.cargo = 0; v.res = null; v.cargoLoadStop = null; }
    else if(deposit > 0){ v.cargoLoadStop = stopB; } // déchargement partiel : le reste repart de cette gare
  }
  if(!nextStop || !canLoad || !freightHub) return;
  let bestRes = null, bestAmt = 0;
  for(const r of trainAllowedResources(v)){
    if(r === unloadedRes) continue;
    if(v.cargo > 0 && v.res !== r) continue;
    if(freightHub.trainAllow?.[r] === false) continue;
    const totalCap = trainWagonCapacityForRes(v, r);
    if(totalCap <= 0) continue;
    const alreadyLoaded = v.res === r ? v.cargo : 0;
    const available = totalCap - alreadyLoaded;
    if(available <= 0) continue;
    const inStock = freightHub.storage?.[r] || 0;
    const amt = Math.min(available, inStock);
    if(amt > bestAmt){ bestAmt = amt; bestRes = r; }
  }
  if(bestRes && bestAmt > 0){
    const trainOwner = v.garageRef?.owner ?? null;
    const hubOwner   = freightHub.owner ?? null;
    const interPlayer = hubOwner != null && trainOwner != null && hubOwner !== trainOwner;
    // Commerce inter-joueurs : le propriétaire du train achète la ressource chargée.
    const take = interPlayer ? applyInterPlayerTrade(trainOwner, hubOwner, bestRes, bestAmt) : bestAmt;
    if(take > 0){
      freightHub.storage[bestRes] -= take;
      // Mémoriser l'origine du chargement (seulement si le train était vide avant)
      if(v.cargo === 0 || v.res !== bestRes) v.cargoLoadStop = stopB;
      v.cargo = (v.res === bestRes ? v.cargo : 0) + take;
      v.res = bestRes;
    }
  }
}

function trainNextMoveState(v){
  if(!v?.pathTiles || v.seg >= v.pathTiles.length - 1) return { blocked:false };
  const cur = v.pathTiles[v.seg], next = v.pathTiles[v.seg + 1];
  // Garde-fou : si le rail a disparu sous la tuile suivante (sauvegarde ancienne,
  // edit de save, ou tout autre cas), on bloque et on signale le problème.
  if(!rail[next]) return { blocked:true, missingRail:true };
  const cx = cur % N, cy = (cur / N) | 0;
  const nx = next % N, ny = (next / N) | 0;
  const def = railDirDef(nx - cx, ny - cy);
  if(!def) return { blocked:true, missingRail:true };
  const curBlock = railBlocks?.blockByTile?.[cur] ?? -1;
  if(curBlock >= 0 && (railBlockOccupancy?.[curBlock] ?? 0) > 1){
    // Récupération d'une ancienne sauvegarde où plusieurs trains sont déjà
    // dans le même canton : un seul repart, les autres attendent sa sortie.
    let leader = null;
    for(const other of vehicles){
      if(other.vtype !== 'train' || other.state === 'idle') continue;
      if((other.currentRailBlock ?? -1) !== curBlock) continue;
      if(!leader || (other.id ?? Infinity) < (leader.id ?? Infinity)) leader = other;
    }
    if(leader && leader !== v) return { blocked:true, holdPosition:true };
  }
  if(!railEdgePassableForPath(cx, cy, def, v)) return { blocked:true };
  return { blocked:false };
}

function trainEdgeHasFacingSignal(v){
  if(!v?.pathTiles || v.seg >= v.pathTiles.length - 1) return false;
  const cur = v.pathTiles[v.seg], next = v.pathTiles[v.seg + 1];
  const cx = cur % N, cy = (cur / N) | 0;
  const nx = next % N, ny = (next / N) | 0;
  const def = railDirDef(nx - cx, ny - cy);
  return !!(def && railEdgeSignalState(cx, cy, def).opposite);
}

function replanTrainAtSignal(v){
  if(!v?.pathTiles?.length || v.t > 1e-6) return false;
  const curTile = v.pathTiles[v.seg] ?? -1;
  if(curTile < 0) return false;
  const targetB = v.state === 'returning' ? v.garageRef : (v.state === 'to_source' ? v.source : v.dest);
  if(!targetB || targetB.dead) return false;
  const previousTile = v.seg > 0
    ? (v.pathTiles[v.seg - 1] ?? null)
    : (v.railDecisionPreviousTile ?? null);
  // Recalcul depuis la position actuelle en explorant les branches disponibles.
  // Un demi-tour est interdit : previousTile bloque le retour en arrière.
  // Si aucune branche valide n'existe (signal rouge sur toutes les sorties),
  // le train attend sur place jusqu'au dégagement du canton.
  const path = findRailPathFromDecision(v, targetB, curTile, previousTile);
  if(!path || path.tiles.length < 2) return false;
  v.pts = path.pts;
  v.pathTiles = path.tiles;
  v.seg = 0;
  v.t = 0;
  v.railPlannedJunctionTile = curTile;
  v.railDecisionPreviousTile = previousTile;
  v.railPathEntryFromTile = previousTile;
  v.railPredecidedJunctionTile = -1;
  seedTrainTrail(v, path.tiles, previousTile);
  return true;
}

function advanceRailVehicle(v, move){
  ensureTrainTrail(v);
  while(move > 0 && v.seg < v.pts.length - 1){
    const decisionTile = v.pathTiles[v.seg] ?? -1;
    // Trancher l'aiguillage en aval AVANT d'amorcer la courbe vers lui, pour que
    // la locomotive vise directement la bonne voie (rendu fluide, sans à-coup).
    if(v.t <= 1e-6) predecideTrainJunction(v);
    const atJunction = trainAtRailJunction(v);
    const selectedBranchGreen = !atJunction || railPathNextSignalAllows(v.pathTiles.slice(v.seg));
    if(v.t <= 1e-6 && (
      trainEdgeHasFacingSignal(v)
      || (atJunction && (v.railPlannedJunctionTile !== decisionTile || !selectedBranchGreen))
    ))
      replanTrainAtSignal(v);
    const a = v.pts[v.seg], b = v.pts[v.seg + 1];
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const state = trainNextMoveState(v);
    if(state.blocked){
      if(state.holdPosition) break;
      const tStop = Math.max(0, 1 - TRAIN_SIGNAL_STOP_GAP / d);
      if(v.t < tStop - 1e-6) v.t = Math.min(tStop, v.t + move / d);
      break;
    }
    const desiredT = Math.min(1, v.t + move / d);
    const used = (desiredT - v.t) * d;
    v.t = desiredT;
    move -= used;
    if(v.t < 1 - 1e-6) break;
    recordTrainTrailPoint(v, b.x, b.y, true);
    v.seg++;
    v.t = 0;
    v.railPlannedJunctionTile = -1;
    v.railDecisionPreviousTile = null;
    v.railPredecidedJunctionTile = -1;
    const tile = v.pathTiles[v.seg] ?? -1;
    // Péage rails : compter chaque tuile empruntée appartenant à un autre joueur.
    if(tile >= 0 && railOwner){
      const ro = railOwner[tile];
      const mine = v.garageRef?.owner ?? null;
      if(ro >= 0 && ro !== mine){
        if(!v.railTollOwed) v.railTollOwed = {};
        v.railTollOwed[ro] = (v.railTollOwed[ro] || 0) + 1;
      }
    }
    const previousBlock = v.currentRailBlock ?? -1;
    const nextBlock = tile >= 0 ? (railBlocks?.blockByTile?.[tile] ?? -1) : -1;
    if(nextBlock !== previousBlock && railBlockOccupancy){
      if(previousBlock >= 0) railBlockOccupancy[previousBlock] = Math.max(0, railBlockOccupancy[previousBlock] - 1);
      if(nextBlock >= 0) railBlockOccupancy[nextBlock]++;
    }
    v.currentRailBlock = nextBlock;
  }
  if(v.seg < v.pts.length - 1){
    const a = v.pts[v.seg], b = v.pts[v.seg + 1];
    recordTrainTrailPoint(v, a.x + (b.x - a.x) * v.t, a.y + (b.y - a.y) * v.t);
  }
}

// Fumée de démarrage : durée d'émission et cadence (secondes de jeu).
const TRAIN_SMOKE_DURATION = 1.6;
const TRAIN_SMOKE_EMIT_INTERVAL = 0.06;
// Arme une bouffée de fumée si la locomotive est actuellement visible à l'écran.
function startTrainSmoke(v){
  if(!isTrainLocoVisible(v)) return;
  v.smokeTimer = TRAIN_SMOKE_DURATION;
  v.smokeEmitAcc = 0;
}

function updateTrainVehicle(v, dt){
  // Émission de fumée pendant le démarrage (purement visuel).
  if(v.smokeTimer > 0){
    v.smokeTimer -= dt;
    v.smokeEmitAcc = (v.smokeEmitAcc || 0) + dt;
    while(v.smokeEmitAcc >= TRAIN_SMOKE_EMIT_INTERVAL){
      v.smokeEmitAcc -= TRAIN_SMOKE_EMIT_INTERVAL;
      emitTrainSmoke(v);
    }
  }
  if(v.orders?.length && !syncTrainOrders(v)){
    v.state = 'idle';
    v.pts = [];
    v.pathTiles = [];
    v.currentBuilding = v.garageRef;
    resetTrainDepotDeparture(v);
    return;
  }
  if(v.state !== 'returning' && (!v.source || !v.dest || v.source.dead || v.dest.dead)){
    v.state = 'idle';
    v.pts = [];
    v.pathTiles = [];
    v.currentBuilding = v.garageRef;
    resetTrainDepotDeparture(v);
    return;
  }
  if(v.waitTimer > 0){
    v.waitTimer -= dt;
    // Afficher le gain fret à mi-temps d'arrêt
    if(v.pendingFreightRevenue > 0 && v.freightRevenueFireAt != null && v.waitTimer <= v.freightRevenueFireAt){
      const freightWallet = walletOf(v.garageRef?.owner ?? null);
      earnMoney(v.pendingFreightRevenue, 'vehicules', freightWallet);
      recordVente(freightWallet, 'veh', 'train', v.pendingFreightRevenue);
      const lp = v.pts?.[v.pts.length - 1];
      const fx = lp ? lp.x / TILE - 0.5 : (v.currentBuilding?.x ?? 0);
      const fy = lp ? lp.y / TILE - 1.5 : (v.currentBuilding?.y ?? 0);
      addFloat(fx, fy, '+'+v.pendingFreightRevenue+' $', '#35ff64');
      v.pendingFreightRevenue = 0;
      v.freightRevenueFireAt = null;
    }
    // Son de locomotive ~1 s avant le départ, depuis une gare visible (pas le
    // dépôt) et au zoom suffisant. Drapeau anti-répétition par arrêt.
    if(!v.departSoundPlayed && v.waitTimer <= 1 && isTrainStationPiece(v.currentBuilding)){
      const b = v.currentBuilding;
      const cx = b.x + (b.w || 1) / 2, cy = b.y + (b.h || 1) / 2;
      if(isMapSoundAudible(cx, cy)) playSound('trainDepart');
      v.departSoundPlayed = true;
    }
    if(v.waitTimer > 0) return;
    // Le train repart : annuler tout gain en attente non encore affiché
    v.pendingFreightRevenue = 0;
    v.freightRevenueFireAt = null;
    const fromB = v.currentBuilding || v.garageRef;
    const toB = v.state === 'returning' ? v.garageRef : (v.state === 'to_source' ? v.source : v.dest);
    const continueTile = v.railContinueTile ?? null;
    const previousTile = v.railPreviousTile ?? null;
    if(!prepareRailTrip(v, fromB, toB, continueTile, previousTile)){
      v.waitTimer = 5;
      return;
    }
    // Bouffée de fumée au démarrage depuis une gare visible (pas le dépôt).
    if(isTrainStationPiece(fromB)){
      const cx = fromB.x + (fromB.w || 1) / 2, cy = fromB.y + (fromB.h || 1) / 2;
      if(isWorldTileVisible(cx, cy)){ v.smokeTimer = TRAIN_SMOKE_DURATION; v.smokeEmitAcc = 0; }
    }
    v.railContinueTile = null;
    v.railPreviousTile = null;
    v.currentBuilding = null;
  }
  if(!v.pts?.length || !v.pathTiles?.length){
    v.waitTimer = 5;
    return;
  }
  // Garde-fou rail manquant : si le prochain segment n'a plus de rail
  // (rail détruit par un moyen détournant le veto), on temporise avant
  // de renvoyer le train au dépôt pour éviter qu'il ne reste figé.
  const pre = trainNextMoveState(v);
  if(pre.missingRail){
    v.missingRailTimer = (v.missingRailTimer || 0) + dt;
    if(v.missingRailTimer >= 10 && v.state !== 'returning'){
      toast('🚂 '+v.name+' : voie interrompue, retour au dépôt','err', eventTargetForVehicle(v));
      v.missingRailTimer = 0;
      returnToGarage(v);
    }
    return;
  }
  v.missingRailTimer = 0;
  // Watchdog anti-deadlock : on suit la progression continue (seg + t).
  // Si elle n'a pas bougé depuis trop longtemps, on renvoie au dépôt.
  const progressBefore = v.seg + v.t;
  advanceRailVehicle(v, VEHICLE_TYPES[v.vtype].speed * (v.engineMult || 1) * TILE * dt);
  const progressAfter = v.seg + v.t;
  if(Math.abs(progressAfter - progressBefore) > 1e-6){
    // Reprise de mouvement : si le train était arrêté un instant (feu rouge,
    // attente d'un canton…), il « repart » → bouffée de fumée si la loco est visible.
    if((v.stoppedTime || 0) >= 0.3 && v.smokeTimer <= 0) startTrainSmoke(v);
    v.stoppedTime = 0;
    v.signalWaitTime = 0;
  } else if(v.state !== 'returning' && trainEdgeHasFacingSignal(v)){
    // Arrêt normal derrière un feu rouge : le canton suivant (p.ex. une gare de
    // destination surchargée) est occupé. Comportement ferroviaire attendu : le
    // train patiente au feu jusqu'au dégagement, il ne rebrousse PAS chemin vers
    // le dépôt (= sa gare de départ). On n'arme donc pas le watchdog ici.
    v.stoppedTime = (v.stoppedTime || 0) + dt;
    v.signalWaitTime = 0;
  } else if(v.state !== 'returning'){
    v.stoppedTime = (v.stoppedTime || 0) + dt;
    v.signalWaitTime = (v.signalWaitTime || 0) + dt;
    const sw = v.signalWaitTime;
    if(sw >= 60){
      toast('🚂 '+v.name+' bloqué trop longtemps, mis en attente','err', eventTargetForVehicle(v));
      v.state = 'idle';
      v.pts = [];
      v.pathTiles = [];
      v.currentBuilding = v.garageRef;
      v.signalWaitTime = 0;
      resetTrainDepotDeparture(v);
      return;
    }
    if(sw >= 30 && v.state !== 'returning'){
      toast('🚂 '+v.name+' bloqué, tentative de retour au dépôt','err', eventTargetForVehicle(v));
      v.signalWaitTime = 30.001; // éviter de re-déclencher returnToGarage chaque frame
      returnToGarage(v);
      return;
    }
  }
  if(v.seg < v.pts.length - 1) return;
  if(v.state === 'returning'){
    v.state = 'idle';
    v.pts = [];
    v.pathTiles = [];
    v.currentBuilding = v.garageRef;
    v.atDepot = true; // arrivé physiquement au dépôt
    v.signalWaitTime = 0;
    v.missingRailTimer = 0;
    resetTrainDepotDeparture(v);
    return;
  }
  if(v.state === 'to_source'){
    rememberTrainArrivalDirection(v);
    v.currentBuilding = v.source;
    trainProcessStop(v, v.source, v.dest);
    v.state = 'to_dest';
    v.waitTimer = trainStopDurationFor(v.source);
    v.freightRevenueFireAt = v.waitTimer / 2;
    v.departSoundPlayed = false;
    holdTrainAtArrival(v);
    return;
  }
  rememberTrainArrivalDirection(v);
  v.currentBuilding = v.dest;
  if(v.orders?.length >= 2){
    v.orderIndex = (v.orderIndex + 1) % v.orders.length;
    syncTrainOrders(v);
    trainProcessStop(v, v.source, v.dest);
    v.state = 'to_dest';
  } else {
    v.state = 'to_source';
  }
  v.waitTimer = trainStopDurationFor(v.currentBuilding);
  v.freightRevenueFireAt = v.waitTimer / 2;
  v.departSoundPlayed = false;
  holdTrainAtArrival(v);
}

// ---------- logistique (véhicules persistants) ----------
function vehicleIdSeed(){
  return MP.connected && MP.myId != null ? MP.myId * 100000 + nextVehicleId : nextVehicleId;
}

function createPersistentVehicle(vtype, garage, id=null){
  if(!VEHICLE_TYPES[vtype] || !garage || garage.dead || !BUILD[garage.type]?.transportDepot) return null;
  const v = {
    id: id ?? vehicleIdSeed(),
    vtype,
    garageRef: garage,
    source: null, dest: null,
    state: 'idle',
    cargo: 0, res: null,
    pts: [], seg: 0, t: 0,
    pathTiles: [],
    waitTimer: 0,
    currentBuilding: garage,
    currentRailBlock: -1,
    railContinueTile: null,
    railPreviousTile: null,
    railTrail: vtype === 'train' ? [] : null,
    wagons: vtype === 'train' ? [] : null,
    orders: vtype === 'train' ? [] : null,
    orderIndex: 0,
    depotDepartureArmed: false,
    atDepot: true, // vrai uniquement quand le train est physiquement au dépôt
    maintenanceDaysPaid: 0,
    boughtAtGtime: gtime,
  };
  const numericId = Number(v.id);
  if(Number.isFinite(numericId)) nextVehicleId = Math.max(nextVehicleId, numericId + 1);
  else nextVehicleId++;
  vehicles.push(v);
  garage.vehicles = garage.vehicles || [];
  garage.vehicles.push(v);
  return v;
}

function syncTrainOrders(v){
  if(v?.vtype !== 'train') return false;
  const routeOwner = v.garageRef?.owner ?? MP.myId ?? null;
  const orders = [];
  for(const b of (v.orders || [])){
    if(!b || b.dead) continue;
    if(!vehicleRouteEndpointOk(b, 'train', routeOwner)) continue;
    const key = trainOrderStopKey(b);
    if(!key) continue;
    const prev = orders.length ? orders[orders.length - 1] : null;
    if(prev && trainOrderStopKey(prev) === key) continue;
    orders.push(b);
  }
  while(orders.length > 1 && trainOrderStopKey(orders[0]) === trainOrderStopKey(orders[orders.length - 1]))
    orders.pop();
  v.orders = orders;
  // Nettoyer les modes pour que le nombre correspond au nombre d'ordres
  if(v.orderModes && v.orderModes.length > orders.length){
    v.orderModes.splice(orders.length);
  }
  if(orders.length < 2){
    v.source = orders[0] || null;
    v.dest = null;
    v.orderIndex = 0;
    return false;
  }
  v.orderIndex = ((v.orderIndex || 0) % orders.length + orders.length) % orders.length;
  v.source = orders[v.orderIndex] || null;
  v.dest = orders[(v.orderIndex + 1) % orders.length] || null;
  return !!(v.source && v.dest);
}

function trainStopLabel(b){
  if(!b || b.dead) return '—';
  if(isTrainStationPiece(b)) return b.name || 'Gare';
  return b.name || BUILD[b.type]?.n || '—';
}

function removePersistentVehicle(v){
  if(!v) return false;
  const i = vehicles.indexOf(v);
  if(i >= 0) vehicles.splice(i, 1);
  const g = v.garageRef;
  if(g) g.vehicles = (g.vehicles||[]).filter(vv=>vv!==v);
  if(vehicleRouteMode && vehicleRouteMode.vehicle===v) vehicleRouteMode = null;
  if(selectedVehicle === v) selectedVehicle = null;
  if(focusVehicle === v){ focusVehicle = null; camTracking = false; }
  return i >= 0;
}

// Un véhicule m'appartient-il ? (en solo, tout est à moi ; en multi, filtré par owner)
function isMyVehicle(v){
  return !MP.connected || !v?.garageRef?.owner || v.garageRef.owner === MP.myId;
}

// Position monde (px) d'un véhicule pour le focus caméra.
function vehicleWorldPos(v){
  if(!v) return null;
  const rs = typeof mpVehicleRenderState === 'function' ? mpVehicleRenderState(v) : v;
  const pts = rs.pts;
  if(pts && pts.length >= 2){
    const seg = Math.min(rs.seg||0, pts.length-1);
    const a = pts[seg], b = pts[Math.min(seg+1, pts.length-1)];
    return { x: a.x + (b.x-a.x)*(rs.t||0), y: a.y + (b.y-a.y)*(rs.t||0) };
  }
  if(pts && pts.length === 1) return { x: pts[0].x, y: pts[0].y };
  const b = rs.currentBuilding || v.garageRef;
  if(b && !b.dead) return { x: (b.x + (b.w||1)/2)*TILE, y: (b.y + (b.h||1)/2)*TILE };
  return null;
}

// Sélectionne un véhicule pour l'affichage du trajet + focus caméra (sans panneau détail).
function focusOnVehicle(v){
  if(!v) return;
  focusVehicle = v;
  camTracking = true;
  const pos = vehicleWorldPos(v);
  if(pos) centerOn(pos.x, pos.y);
  if(typeof renderVehicleListPanel === 'function') renderVehicleListPanel();
}

function vehicleRouteEndpointOk(b, vtype_override, ownerOverride){
  if(!b || b.dead) return false;
  const routeOwner = ownerOverride ?? vehicleRouteMode?.vehicle?.garageRef?.owner ?? MP.myId ?? null;
  const vt = vtype_override || vehicleRouteMode?.vehicle?.vtype;
  // Les trains peuvent utiliser les gares d'un autre joueur comme arrêt
  // (commerce inter-joueurs). Le train_depot reste réservé à son propriétaire.
  if(vt === 'train' && isTrainStationPiece(b) && b.owner != null && b.owner !== routeOwner){
    return true;
  }
  if(!canUseBuilding(b, routeOwner)) return false;
  if(vt === 'bus') return b?.type === 'bus_stop' || b?.type === 'train_station' || b?.type === 'train_platform';
  if(vt === 'train') return b?.type === 'train_depot' || isTrainStationPiece(b);
  return isStorageHub(b);
}

function buildingChebyshevDistance(a, b){
  const ac = centerOfBuilding(a), bc = centerOfBuilding(b);
  return Math.max(Math.abs(ac.x - bc.x), Math.abs(ac.y - bc.y));
}

function vehicleCanServeRoute(v, res=null){
  if(v?.vtype === 'train' && Array.isArray(v.orders)){
    if(v.orders.length < 2) return false;
    if(!syncTrainOrders(v)) return false;
    const routeOwner = v.garageRef?.owner ?? MP.myId ?? null;
    if(!v.orders.every(b => vehicleRouteEndpointOk(b, 'train', routeOwner))) return false;
  } else {
    if(!v?.source || !v?.dest || v.source.dead || v.dest.dead) return false;
    const routeOwner = v?.garageRef?.owner ?? MP.myId ?? null;
    if(!vehicleRouteEndpointOk(v.source, v.vtype, routeOwner) || !vehicleRouteEndpointOk(v.dest, v.vtype, routeOwner)) return false;
  }
  if(v.vtype === 'bus') return true;
  if(v.vtype === 'train'){
    const resource = res || v.res || null;
    return !resource || trainAllowedResources(v).includes(resource);
  }
  const resource = res || VEHICLE_TYPES[v.vtype]?.resources?.[0] || null;
  if(resource === 'water' && v.source.type === 'tank')
    return buildingChebyshevDistance(v.source, v.dest) <= tankRadiusOf(v.source);
  return true;
}

// Returns adjacent road tiles, or (for buildings with no road access like train stations)
// the nearest road tile within maxRadius, so buses can route to rail-only buildings.
function roadTilesFor(b, maxRadius = 6){
  const adj = adjRoadTiles(b);
  if(adj.length) return adj;
  const cx = b.x + Math.floor((b.w||1) / 2), cy = b.y + Math.floor((b.h||1) / 2);
  for(let r = 1; r <= maxRadius; r++){
    const found = [];
    for(let dy = -r; dy <= r; dy++){
      for(let dx = -r; dx <= r; dx++){
        if(Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx, ny = cy + dy;
        if(!inMap(nx, ny)) continue;
        const ni = ny * N + nx;
        if(road[ni]) found.push(ni);
      }
    }
    if(found.length) return found;
  }
  return [];
}

function findRoadPath(fromB, toB){
  const starts = roadTilesFor(fromB);
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
      if(!roadMoveAllowed(cx, cy, x, y)) continue;
      if(road[ni] && dist[ni]<0){ dist[ni] = dist[c]+1; prev[ni] = c; q.push(ni); }
    }
  }
  let bestTile = -1, bestDist = Infinity;
  for(const t of roadTilesFor(toB))
    if(dist[t]>=0 && dist[t]<bestDist){ bestDist = dist[t]; bestTile = t; }
  if(bestTile < 0) return null;
  const path = [];
  let t = bestTile;
  while(t !== -1){ path.push(t); t = prev[t]; }
  path.reverse();
  const C = idx => ({ x:(idx%N)*TILE+TILE/2, y:((idx/N)|0)*TILE+TILE/2 });
  return path.map(C);
}

function findNearbyTrainStation(busStop){
  return buildings.find(b => !b.dead && b.type === 'train_station'
    && buildingChebyshevDistance(busStop, b) <= BUS_STOP_RADIUS);
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
    const busWallet = walletOf(busOwner);
    earnMoney(busShare,   'vehicules', busWallet);
    recordVente(busWallet, 'veh', 'bus', busShare);
    if(otherShare > 0){
      const otherWallet = walletOf(otherOwner);
      earnMoney(otherShare, 'vehicules', otherWallet);
      recordVente(otherWallet, 'veh', 'bus', otherShare);
    }
    addFloat(arrivalStop.x + 0.5, arrivalStop.y, '+'+busShare+' $ 🚌', '#4dd9ff');
  } else {
    const dWallet = walletOf(dOwner);
    earnMoney(revenue, 'vehicules', dWallet);
    recordVente(dWallet, 'veh', 'bus', revenue);
    addFloat(arrivalStop.x + 0.5, arrivalStop.y, '+'+revenue+' $ 🚌', sameCity ? '#a0c8e8' : '#ffe9a0');
  }
}

function startVehicleRoute(v){
  if(v.vtype === 'train' && !syncTrainOrders(v)){ v.state = 'idle'; return false; }
  if(!v.source || !v.dest || v.source.dead || v.dest.dead){ v.state = 'idle'; return false; }
  if(!vehicleCanServeRoute(v)){
    if(v.vtype === 'train'){ v.orders = []; v.orderIndex = 0; }
    v.source = null; v.dest = null; v.state = 'idle'; v.pts = []; v.vizRoute = null;
    return false;
  }
  if(v.vtype === 'train'){
    const viz = [];
    for(let i = 0; i < v.orders.length; i++){
      const from = v.orders[i], to = v.orders[(i + 1) % v.orders.length];
      const leg = findRailPath(from, to);
      if(leg?.pts?.length) viz.push(...leg.pts);
    }
    v.vizRoute = { fwd: viz, bwd: [] };
    if(!prepareRailTrip(v, v.garageRef, v.source)){
      v.waitTimer = 0;
      v.currentBuilding = v.garageRef;
      v.state = 'idle';
      return false;
    }
  v.state = 'to_source';
  v.waitTimer = 0;
  v.currentBuilding = null;
  v.atDepot = false; // quitte physiquement le dépôt
  v.cargo = 0;
    v.res = null;
    v.signalWaitTime = 0;
    v.missingRailTimer = 0;
    resetTrainDepotDeparture(v);
    return true;
  }
  // Cache la route complète pour la visualisation (style Transport Tycoon)
  const fwd = findRoadPath(v.source, v.dest);
  const bwd = findRoadPath(v.dest, v.source);
  v.vizRoute = { fwd: fwd || [], bwd: bwd || [] };
  const pts = findRoadPath(v.garageRef, v.source);
  if(!pts){ v.waitTimer = 0; v.currentBuilding = v.garageRef; return false; }
  v.state = 'to_source';
  v.waitTimer = 0;
  v.pts = pts; v.seg = 0; v.t = 0;
  v.cargo = 0; v.res = null;
  v.currentBuilding = null;
  v.atDepot = false;
  resetVehicleDepotDeparture(v);
  return true;
}

function returnToGarage(v){
  if(v.state === 'idle' || v.state === 'returning') return;
  if(v.vtype === 'train'){
    const startTile = trainTileIndex(v);
    const from = v.currentBuilding || v.garageRef;
    v.cargo = 0; v.res = null;

    // skipFirstSignalCheck=true : le train est en plein milieu du réseau, pas à
    // un point de décision signal ; les signaux sont respectés lors du mouvement réel.
    const ok = startTile >= 0 ? prepareRailTrip(v, from, v.garageRef, startTile, null, true) : prepareRailTrip(v, from, v.garageRef);
    if(ok){
      v.state = 'returning';
      v.currentBuilding = null;
      v.atDepot = false;
      v.signalWaitTime = 0;
      v.missingRailTimer = 0;
      resetTrainDepotDeparture(v);
    } else {
      v.state = 'idle';
      v.pts = [];
      v.pathTiles = [];
      v.currentBuilding = v.garageRef;
      // Pas de chemin vers le dépôt : on garde atDepot = false car le train
      // est physiquement encore sur le réseau. Le watchdog ou une action du
      // joueur (réparation du rail) pourra le débloquer.
      resetTrainDepotDeparture(v);
    }
    return;
  }
  const from = v.currentBuilding || v.garageRef;
  v.source = null; v.dest = null;
  v.vizRoute = null;
  v.cargo = 0; v.res = null;
  const pts = findRoadPath(from, v.garageRef);
  if(pts){
    v.state = 'returning';
    v.pts = pts; v.seg = 0; v.t = 0;
    v.atDepot = false;
    resetVehicleDepotDeparture(v);
  } else {
    v.state = 'idle'; v.pts = [];
    v.atDepot = false;
    resetVehicleDepotDeparture(v);
  }
}

function updateVehicles(dt){
  rebuildRailBlockOccupancy();
  for(const v of vehicles){
    if(v.state === 'idle'){
      // Routes that failed before a rail or signal correction remain assigned.
      // Retry them periodically so existing trains can leave without reconfiguration.
      if(v.vtype === 'train' && v.source && v.dest && !v.source.dead && !v.dest.dead){
        if(trainPresentAtDepot(v)){
          if(trainDepotDepartureArmed(v)){
            const dep = trainCanLeaveDepotNow(v);
            if(dep.ok) startVehicleRoute(v);
          }
        } else {
          // Train idle mais physiquement hors dépôt (retour interrompu, gare
          // destination détruite en transit, etc.). On tente un retour propre
          // vers le dépôt depuis la position courante — on n'appelle surtout
          // pas startVehicleRoute qui planifierait depuis le dépôt et
          // téléporterait visuellement le train.
          v.waitTimer = Math.max(0, (v.waitTimer || 0) - dt);
          if(v.waitTimer <= 0){
            v.waitTimer = 5;
            returnToGarage(v);
          }
        }
      }
      if(v.vtype !== 'train' && v.source && v.dest && vehiclePresentAtDepot(v)){
        if(vehicleDepotDepartureArmed(v)){
          const dep = roadCanLeaveDepotNow(v);
          if(dep.ok) startVehicleRoute(v);
        }
      }
      if(v.state === 'idle') continue;
    }
    if(v.vtype === 'train'){
      updateTrainVehicle(v, dt);
      continue;
    }
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
    advanceRoadUnit(v, move);
    if(v.seg >= v.pts.length-1){
      if(v.state === 'returning'){
        v.state = 'idle'; v.pts = [];
        v.currentBuilding = v.garageRef;
        v.atDepot = true;
        resetVehicleDepotDeparture(v);
        continue;
      }
      if(v.state === 'to_source'){
        v.currentBuilding = v.source;
        if(v.vtype === 'bus'){
          // Déposer les passagers retour (arrivés à leur arrêt de quartier - retournent chez eux)
          if(v.cargo > 0){
            const sourceStation = isTrainStationPiece(v.source)
              ? (trainStationGroupRepresentative(v.source.stationGroupId) || v.source)
              : trainStationLinkedRepresentative(v.source);
            if(sourceStation){
              // Dépose à la gare : passagers entrants pour prendre un train
              sourceStation.passengersEntrantPending = (sourceStation.passengersEntrantPending || 0) + v.cargo;
            }
            busEarnRevenue(v, v.cargo, v.busRouteDistance, v.dest, v.source);
            v.cargo = 0;
          }
          // Charger les passagers aller depuis l'arrêt source
          let takeSrc = 0;
          if(isTrainStationPiece(v.source)){
            // Source = gare : prend les passagersSortant du train
            const srcMain = trainStationGroupRepresentative(v.source.stationGroupId) || v.source;
            const availSrc = Math.floor(srcMain.passagersSortant || 0);
            takeSrc = Math.min(vt.capacite, availSrc);
            srcMain.passagersSortant = Math.max(0, (srcMain.passagersSortant || 0) - takeSrc);
          } else {
            // Source = arrêt de bus : priorité passagersSortant locaux → gare proche → passagers en attente
            const nearSourceTrain = findNearbyTrainStation(v.source);
            const stopSortants = Math.floor(v.source.passagersSortant || 0);
            const trainSortants = Math.floor(nearSourceTrain?.passagersSortant || 0);
            let availableSrc, sourceFrom;
            if(stopSortants >= trainSortants && stopSortants > 0){ availableSrc = stopSortants; sourceFrom = 'stop'; }
            else if(trainSortants > 0){ availableSrc = trainSortants; sourceFrom = 'train'; }
            else { availableSrc = Math.floor(v.source.passengers || 0); sourceFrom = 'passengers'; }
            takeSrc = Math.min(vt.capacite, availableSrc);
            if(sourceFrom === 'stop') v.source.passagersSortant = Math.max(0, stopSortants - takeSrc);
            else if(sourceFrom === 'train') nearSourceTrain.passagersSortant = Math.max(0, nearSourceTrain.passagersSortant - takeSrc);
            else v.source.passengers = Math.max(0, (v.source.passengers || 0) - takeSrc);
          }
          v.cargo = takeSrc;
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
        const resourcesToTry = v.pinnedRes && vt.resources.includes(v.pinnedRes) ? [v.pinnedRes] : vt.resources;
        for(const r of resourcesToTry){
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
            recordVente(sellerWallet, 'res', res, cost);
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
          // Déposer les passagers aller à la destination
          if(v.cargo > 0){
            const destMain = isTrainStationPiece(v.dest)
              ? (trainStationGroupRepresentative(v.dest.stationGroupId) || v.dest)
              : trainStationLinkedRepresentative(v.dest);
            if(destMain){
              // Destination = gare ou arrêt fusionné : passagers en correspondance train
              destMain.passengersEntrantPending = (destMain.passengersEntrantPending || 0) + v.cargo;
            } else {
              // Destination = arrêt de bus : les voyageurs deviennent passagers entrants
              v.dest.passengersEntrant = (v.dest.passengersEntrant || 0) + v.cargo;
            }
            busEarnRevenue(v, v.cargo, v.busRouteDistance, v.source, v.dest);
            v.cargo = 0;
          }
          // Charger les passagers retour
          let take = 0;
          if(isTrainStationPiece(v.dest)){
            // Dest = gare : prend les passagersSortant
            const destMain = trainStationGroupRepresentative(v.dest.stationGroupId) || v.dest;
            const avail = Math.floor(destMain.passagersSortant || 0);
            take = Math.min(vt.capacite, avail);
            destMain.passagersSortant = Math.max(0, (destMain.passagersSortant || 0) - take);
          } else {
            // Dest = arrêt de bus : priorité passagersSortant → gare proche → passagers en attente
            const nearDestReturn = findNearbyTrainStation(v.dest);
            const stopSortants = Math.floor(v.dest.passagersSortant || 0);
            const trainSortants = Math.floor(nearDestReturn?.passagersSortant || 0);
            let available, returnFrom;
            if(stopSortants >= trainSortants && stopSortants > 0){ available = stopSortants; returnFrom = 'stop'; }
            else if(trainSortants > 0){ available = trainSortants; returnFrom = 'train'; }
            else { available = Math.floor(v.dest.passengers || 0); returnFrom = 'passengers'; }
            take = Math.min(vt.capacite, available);
            if(returnFrom === 'stop') v.dest.passagersSortant = Math.max(0, stopSortants - take);
            else if(returnFrom === 'train') nearDestReturn.passagersSortant = Math.max(0, nearDestReturn.passagersSortant - take);
            else v.dest.passengers = Math.max(0, (v.dest.passengers || 0) - take);
          }
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
