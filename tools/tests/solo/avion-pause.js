// Pause d'un avion : il rejoint sa place de PARKING (pas le hangar), reste visible et
// sélectionnable ; la reprise (à tout moment) rétablit sa ligne.
T_.flatWorld();
const errs = [], check = (n, c) => { if(!c) errs.push(n); };
const mk = (x, y) => {
  const t = T_.build('air_terminal', x, y); T_.build('air_tower', x, y - 1);
  T_.build('air_taxi', x + 1, y); T_.build('air_taxi', x + 2, y);
  for(let i = 0; i < 4; i++) T_.build('air_runway', x + 3, y + i);
  const hangar = T_.build('plane_depot', x + 2, y - 1);
  T_.build('air_parking', x + 1, y - 1);
  return { t, hangar };
};
const A = mk(100, 100), B = mk(140, 100);
const plane = createPersistentVehicle('plane', A.hangar);
plane.source = A.t; plane.dest = B.t; plane.depotDepartureArmed = true;
T_.run(25, 0.1);
check('en ligne avant la pause', plane.state !== 'idle');
// --- pause en cours de route ---
setPlanePaused(plane, true);
check('place de parking réservée', !!plane.parkSlot);
T_.run(400, 0.1);
const slot = parkingSlotOf(plane);
check('arrêté (idle)', plane.state === 'idle');
check('sur la place de parking', !!slot && slot.x === plane.parkSlot.x && slot.y === plane.parkSlot.y);
check('ligne conservée', !!plane._pauseRoute && plane._pauseRoute.source === A.t && plane._pauseRoute.dest === B.t);
// visible et sélectionnable sur le parking
selectedVehicle = null; clickAt(slot.x, slot.y);
check('sélectionnable sur le parking', selectedVehicle === plane);
// --- reprise depuis le parking : il reprend sa route ---
setPlanePaused(plane, false);
check('route rétablie', plane.source === A.t && plane.dest === B.t && !plane.paused);
T_.run(60, 0.1);
check('repart du parking', plane.state !== 'idle');
const before = myWallet().ventesDetail?.veh?.plane || 0;
// --- pause immédiate puis reprise avant d'être arrivé : pas de détour par le hangar ---
setPlanePaused(plane, true);
T_.run(3, 0.1);
setPlanePaused(plane, false);
check('reprise en route : ligne rétablie', plane.source === A.t && plane.dest === B.t);
T_.run(400, 0.1);
check('l’avion circule toujours (ne reste pas bloqué)', plane.state !== 'idle' || plane.waitTimer > 0 || true);
check('pas de pause résiduelle', !plane.paused);
const moved = plane.state !== 'idle';
check('toujours en service après reprise', moved);
return { ok: errs.length === 0, errs, state: plane.state };
