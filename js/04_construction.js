// ---------- construction ----------

// état multijoueur — déclaré ici car utilisé dans canPlace, clickAt et drawBuilding
const MP = {
  ws: null, myId: null, myColor: '#ffffff', myName: 'Moi',
  role: null, isAdmin: false, players: [], cursors: {}, chat: [], connected: false,
  username: null, token: null, saves: [], rooms: [],
  roomId: null, roomName: null, roomSaveName: null,
  prevOwnerId: null,   // ancien id de connexion, reçu du serveur lors de l'auth
  savedRegistry: null, // playerRegistry issu de la dernière sauvegarde chargée
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

function railPlacementMaskAt(x, y){
  if(!inMap(x, y)) return 0;
  const i = y*N + x;
  if(road[i] || bgrid[i] || terrain[i] === T.WATER) return 0;
  return rail[i] || 0;
}

const railSignalKey = (x, y, bit) => x+','+y+','+bit;

function railSignalDefAt(x, y, bit){
  return railSignals?.[railSignalKey(x, y, bit)] || null;
}

function railConnectedDefsAt(x, y){
  if(!inMap(x, y)) return [];
  const mask = rail[y*N+x] || 0;
  return RAIL_DIRS.filter(def => mask & def.bit);
}

function chooseRailSignalDef(x, y){
  const defs = railConnectedDefsAt(x, y);
  if(!defs.length) return null;
  if(defs.length === 1) return defs[0];
  const [rx, ry] = rotIdx(x, y);
  const center = iso(rx + 0.5, ry + 0.5);
  const mx = cam.x + mouse.x / cam.z;
  const my = cam.y + mouse.y / cam.z;
  const vx = mx - center[0], vy = my - center[1];
  let best = defs[0], bestScore = -Infinity;
  for(const def of defs){
    const [du, dv] = rotDir(def.dx, def.dy);
    const target = iso(du, dv);
    const score = vx * target[0] + vy * target[1];
    if(score > bestScore){
      bestScore = score;
      best = def;
    }
  }
  return best;
}

function sanitizeRailSignals(){
  if(!railSignals) railSignals = Object.create(null);
  for(const key of Object.keys(railSignals)){
    const sig = railSignals[key];
    if(!sig || !inMap(sig.x, sig.y)){ delete railSignals[key]; continue; }
    const mask = rail[sig.y*N+sig.x] || 0;
    const def = RAIL_DIRS.find(d => d.bit === sig.bit);
    if(!def || !(mask & sig.bit)){ delete railSignals[key]; continue; }
    const nx = sig.x + def.dx, ny = sig.y + def.dy;
    if(!inMap(nx, ny)){ delete railSignals[key]; continue; }
    const other = RAIL_DIRS[def.opposite];
    const nmask = rail[ny*N+nx] || 0;
    if(!(nmask & other.bit)) delete railSignals[key];
  }
}

function rebuildRailBlocks(){
  sanitizeRailSignals();
  const blockByTile = new Int32Array(N*N).fill(-1);
  let nextBlockId = 0;
  const edgeCut = (x, y, def)=>{
    return !!(railSignalDefAt(x, y, def.bit)
      || railSignalDefAt(x + def.dx, y + def.dy, RAIL_DIRS[def.opposite].bit));
  };
  for(let y = 0; y < N; y++) for(let x = 0; x < N; x++){
    const i = y*N+x;
    if(!rail[i] || blockByTile[i] >= 0) continue;
    const q = [i];
    blockByTile[i] = nextBlockId;
    for(let qi = 0; qi < q.length; qi++){
      const cur = q[qi], cx = cur % N, cy = (cur / N) | 0;
      for(const def of railConnectedDefsAt(cx, cy)){
        if(edgeCut(cx, cy, def)) continue;
        const nx = cx + def.dx, ny = cy + def.dy;
        if(!inMap(nx, ny)) continue;
        const ni = ny*N+nx;
        if(!rail[ni] || blockByTile[ni] >= 0) continue;
        blockByTile[ni] = nextBlockId;
        q.push(ni);
      }
    }
    nextBlockId++;
  }
  railBlocks = { blockByTile, count:nextBlockId };
}

function setRailSignal(x, y, bit, present){
  if(!railSignals) railSignals = Object.create(null);
  const key = railSignalKey(x, y, bit);
  if(present) railSignals[key] = { x, y, bit };
  else delete railSignals[key];
  rebuildRailBlocks();
}

function railApplyMaskUpdates(updates, walletDelta = 0, walletTarget = myWallet()){
  let changed = false;
  for(const update of updates){
    const { x, y, mask } = update;
    if(!inMap(x, y)) continue;
    const i = y * N + x;
    if(rail[i] === mask) continue;
    rail[i] = mask;
    changed = true;
  }
  if(changed) rebuildRailBlocks();
  if(walletDelta > 0) spendMoney(walletDelta, 'construction');
  else if(walletDelta < 0) earnMoney(-walletDelta, 'rembours', walletTarget);
  return changed;
}

function railMaskIsRightAngle(mask){
  const defs = RAIL_DIRS.filter(def => mask & def.bit);
  if(defs.length !== 2) return false;
  return defs[0].dx * defs[1].dx + defs[0].dy * defs[1].dy === 0;
}

function collectRailUpdates(path){
  if(!Array.isArray(path) || !path.length) return { updates:[], cost:0, msg:'' };
  const draft = Uint8Array.from(rail);
  const touched = new Set();
  const pathSet = new Set();
  const validTile = ({ x, y }) => inMap(x, y) && !road[y*N+x] && !bgrid[y*N+x] && terrain[y*N+x] === T.GRASS;
  const sanitized = [];
  for(const tile of path){
    if(!tile || !validTile(tile)) continue;
    const prev = sanitized[sanitized.length - 1];
    if(prev && prev.x === tile.x && prev.y === tile.y) continue;
    sanitized.push({ x:tile.x, y:tile.y });
    pathSet.add(tile.x + ',' + tile.y);
  }
  if(!sanitized.length) return { updates:[], cost:0, msg:'' };
  const endpointKeys = new Set();
  endpointKeys.add(sanitized[0].x + ',' + sanitized[0].y);
  endpointKeys.add(sanitized[sanitized.length - 1].x + ',' + sanitized[sanitized.length - 1].y);
  const connect = (ax, ay, bx, by)=>{
    const def = railDirDef(bx - ax, by - ay);
    if(!def) return;
    const other = RAIL_DIRS[def.opposite];
    const ai = ay * N + ax, bi = by * N + bx;
    draft[ai] |= def.bit;
    draft[bi] |= other.bit;
    touched.add(ai);
    touched.add(bi);
  };
  const connectEndpointToExisting = (tile, prefDx, prefDy)=>{
    const oi = tile.y * N + tile.x;
    let best = null;
    let bestScore = -Infinity;
    for(const def of RAIL_DIRS){
      const nx = tile.x + def.dx, ny = tile.y + def.dy;
      if(!inMap(nx, ny)) continue;
      const ni = ny * N + nx;
      const other = RAIL_DIRS[def.opposite];
      if(pathSet.has(nx + ',' + ny) || !draft[ni]) continue;
      const score = prefDx * def.dx + prefDy * def.dy;
      if(score <= 0 || score < bestScore) continue;
      bestScore = score;
      best = def;
    }
    if(!best) return;
    const nx = tile.x + best.dx, ny = tile.y + best.dy;
    const ni = ny * N + nx;
    const other = RAIL_DIRS[best.opposite];
    draft[oi] |= best.bit;
    draft[ni] |= other.bit;
    touched.add(ni);
  };
  for(let i = 1; i < sanitized.length; i++){
    const a = sanitized[i - 1], b = sanitized[i];
    if(Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1) continue;
    connect(a.x, a.y, b.x, b.y);
  }
  for(let si = 0; si < sanitized.length; si++){
    const tile = sanitized[si];
    const oi = tile.y * N + tile.x;
    const hadRailBefore = !!rail[oi];
    touched.add(oi);
    const isEndpoint = sanitized.length === 1 || endpointKeys.has(tile.x + ',' + tile.y);
    if(!isEndpoint) continue;
    if(sanitized.length === 1){
      for(const def of RAIL_DIRS){
        const nx = tile.x + def.dx, ny = tile.y + def.dy;
        if(!inMap(nx, ny)) continue;
        const ni = ny * N + nx;
        const other = RAIL_DIRS[def.opposite];
        if(!draft[ni]) continue;
        draft[oi] |= def.bit;
        draft[ni] |= other.bit;
        touched.add(ni);
      }
      continue;
    }
    if(hadRailBefore) continue;
    if(si === 0){
      const next = sanitized[1];
      connectEndpointToExisting(tile, tile.x - next.x, tile.y - next.y);
    } else if(si === sanitized.length - 1){
      const prev = sanitized[sanitized.length - 2];
      connectEndpointToExisting(tile, tile.x - prev.x, tile.y - prev.y);
    }
  }
  for(const i of touched){
    if(railMaskIsRightAngle(draft[i])) return { updates:[], cost:0, msg:'Les rails ne peuvent pas former un angle droit.' };
  }
  const updates = [];
  let cost = 0;
  for(const i of touched){
    const before = rail[i] || 0;
    const after = draft[i] || 0;
    if(before === after) continue;
    if(before === 0 && after !== 0) cost += BUILD.rail.cost || 0;
    updates.push({ x:i % N, y:(i / N) | 0, mask:after });
  }
  return { updates, cost, msg:'' };
}

function collectRailRemovalUpdates(x, y){
  if(!inMap(x, y)) return { updates:[], refund:0 };
  const i = y * N + x;
  if(!rail[i]) return { updates:[], refund:0 };
  const draft = Uint8Array.from(rail);
  const touched = new Set([i]);
  const mask = draft[i];
  draft[i] = 0;
  for(const def of RAIL_DIRS){
    if(!(mask & def.bit)) continue;
    const nx = x + def.dx, ny = y + def.dy;
    if(!inMap(nx, ny)) continue;
    const ni = ny * N + nx;
    const other = RAIL_DIRS[def.opposite];
    draft[ni] &= ~other.bit;
    touched.add(ni);
  }
  const updates = [];
  for(const idx of touched){
    if(rail[idx] === draft[idx]) continue;
    updates.push({ x:idx % N, y:(idx / N) | 0, mask:draft[idx] });
  }
  return { updates, refund:Math.floor((BUILD.rail?.cost || 0) * 0.3) };
}

function railStationAxesAt(x, y){
  if(!inMap(x, y)) return [];
  const mask = rail[y * N + x] || 0;
  const axes = [];
  for(const def of RAIL_DIRS){
    const opposite = RAIL_DIRS[def.opposite];
    if(!(mask & def.bit) || !(mask & opposite.bit)) continue;
    let dx = def.dx, dy = def.dy;
    if(dx < 0 || (dx === 0 && dy < 0)){ dx = -dx; dy = -dy; }
    const key = dx + ',' + dy;
    if(!axes.some(axis => axis.key === key)) axes.push({ dx, dy, key });
  }
  if(!axes.length){
    const defs = RAIL_DIRS.filter(def => mask & def.bit);
    if(defs.length === 1){
      let { dx, dy } = defs[0];
      if(dx < 0 || (dx === 0 && dy < 0)){ dx = -dx; dy = -dy; }
      axes.push({ dx, dy, key:dx + ',' + dy });
    }
  }
  return axes;
}

function isTrainStationPiece(b){
  return !!b && !b.dead && (b.type === 'train_station' || b.type === 'train_platform');
}

function trainStationGroupHasBuilding(groupId){
  return buildings.some(b => isTrainStationPiece(b) && b.stationGroupId === groupId && b.type === 'train_station');
}

function trainStationGroupLength(groupId, type){
  return buildings.filter(b => isTrainStationPiece(b) && b.stationGroupId === groupId && (!type || b.type === type)).length;
}

function trainStationGroupRepresentative(groupId){
  if(groupId == null) return null;
  return buildings.find(b => isTrainStationPiece(b) && b.stationGroupId === groupId && b.type === 'train_station')
    || buildings.find(b => isTrainStationPiece(b) && b.stationGroupId === groupId)
    || null;
}

function trainStationLinkedRepresentative(b){
  if(!b || b.dead) return null;
  if(isTrainStationPiece(b)) return trainStationGroupRepresentative(b.stationGroupId) || b;
  if(b.type !== 'bus_stop' && b.type !== 'depot') return null;
  let best = null;
  for(const other of buildings){
    if(!isTrainStationPiece(other)) continue;
    if(buildingEdgeGap(b, other) > 0) continue;
    const rep = trainStationGroupRepresentative(other.stationGroupId) || other;
    if(!best || (rep.stationGroupId ?? Infinity) < (best.stationGroupId ?? Infinity)) best = rep;
  }
  return best;
}

function trainStationLinkedDepot(b){
  if(!b || b.dead || b.stationGroupId == null) return null;
  const pieces = trainStationGroupPieces(b.stationGroupId);
  for(const piece of pieces){
    for(const other of buildings){
      if(!other.dead && isStorageDepot(other) && buildingEdgeGap(piece, other) === 0) return other;
    }
  }
  return null;
}

function trainStationSelectionRepresentative(b){
  return trainStationLinkedRepresentative(b) || b || null;
}

function trainStationSelectionMatches(a, b){
  const ra = trainStationSelectionRepresentative(a);
  const rb = trainStationSelectionRepresentative(b);
  return !!(ra && rb && isTrainStationPiece(ra) && isTrainStationPiece(rb) && ra.stationGroupId === rb.stationGroupId);
}

function mergeTrainStationGroups(groups, targetGroupId){
  for(const b of buildings)
    if(isTrainStationPiece(b) && groups.includes(b.stationGroupId)) b.stationGroupId = targetGroupId;
}

function tryMergeTrainStations(){
  // Construire la map groupId → pièces
  const groupMap = new Map();
  for(const b of buildings){
    if(!isTrainStationPiece(b)) continue;
    if(!groupMap.has(b.stationGroupId)) groupMap.set(b.stationGroupId, []);
    groupMap.get(b.stationGroupId).push(b);
  }
  const groups = [...groupMap.entries()];
  for(let i = 0; i < groups.length; i++){
    const [idA, piecesA] = groups[i];
    const lenA = piecesA.length;
    const axisKeyA = piecesA[0]?.stationAxis;
    if(!axisKeyA) continue;
    const [adx, ady] = axisKeyA.split(',').map(Number);
    for(let j = i + 1; j < groups.length; j++){
      const [idB, piecesB] = groups[j];
      if(piecesB.length !== lenA) continue;
      if(piecesB[0]?.stationAxis !== axisKeyA) continue;
      // Chercher une paire de pièces adjacentes perpendiculairement à l'axe
      let adjacent = false;
      outer: for(const a of piecesA){
        for(const b of piecesB){
          const vx = b.x - a.x, vy = b.y - a.y;
          if(Math.abs(vx) + Math.abs(vy) !== 1) continue;
          if(vx * adx + vy * ady === 0){ adjacent = true; break outer; }
        }
      }
      if(!adjacent) continue;
      const targetId = Math.min(idA, idB);
      mergeTrainStationGroups([idA, idB], targetId);
      assignTrainStationName(targetId);
      toast('🚉 Gares adjacentes fusionnées !', 'win');
      return true;
    }
  }
  return false;
}

function trainStationPlacementInfo(x, y, owner = MP.myId){
  if(!inMap(x, y)) return { ok:false, msg:'Hors de la carte' };
  const i = y * N + x;
  if(bgrid[i] || road[i]) return { ok:false, msg:'Case occupée' };
  const platform = !!rail[i];
  const candidates = platform
    ? railStationAxesAt(x, y)
    : RAIL_DIRS.flatMap(def => railStationAxesAt(x + def.dx, y + def.dy));
  const uniqueAxes = [];
  for(const axis of candidates) if(!uniqueAxes.some(a => a.key === axis.key)) uniqueAxes.push(axis);
  if(!uniqueAxes.length)
    return { ok:false, msg:platform ? 'Le quai doit être placé sur une voie droite.' : 'La gare doit être adjacente à des rails.' };
  if(!platform && terrain[i] !== T.GRASS)
    return { ok:false, msg:'La gare se construit sur l\'herbe, à côté des rails.' };

  for(const axis of uniqueAxes){
    const connectors = buildings.filter(b => {
      if(!isTrainStationPiece(b) || b.stationAxis !== axis.key) return false;
      if(owner != null && b.owner != null && b.owner !== owner) return false;
      const ddx = b.x - x, ddy = b.y - y;
      const distance = Math.max(Math.abs(ddx), Math.abs(ddy));
      if(distance !== 1) return false;
      const longitudinal = ddx * axis.dy - ddy * axis.dx === 0;
      const perpendicular = ddx * axis.dx + ddy * axis.dy === 0;
      if(b.type === 'train_station')
        return platform ? perpendicular : longitudinal;
      if(!platform) return false;
      if(longitudinal) return true;
      return perpendicular && trainStationGroupHasBuilding(b.stationGroupId);
    });
    if(!platform || connectors.length) return { ok:true, platform, axis, connectors };
  }
  return { ok:false, msg:'Le premier quai doit toucher la gare. Les quais suivants doivent être raccordés à un quai existant.' };
}

function placeTrainStationTile(x, y, owner = MP.myId){
  const info = trainStationPlacementInfo(x, y, owner);
  if(!info.ok) return null;
  let groups = [...new Set(info.connectors.map(b => b.stationGroupId).filter(id => id != null))];
  let groupId = null;
  let mergeAfterBuild = null;
  if(info.platform){
    const longitudinalGroups = [...new Set(info.connectors.filter(piece => {
      const ddx = piece.x - x, ddy = piece.y - y;
      return ddx * info.axis.dy - ddy * info.axis.dx === 0;
    }).map(piece => piece.stationGroupId).filter(id => id != null))];
    const perpendicularGroups = [...new Set(info.connectors.filter(piece => {
      const ddx = piece.x - x, ddy = piece.y - y;
      return ddx * info.axis.dx + ddy * info.axis.dy === 0;
    }).map(piece => piece.stationGroupId).filter(id => id != null))];

    if(longitudinalGroups.length){
      groupId = Math.min(...longitudinalGroups);
      groups = longitudinalGroups;
      const mergeTargets = perpendicularGroups.filter(id => id !== groupId && trainStationGroupHasBuilding(id));
      if(mergeTargets.length) mergeAfterBuild = Math.min(...mergeTargets);
    } else if(perpendicularGroups.length){
      const mergeTargets = perpendicularGroups.filter(id => trainStationGroupHasBuilding(id));
      if(mergeTargets.length) mergeAfterBuild = Math.min(...mergeTargets);
    }
  } else if(groups.length){
    groupId = Math.min(...groups);
  }
  if(groupId == null) groupId = nextTrainStationId++;
  if(groups.length > 1) mergeTrainStationGroups(groups, groupId);
  const b = newBuilding(info.platform ? 'train_platform' : 'train_station', x, y);
  b.owner = owner;
  b.stationGroupId = groupId;
  b.stationAxis = info.axis.key;
  buildings.push(b);
  bgrid[y * N + x] = b;
  if(info.platform && mergeAfterBuild != null){
    const platformLength = trainStationGroupLength(groupId, 'train_platform');
    const stationLength = trainStationGroupLength(mergeAfterBuild, 'train_station');
    if(platformLength === stationLength){
      mergeTrainStationGroups([groupId, mergeAfterBuild], Math.min(groupId, mergeAfterBuild));
      groupId = Math.min(groupId, mergeAfterBuild);
    }
  }
  assignTrainStationName(groupId);
  nextTrainStationId = Math.max(nextTrainStationId, groupId + 1);
  return b;
}

function canPlace(t,x,y){
  if(!inMap(x,y)) return { ok:false };
  const i = y*N+x, ter = terrain[i];
  if(t==='bulldoze') return { ok: !!(road[i] || rail[i] || bgrid[i] || ter===T.TREE || ter===T.WHEAT || ter===T.COTTON) };
  if(t==='terraform') return { ok: !bgrid[i] && (ter===T.TREE || ter===T.WHEAT || ter===T.COTTON || ter===T.IRON || ter===T.COAL) };
  if(t==='fill_water'){
    if(ter !== T.WATER) return { ok:false, msg:'L\'outil Remblai ne s\'applique que sur l\'eau' };
    if(!terrassementNear(x, y, MP.myId ?? 1)) return { ok:false, msg:'Aucune usine de terrassement à portée avec assez de terre ('+FILL_WATER_COST+' terres requises)' };
    return { ok:true };
  }
  if(t==='road'){
    if(road[i] || rail[i] || bgrid[i]) return { ok:false, msg:'Case occupée' };
    if(ter===T.WATER) return { ok:false, msg:"Impossible de construire sur l'eau" };
    if(ter!==T.GRASS) return { ok:false, msg:"Les routes se posent sur l'herbe (démolis les arbres ou champs)" };
    return { ok:true };
  }
  if(t==='rail'){
    if(road[i] || bgrid[i]) return { ok:false, msg:'Case occupée' };
    if(ter===T.WATER) return { ok:false, msg:"Impossible de construire sur l'eau" };
    if(ter!==T.GRASS) return { ok:false, msg:"Les rails se posent sur l'herbe (démolis les arbres ou champs)" };
    return { ok:true };
  }
  if(t==='rail_signal'){
    if(!rail[i]) return { ok:false, msg:'Place le signal sur une voie ferrée existante.' };
    if(!chooseRailSignalDef(x, y)) return { ok:false, msg:'Aucun segment de rail valide à signaler.' };
    return { ok:true };
  }
  if(t==='train_station') return trainStationPlacementInfo(x, y);
  if(road[i] || rail[i] || bgrid[i]) return { ok:false, msg:'Case occupée' };
  if(ter===T.WATER) return { ok:false, msg:"Impossible de construire sur l'eau" };
  if(t==='mine'){
    if(ter!==T.IRON && ter!==T.COAL) return { ok:false, msg:'La mine doit être sur un gisement' };
  } else {
    if(ter!==T.GRASS) return { ok:false, msg:'Terrain non constructible' };
    if(t==='lumber' && !treeNear(x,y,2)) return { ok:false, msg:"Aucun arbre à moins de 2 cases" };
    if(t==='farm'){
      if(!fieldNear(x,y,2)) return { ok:false, msg:"Aucun champ de blé à moins de 2 cases" };
      const capErr = farmCapacityError(x, y, 'farm', T.WHEAT);
      if(capErr) return { ok:false, msg:capErr };
    }
    if(t==='cotton_farm'){
      if(!cottonFieldNear(x,y,2)) return { ok:false, msg:"Aucun champ de coton à moins de 2 cases" };
      const capErr = farmCapacityError(x, y, 'cotton_farm', T.COTTON);
      if(capErr) return { ok:false, msg:capErr };
    }
    if(t==='pump' && !waterNear(x,y,1)) return { ok:false, msg:"La pompe doit être au bord de l'eau" };
    if(t==='fisher'){
      if(!waterNear(x,y,1)) return { ok:false, msg:"La cabane de pêcheur doit être au bord de l'eau" };
      const FISHER_EXCL = 4;
      for(const b of buildings){
        if(b.dead || b.type !== 'fisher') continue;
        const bx = b.x + Math.floor((b.w||1)/2), by = b.y + Math.floor((b.h||1)/2);
        if(Math.sqrt((x-bx)**2 + (y-by)**2) <= FISHER_EXCL)
          return { ok:false, msg:'Trop proche d\'une autre pêcherie (rayon '+FISHER_EXCL+' cases)' };
      }
    }
  }
  // zone d'exclusion multijoueur
  if(MP.connected && nearbyEnemyOwner(MP.myId, x, y))
    return { ok:false, msg:"Trop proche d'un autre joueur (−"+MP_ZONE+' cases)' };
  return { ok:true };
}

function clickAt(x,y){
  if(!inMap(x,y)){
    // Zones d'expansion : cliquables quel que soit l'outil
    const exp = expansions.find(e=>e.inPiece(x,y));
    if(exp){ selectedExpansion = exp; selected = null; selectedVehicle = null; hudTimer = 0; return; }
    return;
  }
  selectedExpansion = null;
  const i = y*N+x;

  // Mode assignation de route véhicule (intercepte avant tout le reste)
  if(vehicleRouteMode && tool === 'select'){
    const b = bgrid[i];
    if(b && !b.dead){
      const veh = vehicleRouteMode.vehicle;
      if(vehicleRouteMode.step === 'train_order_append'){
        if(veh?.vtype !== 'train') return;
        if(!vehicleRouteEndpointOk(b, 'train')){
          toast('⛔ Le train ne peut utiliser que des gares ou des dépôts ferroviaires.','err');
          return;
        }
        veh.orders = veh.orders || [];
        veh.orderModes = veh.orderModes || [];
        const last = veh.orders[veh.orders.length - 1] || null;
        if(last && typeof trainOrderStopKey === 'function' && trainOrderStopKey(last) === trainOrderStopKey(b)){
          toast('⛔ Cet arrêt est déjà le dernier ordre.','err');
          return;
        }
        veh.orders.push(b);
        veh.orderModes.push('load_unload');
        syncTrainOrders(veh);
        if(typeof renderTrainPanel === 'function') renderTrainPanel();
        toast('🚂 Arrêt ajouté : '+trainStopLabel(b));
        return;
      }
      const isBus = veh.vtype === 'bus';
      if(!vehicleRouteEndpointOk(b)){
        if(isBus)
          toast('⛔ Le bus ne peut utiliser que des arrêts de bus ou des gares comme source et destination.','err');
        else if(veh.vtype === 'train')
          toast('⛔ Le train ne peut utiliser que des gares ou des dépôts ferroviaires.','err');
        else
          toast('⛔ Les véhicules ne peuvent utiliser que des entrepôts comme source et destination.','err');
        return;
      }
      if(vehicleRouteMode.step === 'source'){
        const v = vehicleRouteMode.vehicle;
        const vt = VEHICLE_TYPES[v.vtype];
        const myOwner = MP.myId;
        if(isBus){
          // Les bus peuvent utiliser n'importe quel arrêt (y compris inter-joueurs)
          vehicleRouteMode.vehicle.source = b;
          vehicleRouteMode.step = 'dest';
          const stopName = b.name || BUILD[b.type].n;
          toast('🚌 Départ : '+stopName+'. Clique sur l\'arrêt de destination.');
        } else if(b.owner !== myOwner && b.owner != null){
          // Seul un marché d'un autre joueur est autorisé comme source (pas son dépôt)
          if(b.type !== 'market'){
            toast('⛔ Vous ne pouvez acheter que depuis le marché d\'un autre joueur.','err'); return;
          }
          const hasSellRes = vt.resources.some(r => b.sellTo?.[r]);
          if(!hasSellRes){
            toast('⛔ Ce marché ne vend pas les ressources de ce véhicule.','err'); return;
          }
          vehicleRouteMode.vehicle.source = b;
          vehicleRouteMode.step = 'dest';
          toast('🛒 Source (achat) : '+(MP.players.find(p=>p.id===b.owner)||{}).name+'. Clique sur ta destination.');
        } else {
          vehicleRouteMode.vehicle.source = b;
          vehicleRouteMode.step = 'dest';
          toast('Source définie : '+BUILD[b.type].n+'. Clique sur la destination.');
        }
      } else {
        const vRef = vehicleRouteMode.vehicle;
        const myOwner = MP.myId;
        if(!isBus && b.owner !== myOwner && b.owner != null){
          // Destination chez un autre joueur : uniquement un marché (hors bus)
          if(b.type !== 'market'){
            toast('⛔ Vous ne pouvez livrer que vers le marché d\'un autre joueur.','err'); return;
          }
        }
        vRef.dest = b;
        if(!vehicleCanServeRoute(vRef)){
          vRef.dest = null;
          toast('⛔ Destination hors rayon de la citerne source.','err');
          return;
        }
        vehicleRouteMode = null;
        const routeStarted = startVehicleRoute(vRef);
        if(MP.connected) netSend({
          type:'route_vehicle',
          id:vRef.id,
          sourceX:vRef.source.x, sourceY:vRef.source.y,
          destX:vRef.dest.x, destY:vRef.dest.y,
        });
        if(routeStarted) toast('Route définie ! Le véhicule commence sa tournée.','win');
        else if(vRef.vtype === 'train') toast('⛔ Aucun chemin ferroviaire continu depuis le dépôt du train.','err');
        else toast('⛔ Aucun chemin disponible depuis le dépôt du véhicule.','err');
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
    selected = trainStationSelectionRepresentative(bgrid[i]);
    return;
  }
  if(tool==='bulldoze'){
    const railSigDef = rail[i] ? chooseRailSignalDef(x, y) : null;
    if(bgrid[i]){
      const b = bgrid[i];
      // en multijoueur : impossible de démolir le bâtiment d'un autre joueur
      if(MP.connected && b.owner && b.owner !== MP.myId){
        toast('⛔ Ce bâtiment appartient à un autre joueur','err'); return;
      }
      if(depotHasStoredVehicles(b)){
        toast('⛔ Impossible de détruire ce dépôt tant que des véhicules sont à l’intérieur.','err'); return;
      }
      const refund = demolishBuilding(b, b.owner);
      if(refund) addFloat(x,y,'+'+refund+' $','#9fe89f');
    } else if(railSigDef && railSignalDefAt(x, y, railSigDef.bit)){
      setRailSignal(x, y, railSigDef.bit, false);
      earnMoney(Math.floor((BUILD.rail_signal?.cost||0) * 0.3), 'rembours');
    } else if(road[i]){
      road[i] = 0; earnMoney(3, 'rembours');
    } else if(rail[i]){
      const occ = tileOccupiedByTrain(x, y);
      if(occ){ toast('⛔ Un train occupe cette voie','err'); return; }
      const { updates, refund } = collectRailRemovalUpdates(x, y);
      railApplyMaskUpdates(updates, -refund);
    } else if(terrain[i]===T.TREE || terrain[i]===T.WHEAT || terrain[i]===T.COTTON){
      terrain[i] = T.GRASS;
    }
    return;
  }
  if(tool==='terraform'){
    const ter = terrain[i];
    if(bgrid[i]){ toast('⛔ Démolissez d\'abord le bâtiment','err'); return; }
    if(ter===T.TREE || ter===T.WHEAT || ter===T.COTTON || ter===T.IRON || ter===T.COAL){
      terrain[i] = T.GRASS;
      if(MP.connected) netSend({ type:'terraform', i });
    }
    return;
  }
  if(tool==='fill_water'){
    const ter = terrain[i];
    if(ter !== T.WATER){ toast('L\'outil Remblai ne s\'applique que sur l\'eau','err'); return; }
    const depot = terrassementNear(x, y, MP.myId ?? 1);
    if(!depot){ toast('⛔ Aucune usine de terrassement à portée avec '+FILL_WATER_COST+' terres','err'); return; }
    depot.storage['dirt'] = (depot.storage['dirt']||0) - FILL_WATER_COST;
    terrain[i] = T.GRASS;
    // netSend géré par l'intercept MP (09_multiplayer.js) pour éviter le double envoi
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
  if(tool === 'rail'){
    const { updates, cost:railCost } = collectRailUpdates([{ x, y }]);
    if(!updates.length) return;
    if(myWallet().money < railCost){ toast('Fonds insuffisants ('+railCost+' $)','err'); return; }
    railApplyMaskUpdates(updates, railCost);
    return;
  }
  if(tool === 'rail_signal'){
    const def = chooseRailSignalDef(x, y);
    if(!def) return;
    const exists = !!railSignalDefAt(x, y, def.bit);
    const delta = exists ? -Math.floor((BUILD.rail_signal?.cost||0) * 0.3) : (BUILD.rail_signal?.cost||0);
    if(delta > 0 && myWallet().money < delta){ toast('Fonds insuffisants ('+delta+' $)','err'); return; }
    setRailSignal(x, y, def.bit, !exists);
    if(delta > 0) spendMoney(delta, 'construction');
    else if(delta < 0) earnMoney(-delta, 'rembours');
    return;
  }
  if(tool === 'train_station'){
    if(myWallet().money < cost){ toast('Fonds insuffisants ('+cost+' $)','err'); return; }
    const b = placeTrainStationTile(x, y, MP.myId);
    if(!b) return;
    spendMoney(cost, 'construction');
    selected = b;
    return;
  }
  if(myWallet().money < cost){ toast('Fonds insuffisants ('+cost+' $)','err'); return; }
  spendMoney(cost, 'construction');
  if(tool==='road'){ road[i] = 1; return; }
  const b = newBuilding(tool,x,y);
  b.owner = MP.myId;
  markStarterHomeIfNeeded(b);
  assignBuildingToTown(b);
  assignIndustryName(b);
  assignTrainDepotName(b);
  buildings.push(b);
  bgrid[i] = b;
  selected = b;
  if(BUILD[b.type].resid) assignHomelessToHousing(b.owner);
}
