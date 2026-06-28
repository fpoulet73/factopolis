// ======================================================================
// MULTIJOUEUR — couche réseau WebSocket
// ======================================================================

function refreshOwnerColorsFromRegistry(){
  const reg = MP.savedRegistry;
  if(!reg || typeof reg !== 'object' || !crypto?.subtle) return;
  for(const [username, ownerId] of Object.entries(reg)){
    const n = Number(ownerId);
    if(!username || !Number.isFinite(n) || MP.ownerColors?.[n]) continue;
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(username))
      .then(buf => {
        const firstByte = new Uint8Array(buf)[0];
        MP.ownerColors[n] = COLORS[firstByte % COLORS.length];
        for(const h of homeless) if(h.owner === n) h.col = MP.ownerColors[n];
      })
      .catch(()=>{});
  }
}

const MP_STATE_SYNC_INTERVAL = 0.2;
const MP_RENDER_DELAY = 0.3;
const MP_SNAPSHOT_BUFFER_MAX = 16;
let mpStateSyncTimer = 0;

// L'hôte diffuse toutes les MP_STATE_SYNC_INTERVAL secondes RÉELLES ; l'écart de
// gtime entre deux snapshots vaut donc MP_STATE_SYNC_INTERVAL * speed. Si la
// profondeur du tampon de rendu (le retard) est inférieure à ~2 intervalles,
// l'horloge de rendu rattrape la cible, se fige, puis saute à l'arrivée du
// snapshot suivant : c'est la saccade. On dimensionne le retard sur l'écart réel
// des snapshots (qui dépend de la vitesse) avec une marge de 2,5 intervalles.
function mpRenderDelay(){
  return Math.max(MP_RENDER_DELAY, MP_STATE_SYNC_INTERVAL * (speed || 1) * 2.5);
}

function serializeTruckState(tk){
  return {
    id: tk.id ?? null,
    pts: Array.isArray(tk.pts) ? tk.pts.map(p => ({ x:p.x, y:p.y })) : [],
    seg: tk.seg || 0,
    t: tk.t || 0,
    res: tk.res || null,
    amt: tk.amt || 0,
    targetX: tk.target && !tk.target.dead ? tk.target.x : null,
    targetY: tk.target && !tk.target.dead ? tk.target.y : null,
    fromX: tk.from && !tk.from.dead ? tk.from.x : null,
    fromY: tk.from && !tk.from.dead ? tk.from.y : null,
    overtaking: !!tk.overtaking,
  };
}

function serializeWalkerState(wk){
  return {
    pts: Array.isArray(wk.pts) ? wk.pts.map(p => ({ x:p.x, y:p.y })) : [],
    seg: wk.seg || 0,
    t: wk.t || 0,
    targetX: wk.target && !wk.target.dead ? wk.target.x : null,
    targetY: wk.target && !wk.target.dead ? wk.target.y : null,
    leaving: !!wk.leaving,
    fromHomeless: !!wk.fromHomeless,
    protectedResident: !!wk.protectedResident,
    col: wk.col || null,
    phase: Number.isFinite(wk.phase) ? wk.phase : 0,
  };
}

function serializeVehicleState(v){
  return {
    id: v.id, vtype: v.vtype,
    name: v.name || null,
    garageX: v.garageRef.x, garageY: v.garageRef.y,
    sourceX: v.source && !v.source.dead ? v.source.x : null,
    sourceY: v.source && !v.source.dead ? v.source.y : null,
    destX:   v.dest   && !v.dest.dead   ? v.dest.x   : null,
    destY:   v.dest   && !v.dest.dead   ? v.dest.y   : null,
    state: v.state, cargo: v.cargo, res: v.res || null, busRouteDistance: v.busRouteDistance ?? null,
    passengersOnBoard: v.passengersOnBoard ?? null,
    passengersFromStationX: v.passengersFromStation && !v.passengersFromStation.dead ? v.passengersFromStation.x : null,
    passengersFromStationY: v.passengersFromStation && !v.passengersFromStation.dead ? v.passengersFromStation.y : null,
    currentBuildingX: v.currentBuilding && !v.currentBuilding.dead ? v.currentBuilding.x : null,
    currentBuildingY: v.currentBuilding && !v.currentBuilding.dead ? v.currentBuilding.y : null,
    seg: v.seg || 0,
    t: v.t || 0,
    waitTimer: v.waitTimer || 0,
    pts: Array.isArray(v.pts) ? v.pts.map(p => ({ x:p.x, y:p.y })) : [],
    pathTiles: Array.isArray(v.pathTiles) ? v.pathTiles.slice() : [],
    railContinueTile: v.railContinueTile ?? null,
    railPreviousTile: v.railPreviousTile ?? null,
    railTrail: Array.isArray(v.railTrail) ? v.railTrail.map(p => ({ x:p.x, y:p.y })) : null,
    depotDepartureArmed: !!v.depotDepartureArmed,
    atDepot: !!v.atDepot,
    pinnedRes: v.pinnedRes || null,
    wagons: Array.isArray(v.wagons) ? v.wagons.map(w => typeof w === 'string' ? w : ({ type:w.type, resource:w.resource || null })) : null,
    orderIndex: v.orderIndex || 0,
    orders: Array.isArray(v.orders) ? v.orders.filter(b => b && !b.dead).map(b => ({ x:b.x, y:b.y })) : null,
    orderModes: Array.isArray(v.orderModes) ? v.orderModes.slice() : null,
    cargoLoadStopX: v.cargoLoadStop && !v.cargoLoadStop.dead ? v.cargoLoadStop.x : null,
    cargoLoadStopY: v.cargoLoadStop && !v.cargoLoadStop.dead ? v.cargoLoadStop.y : null,
    engineMult: v.engineMult ?? null,
    boughtAtGtime: v.boughtAtGtime ?? null,
    maintenanceDaysPaid: v.maintenanceDaysPaid ?? 0,
    signalWaitTime: v.signalWaitTime ?? 0,
    missingRailTimer: v.missingRailTimer ?? 0,
    currentRailBlock: v.currentRailBlock ?? -1,
    pendingFreightRevenue: v.pendingFreightRevenue ?? 0,
    freightRevenueFireAt: v.freightRevenueFireAt ?? null,
    railTollOwed: v.railTollOwed ? { ...v.railTollOwed } : null,
  };
}

function snapshotBuildingRef(b){
  if(!b) return null;
  return { type:b.type, x:b.x, y:b.y, w:b.w, h:b.h };
}

function findSnapshotBuildingRef(ref){
  if(!ref) return null;
  return buildings.find(b => !b.dead && b.type === ref.type && b.x === ref.x && b.y === ref.y && b.w === ref.w && b.h === ref.h) || null;
}

function findSnapshotVehicleRef(id){
  return vehicles.find(v => String(v.id) === String(id)) || null;
}

function copyPointList(list){
  return Array.isArray(list) ? list.map(p => ({ x:p.x, y:p.y })) : [];
}

function vehicleRenderStateSnapshot(v){
  return {
    pts: copyPointList(v.renderPts || v.pts),
    pathTiles: Array.isArray(v.renderPathTiles) ? v.renderPathTiles.slice() : (Array.isArray(v.pathTiles) ? v.pathTiles.slice() : []),
    railTrail: copyPointList(v.renderRailTrail || v.railTrail),
    seg: v.renderSeg ?? v.seg ?? 0,
    t: v.renderT ?? v.t ?? 0,
    currentBuilding: v.renderCurrentBuilding || v.currentBuilding || null,
    railContinueTile: v.renderRailContinueTile ?? v.railContinueTile ?? null,
    railPreviousTile: v.renderRailPreviousTile ?? v.railPreviousTile ?? null,
  };
}

function vehicleAuthoritativeStateSnapshot(v){
  return {
    pts: copyPointList(v.pts),
    pathTiles: Array.isArray(v.pathTiles) ? v.pathTiles.slice() : [],
    railTrail: copyPointList(v.railTrail),
    seg: v.seg ?? 0,
    t: v.t ?? 0,
    waitTimer: v.waitTimer ?? 0,
    currentBuilding: v.currentBuilding || null,
    railContinueTile: v.railContinueTile ?? null,
    railPreviousTile: v.railPreviousTile ?? null,
  };
}

function truckRenderStateSnapshot(tk){
  return {
    pts: copyPointList(tk.renderPts || tk.pts),
    seg: tk.renderSeg ?? tk.seg ?? 0,
    t: tk.renderT ?? tk.t ?? 0,
  };
}

function vehiclePathSignature(state, vtype){
  if(vtype === 'train'){
    return Array.isArray(state.pathTiles) && state.pathTiles.length
      ? 'rail:' + state.pathTiles.join(',')
      : 'railpts:' + (state.pts || []).map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join('|');
  }
  return 'road:' + (state.pts || []).map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join('|');
}

// Position monde (pixels) de la locomotive lissée, à partir de l'état de rendu
// interpolé (renderPts/renderSeg/renderT). Même repère que railTrail.
function mpGuestLocoWorld(v){
  const pts = v.renderPts;
  if(!Array.isArray(pts) || !pts.length) return null;
  const seg = Math.max(0, Math.min(v.renderSeg | 0, pts.length - 1));
  const a = pts[seg], b = pts[Math.min(seg + 1, pts.length - 1)];
  if(!a || !b) return null;
  const t = Math.max(0, Math.min(1, v.renderT || 0));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// Rogne renderRailTrail comme l'hôte rogne railTrail : on conserve juste assez de
// longueur derrière la loco pour porter tous les wagons (+ marge).
function mpTrimGuestTrail(v){
  const trail = v.renderRailTrail;
  if(!Array.isArray(trail) || trail.length < 3) return;
  const keepDistance = ((v.wagons?.length || 0) + 2) * TILE * 0.80 + TILE * 2;
  let distance = 0, first = trail.length - 1;
  for(let i = trail.length - 1; i > 0; i--){
    distance += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y);
    first = i - 1;
    if(distance >= keepDistance) break;
  }
  if(first > 0) trail.splice(0, first);
}

// Reconstruit la traînée des wagons côté invité à partir de la position LISSÉE de
// la locomotive interpolée, exactement comme l'hôte enregistre sa traînée image
// par image. On n'interpole plus élément par élément le railTrail du snapshot —
// un tampon glissant dont les index ne coïncident pas d'un snapshot à l'autre, ce
// qui faisait vibrer les wagons même quand la loco glissait correctement.
function mpUpdateGuestTrainTrail(v, seedTrail){
  const loco = mpGuestLocoWorld(v);
  if(!loco) return; // loco arrêtée sans tracé exploitable : on garde la traînée
  let trail = v.renderRailTrail;
  const last = Array.isArray(trail) && trail.length ? trail[trail.length - 1] : null;
  // (Re)amorçage si la traînée est vide ou après une discontinuité (nouveau
  // trajet/téléportation) : on part de la traînée autoritaire du snapshot pour
  // que les wagons soient présents immédiatement.
  const jumped = last && Math.hypot(loco.x - last.x, loco.y - last.y) > TILE * 3;
  if(!last || jumped){
    trail = (Array.isArray(seedTrail) && seedTrail.length)
      ? seedTrail.map(p => ({ x: p.x, y: p.y }))
      : [{ x: loco.x, y: loco.y }];
    v.renderRailTrail = trail;
  }
  // Comme l'hôte (recordTrainTrailPoint) : on n'empile un point que lorsque la
  // loco a parcouru le seuil depuis le dernier point. Pas d'ajustement continu de
  // la pointe (sinon le dernier segment s'allongerait sans fin).
  const tip = trail[trail.length - 1];
  if(!tip || Math.hypot(loco.x - tip.x, loco.y - tip.y) >= 2){
    trail.push({ x: loco.x, y: loco.y });
  }
  mpTrimGuestTrail(v);
}

function setVehicleRenderImmediate(v, state){
  v.renderPts = copyPointList(state.pts);
  v.renderPathTiles = Array.isArray(state.pathTiles) ? state.pathTiles.slice() : [];
  v.renderRailTrail = copyPointList(state.railTrail);
  v.renderSeg = 0;
  v.renderT = 0;
  v.renderCurrentBuilding = state.currentBuilding || null;
  v.renderRailContinueTile = state.railContinueTile ?? null;
  v.renderRailPreviousTile = state.railPreviousTile ?? null;
  setVehicleRenderProgress(v, (state.seg ?? 0) + (state.t ?? 0));
}

function mpVehicleRenderState(veh){
  if(!veh) return null;
  return {
    pts: veh.renderPts || veh.pts || [],
    pathTiles: veh.renderPathTiles || veh.pathTiles || [],
    railTrail: veh.renderRailTrail || veh.railTrail || [],
    seg: veh.renderSeg ?? veh.seg ?? 0,
    t: veh.renderT ?? veh.t ?? 0,
    currentBuilding: veh.renderCurrentBuilding || veh.currentBuilding || null,
    railContinueTile: veh.renderRailContinueTile ?? veh.railContinueTile ?? null,
    railPreviousTile: veh.renderRailPreviousTile ?? veh.railPreviousTile ?? null,
  };
}

function mpTruckRenderState(tk){
  if(!tk) return null;
  return {
    pts: tk.renderPts || tk.pts || [],
    seg: tk.renderSeg ?? tk.seg ?? 0,
    t: tk.renderT ?? tk.t ?? 0,
  };
}

function setTruckRenderImmediate(tk, state){
  tk.renderPts = copyPointList(state.pts);
  tk.renderSeg = state.seg ?? 0;
  tk.renderT = state.t ?? 0;
}

function setVehicleRenderProgress(v, progress){
  const pts = v.renderPts || [];
  if(!pts.length){
    v.renderSeg = 0;
    v.renderT = 0;
    return;
  }
  if(pts.length === 1){
    v.renderSeg = 0;
    v.renderT = 0;
    return;
  }
  const maxProgress = pts.length - 1;
  const clamped = Math.max(0, Math.min(maxProgress, progress || 0));
  if(clamped >= maxProgress){
    v.renderSeg = Math.max(0, pts.length - 2);
    v.renderT = 1;
    return;
  }
  const seg = Math.floor(clamped);
  v.renderSeg = Math.max(0, Math.min(seg, pts.length - 2));
  v.renderT = clamped - seg;
}

function wrappedProgressDiff(current, target, total){
  if(!(total > 0)) return target - current;
  let diff = target - current;
  if(diff > total / 2) diff -= total;
  else if(diff < -total / 2) diff += total;
  return diff;
}

