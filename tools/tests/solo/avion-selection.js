// Un avion se sélectionne au clic : garé, sur la piste ou sur une voie de taxi.
T_.flatWorld();
const errs = [], check = (n, c) => { if(!c) errs.push(n); };
const tg = T_.build('air_terminal', 180, 100);
T_.build('air_tower', 180, 99);
T_.build('air_taxi', 181, 100); T_.build('air_taxi', 182, 100);
for(let i = 0; i < 4; i++) T_.build('air_runway', 183, 100 + i);
const hangar = T_.build('plane_depot', 182, 99);
const park = T_.build('air_parking', 181, 99);
check('pose', tg && hangar && park);
const plane = createPersistentVehicle('plane', hangar);
// 1) garé sur sa place de parking
const slot = parkingSlotOf(plane);
check('avion garé sur le parking', !!slot && slot.x === 181 && slot.y === 99);
clickAt(181, 99);
check('clic sur l’avion garé', selectedVehicle === plane && !selected);
clickAt(181, 99 + 0); selectedVehicle = null; selected = null;
// 2) au sol sur la piste et le taxi
for(const [x, y, n] of [[183, 101, 'piste'], [181, 100, 'taxi']]){
  plane.state = 'to_source'; plane.pts = [{ x:(x + 0.5) * TILE, y:(y + 0.5) * TILE }, { x:(x + 0.5) * TILE + 1, y:(y + 0.5) * TILE }]; plane.seg = 0; plane.t = 0;
  selectedVehicle = null; selected = null;
  clickAt(x, y);
  check('clic sur l’avion sur ' + n, selectedVehicle === plane);
}
// sans avion : le clic sélectionne toujours le bâtiment
plane.state = 'idle'; plane.pts = []; plane.parkSlot = null;
selectedVehicle = null; clickAt(183, 102);
check('sans avion, le clic sélectionne la piste/aéroport', !selectedVehicle && !!selected);
return { ok: errs.length === 0, errs };
