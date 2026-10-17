// Hangars adjacents : fusion en un seul hangar plus grand (avions, capacité et service conservés).
T_.flatWorld();
const errs = [], check = (n, c) => { if(!c) errs.push(n); };
const mk = (x, y) => {
  const t = T_.build('air_terminal', x, y); T_.build('air_tower', x, y - 1);
  for(let i = 1; i <= 5; i++) T_.build('air_taxi', x + i, y);
  for(let i = 0; i < 4; i++) T_.build('air_runway', x + 6, y + i);
  return t;
};
const A = mk(100, 100), B = mk(140, 100);
const h1 = T_.build('plane_depot', 102, 99), h2 = T_.build('plane_depot', 103, 99), h3 = T_.build('plane_depot', 102, 98), h4 = T_.build('plane_depot', 103, 98);
check('hangars posés', h1 && h2 && h3 && h4);
const p1 = createPersistentVehicle('plane', h1), p2 = createPersistentVehicle('plane', h2), p3 = createPersistentVehicle('plane', h4);
p1.source = A; p1.dest = B; p1.depotDepartureArmed = true;
const money = myWallet().money;
T_.run(2.5, 0.1);
const hangars = buildings.filter(b => !b.dead && b.type === 'plane_depot');
check('un seul hangar 2×2', hangars.length === 1 && hangars[0].w === 2 && hangars[0].h === 2);
const H = hangars[0];
check('avions conservés', [p1, p2, p3].every(p => p.garageRef === H) && H.vehicles.length === 3 && vehicles.length === 3);
check('aéroport desservi', planeDepotAirport(H) === airportOf(A));
check('capacité : 4 cases = 16 avions', hangarFleet(H).capacity === 16 && hangarFleet(H).hangars === 4);
check('gain : aucune dépense', myWallet().money >= money - 1);
// l'avion de la ligne part du hangar fusionné et dessert l'autre aéroport
T_.run(120, 0.1);
check('l’avion circule depuis le hangar fusionné', p1.state !== 'idle' || p1.currentBuilding === B || p1.cargo >= 0);
check('hangar toujours en vie', !H.dead && bgrid[98 * N + 103] === H);
// sauvegarde / rechargement
applySnapshot(JSON.parse(JSON.stringify(serializeState())));
const H2 = buildings.find(b => b.type === 'plane_depot');
check('rechargé : hangar 2×2 et avions rattachés', H2 && H2.w === 2 && H2.h === 2 && vehicles.length === 3 && vehicles.every(v => v.garageRef === H2));
// info + rendu
try { selected = H2; $('info')._html = null; renderInfo(); drawFn(); drawFn(); } catch(e){ errs.push('rendu : ' + e.message); }
return { ok: errs.length === 0, errs };