function buildingRenderProg(b){
  // renderProg n'est entretenu que pour l'invité (interpolation de snapshots).
  // L'hôte et le solo simulent en direct : on lit toujours la progression vive,
  // sinon une valeur renderProg périmée gèlerait la barre de progression.
  if(MP.connected && MP.role === 'guest') return b?.renderProg ?? b?.prog ?? 0;
  return b?.prog ?? 0;
}

function mpResetGuestSnapshotBuffer(){
  MP.renderSnapshots = [];
  MP.renderClockGtime = null;
}

function serializeGuestRenderVehicleSnapshot(sv){
  return {
    id: String(sv.id),
    vtype: sv.vtype,
    state: sv.state || 'idle',
    pts: copyPointList(sv.pts),
    pathTiles: Array.isArray(sv.pathTiles) ? sv.pathTiles.slice() : [],
    railTrail: copyPointList(sv.railTrail),
    seg: sv.seg || 0,
    t: sv.t || 0,
    currentBuildingX: sv.currentBuildingX ?? null,
    currentBuildingY: sv.currentBuildingY ?? null,
    railContinueTile: sv.railContinueTile ?? null,
    railPreviousTile: sv.railPreviousTile ?? null,
  };
}

function serializeGuestRenderTruckSnapshot(st){
  return {
    id: String(st.id ?? `${st.fromX},${st.fromY}:${st.targetX},${st.targetY}:${st.res}:${st.amt}`),
    pts: copyPointList(st.pts),
    seg: st.seg || 0,
    t: st.t || 0,
  };
}

function mpBuildGuestRenderSnapshot(d){
  const buildings = Object.create(null);
  for(const b of d.buildings || []) buildings[syncBuildingKey(b)] = { prog:b.prog || 0 };
  return {
    gtime: d.gtime || 0,
    buildings,
    vehicles: new Map((d.vehicles || []).map(sv => [String(sv.id), serializeGuestRenderVehicleSnapshot(sv)])),
    trucks: new Map((d.trucks || []).map(st => [String(st.id ?? `${st.fromX},${st.fromY}:${st.targetX},${st.targetY}:${st.res}:${st.amt}`), serializeGuestRenderTruckSnapshot(st)])),
  };
}

function mpPushGuestRenderSnapshot(d){
  if(!MP.connected || MP.role !== 'guest' || !d) return;
  const snap = mpBuildGuestRenderSnapshot(d);
  const buf = MP.renderSnapshots || (MP.renderSnapshots = []);
  const last = buf[buf.length - 1];
  if(last && snap.gtime < last.gtime - 1e-6) return;
  if(last && Math.abs(snap.gtime - last.gtime) <= 1e-6) buf[buf.length - 1] = snap;
  else buf.push(snap);
  while(buf.length > MP_SNAPSHOT_BUFFER_MAX) buf.shift();
  const latest = buf[buf.length - 1];
  const oldest = buf[0];
  const target = Math.max(oldest?.gtime || 0, (latest?.gtime || 0) - mpRenderDelay());
  if(!Number.isFinite(MP.renderClockGtime)) MP.renderClockGtime = target;
  else if(MP.renderClockGtime < (oldest?.gtime || 0)) MP.renderClockGtime = oldest.gtime;
}

function mpAdvanceGuestRenderClock(gameDt){
  const buf = MP.renderSnapshots || [];
  if(!buf.length){
    MP.renderClockGtime = null;
    return;
  }
  const oldest = buf[0];
  const latest = buf[buf.length - 1];
  const target = Math.max(oldest.gtime, latest.gtime - mpRenderDelay());
  if(!Number.isFinite(MP.renderClockGtime)) MP.renderClockGtime = target;
  if(!paused && gameDt > 0) MP.renderClockGtime += gameDt;
  if(MP.renderClockGtime > target) MP.renderClockGtime = target;
  if(MP.renderClockGtime < oldest.gtime) MP.renderClockGtime = oldest.gtime;
}

function mpFindGuestRenderBracket(){
  const buf = MP.renderSnapshots || [];
  if(!buf.length) return null;
  const latest = buf[buf.length - 1];
  const target = Math.max(buf[0].gtime, latest.gtime - mpRenderDelay());
  const renderTime = Number.isFinite(MP.renderClockGtime) ? MP.renderClockGtime : target;
  if(renderTime <= buf[0].gtime) return { a:buf[0], b:buf[0], alpha:0 };
  for(let i=1; i<buf.length; i++){
    const b = buf[i];
    if(renderTime <= b.gtime){
      const a = buf[i - 1];
      const span = Math.max(1e-6, b.gtime - a.gtime);
      return { a, b, alpha:Math.max(0, Math.min(1, (renderTime - a.gtime) / span)) };
    }
  }
  return { a:latest, b:latest, alpha:0 };
}

function snapshotProgressValue(s){
  return (s?.seg || 0) + (s?.t || 0);
}

