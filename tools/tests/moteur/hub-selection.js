// Arrêt de bus / entrepôt collé à un aéroport ou à un port : il en fait partie, un clic
// sélectionne l'aéroport (gare principale) ou le port, comme pour une gare de train.
T_.flatWorld();
myWallet().money = 1e6;
T_.water(55, 55, 60, 70);
const errs = [], check = (n, c) => { if(!c) errs.push(n); };
const t1 = T_.build('air_terminal', 100, 100);
let R = t1;
for(let i = 1; i <= 4; i++) T_.build('air_runway', 100 + i, 100);
T_.build('air_tower', 100, 99);
const bus = T_.build('bus_stop', 100, 101), dep = T_.build('depot', 103, 101);
check('arrêt collé à la gare', trainStationSelectionRepresentative(bus) === t1);
check('entrepôt collé à la piste', trainStationSelectionRepresentative(dep) === t1);
const t2 = T_.build('air_terminal', 99, 100);
R = airportRepresentative(t1);
check('gare adjacente fusionnée', trainStationSelectionRepresentative(t2) === R && trainStationSelectionRepresentative(bus) === R);
clickAt(100, 101); check('clic arrêt → aéroport', selected === R);
clickAt(103, 101); check('clic entrepôt → aéroport', selected === R);
const far = T_.build('bus_stop', 120, 120);
check('arrêt isolé inchangé', trainStationSelectionRepresentative(far) === far);
const port = T_.build('boat_depot', 60, 60), pb = T_.build('bus_stop', 61, 60), pd = T_.build('depot', 60, 61);
check('arrêt collé au port', pb && trainStationSelectionRepresentative(pb) === port);
check('entrepôt collé au port', pd && trainStationSelectionRepresentative(pd) === port);
for(const o of [bus, dep, pb, pd]) try { selected = trainStationSelectionRepresentative(o); $('info')._html = null; renderInfo(); drawFn(); } catch(e){ errs.push('rendu : ' + e.message); }
return { ok: errs.length === 0, errs };
