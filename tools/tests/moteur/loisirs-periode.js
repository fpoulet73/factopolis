// Un habitant ne se rend qu'une fois par période dans un même lieu ; la période est propre au lieu
// (config loisirs.lieux.*.periode). Après la période, les habitants peuvent revenir.
T_.flatWorld(false);
const errs = [];
const check = (label, cond, info) => { if(!cond) errs.push(label + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
for(const t of T_.line(88, 99, 112, 99)) road[t.y*N+t.x] = 1;
markGroundDirty();
check('période propre à chaque lieu', BUILD.restaurant.leisure.period !== BUILD.hotel.leisure.period, [BUILD.restaurant.leisure.period, BUILD.hotel.leisure.period]);
// 6 habitants seulement : au plus 6 visites par période
for(let x = 90; x < 93; x++){
  const h = T_.build('house', x, 98);
  if(h){ h.pop = 2; h.starterHome = false; h.protectedPop = 0; h.storage.fish_fillet = 10; }
}
const stop = T_.build('bus_stop', 95, 100);
const garage = T_.build('garage', 80, 100), terminus = T_.build('bus_stop', 86, 100);
const bus = createPersistentVehicle('bus', garage); bus.source = stop; bus.dest = terminus;
const resto = T_.build('restaurant', 97, 100);
const pop = popTotal();
check('6 habitants', pop === 6, pop);
for(let k = 0; k < 40 && workersAllocatedOf(resto) < workersRequiredOf(resto); k++) T_.run(0.5, 0.1);
// 20 voyageurs se présentent : seuls `pop` (moins les employés déjà comptés) entrent, une fois chacun
stop.passagersSortant = 20;
T_.run(1.05, 0.05);
const first = resto.visitsTotal || 0;
check('visites limitées à la population', first > 0 && first <= pop, [first, pop]);
// plusieurs tours de voyageurs dans la même période : le cumul ne dépasse jamais la population
for(let k = 0; k < 2; k++){
  stop.passagersSortant = 20;
  T_.run(leisureStaySecs(resto) + 1.5, 0.05);
}
const inPeriod = resto.visitsTotal || 0;
check('au plus une visite par habitant et par période', inPeriod >= first && inPeriod <= pop, [inPeriod, pop]);
stop.passagersSortant = 20;
T_.run(1.05, 0.05);
check('plus aucune visite une fois la population épuisée', (resto.visitsTotal || 0) === inPeriod, [resto.visitsTotal, inPeriod]);
// la période écoulée, ils peuvent revenir
T_.run(leisurePeriodSecs(resto) + 1, 0.2);
stop.passagersSortant = 20;
T_.run(1.05, 0.05);
check('visites à nouveau permises après la période', (resto.visitsTotal || 0) > inPeriod, [resto.visitsTotal, inPeriod]);
// sauvegarde : compteur de période conservé
const n0 = JSON.stringify(resto.visitPeriod);
applySnapshot(JSON.parse(JSON.stringify(serializeState())));
const r2 = bgrid[100*N+97];
check('période rechargée', r2 && JSON.stringify(r2.visitPeriod) === n0, [r2 && r2.visitPeriod, n0]);
return { ok: errs.length === 0, errs };