// Position monde (pixels) d'un snapshot le long de sa polyline pts.
function snapshotWorldPos(s){
  const pts = s?.pts;
  if(!Array.isArray(pts) || !pts.length) return null;
  const seg = Math.max(0, Math.min(s.seg | 0, pts.length - 1));
  const a = pts[seg], b = pts[Math.min(seg + 1, pts.length - 1)];
  if(!a || !b) return null;
  const t = Math.max(0, Math.min(1, s.t || 0));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// Projette un point monde sur la polyline pts et renvoie la progression (seg+t)
// du point le plus proche. Sert à reconvertir une position interpolée en monde
// vers le repère (seg+t) du chemin de rendu. La recherche est limitée à une
// fenêtre autour de hintSeg (segment courant du snapshot) : c'est plus rapide et
// ça évite qu'une voie repassant près d'elle-même ne capte une mauvaise section.
function projectWorldOnPts(pts, world, hintSeg = 0){
  if(!Array.isArray(pts) || pts.length < 2 || !world) return 0;
  const last = pts.length - 2;
  const lo = Math.max(0, Math.min(last, (hintSeg | 0) - 8));
  const hi = Math.max(0, Math.min(last, (hintSeg | 0) + 3));
  let bestProg = lo, bestD2 = Infinity;
  for(let i = lo; i <= hi; i++){
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((world.x - a.x) * dx + (world.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + dx * t, py = a.y + dy * t;
    const d2 = (world.x - px) ** 2 + (world.y - py) ** 2;
    if(d2 < bestD2){ bestD2 = d2; bestProg = i + t; }
  }
  return bestProg;
}

// Interpolation des trains EN ESPACE MONDE. Un train réinitialise son repère
// (seg=0, pts/pathTiles reconstruits à partir de la tuile courante) à chaque
// replanification de signal/aiguillage : la progression (seg+t) chute alors à ~0
// alors que le train n'a pas bougé. Interpoler cette progression faisait sauter
// tout le train à chaque snapshot (et le bloquait près du dépôt, dense en
// signaux). On interpole donc la POSITION MONDE de la loco (continue malgré le
// changement de repère), puis on la reprojette sur le chemin de rendu b.pts pour
// retrouver un (seg+t) exploitable par le rendu existant.
function interpolateVehicleSnapshotState(a, b, alpha){
  if(!a && !b) return null;
  if(!a) return b;
  if(!b) return a;
  const isTrain = a.vtype === 'train' && b.vtype === 'train';

  if(isTrain){
    // Changement d'état (idle↔roulant, source↔dest) : bascule franche. Ces
    // transitions se produisent à l'arrêt (dépôt/gare), donc invisibles.
    if(a.state !== b.state) return alpha < 0.5 ? a : b;
    const wa = snapshotWorldPos(a), wb = snapshotWorldPos(b);
    if(!wa || !wb || !Array.isArray(b.pts) || b.pts.length < 2){
      return alpha < 0.5 ? a : b;
    }
    // Saut trop grand pour un intervalle de snapshot : vraie téléportation
    // (nouveau trajet lointain) → bascule franche plutôt qu'un glissement.
    if(Math.hypot(wa.x - wb.x, wa.y - wb.y) > TILE * 6){
      return alpha < 0.5 ? a : b;
    }
    const pa = projectWorldOnPts(b.pts, wa, b.seg | 0);
    const pb = projectWorldOnPts(b.pts, wb, b.seg | 0);
    return {
      ...b,
      currentBuildingX: alpha < 0.5 ? a.currentBuildingX : b.currentBuildingX,
      currentBuildingY: alpha < 0.5 ? a.currentBuildingY : b.currentBuildingY,
      railContinueTile: alpha < 0.5 ? a.railContinueTile : b.railContinueTile,
      railPreviousTile: alpha < 0.5 ? a.railPreviousTile : b.railPreviousTile,
      interpProgress: pa + (pb - pa) * alpha,
    };
  }

  const samePath = vehiclePathSignature(a, a.vtype) === vehiclePathSignature(b, b.vtype);
  if(!samePath || a.state !== b.state){
    return alpha < 0.5 ? a : b;
  }
  const aProgress = snapshotProgressValue(a);
  const bProgress = snapshotProgressValue(b);
  if(bProgress + 1e-6 < aProgress) return alpha < 0.5 ? a : b;
  const progress = aProgress + (bProgress - aProgress) * alpha;
  return {
    ...b,
    currentBuildingX: alpha < 0.5 ? a.currentBuildingX : b.currentBuildingX,
    currentBuildingY: alpha < 0.5 ? a.currentBuildingY : b.currentBuildingY,
    railContinueTile: alpha < 0.5 ? a.railContinueTile : b.railContinueTile,
    railPreviousTile: alpha < 0.5 ? a.railPreviousTile : b.railPreviousTile,
    interpProgress: progress,
  };
}

function interpolateTruckSnapshotState(a, b, alpha){
  if(!a && !b) return null;
  if(!a) return b;
  if(!b) return a;
  const samePath = vehiclePathSignature(a, 'road') === vehiclePathSignature(b, 'road');
  if(!samePath) return alpha < 0.5 ? a : b;
  const aProgress = snapshotProgressValue(a);
  const bProgress = snapshotProgressValue(b);
  if(bProgress + 1e-6 < aProgress) return alpha < 0.5 ? a : b;
  return {
    ...b,
    interpProgress: aProgress + (bProgress - aProgress) * alpha,
  };
}

function mpUpdateGuestVisuals(realDt=0, gameDt=0){
  if(!MP.connected || MP.role !== 'guest'){
    mpResetGuestSnapshotBuffer();
    for(const v of vehicles){
      v.renderPts = null;
      v.renderPathTiles = null;
      v.renderRailTrail = null;
      v.renderSeg = null;
      v.renderT = null;
      v.renderCurrentBuilding = null;
      v.renderRailContinueTile = null;
      v.renderRailPreviousTile = null;
    }
    for(const tk of trucks){
      tk.renderPts = null;
      tk.renderSeg = null;
      tk.renderT = null;
    }
    return;
  }
  mpAdvanceGuestRenderClock(gameDt);
  const bracket = mpFindGuestRenderBracket();
  if(!bracket){
    for(const b of buildings) b.renderProg = b.prog || 0;
    for(const v of vehicles) setVehicleRenderImmediate(v, vehicleAuthoritativeStateSnapshot(v));
    for(const tk of trucks) setTruckRenderImmediate(tk, truckRenderStateSnapshot(tk));
    return;
  }
  const { a, b, alpha } = bracket;

  for(const bld of buildings){
    const r = recipeOf(bld);
    const pa = a.buildings[syncBuildingKey(bld)]?.prog;
    const pb = b.buildings[syncBuildingKey(bld)]?.prog;
    if(!r || pa == null || pb == null){
      bld.renderProg = bld.prog || 0;
      continue;
    }
    bld.renderProg = pa + wrappedProgressDiff(pa, pb, r.time) * alpha;
    while(bld.renderProg >= r.time) bld.renderProg -= r.time;
    while(bld.renderProg < 0) bld.renderProg += r.time;
  }

  for(const v of vehicles){
    const va = a.vehicles.get(String(v.id));
    const vb = b.vehicles.get(String(v.id));
    const interp = interpolateVehicleSnapshotState(va, vb, alpha);
    if(!interp){
      setVehicleRenderImmediate(v, vehicleAuthoritativeStateSnapshot(v));
      continue;
    }
    const currentBuilding = syncBuildingByCoords(interp.currentBuildingX, interp.currentBuildingY) || null;
    v.renderPts = copyPointList(interp.pts);
    v.renderPathTiles = Array.isArray(interp.pathTiles) ? interp.pathTiles.slice() : [];
    v.renderCurrentBuilding = currentBuilding;
    v.renderRailContinueTile = interp.railContinueTile ?? null;
    v.renderRailPreviousTile = interp.railPreviousTile ?? null;
    const progress = interp.interpProgress ?? snapshotProgressValue(interp);
    setVehicleRenderProgress(v, progress);
    // La traînée (et donc les wagons) est reconstruite à partir de la loco lissée
    // plutôt qu'interpolée depuis le snapshot ; sinon les wagons vibrent.
    if(v.vtype === 'train') mpUpdateGuestTrainTrail(v, interp.railTrail);
    else v.renderRailTrail = copyPointList(interp.railTrail);
  }

  for(const tk of trucks){
    const ta = a.trucks.get(String(tk.id));
    const tb = b.trucks.get(String(tk.id));
    const interp = interpolateTruckSnapshotState(ta, tb, alpha);
    if(!interp){
      setTruckRenderImmediate(tk, truckRenderStateSnapshot(tk));
      continue;
    }
    tk.renderPts = copyPointList(interp.pts);
    const progress = interp.interpProgress ?? snapshotProgressValue(interp);
    const pts = tk.renderPts || [];
    if(pts.length >= 2){
      const maxProgress = pts.length - 1;
      const clamped = Math.max(0, Math.min(maxProgress, progress || 0));
      if(clamped >= maxProgress){
        tk.renderSeg = Math.max(0, pts.length - 2);
        tk.renderT = 1;
      } else {
        tk.renderSeg = Math.max(0, Math.min(Math.floor(clamped), pts.length - 2));
        tk.renderT = clamped - Math.floor(clamped);
      }
    } else {
      tk.renderSeg = 0;
      tk.renderT = 0;
    }
  }
}

function syncBuildingKey(o){
  return `${o.type}:${o.x}:${o.y}:${o.w}:${o.h}`;
}

function syncBuildingByCoords(x, y, type=null){
  if(x == null || y == null) return null;
  const b = buildings.find(bb => !bb.dead && bb.x === x && bb.y === y);
  if(!b) return null;
  if(type && b.type !== type) return null;
  return b;
}

function applyPauseSpeedFromSync(d){
  paused = !!d.paused;
  speed = d.speed || 1;
  $('bPause').textContent = paused ? '▶' : '⏸';
  $('bPause').classList.toggle('on', paused);
  document.querySelectorAll('.spd').forEach(b=> b.classList.toggle('on', +b.dataset.s===speed));
}

function applyBuildingDynamicState(b, o, includeTransient, syncGtime=null){
  const prevProg = b.prog || 0;
  const prevSyncGtime = b.mpProgSyncGtime ?? null;
  b.storage = o.storage || {};
  b.inc = o.inc || {};
  b.prog = o.prog || 0;
  b.trucksOut = includeTransient ? (o.trucksOut || 0) : b.trucksOut || 0;
  b.pop = o.pop || 0;
  b.protectedPop = o.protectedPop || 0;
  b.ct = o.ct || 0;
  b.pending = includeTransient ? (o.pending || 0) : 0;
  b.pendingProtected = includeTransient ? (o.pendingProtected || 0) : 0;
  b.starve = o.starve || 0;
  b.ore = o.ore || null;
  b.allow = o.allow || null;
  b.sellTo = o.sellTo || null;
  b.sellMin = o.sellMin || null;
  b.trainAllow = o.trainAllow || null;
  b.paused = !!o.paused;
  b.blockedOut = o.blockedOut || null;
  b.owner = o.owner ?? null;
  b.starterHome = !!o.starterHome;
  b.starterSlots = o.starterSlots || 0;
  b.townId = o.townId ?? null;
  b.name = o.name || null;
  b.mergeBlockedMissing = Array.isArray(o.mergeBlockedMissing) ? o.mergeBlockedMissing.filter(r => RES[r]) : null;
  if(b.type === 'bus_stop'){
    b.passengers = o.passengers || 0;
    b.passengersEntrant = o.passengersEntrant ?? 0;
  }
  if(b.type === 'train_station'){
    b.passengersEntrant = o.passengersEntrant ?? 0;
    b.passengersEntrantMax = o.passengersEntrantMax ?? 0;
    b.passagersSortant = o.passagersSortant ?? 0;
    b.passengersEntrantPending = o.passengersEntrantPending ?? 0;
  }
  b.stationGroupId = o.stationGroupId ?? null;
  b.stationAxis = o.stationAxis || null;
  const r = recipeOf(b);
  if(r && syncGtime != null && prevSyncGtime != null && syncGtime > prevSyncGtime){
    const deltaG = syncGtime - prevSyncGtime;
    let deltaProg = b.prog - prevProg;
    if(deltaProg < -1e-6) deltaProg += r.time;
    b.mpProgRate = deltaProg / deltaG;
  } else if(!r){
    b.mpProgRate = 0;
  }
  b.mpProgSyncGtime = syncGtime;
  if(b.renderProg == null || !r) b.renderProg = b.prog || 0;
}

function applyVehicleDynamicState(v, sv){
  const source = syncBuildingByCoords(sv.sourceX, sv.sourceY);
  const dest = syncBuildingByCoords(sv.destX, sv.destY);
  const currentBuilding = syncBuildingByCoords(sv.currentBuildingX, sv.currentBuildingY);
  v.name = sv.name ?? v.name;
  // Édition de route en cours côté client : la source/destination sont en train
  // d'être choisies (clic source puis clic destination). La synchro autoritative
  // (toutes les 0,2 s) ne doit pas écraser la source fraîchement sélectionnée,
  // sinon au clic destination vehicleCanServeRoute échoue (source redevenue null)
  // et affiche à tort « Destination hors rayon de la citerne source ».
  const editingRoute = typeof vehicleRouteMode !== 'undefined' && vehicleRouteMode
    && vehicleRouteMode.vehicle === v;
  if(!editingRoute){
    v.source = source || null;
    v.dest = dest || null;
  }
  v.currentBuilding = currentBuilding || (sv.state === 'idle' ? v.garageRef : null);
  v.state = sv.state || 'idle';
  v.cargo = sv.cargo || 0;
  v.res = sv.res || null;
  v.pinnedRes = sv.pinnedRes || null;
  v.busRouteDistance = sv.busRouteDistance ?? null;
  v.passengersOnBoard = sv.passengersOnBoard ?? null;
  v.passengersFromStation = syncBuildingByCoords(sv.passengersFromStationX, sv.passengersFromStationY, 'train_station') || null;
  v.waitTimer = sv.waitTimer || 0;
  v.depotDepartureArmed = !!sv.depotDepartureArmed;
  v.atDepot = !!sv.atDepot;
  v.engineMult = sv.engineMult ?? v.engineMult;
  v.boughtAtGtime = sv.boughtAtGtime ?? v.boughtAtGtime;
  v.maintenanceDaysPaid = sv.maintenanceDaysPaid ?? v.maintenanceDaysPaid;
  v.signalWaitTime = sv.signalWaitTime || 0;
  v.missingRailTimer = sv.missingRailTimer || 0;
  v.currentRailBlock = sv.currentRailBlock ?? -1;
  v.pendingFreightRevenue = sv.pendingFreightRevenue || 0;
  v.freightRevenueFireAt = sv.freightRevenueFireAt ?? null;
  v.railTollOwed = sv.railTollOwed ? { ...sv.railTollOwed } : {};
  v.railContinueTile = sv.railContinueTile ?? null;
  v.railPreviousTile = sv.railPreviousTile ?? null;
  v.cargoLoadStop = syncBuildingByCoords(sv.cargoLoadStopX, sv.cargoLoadStopY) || null;
  // Brouillon de route en cours d'édition côté client (arrêts ajoutés mais pas
  // encore « Enregistrés ») : la synchro autoritative ne doit pas écraser les
  // ordres locaux, sinon l'arrêt fraîchement ajouté disparaît au prochain sync
  // (toutes les 0,2 s). Une fois la route appliquée (route_vehicle envoyé) ou le
  // panneau fermé, le drapeau retombe et l'hôte redevient autoritatif.
  if(!v.ordersDraft){
    if(Array.isArray(sv.orders)){
      v.orders = sv.orders.map(o => syncBuildingByCoords(o.x, o.y)).filter(Boolean);
    }
    if(Number.isInteger(sv.orderIndex)) v.orderIndex = sv.orderIndex;
    if(Array.isArray(sv.orderModes)) v.orderModes = sv.orderModes.slice();
  }
  if(Array.isArray(sv.wagons)){
    v.wagons = sv.wagons
      .map(w => typeof w === 'string'
        ? trainCreateWagon(w)
        : (w && typeof w === 'object' ? trainCreateWagon(w.type, w.resource || null) : null))
      .filter(Boolean);
  }
  if(v.vtype === 'train'){
    v.pathTiles = Array.isArray(sv.pathTiles) ? sv.pathTiles.slice() : [];
    v.pts = Array.isArray(sv.pathTiles) && sv.pathTiles.length
      ? sv.pathTiles.map(idx => ({ x:(idx % N) * TILE + TILE / 2, y:((idx / N) | 0) * TILE + TILE / 2 }))
      : (Array.isArray(sv.pts) ? sv.pts.map(p => ({ x:p.x, y:p.y })) : []);
    v.railTrail = Array.isArray(sv.railTrail)
      ? sv.railTrail.filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y)).map(p => ({ x:p.x, y:p.y }))
      : [];
    if(v.wagons?.length) trainNormalizeWagons(v);
    if(v.orders?.length) syncTrainOrders(v);
  } else {
    v.pathTiles = [];
    v.pts = Array.isArray(sv.pts) ? sv.pts.map(p => ({ x:p.x, y:p.y })) : [];
  }
  v.seg = Math.max(0, Math.min((sv.seg || 0), Math.max(0, v.pts.length - 1)));
  v.t = Math.max(0, Math.min(1, sv.t || 0));
}

function applyStateSync(d){
  if(!d?.dynamicOnly){
    applySnapshot(d);
    // workersAssigned/Idle ne sont pas transmis : l'invité les reconstruit
    // depuis les données synchronisées (pop, townId, owner, navetteurs).
    refreshWorkerAllocation();
    return;
  }
  const includeTransient = Array.isArray(d.trucks) || Array.isArray(d.walkers) || Array.isArray(d.homeless);
  if(d.playerRegistry && typeof d.playerRegistry === 'object') MP.savedRegistry = d.playerRegistry;
  MP.ownerColors = {};
  if(d.ownerColors && typeof d.ownerColors === 'object'){
    for(const [ownerId, color] of Object.entries(d.ownerColors)){
      const n = Number(ownerId);
      if(Number.isFinite(n) && typeof color === 'string' && color) MP.ownerColors[n] = color;
    }
  }
  refreshOwnerColorsFromRegistry();
  gtime = d.gtime || 0;
  dispatchTimer = d.dispatchTimer || 0;
  taxTimer = d.taxTimer || 0;
  mergeTimer = d.mergeTimer || 0;
  upkeepTimer = d.upkeepTimer || 0;
  busStopTimer = d.busStopTimer || 0;
  passengerCycleTimer = d.passengerCycleTimer || 0;
  WALLETS = {};
  if(d.wallets){ for(const k in d.wallets) WALLETS[k] = d.wallets[k]; }
  applyPauseSpeedFromSync(d);

  const townById = new Map((d.towns || []).map(t => [t.id, t]));
  towns = towns.filter(t => townById.has(t.id));
  for(const t of towns){
    const st = townById.get(t.id);
    t.name = st.name;
    t.cx = st.cx;
    t.cy = st.cy;
  }
  nextTownId = d.nextTownId ?? nextTownId;
  nextTrainStationId = d.nextTrainStationId || nextTrainStationId;
  if(selectedTownId != null && !townById.has(selectedTownId)) selectedTownId = null;

  const bState = new Map((d.buildings || []).map(o => [syncBuildingKey(o), o]));
  for(const b of buildings){
    const o = bState.get(syncBuildingKey(b));
    if(!o) continue;
    applyBuildingDynamicState(b, o, includeTransient, d.gtime || 0);
  }

  homeless = Array.isArray(d.homeless)
    ? d.homeless
      .filter(h => Number.isFinite(h?.x) && Number.isFinite(h?.y))
      .map(h => ({
        owner: h.owner ?? null,
        x: h.x,
        y: h.y,
        col: h.col || playerColor(h.owner ?? null),
        phase: Number.isFinite(h.phase) ? h.phase : 0,
      }))
    : [];
  for(const k in WALLETS) WALLETS[k].homelessSeeded = true;

  const vehiclesById = new Map(vehicles.map(v => [String(v.id), v]));
  const hostVehicleIds = new Set();
  for(const sv of d.vehicles || []){
    if(!VEHICLE_TYPES[sv.vtype]) continue;
    hostVehicleIds.add(String(sv.id));
    let v = vehiclesById.get(String(sv.id));
    if(!v){
      const garage = syncBuildingByCoords(sv.garageX, sv.garageY);
      if(!garage || !BUILD[garage.type]?.transportDepot) continue;
      v = createPersistentVehicle(sv.vtype, garage, sv.id ?? null);
      if(!v) continue;
      if(v.vtype === 'train' && !sv.name) assignTrainVehicleName(v);
      vehiclesById.set(String(v.id), v);
    }
    // L'hôte connaît ce véhicule : l'achat optimiste est confirmé.
    v.mpPendingAck = false;
    applyVehicleDynamicState(v, sv);
  }
  // L'hôte transmet TOUJOURS sa liste complète de véhicules. Tout véhicule
  // local absent de cette liste n'existe pas pour l'hôte autoritatif : c'est un
  // fantôme issu d'un achat optimiste rejeté (dépôt dont l'owner ne correspond
  // pas à l'ID de session du client). Sans cet élagage, un tel train reste
  // affiché avec son drapeau vert mais ne sort jamais du dépôt, car l'hôte ne
  // le simule pas. On laisse une brève fenêtre de grâce aux achats tout récents
  // (l'hôte n'a pas encore renvoyé de sync).
  const OPTIMISTIC_ACK_GRACE_MS = 8000;
  const nowReal = performance.now();
  const ghosts = vehicles.filter(v => !hostVehicleIds.has(String(v.id))
    && !(v.mpPendingAck && v.mpCreatedRealTime != null && (nowReal - v.mpCreatedRealTime) < OPTIMISTIC_ACK_GRACE_MS));
  for(const v of ghosts){
    if(selectedVehicle === v) selectedVehicle = null;
    if(focusVehicle === v){ focusVehicle = null; camTracking = false; }
    if(typeof trainConfigVehicle !== 'undefined' && trainConfigVehicle === v) trainConfigVehicle = null;
    const garageVehicles = v.garageRef?.vehicles;
    if(Array.isArray(garageVehicles)){
      const gi = garageVehicles.indexOf(v);
      if(gi >= 0) garageVehicles.splice(gi, 1);
    }
  }
  if(ghosts.length){
    const dropped = new Set(ghosts);
    vehicles = vehicles.filter(v => !dropped.has(v));
  }

  trucks = [];
  for(const st of d.trucks || []){
    const from = syncBuildingByCoords(st.fromX, st.fromY);
    const target = syncBuildingByCoords(st.targetX, st.targetY);
    if(!from || !target || !Array.isArray(st.pts) || st.pts.length < 2) continue;
    const truckId = st.id ?? nextTruckId++;
    if(Number.isFinite(Number(truckId))) nextTruckId = Math.max(nextTruckId, Number(truckId) + 1);
    trucks.push({
      id: truckId,
      pts: st.pts.map(p => ({ x:p.x, y:p.y })),
      seg: Math.max(0, Math.min((st.seg || 0), Math.max(0, st.pts.length - 1))),
      t: Math.max(0, Math.min(1, st.t || 0)),
      res: st.res || null,
      amt: st.amt || 0,
      target,
      from,
      overtaking: !!st.overtaking,
    });
  }
  // trucksOut reconstruit depuis les camions réellement présents (cf. applySnapshot) :
  // évite tout compteur résiduel qui bloquerait le dispatch des sorties.
  for(const b of buildings) b.trucksOut = 0;
  for(const tk of trucks) if(tk.from) tk.from.trucksOut++;

  walkers = [];
  for(const sw of d.walkers || []){
    if(!Array.isArray(sw.pts) || sw.pts.length < 2) continue;
    const target = syncBuildingByCoords(sw.targetX, sw.targetY) || null;
    walkers.push({
      pts: sw.pts.map(p => ({ x:p.x, y:p.y })),
      seg: Math.max(0, Math.min((sw.seg || 0), Math.max(0, sw.pts.length - 1))),
      t: Math.max(0, Math.min(1, sw.t || 0)),
      target,
      leaving: !!sw.leaving,
      fromHomeless: !!sw.fromHomeless,
      protectedResident: !!sw.protectedResident,
      col: sw.col || playerColor(target?.owner ?? null),
      phase: Number.isFinite(sw.phase) ? sw.phase : 0,
    });
  }

  floats = Array.isArray(d.floats)
    ? d.floats
      .filter(f => Number.isFinite(f?.x) && Number.isFinite(f?.y) && Number.isFinite(f?.life))
      .map(f => ({ x:f.x, y:f.y, txt:f.txt || '', col:f.col || '#fff', life:f.life }))
    : [];

  if(selectedVehicle && !vehiclesById.has(String(selectedVehicle.id))) selectedVehicle = null;
  if(focusVehicle && !vehiclesById.has(String(focusVehicle.id))){
    focusVehicle = null;
    camTracking = false;
  }
  if(typeof trainConfigVehicle !== 'undefined' && trainConfigVehicle && !vehiclesById.has(String(trainConfigVehicle.id))){
    trainConfigVehicle = null;
    trainConfigSelectedWagonIndex = -1;
    trainConfigLocoSelected = false;
  }

  // workersAssigned/Idle ne sont pas transmis dans le sync dynamique : l'invité
  // les reconstruit localement à partir des bâtiments synchronisés, sinon les
  // usines affichent 0 ouvrier alors que l'hôte les a bien alloués.
  refreshWorkerAllocation();
}

function mpRunsAuthoritativeSimulation(){
  return !MP.connected || MP.role !== 'guest';
}

function mpMaybeBroadcastState(dt){
  if(!MP.connected || MP.role !== 'host' || !MP.ws) return;
  mpStateSyncTimer += dt;
  if(mpStateSyncTimer < MP_STATE_SYNC_INTERVAL) return;
  mpStateSyncTimer = 0;
  MP.ws.send(JSON.stringify({
    type:'state_sync',
    state: serializeState({ includeTransient:true, includeWorld:false }),
  }));
}

// ---- sérialisation de l'état complet (hôte → invité) ----
function serializeState(opts = {}){
  const includeTransient = !!opts.includeTransient;
  const includeWorld = opts.includeWorld !== false;
  const ownerColors = { ...(MP.ownerColors || {}) };
  for(const p of MP.players || []) if(p?.id != null && p.color) ownerColors[p.id] = p.color;
  if(MP.myId != null && MP.myColor) ownerColors[MP.myId] = MP.myColor;
  const out = {
    dynamicOnly: !includeWorld,
    ownerColors,
    wallets: WALLETS,
    homeless: includeTransient
      ? homeless.map(h => ({
          owner: h.owner ?? null,
          x: h.x, y: h.y,
          col: h.col || null,
          phase: Number.isFinite(h.phase) ? h.phase : 0,
        }))
      : [],
    gtime,
    paused, speed,
    dispatchTimer,
    taxTimer,
    mergeTimer,
    upkeepTimer,
    busStopTimer,
    passengerCycleTimer,
    buildings: buildings.map(b => ({
      type:b.type, x:b.x, y:b.y, w:b.w, h:b.h,
      storage:{...b.storage}, inc:{},
      prog:b.prog||0, trucksOut:includeTransient ? (b.trucksOut||0) : 0,
      pop:b.pop||0, protectedPop:b.protectedPop||0,
      ct:b.ct||0,
      pending:includeTransient ? (b.pending||0) : 0,
      pendingProtected:includeTransient ? (b.pendingProtected||0) : 0,
      starve:b.starve||0,
      ore:b.ore||null, allow:b.allow||null, sellTo:b.sellTo||null, sellMin:b.sellMin||null, trainAllow:b.trainAllow||null, paused:b.paused||false, blockedOut:b.blockedOut||null, owner:b.owner||null,
      starterHome:!!b.starterHome, starterSlots:b.starterSlots||0, townId:b.townId??null, name:b.name||null,
      mergeBlockedMissing:Array.isArray(b.mergeBlockedMissing) ? b.mergeBlockedMissing.slice() : null,
      passengers:b.passengers||0,
      passengersEntrant:b.passengersEntrant??null, passengersEntrantMax:b.passengersEntrantMax??null, passagersSortant:b.passagersSortant??null,
      passengersEntrantPending:b.passengersEntrantPending??null,
      stationGroupId:b.stationGroupId??null, stationAxis:b.stationAxis||null,
    })),
    towns: towns.map(t => ({ id:t.id, name:t.name, cx:t.cx, cy:t.cy })),
    nextTownId,
    nextTrainStationId,
    vehicles: vehicles.map(serializeVehicleState),
    trucks: includeTransient ? trucks.map(serializeTruckState) : [],
    walkers: includeTransient ? walkers.map(serializeWalkerState) : [],
    floats: includeTransient ? floats.map(f => ({
      x: f.x, y: f.y, txt: f.txt, col: f.col, life: f.life,
    })) : [],
  };
  if(includeWorld){
    Object.assign(out, {
      world: WORLD,
      size: N,
      mapBounds,
      expansionLevels,
      purchasedPieces: Array.from(purchasedPieces),
      mapMask: Array.from(mapMask),
      terrain: Array.from(terrain),
      road:    Array.from(road),
      rail:    Array.from(rail),
      railOwner: railOwner ? Array.from(railOwner) : null,
      railSignals: Object.values(railSignals || {}),
    });
  }
  return out;
}

// Relie le nouveau MP.myId aux données d'une session précédente
// Source 1 : prevOwnerId transmis par le serveur (reconnexion dans la même session)
// Source 2 : playerRegistry dans la sauvegarde (redémarrage serveur)
// Diffuse également le remap à l'hôte pour que son état reste cohérent
function remapOwnerId(){
  if(MP.myId == null || !MP.username) return;
  let oldId = MP.prevOwnerId;
  if((oldId == null || oldId === MP.myId) && MP.savedRegistry){
    const fromSave = MP.savedRegistry[MP.username];
    if(fromSave != null) oldId = Number(fromSave);
  }
  const inferredId = inferSavedOwnerIdForUsername(oldId);
  if(inferredId != null) oldId = inferredId;
  if(oldId == null || oldId === MP.myId || !Number.isFinite(Number(oldId))) return;
  oldId = Number(oldId);
  applyOwnerRemap(oldId, MP.myId);
  // Propager le remap à l'hôte et aux autres clients
  if(MP.connected && MP.role !== 'host'){
    netSend({ type:'owner_remap', oldId, newId:MP.myId });
  }
}

function inferSavedOwnerIdForUsername(registryId){
  if(!MP.savedRegistry || !MP.username) return null;
  const registeredToOthers = new Set(
    Object.entries(MP.savedRegistry)
      .filter(([name]) => name !== MP.username)
      .map(([, id]) => Number(id))
      .filter(Number.isFinite)
  );
  const hasOwnedBuildings = id => buildings.some(b => b.owner === id);
  if(Number.isFinite(registryId) && hasOwnedBuildings(registryId)) return null;

  const counts = new Map();
  for(const b of buildings){
    if(b.owner == null || b.owner === MP.myId || registeredToOthers.has(b.owner)) continue;
    counts.set(b.owner, (counts.get(b.owner) || 0) + 1);
  }
  if(!counts.size) return null;
  return [...counts.entries()].sort((a,b) => b[1] - a[1])[0][0];
}

function applyOwnerRemap(oldId, newId){
  for(const b of buildings) if(b.owner === oldId) b.owner = newId;
  if(railOwner) for(let i=0;i<railOwner.length;i++) if(railOwner[i] === oldId) railOwner[i] = newId;
  for(const h of homeless)  if(h.owner === oldId){ h.owner = newId; h.col = playerColor(newId); }
  if(MP.ownerColors?.[oldId]){
    MP.ownerColors[newId] = MP.ownerColors[oldId];
    delete MP.ownerColors[oldId];
  }
  if(WALLETS[oldId]){
    if(!WALLETS[newId] || (WALLETS[oldId].money||0) >= (WALLETS[newId]?.money||0)){
      WALLETS[newId] = WALLETS[oldId];
    }
    delete WALLETS[oldId];
  }
  if(oldId == null && WALLETS[0] && !WALLETS[newId]){
    WALLETS[newId] = WALLETS[0];
    delete WALLETS[0];
  }
}

// Nom d'utilisateur (identité STABLE) de l'expéditeur d'une action côté hôte.
// Les IDs de session (msg.from) changent à chaque connexion ; le nom non.
function mpSenderUsername(msg){
  if(msg.fromUsername) return msg.fromUsername;
  const p = (MP.players || []).find(pl => pl?.id === msg.from);
  if(p?.username) return p.username;
  return WALLETS[msg.from]?.username || null;
}

// Nom d'utilisateur associé à un ancien ID de propriétaire (via le wallet, qui
// voyage avec le joueur, ou le registre nom→id de la sauvegarde courante).
function mpUsernameOfOwnerId(ownerId){
  if(ownerId == null) return null;
  if(WALLETS[ownerId]?.username) return WALLETS[ownerId].username;
  const reg = MP.savedRegistry || {};
  for(const [name, id] of Object.entries(reg)) if(Number(id) === Number(ownerId)) return name;
  return null;
}

// L'expéditeur contrôle-t-il ce bâtiment ? On accepte l'ID de session courant,
// mais aussi un ANCIEN ID du même nom d'utilisateur — à condition qu'il ne soit
// pas l'ID courant d'un AUTRE joueur connecté (anti-vol). Dans ce cas on réalise
// le remap durable oldId→msg.from pour que tout l'état converge et que les
// prochaines actions correspondent directement (cf. mp-owner-id-instability).
function mpSenderControlsOwner(ownerId, msg){
  if(ownerId == null) return false;
  if(ownerId === msg.from || Number(ownerId) === Number(msg.from)) return true;
  // L'ID owner ne doit pas être l'ID courant d'un AUTRE joueur connecté (anti-vol).
  for(const pl of MP.players || []){
    if(pl?.id != null && Number(pl.id) === Number(ownerId) && Number(pl.id) !== Number(msg.from)) return false;
  }
  // Cas 1 : l'ancien ID se résout au nom d'utilisateur de l'expéditeur.
  // Cas 2 (repli) : l'ID est périmé — il n'appartient à AUCUN joueur connecté ni
  // à un autre nom du registre. En pratique, les bâtiments à ID périmé sont ceux
  // du joueur qui revient (son wallet/owner a déjà pu être déplacé par un remap
  // partiel), jamais ceux de l'hôte (connecté, ID courant). On réconcilie donc.
  const senderName = mpSenderUsername(msg);
  const ownerName = mpUsernameOfOwnerId(ownerId);
  const ownerIsConnected = (MP.players || []).some(pl => pl?.id != null && Number(pl.id) === Number(ownerId));
  const belongsToSender = (senderName && ownerName === senderName)
    || (!ownerIsConnected && ownerName == null);
  if(!belongsToSender) return false;
  applyOwnerRemap(Number(ownerId), msg.from);
  return true;
}

function applySnapshot(d){
  const hadTransient = Array.isArray(d.trucks) || Array.isArray(d.walkers) || Array.isArray(d.homeless);
  const prevSelectedRef = snapshotBuildingRef(selected);
  const prevSelectedVehicleId = selectedVehicle?.id ?? null;
  const prevFocusVehicleId = focusVehicle?.id ?? null;
  const prevTrainConfigVehicleId = typeof trainConfigVehicle !== 'undefined' ? (trainConfigVehicle?.id ?? null) : null;
  const prevSelectedTownId = selectedTownId;
  if(d.dynamicOnly){
    applyStateSync(d);
    return;
  } else if(d.mapBounds){
    // Format récent : d.size = N_FULL, mapBounds fourni
    WORLD = normalizeWorldConfig(d.world || { ...WORLD, size: d.size });
    setMapSize(d.size || N);
    terrain = Uint8Array.from(d.terrain);
    road    = Uint8Array.from(d.road);
    rail    = d.rail ? normalizeLegacyRailGrid(d.rail) : new Uint8Array((d.size || N) * (d.size || N));
    railOwner = (d.railOwner && d.railOwner.length === N*N) ? Int16Array.from(d.railOwner) : new Int16Array(N*N).fill(-1);
    railSignals = Object.create(null);
    mapBounds = { ...d.mapBounds };
    expansionLevels = d.expansionLevels || { left:0, right:0, top:0, bottom:0 };
    purchasedPieces = new Set(d.purchasedPieces||[]);
    if(d.mapMask){
      mapMask = Uint8Array.from(d.mapMask);
    } else {
      // Ancienne sauvegarde sans mapMask : reconstruire le masque ET le terrain des marges
      mapMask.fill(0);
      for(let y=mapBounds.y0; y<mapBounds.y1; y++)
        for(let x=mapBounds.x0; x<mapBounds.x1; x++)
          mapMask[y*N+x] = 1;
      generateExpansionTerrain(); // les marges étaient vides (tout herbe)
    }
  } else {
    // Ancien format : d.size = N_PLAY, migration vers la nouvelle structure
    const N_PLAY = d.size || 64;
    const N_FULL_MAP = N_PLAY + 2 * EXP_MARGIN;
    WORLD = normalizeWorldConfig(d.world || { ...WORLD, size: N_PLAY });
    setMapSize(N_FULL_MAP);
    mapBounds = { x0: EXP_MARGIN, y0: EXP_MARGIN, x1: EXP_MARGIN + N_PLAY, y1: EXP_MARGIN + N_PLAY };
    expansionLevels = { left:0, right:0, top:0, bottom:0 };
    purchasedPieces = new Set();
    // Déplacer le terrain dans la grande grille
    const oldTerrain = Uint8Array.from(d.terrain);
    const oldRoad    = Uint8Array.from(d.road);
    const oldRail    = d.rail ? normalizeLegacyRailGrid(d.rail) : new Uint8Array(N_PLAY * N_PLAY);
    terrain = new Uint8Array(N_FULL_MAP * N_FULL_MAP);
    road    = new Uint8Array(N_FULL_MAP * N_FULL_MAP);
    rail    = new Uint8Array(N_FULL_MAP * N_FULL_MAP);
    railOwner = new Int16Array(N_FULL_MAP * N_FULL_MAP).fill(-1);
    railSignals = Object.create(null);
    for(let y=0; y<N_PLAY; y++) for(let x=0; x<N_PLAY; x++){
      terrain[(y+EXP_MARGIN)*N_FULL_MAP+(x+EXP_MARGIN)] = oldTerrain[y*N_PLAY+x];
      road   [(y+EXP_MARGIN)*N_FULL_MAP+(x+EXP_MARGIN)] = oldRoad   [y*N_PLAY+x];
      rail   [(y+EXP_MARGIN)*N_FULL_MAP+(x+EXP_MARGIN)] = oldRail   [y*N_PLAY+x];
    }
    // Décaler toutes les coordonnées de EXP_MARGIN tuiles
    for(const o of d.buildings) { o.x += EXP_MARGIN; o.y += EXP_MARGIN; }
    if(Array.isArray(d.towns)) for(const t of d.towns) { t.cx += EXP_MARGIN; t.cy += EXP_MARGIN; }
    if(Array.isArray(d.vehicles)) for(const v of d.vehicles){
      if(v.garageX != null) v.garageX += EXP_MARGIN;
      if(v.garageY != null) v.garageY += EXP_MARGIN;
      if(v.sourceX != null) v.sourceX += EXP_MARGIN;
      if(v.sourceY != null) v.sourceY += EXP_MARGIN;
      if(v.destX   != null) v.destX   += EXP_MARGIN;
      if(v.destY   != null) v.destY   += EXP_MARGIN;
    }
    // Remplir le masque et générer le terrain des marges (migration : marges = tout herbe)
    mapMask.fill(0);
    for(let y=mapBounds.y0; y<mapBounds.y1; y++)
      for(let x=mapBounds.x0; x<mapBounds.x1; x++)
        mapMask[y*N+x] = 1;
    generateExpansionTerrain();
    // Re-centrer la caméra sur la zone jouable migée
    const pcx = (mapBounds.x0 + mapBounds.x1) / 2;
    const pcy = (mapBounds.y0 + mapBounds.y1) / 2;
    cam.z = 1;
    centerOn(pcx * TILE + TILE/2, pcy * TILE + TILE/2);
  }
  selectedExpansion = null; hoveredExpansion = null;
  if(Array.isArray(d.railSignals)){
    railSignals = Object.create(null);
    for(const sig of d.railSignals){
      if(!sig || !Number.isInteger(sig.x) || !Number.isInteger(sig.y) || !Number.isInteger(sig.bit)) continue;
      railSignals[railSignalKey(sig.x, sig.y, sig.bit)] = { x:sig.x, y:sig.y, bit:sig.bit, forcedRed:!!sig.forcedRed, kind:sig.kind || 'block' };
    }
  } else railSignals = Object.create(null);
  rebuildRailBlocks();
  // Sauvegarder le registre des joueurs (pour récupération après redémarrage serveur)
  if(d.playerRegistry && typeof d.playerRegistry === 'object') MP.savedRegistry = d.playerRegistry;
  MP.ownerColors = {};
  if(d.ownerColors && typeof d.ownerColors === 'object'){
    for(const [ownerId, color] of Object.entries(d.ownerColors)){
      const n = Number(ownerId);
      if(Number.isFinite(n) && typeof color === 'string' && color) MP.ownerColors[n] = color;
    }
  }
  refreshOwnerColorsFromRegistry();
  gtime    = d.gtime || 0;
  dispatchTimer = d.dispatchTimer || 0;
  taxTimer = d.taxTimer || 0;
  mergeTimer = d.mergeTimer || 0;
  upkeepTimer = d.upkeepTimer || 0;
  busStopTimer = d.busStopTimer || 0;
  passengerCycleTimer = d.passengerCycleTimer || 0;
  WALLETS  = {};
  if(d.wallets){ for(const k in d.wallets) WALLETS[k] = d.wallets[k]; }
  paused   = d.paused;  speed   = d.speed||1;
  $('bPause').textContent = paused ? '▶' : '⏸';
  $('bPause').classList.toggle('on', paused);
  document.querySelectorAll('.spd').forEach(b=> b.classList.toggle('on', +b.dataset.s===speed));

  buildings = []; trucks = []; walkers = []; homeless = []; floats = [];
  vehicles = []; vehicleRouteMode = null; selectedVehicle = null; focusVehicle = null; camTracking = false; vehicleListMode = null; nextTruckId = 0; nextVehicleId = 0; nextTrainStationId = d.nextTrainStationId || 1;
  towns = []; nextTownId = 0; selectedTownId = prevSelectedTownId ?? null; townLabelHits = [];
  bgrid = new Array(N*N).fill(null);
  selected = null;

  // Restaurer les villes
  if(Array.isArray(d.towns)){
    towns = d.towns.map(t => ({ id:t.id, name:t.name, cx:t.cx, cy:t.cy }));
    nextTownId = d.nextTownId ?? (towns.reduce((m,t)=>Math.max(m,t.id),-1) + 1);
  }
  if(selectedTownId != null && !towns.some(t => t.id === selectedTownId)) selectedTownId = null;

  for(const o of d.buildings){
    if(!BUILD[o.type]) continue;
    const b = newBuilding(o.type, o.x, o.y, o.w, o.h);
    Object.assign(b, {
      storage:o.storage||{}, inc:{},
      prog:o.prog||0, trucksOut:hadTransient ? (o.trucksOut||0) : 0,
      pop:o.pop||0, protectedPop:o.protectedPop||0,
      ct:o.ct||0,
      pending:hadTransient ? (o.pending||0) : 0,
      pendingProtected:hadTransient ? (o.pendingProtected||0) : 0,
      starve:o.starve||0,
    });
    b.renderProg = b.prog || 0;
    b.mpProgRate = 0;
    b.mpProgSyncGtime = gtime || 0;
    if(o.ore)   b.ore   = o.ore;
    if(o.allow) b.allow = o.allow;
    if(o.sellTo) b.sellTo = o.sellTo;
    if(o.sellMin) b.sellMin = o.sellMin;
    if(o.trainAllow) b.trainAllow = o.trainAllow;
    if(o.paused != null) b.paused = o.paused;
    if(o.blockedOut) b.blockedOut = o.blockedOut;
    if(o.owner  != null) b.owner  = o.owner;
    if(o.starterHome) b.starterHome = true;
    if(o.starterSlots) b.starterSlots = o.starterSlots;
    if(o.townId != null) b.townId = o.townId;
    if(o.name   != null) b.name   = o.name;
    if(Array.isArray(o.mergeBlockedMissing)) b.mergeBlockedMissing = o.mergeBlockedMissing.filter(r => RES[r]);
    if(o.passengers != null && b.type === 'bus_stop') b.passengers = o.passengers;
    if(o.passengersEntrant != null && b.type === 'train_station'){
      b.passengersEntrant = o.passengersEntrant;
      b.passengersEntrantMax = o.passengersEntrantMax ?? 0;
      b.passagersSortant = o.passagersSortant ?? 0;
      b.passengersEntrantPending = o.passengersEntrantPending ?? 0;
    }
    if(o.stationGroupId != null) b.stationGroupId = o.stationGroupId;
    if(o.stationAxis) b.stationAxis = o.stationAxis;
    buildings.push(b);
    setGrid(b,b);
    if(b.stationGroupId != null) nextTrainStationId = Math.max(nextTrainStationId, b.stationGroupId + 1);
  }
  // Migration : assign townId aux maisons sans village et noms aux industries sans nom
  for(const b of buildings){
    if(b.townId == null) assignBuildingToTown(b, true);
    if(BUILD[b.type]?.ind   && !b.name)          assignIndustryName(b);
    if(b.type === 'train_depot' && !b.name)      assignTrainDepotName(b);
  }
  for(const groupId of new Set(buildings.filter(b => !b.dead && b.stationGroupId != null).map(b => b.stationGroupId))){
    const pieces = buildings.filter(b => !b.dead && b.stationGroupId === groupId && (b.type === 'train_station' || b.type === 'train_platform'));
    if(pieces.length && pieces.some(b => !b.name)) assignTrainStationName(groupId);
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
  homeless = Array.isArray(d.homeless)
    ? d.homeless
      .filter(h => Number.isFinite(h?.x) && Number.isFinite(h?.y))
      .map(h => ({
        owner: h.owner ?? null,
        x: h.x,
        y: h.y,
        col: h.col || playerColor(h.owner ?? null),
        phase: Number.isFinite(h.phase) ? h.phase : 0,
      }))
    : [];
  for(const k in WALLETS) WALLETS[k].homelessSeeded = true;
  // Restaurer les véhicules persistants
  if(Array.isArray(d.vehicles)){
    for(const sv of d.vehicles){
      if(!VEHICLE_TYPES[sv.vtype]) continue;
      const garage = buildings.find(b=>b.x===sv.garageX && b.y===sv.garageY && BUILD[b.type]?.transportDepot);
      if(!garage) continue;
      const source = sv.sourceX != null ? buildings.find(b=>b.x===sv.sourceX && b.y===sv.sourceY) : null;
      const dest   = sv.destX   != null ? buildings.find(b=>b.x===sv.destX   && b.y===sv.destY)   : null;
      const currentBuilding = sv.currentBuildingX != null
        ? buildings.find(b=>b.x===sv.currentBuildingX && b.y===sv.currentBuildingY) || null
        : null;
      const v = createPersistentVehicle(sv.vtype, garage, sv.id ?? null);
      if(!v) continue;
      if(sv.name != null) v.name = sv.name;
      else if(v.vtype === 'train') assignTrainVehicleName(v);
      v.source = source || null;
      v.dest = dest || null;
      v.currentBuilding = currentBuilding || (sv.state === 'idle' ? garage : null);
      v.cargo = sv.cargo || 0;
      v.res = sv.res || null;
      v.pinnedRes = sv.pinnedRes || null;
      if(sv.engineMult != null) v.engineMult = sv.engineMult;
      v.waitTimer = sv.waitTimer || 0;
      v.depotDepartureArmed = !!sv.depotDepartureArmed;
      v.boughtAtGtime = sv.boughtAtGtime ?? v.boughtAtGtime;
      v.maintenanceDaysPaid = sv.maintenanceDaysPaid ?? v.maintenanceDaysPaid;
      v.signalWaitTime = sv.signalWaitTime || 0;
      v.missingRailTimer = sv.missingRailTimer || 0;
      v.currentRailBlock = sv.currentRailBlock ?? -1;
      v.pendingFreightRevenue = sv.pendingFreightRevenue || 0;
      v.freightRevenueFireAt = sv.freightRevenueFireAt ?? null;
      v.railTollOwed = sv.railTollOwed ? { ...sv.railTollOwed } : {};
      // Migration : les anciennes sauvegardes n'ont pas atDepot. On l'infère
      // depuis l'état : idle sans path ni trail = train réellement au dépôt.
      v.atDepot = sv.atDepot != null
        ? !!sv.atDepot
        : (sv.state === 'idle' && (!Array.isArray(sv.pathTiles) || sv.pathTiles.length === 0) && (!Array.isArray(sv.railTrail) || sv.railTrail.length === 0));
      if(Array.isArray(sv.wagons)) v.wagons = sv.wagons
        .map(w => typeof w === 'string'
          ? trainCreateWagon(w)
          : (w && typeof w === 'object' ? trainCreateWagon(w.type, w.resource || null) : null))
        .filter(Boolean);
      if(v.vtype === 'train') trainNormalizeWagons(v);
      if(Array.isArray(sv.orders)){
        v.orders = sv.orders
          .map(o => buildings.find(b => b.x === o.x && b.y === o.y))
          .filter(Boolean);
      }
      if(Number.isInteger(sv.orderIndex)) v.orderIndex = sv.orderIndex;
      if(Array.isArray(sv.orderModes)) v.orderModes = sv.orderModes.slice();
      if(sv.cargoLoadStopX != null)
        v.cargoLoadStop = buildings.find(b => b.x === sv.cargoLoadStopX && b.y === sv.cargoLoadStopY) || null;
      if(v.vtype === 'train') syncTrainOrders(v);
      if(sv.busRouteDistance != null) v.busRouteDistance = sv.busRouteDistance;
      if(sv.passengersOnBoard != null) v.passengersOnBoard = sv.passengersOnBoard;
      if(sv.passengersFromStationX != null){
        v.passengersFromStation = buildings.find(b => b.x === sv.passengersFromStationX && b.y === sv.passengersFromStationY && b.type === 'train_station') || null;
      }
      if(v.source && v.dest && !vehicleCanServeRoute(v, v.res)){
        v.source = null; v.dest = null; v.cargo = 0; v.res = null;
        continue;
      }
      v.state = sv.state || 'idle';
      if(v.vtype === 'train'){
        if(Array.isArray(sv.railTrail))
          v.railTrail = sv.railTrail.filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y)).map(p => ({ x:p.x, y:p.y }));
        if(Array.isArray(sv.pathTiles) && sv.pathTiles.length){
          v.pathTiles = sv.pathTiles.slice();
          v.pts = v.pathTiles.map(idx => ({ x:(idx % N) * TILE + TILE / 2, y:((idx / N) | 0) * TILE + TILE / 2 }));
          v.seg = Math.max(0, Math.min((sv.seg || 0), Math.max(0, v.pts.length - 1)));
          v.t = Math.max(0, Math.min(1, sv.t || 0));
          v.railContinueTile = sv.railContinueTile ?? null;
          v.railPreviousTile = sv.railPreviousTile ?? null;
          ensureTrainTrail(v);
        } else if(source && dest && sv.state !== 'idle'){
          const from = currentBuilding || (sv.state === 'to_dest' ? source : garage);
          const to   = sv.state === 'to_dest' ? dest : source;
          const leg = findRailPath(from, to);
          if(leg){
            v.pts = leg.pts;
            v.pathTiles = leg.tiles;
          }
        }
        if(v.orders?.length >= 2){
          const viz = [];
          for(let i = 0; i < v.orders.length; i++){
            const from = v.orders[i], to = v.orders[(i + 1) % v.orders.length];
            const leg = findRailPath(from, to);
            if(leg?.pts?.length) viz.push(...leg.pts);
          }
          v.vizRoute = { fwd: viz, bwd: [] };
        } else if(source && dest){
          const fwd = findRailPath(source, dest);
          const bwd = findRailPath(dest, source);
          v.vizRoute = { fwd: fwd?.pts || [], bwd: bwd?.pts || [] };
        }
      } else {
        if(Array.isArray(sv.pts) && sv.pts.length){
          v.pts = sv.pts.map(p => ({ x:p.x, y:p.y }));
          v.seg = Math.max(0, Math.min((sv.seg || 0), Math.max(0, v.pts.length - 1)));
          v.t = Math.max(0, Math.min(1, sv.t || 0));
        } else if(source && dest && sv.state !== 'idle'){
          const from = currentBuilding || (sv.state === 'to_dest' ? source : garage);
          const to   = sv.state === 'to_dest' ? dest : source;
          const pts = findRoadPath(from, to);
          if(pts) v.pts = pts;
        }
        if(source && dest){
          const fwd = findRoadPath(source, dest);
          const bwd = findRoadPath(dest, source);
          v.vizRoute = { fwd: fwd || [], bwd: bwd || [] };
        }
      }
    }
  }
  if(Array.isArray(d.trucks)){
    for(const st of d.trucks){
      const from = st.fromX != null ? buildings.find(b => b.x === st.fromX && b.y === st.fromY) : null;
      const target = st.targetX != null ? buildings.find(b => b.x === st.targetX && b.y === st.targetY) : null;
      if(!from || !target || !Array.isArray(st.pts) || st.pts.length < 2) continue;
      const truckId = st.id ?? nextTruckId++;
      if(Number.isFinite(Number(truckId))) nextTruckId = Math.max(nextTruckId, Number(truckId) + 1);
      trucks.push({
        id: truckId,
        pts: st.pts.map(p => ({ x:p.x, y:p.y })),
        seg: Math.max(0, Math.min((st.seg || 0), Math.max(0, st.pts.length - 1))),
        t: Math.max(0, Math.min(1, st.t || 0)),
        res: st.res || null,
        amt: st.amt || 0,
        target,
        from,
        overtaking: !!st.overtaking,
      });
    }
  }
  // Le compteur trucksOut doit refléter exactement les camions réellement présents.
  // Une sauvegarde non transitoire écrit trucks:[] mais a pu conserver un trucksOut > 0 ;
  // recharger cela bloquerait définitivement le dispatch (sortie saturée → toutes les
  // usines à l'arrêt). On le reconstruit depuis les camions effectivement chargés.
  for(const b of buildings) b.trucksOut = 0;
  for(const tk of trucks) if(tk.from) tk.from.trucksOut++;
  if(Array.isArray(d.walkers)){
    for(const sw of d.walkers){
      if(!Array.isArray(sw.pts) || sw.pts.length < 2) continue;
      const target = sw.targetX != null ? buildings.find(b => b.x === sw.targetX && b.y === sw.targetY) || null : null;
      walkers.push({
        pts: sw.pts.map(p => ({ x:p.x, y:p.y })),
        seg: Math.max(0, Math.min((sw.seg || 0), Math.max(0, sw.pts.length - 1))),
        t: Math.max(0, Math.min(1, sw.t || 0)),
        target,
        leaving: !!sw.leaving,
        fromHomeless: !!sw.fromHomeless,
        protectedResident: !!sw.protectedResident,
        col: sw.col || playerColor(target?.owner ?? null),
        phase: Number.isFinite(sw.phase) ? sw.phase : 0,
      });
    }
  }
  if(Array.isArray(d.floats)){
    floats = d.floats
      .filter(f => Number.isFinite(f?.x) && Number.isFinite(f?.y) && Number.isFinite(f?.life))
      .map(f => ({ x:f.x, y:f.y, txt:f.txt || '', col:f.col || '#fff', life:f.life }));
  }
  // Valider immédiatement les choix ferroviaires restaurés, même lorsque la
  // sauvegarde est chargée en pause. Un train au milieu d'une arête conserve
  // sa position et sera réévalué sur la prochaine tuile.
  rebuildRailBlockOccupancy();
  for(const v of vehicles){
    if(v.vtype !== 'train' || v.state === 'idle' || !v.pathTiles?.length) continue;
    v.railPlannedJunctionTile = -1;
    v.railDecisionPreviousTile = v.seg > 0 ? (v.pathTiles[v.seg - 1] ?? null) : null;
    if(v.t <= 1e-6 && (trainAtRailJunction(v) || trainEdgeHasFacingSignal(v)))
      replanTrainAtSignal(v);
  }
  refreshExpansionSlots();
  remapOwnerId();
  selected = findSnapshotBuildingRef(prevSelectedRef);
  selectedVehicle = prevSelectedVehicleId != null ? findSnapshotVehicleRef(prevSelectedVehicleId) : null;
  focusVehicle = prevFocusVehicleId != null ? findSnapshotVehicleRef(prevFocusVehicleId) : null;
  if(!focusVehicle) camTracking = false;
  if(typeof trainConfigVehicle !== 'undefined'){
    trainConfigVehicle = prevTrainConfigVehicleId != null ? findSnapshotVehicleRef(prevTrainConfigVehicleId) : null;
    if(!trainConfigVehicle){
      trainConfigSelectedWagonIndex = -1;
      trainConfigLocoSelected = false;
    }
  }
}

// ---- patch minimal d'une action entrante ----
function applyAction(msg){
  const { act } = msg;
  if(!act || typeof act.type !== 'string') return;
  const validIdx = i => Number.isInteger(i) && i >= 0 && i < N*N;
  const validXY = (x,y) => Number.isInteger(x) && Number.isInteger(y) && inMap(x,y);
  switch(act.type){
    case 'road':
      if(validIdx(act.i)) road[act.i] = 1;
      break;
    case 'rail_update':
      if(!validXY(act.x, act.y) || !Number.isInteger(act.mask) || act.mask < 0 || act.mask > 255) break;
      // Refuser toute modification de rail sous un train en mouvement (anti train fantôme)
      if(tileOccupiedByTrain(act.x, act.y)){
        if(act.costDelta > 0){
          // Rembourser l'expéditeur puisqu'on annule son action
          earnMoney(act.costDelta, 'rembours', walletOf(msg.from));
        }
        break;
      }
      if(msg.fromUsername) walletOf(msg.from).username = msg.fromUsername;
      {
        const ri = act.y*N+act.x;
        const wasEmpty = !rail[ri];
        rail[ri] = act.mask;
        if(!act.mask) railOwner[ri] = -1;
        else if(wasEmpty) railOwner[ri] = (msg.from == null ? -1 : msg.from);
      }
      rebuildRailBlocks();
      if(act.costDelta > 0){
        walletOf(msg.from).money -= act.costDelta;
        walletOf(msg.from).fin.construction += act.costDelta;
      } else if(act.costDelta < 0){
        earnMoney(-act.costDelta, 'rembours', walletOf(msg.from));
      }
      break;
    case 'rail_signal_update':
      if(!validXY(act.x, act.y) || !Number.isInteger(act.bit)) break;
      if(act.present) setRailSignal(act.x, act.y, act.bit, true, !!act.forcedRed, act.kind || 'block');
      else setRailSignal(act.x, act.y, act.bit, false);
      if(act.costDelta > 0){
        walletOf(msg.from).money -= act.costDelta;
        walletOf(msg.from).fin.construction += act.costDelta;
      } else if(act.costDelta < 0){
        earnMoney(-act.costDelta, 'rembours', walletOf(msg.from));
      }
      break;
    case 'bulldoze_road':
      if(validIdx(act.i)){ road[act.i] = 0; earnMoney(3, 'rembours', walletOf(msg.from)); }
      break;
    case 'bulldoze_tree':
      if(validIdx(act.i)) terrain[act.i] = T.GRASS;
      break;
    case 'terraform':
      if(validIdx(act.i)) terrain[act.i] = T.GRASS;
      break;
    case 'fill_water': {
      if(!validIdx(act.i) || !validXY(act.depotX, act.depotY)) break;
      terrain[act.i] = T.GRASS;
      const depot = bgrid[act.depotY*N+act.depotX];
      if(depot && depot.type === 'terrassement')
        depot.storage['dirt'] = Math.max(0, (depot.storage['dirt']||0) - FILL_WATER_COST);
      break;
    }
    case 'bulldoze_bld': {
      if(!validXY(act.bx, act.by)) break;
      const b = bgrid[act.by*N+act.bx];
      if(!b) break;
      // valider le droit de démolition côté receveur aussi
      if(b.owner && b.owner !== msg.from) break;
      if(depotHasStoredVehicles(b)) break;
      demolishBuilding(b, msg.from);
      break;
    }
    case 'build': {
      if(!BUILD[act.btype] || !validXY(act.x, act.y)) break;
      const cost = BUILD[act.btype].cost||0;
      const wSender = walletOf(msg.from);
      if(msg.fromUsername) wSender.username = msg.fromUsername;
      if(act.btype === 'train_station'){
        const info = trainStationPlacementInfo(act.x, act.y, msg.from);
        if(!info.ok) break;
        const b = placeTrainStationTile(act.x, act.y, msg.from);
        if(!b) break;
        wSender.money -= cost; wSender.fin.construction += cost;
        break;
      }
      if(act.btype === 'road'){
        // rail[] autorisé : passage à niveau (route par-dessus un rail)
        if(bgrid[act.y*N+act.x] || road[act.y*N+act.x]) break;
        road[act.y*N+act.x] = 1;
        wSender.money -= cost; wSender.fin.construction += cost;
        break;
      }
      if(road[act.y*N+act.x] || rail[act.y*N+act.x] || bgrid[act.y*N+act.x]) break;
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
      if(!validXY(act.x, act.y)) break;
      const b = bgrid[act.y*N+act.x];
      if(!b || !BUILD[b.type]?.ind) break;
      if(b.owner && b.owner !== msg.from) break;
      b.paused = !!act.paused;
      break;
    }
    case 'toggle_out_block': {
      if(!validXY(act.x, act.y) || typeof act.res !== 'string') break;
      const b = bgrid[act.y*N+act.x];
      if(!b || !BUILD[b.type]?.ind) break;
      if(b.owner && b.owner !== msg.from) break;
      if(!b.blockedOut) b.blockedOut = {};
      b.blockedOut[act.res] = !!act.blocked;
      break;
    }
    case 'clear_bld_stock': {
      if(!validXY(act.x, act.y)) break;
      const b = bgrid[act.y*N+act.x];
      if(!b || !BUILD[b.type]?.ind) break;
      if(b.owner && b.owner !== msg.from) break;
      b.storage = {}; b.inc = {};
      break;
    }
    case 'upgrade_plant': {
      if(!validXY(act.x, act.y) || !BUILD[act.targetType]) break;
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
    case 'buy_vehicle': {
      if(!VEHICLE_TYPES[act.vtype]) break;
      if(!validXY(act.garageX, act.garageY)) break;
      const garage = buildings.find(b=>b.x===act.garageX && b.y===act.garageY && BUILD[b.type]?.transportDepot);
      if(!garage || !mpSenderControlsOwner(garage.owner, msg)) break;
      if(vehicles.some(v=>String(v.id) === String(act.id))) break;
      const cost = VEHICLE_TYPES[act.vtype].cost || 0;
      const wSender = walletOf(msg.from);
      wSender.money -= cost;
      wSender.fin.construction = (wSender.fin.construction||0) + cost;
      const v = createPersistentVehicle(act.vtype, garage, act.id);
      if(v?.vtype === 'train') assignTrainVehicleName(v);
      break;
    }
    case 'sell_vehicle': {
      const v = vehicles.find(v=>String(v.id) === String(act.id));
      if(!v || !mpSenderControlsOwner(v.garageRef?.owner, msg)) break;
      const refund = Math.floor((VEHICLE_TYPES[v.vtype]?.cost||0) * 0.5);
      walletOf(msg.from).money += refund;
      walletOf(msg.from).fin.rembours = (walletOf(msg.from).fin.rembours||0) + refund;
      removePersistentVehicle(v);
      break;
    }
    case 'route_vehicle': {
      const v = vehicles.find(v=>String(v.id) === String(act.id));
      if(!v || !mpSenderControlsOwner(v.garageRef?.owner, msg)) break;
      if(v.vtype === 'train' && Array.isArray(act.orders)){
        v.orders = act.orders
          .map(o => validXY(o.x, o.y) ? buildings.find(b => b.x===o.x && b.y===o.y) : null)
          .filter(Boolean);
        v.orderIndex = Number.isInteger(act.orderIndex) ? act.orderIndex : 0;
        if(Array.isArray(act.orderModes)) v.orderModes = act.orderModes.slice();
        if(!syncTrainOrders(v) || !vehicleCanServeRoute(v)){ v.orders = []; v.source = null; v.dest = null; break; }
        v.state = 'idle';
        v.currentBuilding = v.garageRef;
        v.pts = [];
        v.pathTiles = [];
        v.railTrail = [];
        v.railContinueTile = null;
        v.railPreviousTile = null;
        v.waitTimer = 0;
        resetTrainDepotDeparture(v);
      } else {
        if(!validXY(act.sourceX, act.sourceY) || !validXY(act.destX, act.destY)) break;
        const source = buildings.find(b=>b.x===act.sourceX && b.y===act.sourceY);
        const dest   = buildings.find(b=>b.x===act.destX   && b.y===act.destY);
        if(!source || !dest) break;
        // Réconcilier la propriété périmée des extrémités : leurs ID owner sont
        // aussi volatils que ceux des dépôts (cf. mp-owner-id-instability). Sans
        // ça, l'égalité stricte de canUseBuilding échoue et la route est rejetée
        // alors que l'expéditeur route bien entre SES propres bâtiments. Aucun
        // effet sur un bâtiment d'un autre joueur (mpSenderControlsOwner ne
        // remappe que les anciens ID du même nom d'utilisateur).
        mpSenderControlsOwner(source.owner, msg);
        mpSenderControlsOwner(dest.owner, msg);
        if(!vehicleRouteEndpointOk(source, v.vtype, msg.from) || !vehicleRouteEndpointOk(dest, v.vtype, msg.from)) break;
        v.source = source;
        v.dest = dest;
        if(!vehicleCanServeRoute(v)){ v.source = null; v.dest = null; break; }
      }
      if(v.vtype !== 'train'){
        if(vehiclePresentAtDepot(v)){
          v.state = 'idle';
          v.pts = [];
          v.seg = 0;
          v.t = 0;
          v.currentBuilding = v.garageRef;
          v.atDepot = true;
          v.cargo = 0;
          v.res = null;
          resetVehicleDepotDeparture(v);
        } else startVehicleRoute(v);
      }
      break;
    }
    case 'train_depot_flag':
    case 'depot_departure_flag': {
      const v = vehicles.find(v=>String(v.id) === String(act.id));
      if(!v || !mpSenderControlsOwner(v.garageRef?.owner, msg)) break;
      setVehicleDepotDeparture(v, !!act.armed);
      break;
    }
    case 'pin_vehicle_res': {
      const v = vehicles.find(v=>String(v.id) === String(act.id));
      if(!v || !mpSenderControlsOwner(v.garageRef?.owner, msg)) break;
      const vt = VEHICLE_TYPES[v.vtype];
      v.pinnedRes = (act.res && vt?.resources.includes(act.res)) ? act.res : null;
      if(v.pinnedRes && v.res && v.res !== v.pinnedRes){ v.cargo = 0; v.res = null; }
      break;
    }
    case 'configure_train': {
      const v = vehicles.find(v=>String(v.id) === String(act.id));
      if(!v || !mpSenderControlsOwner(v.garageRef?.owner, msg) || v.vtype !== 'train') break;
      v.wagons = Array.isArray(act.wagons) ? act.wagons
        .map(w => typeof w === 'string'
          ? trainCreateWagon(w)
          : (w && typeof w === 'object' ? trainCreateWagon(w.type, w.resource || null) : null))
        .filter(Boolean) : [];
      if(typeof act.engineMult === 'number' && act.engineMult >= 1) v.engineMult = act.engineMult;
      if(v.res && trainWagonCapacityForRes(v, v.res) < v.cargo){ v.cargo = 0; v.res = null; }
      break;
    }
    case 'return_vehicle': {
      const v = vehicles.find(v=>String(v.id) === String(act.id));
      if(!v || !mpSenderControlsOwner(v.garageRef?.owner, msg)) break;
      returnToGarage(v);
      break;
    }
    case 'merge_towns': {
      if(!Number.isInteger(act.dstId) || !Number.isInteger(act.srcId)) break;
      const dst = towns.find(t=>t.id===act.dstId);
      const src = towns.find(t=>t.id===act.srcId);
      if(!dst || !src) break;
      mergeTowns(act.dstId, act.srcId);
      break;
    }
    case 'zone_reassign': {
      if(!Number.isInteger(act.dstId) || !validXY(act.x1, act.y1) || !validXY(act.x2, act.y2)) break;
      if(act.newTown){
        // Créer le nouveau village si nécessaire (venant d'un autre joueur)
        if(!towns.find(t=>t.id===act.newTown.id)){
          towns.push({ id:act.newTown.id, name:act.newTown.name, cx:act.newTown.cx, cy:act.newTown.cy });
          nextTownId = Math.max(nextTownId, act.newTown.id + 1);
        }
      }
      const dst = towns.find(t=>t.id===act.dstId);
      if(!dst) break;
      reassignBuildingsInRect(act.dstId, act.x1, act.y1, act.x2, act.y2, act.owner);
      break;
    }
    case 'rename_bus_stop': {
      if(!validXY(act.x, act.y)) break;
      const b = bgrid[act.y*N+act.x];
      if(!b || b.type !== 'bus_stop') break;
      if(b.owner && b.owner !== msg.from) break;
      b.name = act.name || null;
      break;
    }
    case 'owner_remap':
      if(!Number.isInteger(act.oldId) || !Number.isInteger(act.newId)) break;
      applyOwnerRemap(act.oldId, act.newId);
      break;
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
    MP.awaitingSnapshot = false;
    mpResetGuestSnapshotBuffer();
    mpStateSyncTimer = 0;
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
    MP.rooms = [];
    MP.shutdownNotice = false;
    MP.awaitingSnapshot = false;
    mpResetGuestSnapshotBuffer();
    mpStateSyncTimer = 0;
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
      case 'rooms_list':
        MP.rooms = msg.rooms || [];
        mpUpdateUI();
        mpRenderRooms();
        break;

      case 'left_room':
        MP.role = null;
        MP.myId = null;
        MP.isAdmin = false;
        MP.roomId = null;
        MP.roomName = null;
        MP.roomSaveName = null;
        MP.players = [];
        MP.ownerColors = {};
        MP.cursors = {};
        MP.awaitingSnapshot = false;
        mpResetGuestSnapshotBuffer();
        mpStateSyncTimer = 0;
        document.title = 'Factopolis';
        genWorld(WORLD_DEFAULTS);
        mpUpdateUI();
        mpRenderPlayerList();
        break;

      case 'room_err':
        toast('⛔ ' + msg.msg, 'err');
        break;

      case 'hello':
        MP.myId    = msg.id;
        MP.myColor = msg.color;
        MP.myName  = msg.name;
        MP.role    = msg.role;
        MP.isAdmin = !!msg.isAdmin;
        MP.roomId       = msg.roomId       ?? null;
        MP.roomName     = msg.roomName     ?? null;
        MP.roomSaveName = msg.saveName     ?? msg.roomName ?? null;
        MP.awaitingSnapshot = msg.role === 'guest';
        mpResetGuestSnapshotBuffer();
        mpStateSyncTimer = 0;
        document.title = MP.roomName ? 'Factopolis — ' + MP.roomName : 'Factopolis';
        if(msg.worldConfig) WORLD = normalizeWorldConfig(msg.worldConfig);
        adoptSoloHomeless(MP.myId);
        ensureHomelessForOwner(MP.myId);
        resetSelectedTown();
        toast((msg.role==='host' ? '👑 Tu es l\'hôte' : '👥 Tu as rejoint la partie')+' (#'+msg.id+')');
        mpUpdateUI();
        mpRenderSaves();
        renderAutoSaves();
        mpRequestRoomSaves(); // sauvegardes de la room (carte), pas du joueur
        break;

      case 'promoted_host':
        MP.role = 'host';
        MP.isAdmin = false;
        mpStateSyncTimer = 0;
        if(msg.worldConfig) WORLD = normalizeWorldConfig(msg.worldConfig);
        toast('👑 Tu es maintenant l\'hôte de la partie');
        mpUpdateUI();
        mpRenderSaves();
        mpRequestRoomSaves();
        break;

      case 'admin_promoted':
        MP.isAdmin = true;
        toast('🛡️ Tu es maintenant administrateur');
        mpUpdateUI();
        mpRenderSaves();
        mpRequestRoomSaves();
        break;

      case 'admin_demoted':
        MP.isAdmin = false;
        toast('🛡️ Tes droits administrateur ont été retirés');
        mpUpdateUI();
        mpRenderSaves();
        break;

      case 'admin_changed':
        if(msg.playerId === MP.myId) MP.isAdmin = !!msg.isAdmin;
        toast(msg.isAdmin ? '🛡️ Un joueur a été promu administrateur' : '🛡️ Un joueur a perdu ses droits administrateur');
        mpUpdateUI();
        break;

      case 'snapshot_request':
        // l'hôte envoie l'état complet à un invité
        if(MP.role === 'host'){
          MP.ws.send(JSON.stringify({
            type:'snapshot', forId: msg.forId,
            state: serializeState({ includeTransient:true }),
          }));
        }
        break;

      case 'snapshot':
        // l'invité reçoit l'état initial
        mpResetGuestSnapshotBuffer();
        mpPushGuestRenderSnapshot(msg.state);
        applySnapshot(msg.state);
        MP.awaitingSnapshot = false;
        resetSelectedTown();
        toast('📥 Carte synchronisée');
        break;

      case 'state_sync':
        if(MP.role === 'guest' && !MP.awaitingSnapshot && msg.state){
          mpPushGuestRenderSnapshot(msg.state);
          applyStateSync(msg.state);
        }
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

      case 'player_list': {
        MP.players = msg.players;
        for(const p of MP.players){
          if(p?.id != null && p.color) MP.ownerColors[p.id] = p.color;
        }
        MP.isAdmin = !!(MP.players.find(p=>p.id===MP.myId)||{}).isAdmin;
        for(const p of MP.players) ensureHomelessForOwner(p.id);
        // Synchroniser la couleur du joueur local si elle a changé (après auth)
        const myEntry = MP.players.find(p=>p.id===MP.myId);
        if(myEntry && myEntry.color !== MP.myColor){ MP.myColor = myEntry.color; }
        for(const h of homeless) h.col = playerColor(h.owner);
        for(const p of MP.players) assignHomelessToHousing(p.id);
        ensureSelectedTown();
        mpUpdateUI();
        mpRenderPlayerList();
        // mettre à jour les couleurs des curseurs
        for(const p of MP.players)
          if(MP.cursors[p.id]) MP.cursors[p.id].color = p.color;
        break;
      }

      case 'player_left':
        delete MP.cursors[msg.id];
        if(msg.id !== MP.myId){
          const leaverName = msg.username || msg.name || ('Joueur #'+msg.id);
          toast('👤 '+leaverName+' a quitté la partie');
        }
        mpRenderPlayerList();
        break;

      case 'host_absent':
        if(!paused){ paused = true; $('bPause').textContent = '▶'; $('bPause').classList.add('on'); }
        toast('⏸ L\'hôte a quitté — partie en pause en attendant un hôte');
        mpUpdateUI();
        break;

      case 'auth_ok':
        MP.username = msg.username;
        MP.token    = msg.token;
        MP.myColor  = msg.color;
        MP.myName   = msg.username;
        if(MP.myId != null && msg.color) MP.ownerColors[MP.myId] = msg.color;
        MP.prevOwnerId = null;
        // Stocker l'ancien id de connexion fourni par le serveur pour le remappage
        if(msg.prevOwnerId != null && msg.prevOwnerId !== MP.myId) MP.prevOwnerId = msg.prevOwnerId;
        // Fallback : chercher dans le registry sauvegardé (cas redémarrage serveur)
        if(!MP.prevOwnerId && MP.savedRegistry){
          const fromSave = MP.savedRegistry[msg.username];
          if(fromSave != null && Number(fromSave) !== MP.myId) MP.prevOwnerId = Number(fromSave);
        }
        for(const h of homeless) if(h.owner === MP.myId) h.col = msg.color;
        localStorage.setItem('fp_token', msg.token);
        $('mpAuthPwd').value = '';
        mpShowAuthError('');
        toast('👤 Connecté en tant que ' + msg.username);
        // Relier l'ancien id aux données déjà chargées (si snapshot déjà arrivé)
        remapOwnerId();
        resetSelectedTown();
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
        if(!mpIsAutoSaveName(msg.name)) MP.roomSaveName = msg.name;
        document.title = 'Factopolis — ' + (MP.roomName || msg.name);
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
        if(!mpIsAutoSaveName(msg.name)) MP.roomSaveName = msg.name;
        if(msg.savedBy !== MP.username)
          toast('💾 '+msg.savedBy+' a sauvegardé la partie : "'+msg.name+'"');
        break;

      case 'game_loaded':
        if(MP.role === 'guest'){
          mpResetGuestSnapshotBuffer();
          mpPushGuestRenderSnapshot(msg.state);
        }
        applySnapshot(msg.state);
        MP.awaitingSnapshot = false;
        resetSelectedTown();
        if(msg.loadedBy !== 'serveur'){
          MP.roomSaveName = msg.name;
          mpRenderSaves();
        }
        toast('📂 Partie "'+msg.name+'" chargée par '+msg.loadedBy);
        break;

      case 'game_new_world':
        if(MP.role === 'guest'){
          mpResetGuestSnapshotBuffer();
          mpPushGuestRenderSnapshot(msg.state);
        }
        applySnapshot(msg.state);
        MP.awaitingSnapshot = false;
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

      case 'server_cmd':
        if(msg.cmd === 'regen_expansions'){
          generateExpansionTerrain();
          refreshExpansionSlots();
          toast('🌍 Terrain des zones d\'expansion régénéré par le serveur.', 'win');
        } else if(msg.cmd === 'set_money'){
          const amount = Math.round(Number(msg.amount));
          if(Number.isFinite(amount)){
            myWallet().money = amount;
            toast('💰 Solde fixé à '+amount.toLocaleString()+' $ par le serveur.', 'win');
          }
        } else if(msg.cmd === 'spawn_fields'){
          spawnFieldsOnMap(msg.fieldType, msg.count);
        }
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
  MP.rooms = [];
  MP.awaitingSnapshot = false;
  mpResetGuestSnapshotBuffer();
  mpStateSyncTimer = 0;
  mpUpdateUI();
}

function mpJoinRoom(roomId){
  if(!MP.ws || !MP.connected) return;
  MP.ws.send(JSON.stringify({ type:'join_room', roomId }));
}

function mpLeaveRoom(){
  if(!MP.ws || !MP.connected) return;
  MP.ws.send(JSON.stringify({ type:'leave_room' }));
}

function mpRenderRooms(){
  const el = $('mpRoomList');
  if(!el) return;
  const rooms = MP.rooms || [];
  if(!rooms.length){
    el.innerHTML = '<div style="color:#8fa3bf;font-size:11px;padding:6px 0">Aucun monde disponible.</div>';
    return;
  }
  el.innerHTML = rooms.map(r => {
    const count = r.playerCount || 0;
    const players = (r.players||[]).map(p=>`<span style="color:${p.color||'#ccc'}">${p.name}</span>`).join(', ') || '—';
    const size = r.worldConfig?.size || '?';
    return `<div style="background:#16202f;border-radius:6px;padding:8px;margin-bottom:6px">
      <div style="font-weight:bold;margin-bottom:2px">🌍 ${r.name}</div>
      <div style="font-size:10px;color:#6e8aa0;margin-bottom:4px">${size}×${size} · ${count} joueur${count!==1?'s':''}</div>
      ${count?`<div style="font-size:10px;margin-bottom:5px">${players}</div>`:''}
      <button class="tbtn" onclick="mpJoinRoom(${r.id})" style="width:100%;font-size:12px">Rejoindre</button>
    </div>`;
  }).join('');
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
  // Zones d'expansion cliquables quel que soit l'outil ou le contexte réseau
  if(!inMap(x,y)){
    const exp = expansions.find(e=>e.inPiece(x,y));
    if(exp){ selectedExpansion = exp; selected = null; selectedVehicle = null; hudTimer = 0; }
    return;
  }
  const i = y*N+x;
  if(tool==='select'){ clickAt(x,y); return; }
  if(!MP.connected){
    toast('🌐 Connecte-toi au serveur multijoueur pour construire','err');
    return;
  }
  if(!MP.username){
    toast('👤 Connecte-toi avec un compte joueur pour construire','err');
    return;
  }

  if(tool==='terraform'){
    const railSigDef = rail[i] ? chooseRailSignalDef(x, y) : null;
    if(bgrid[i]){
      // ne pas envoyer l'action si le bâtiment appartient à quelqu'un d'autre
      if(bgrid[i].owner && bgrid[i].owner !== MP.myId){ clickAt(x,y); return; }
      netSend({ type:'bulldoze_bld', bx:bgrid[i].x, by:bgrid[i].y });
    } else if(railSigDef && railSignalDefAt(x, y, railSigDef.bit)){
      const refund = Math.floor((BUILD.rail_signal?.cost||0) * 0.3);
      netSend({ type:'rail_signal_update', x, y, bit:railSigDef.bit, present:false, costDelta:-refund });
      setRailSignal(x, y, railSigDef.bit, false);
      earnMoney(refund, 'rembours');
    } else if(road[i]){
      netSend({ type:'bulldoze_road', i });
    } else if(rail[i]){
      const occ = tileOccupiedByTrain(x, y);
      if(occ){ toast('⛔ Un train occupe cette voie','err'); return; }
      const { updates, refund } = collectRailRemovalUpdates(x, y);
      if(updates.length){
        let first = true;
        for(const update of updates){
          netSend({ type:'rail_update', x:update.x, y:update.y, mask:update.mask, costDelta:first ? -refund : 0 });
          first = false;
        }
        railApplyMaskUpdates(updates, -refund);
      }
    } else if(terrain[i]===T.TREE || terrain[i]===T.WHEAT || terrain[i]===T.COTTON){
      netSend({ type:'bulldoze_tree', i });
    } else if(terrain[i]===T.IRON || terrain[i]===T.COAL){
      netSend({ type:'terraform', i });
    }
    clickAt(x,y);
    return;
  }
  if(tool==='fill_water'){
    const ter = terrain[i];
    if(ter === T.WATER){
      const depot = terrassementNear(x, y, MP.myId);
      if(depot){
        netSend({ type:'fill_water', i, depotX: depot.x, depotY: depot.y });
        clickAt(x,y); // applique localement (sans re-envoyer)
      } else {
        clickAt(x,y); // affiche le message d'erreur
      }
    }
    return;
  }
  if(tool==='rail'){
    const { updates, cost, msg } = collectRailUpdates([{ x, y }]);
    if(!updates.length){ if(msg) toast(msg, 'err'); else clickAt(x,y); return; }
    if(cost > myWallet().money){ toast('Fonds insuffisants ('+cost+' $)','err'); return; }
    let first = true;
    for(const update of updates){
      netSend({ type:'rail_update', x:update.x, y:update.y, mask:update.mask, costDelta:first ? cost : 0 });
      first = false;
    }
    railApplyMaskUpdates(updates, cost);
    return;
  }
  if(tool==='rail_signal' || tool==='rail_signal2'){
    const def = chooseRailSignalDef(x, y);
    if(!def){ clickAt(x,y); return; }
    // Cycle au clic : (aucun) -> feu vert -> feu rouge forcé -> retiré.
    const sig = railSignalDefAt(x, y, def.bit);
    let present = true, forcedRed = false, delta = 0;
    let kind = tool === 'rail_signal2' ? 'junction' : 'block';
    if(!sig){
      delta = BUILD[tool]?.cost || 0;
    } else if(!sig.forcedRed){
      forcedRed = true;
      kind = sig.kind || 'block';
    } else {
      present = false;
      delta = -Math.floor((BUILD[tool]?.cost||0) * 0.3);
    }
    if(delta > 0 && delta > myWallet().money){ toast('Fonds insuffisants ('+delta+' $)','err'); return; }
    netSend({ type:'rail_signal_update', x, y, bit:def.bit, present, forcedRed, kind, costDelta:delta });
    setRailSignal(x, y, def.bit, present, forcedRed, kind);
    if(delta > 0) spendMoney(delta, 'construction');
    else if(delta < 0) earnMoney(-delta, 'rembours');
    return;
  }
  const v = canPlace(tool,x,y);
  if(!v.ok){ clickAt(x,y); return; }
  if((BUILD[tool].cost||0) > myWallet().money){ clickAt(x,y); return; }
  netSend({ type:'build', btype:tool, x, y });
  clickAt(x,y);
};

function applyRailPathWithNetwork(path){
  const { updates, cost, msg } = collectRailUpdates(path);
  if(!updates.length){
    if(msg) toast(msg, 'err');
    return false;
  }
  let first = true;
  for(const update of updates){
    netSend({ type:'rail_update', x:update.x, y:update.y, mask:update.mask, costDelta:first ? cost : 0 });
    first = false;
  }
  railApplyMaskUpdates(updates, cost);
  return true;
}

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
<div class="panel-head">
  <h3 style="font-size:15px">🌐 Multijoueur</h3>
  <button class="tbtn" id="mpBtnClose" aria-label="Fermer">✕</button>
</div>

<!-- connexion au serveur -->
<div id="mpConnBlock">
  <input id="mpUrl" type="text" placeholder="ws://localhost:8765"
    value="${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws" style="${INP}">
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

<!-- lobby : liste des mondes (visible quand connecté mais pas encore dans une partie) -->
<div id="mpLobbyBlock" style="display:none">
  <div style="border-top:1px solid #36465e;margin:8px 0"></div>
  <div style="color:#8fa3bf;font-size:11px;margin-bottom:6px">🌍 Mondes disponibles</div>
  <div id="mpRoomList"></div>
  <div id="mpCreateRoomBlock" style="display:none;margin-top:6px">
    <div style="border-top:1px solid #36465e;margin:8px 0"></div>
    <input id="mpNewRoomName" type="text" placeholder="Nom du nouveau monde" style="${INP}">
    <button class="tbtn" id="mpBtnCreateRoom" style="width:100%">+ Créer un monde</button>
    <div id="mpRoomErr" style="color:#ff9a8a;font-size:11px;min-height:14px;margin-top:4px"></div>
  </div>
</div>

<!-- contenu de jeu (visible uniquement quand dans une partie) -->
<div id="mpGameBlock" style="display:none">

<div style="border-top:1px solid #36465e;margin:8px 0"></div>
<button class="tbtn" id="mpBtnLeaveRoom" style="width:100%;margin-bottom:6px;font-size:11px">← Quitter la partie</button>

<!-- section saves -->
<div id="mpNewBlock" style="display:none">
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
    <label style="display:block;color:#8fa3bf;font-size:11px">Champs de coton (%)</label>
    <input id="mpResCotton" type="number" min="0" max="40" step="0.5" style="${INP}">
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

<!-- sauvegardes auto -->
<div id="mpAutoSaveBlock" style="display:none">
  <div style="border-top:1px solid #36465e;margin:8px 0"></div>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
    <div style="color:#8fa3bf;font-size:11px">🔄 Sauvegardes auto</div>
    <span id="autoSaveCountdown" style="color:#6e8aa0;font-size:10px"></span>
  </div>
  <div id="autoSaveList" style="max-height:130px;overflow-y:auto;margin-bottom:4px"></div>
</div>

<!-- joueurs connectés -->
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
</div>

</div>`;

  document.body.appendChild(panel);
  ensurePanelDragHandle('mpPanel');
  makePanelDraggable('mpPanel');

  // --- événements ---
  $('mpBtnClose').onclick = ()=> $('mpPanel').style.display = 'none';
  $('mpBtnConn').onclick = ()=> mpConnect($('mpUrl').value.trim() || `${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);
  $('mpBtnDisc').onclick = mpDisconnect;
  $('mpBtnSwitchAccount').onclick = mpLogoutAccount;
  $('mpBtnLeaveRoom').onclick = mpLeaveRoom;
  $('mpBtnCreateRoom').onclick = ()=>{
    const name = $('mpNewRoomName').value.trim();
    if(!name){ $('mpRoomErr').textContent = 'Entre un nom de monde'; return; }
    $('mpRoomErr').textContent = '';
    MP.ws.send(JSON.stringify({ type:'create_room', name }));
  };
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

  $('mpBtnNewWorld').onclick = async ()=>{
    if(!mpHasAdminRights()){ $('mpWorldErr').textContent = 'Réservé à l’hôte/admin'; return; }
    if(!await confirmAction('Créer une nouvelle carte ?\nLa partie en cours sera remplacée pour tous les joueurs.', {
      title: 'Nouvelle carte',
      okText: 'Créer',
      danger: true,
    })) return;
    const config = normalizeWorldConfig({
      size: $('mpWorldSize').value,
      maxPlayers: $('mpMaxPlayers').value,
      resources: {
        tree: $('mpResTree').value,
        wheat: $('mpResWheat').value,
        cotton: $('mpResCotton').value,
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

  const inGame = MP.connected && MP.role !== null;
  const inLobby = MP.connected && MP.role === null;

  if(MP.connected){
    const sp = $('splash'); if(sp) sp.style.display = 'none';
    conn.style.display = 'none';
    disc.style.display = '';
    $('mpAuthBlock').style.display = MP.username ? 'none' : '';
    $('mpAccountBlock').style.display = MP.username ? '' : 'none';

    // lobby
    $('mpLobbyBlock').style.display = inLobby ? '' : 'none';
    $('mpCreateRoomBlock').style.display = (inLobby && MP.username) ? '' : 'none';

    // game
    $('mpGameBlock').style.display = inGame ? '' : 'none';

    if(inGame){
      // Sauvegardes (manuelles + auto) : réservées à l'hôte/admin, qui seul
      // peut sauvegarder ou charger la partie pour tous les joueurs. Les invités
      // ne voient pas du tout ces sections.
      const hasRights = mpHasAdminRights() && !!MP.username;
      $('mpSaveBlock').style.display = hasRights ? '' : 'none';
      $('mpNewBlock').style.display = hasRights ? '' : 'none';
      $('mpAutoSaveBlock').style.display = hasRights ? '' : 'none';
      $('mpBtnSave').disabled = !hasRights;
      $('mpSaveLock').textContent = '';
    }

    // boutons vitesse/pause : réservés à l'hôte/admin en multijoueur
    const canControl = !MP.connected || !inGame || mpHasAdminRights();
    $('bPause').disabled = !canControl;
    document.querySelectorAll('.spd').forEach(b => { b.disabled = !canControl; });

    if(MP.username){
      const roleIcon = MP.role==='host'?'👑 ':MP.isAdmin?'🛡️ ':'👥 ';
      st.textContent = (inGame ? roleIcon : '🌐 ') + MP.username;
      st.style.color = MP.myColor;
      $('mpAccountName').textContent = 'Compte: ' + MP.username;
    } else {
      st.textContent = inGame
        ? (MP.role==='host'?'👑 Hôte':MP.isAdmin?'🛡️ Admin':'👥 Invité')+' · non identifié'
        : '🌐 Lobby';
      st.style.color = '#8fa3bf';
    }
  } else {
    conn.style.display = '';
    disc.style.display = 'none';
    $('mpAuthBlock').style.display = 'none';
    $('mpAccountBlock').style.display = 'none';
    $('mpLobbyBlock').style.display = 'none';
    $('mpGameBlock').style.display = 'none';
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
  $('mpResCotton').value = WORLD.resources.cotton;
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
    + (mpHasAdminRights() && !p.isHost && p.id !== MP.myId
      ? (p.isAdmin
        ? '<button class="tbtn on" style="padding:1px 6px;font-size:11px" data-demote="'+p.id+'" title="Retirer les droits admin">🛡️ ✕</button>'
        : '<button class="tbtn" style="padding:1px 6px;font-size:11px" data-promote="'+p.id+'" title="Donner les droits admin">＋ Admin</button>')
      : '')
    + '</div>'
  ).join('');
  el.querySelectorAll('[data-promote]').forEach(btn=>{
    btn.onclick = ()=>{
      MP.ws.send(JSON.stringify({ type:'promote_admin', playerId:+btn.dataset.promote }));
    };
  });
  el.querySelectorAll('[data-demote]').forEach(btn=>{
    btn.onclick = ()=>{
      MP.ws.send(JSON.stringify({ type:'demote_admin', playerId:+btn.dataset.demote }));
    };
  });
}

function mpIsAutoSaveName(name){
  return /^\[Auto\]/i.test(String(name || '').trim());
}

// Demande au serveur la liste des sauvegardes de la room courante (scopée par
// carte, pas par joueur). Réservé à l'hôte/admin identifié dans une room.
function mpRequestRoomSaves(){
  if(MP.token && MP.roomId != null && MP.ws && MP.ws.readyState === 1){
    MP.ws.send(JSON.stringify({ type:'list_saves', token:MP.token }));
  }
}

function mpRenderSaves(){
  const el = $('mpSaveList');
  if(!el) return;
  // Le serveur renvoie déjà uniquement les sauvegardes de la room courante ;
  // on n'exclut ici que les auto-sauvegardes (affichées séparément).
  const saves = MP.saves.filter(s => !mpIsAutoSaveName(s.name));
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
    btn.onclick = async ()=>{
      if(!mpHasAdminRights()) return;
      const name = btn.dataset.overwrite;
      if(!await confirmAction('Écraser la sauvegarde "'+name+'" avec la partie en cours ?', {
        title: 'Écraser la sauvegarde',
        okText: 'Écraser',
        danger: true,
      })) return;
      MP.ws.send(JSON.stringify({ type:'save_game', token:MP.token, name, state:serializeState() }));
    };
  });

  el.querySelectorAll('[data-load]').forEach(btn=>{
    btn.onclick = async ()=>{
      if(!mpHasAdminRights()) return;
      if(!await confirmAction('Charger "'+btn.dataset.load+'" ?\nLa partie en cours sera remplacée pour tous les joueurs.', {
        title: 'Charger une sauvegarde',
        okText: 'Charger',
      })) return;
      MP.ws.send(JSON.stringify({ type:'load_game', token:MP.token, name:btn.dataset.load }));
    };
  });
  el.querySelectorAll('[data-del]').forEach(btn=>{
    btn.onclick = async ()=>{
      if(!mpHasAdminRights()) return;
      if(!await confirmAction('Supprimer "'+btn.dataset.del+'" ?', {
        title: 'Supprimer la sauvegarde',
        okText: 'Supprimer',
        danger: true,
      })) return;
      MP.ws.send(JSON.stringify({ type:'delete_save', token:MP.token, name:btn.dataset.del }));
    };
  });
}
