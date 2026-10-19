// Cohérence des habitants : chaque habitant est à un seul endroit (maison, poste, arrêt, véhicule,
// lieu de loisirs), le total ne varie pas sans raison, personne ne reste bloqué et, si la ligne qui
// devait le ramener disparaît, il rentre chez lui à pied.
T_.flatWorld(false);
const errs = [];
const check = (label, cond, info) => { if(!cond) errs.push(label + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
for(const t of T_.line(60, 99, 140, 99)) road[t.y*N+t.x] = 1;
markGroundDirty();
const homes = [];
for(let x = 62; x < 72; x++){
  const h = T_.build('house', x, 98);
  if(h){ h.pop = BUILD.house.resid.popCap; h.starterHome = false; h.protectedPop = 0; h.storage.fish_fillet = 50; homes.push(h); }
}
const garage = T_.build('garage', 72, 101);
const A = T_.build('bus_stop', 66, 100);
const B = T_.build('bus_stop', 130, 100);
const job = T_.build('plant', 132, 101); applyPlantUpgrade(job, 'factory');
check('scène posée', homes.length === 10 && garage && A && B && job?.type === 'factory', [homes.length, !!garage, !!A, !!B, job?.type]);
const pop0 = popTotal();
// invariant : population inchangée et aucun habitant compté deux fois
let worst = null;
const audit = label => {
  const a = populationAudit().get(myOwner() ?? null);
  if(!a) return;
  if(popTotal() !== pop0 && !worst) worst = { label, pop: popTotal(), pop0 };
  if(a.atHome < -0.01 && !worst) worst = { label, ...a, refs: undefined };
};
const bus = createPersistentVehicle('bus', garage);
bus.source = A; bus.dest = B;
check('ligne démarrée', startVehicleRoute(bus) === true);
for(let k = 0; k < 120 && !(job.commuters && Object.keys(job.commuters).length); k++){ T_.run(1, 0.05); audit('ligne'); }
const commuters = () => Object.values(job.commuters || {}).reduce((s, n) => s + n, 0);
check('ouvriers arrivés par le bus', commuters() > 0, { commuters: commuters(), A: A.passengers, B: B.passagersSortant });
T_.run(20, 0.05); audit('ligne');

// la ligne disparaît : plus aucun moyen de rentrer → retour à pied, rien ne reste bloqué
removePersistentVehicle(bus);
T_.run(8, 0.05); audit('sans ligne');
check('ouvriers renvoyés chez eux', commuters() === 0, job.commuters);
for(let k = 0; k < 40; k++){ T_.run(1, 0.05); audit('sans ligne'); }
const stuck = buildings.filter(b => !b.dead && ((b.passengers || 0) >= 1 || (b.passagersSortant || 0) >= 1 || (b.passengersEntrant || 0) >= 1))
  .map(b => ({ t: b.type, x: b.x, w: b.passengers, s: b.passagersSortant, e: b.passengersEntrant }));
check('aucun voyageur bloqué à un arrêt sans ligne', stuck.length === 0, stuck);
check('population constante et sans doublon', !worst, worst);
const a = populationAudit().get(myOwner() ?? null);
check('tout le monde à la maison ou au travail', a && a.away < 0.5, a && { ...a, refs: undefined });

// train rentré au dépôt avec des voyageurs à bord : ils descendent et rentrent chez eux
T_.rail(T_.line(80, 104, 120, 104));
const dep = T_.build('train_depot', 80, 103);
const s1 = T_.build('train_station', 85, 103); T_.build('train_station', 85, 104);
const s2 = T_.build('train_station', 115, 103); T_.build('train_station', 115, 104);
const { v: tr } = T_.train(dep, [s1, s2], ['voiture']);
T_.run(2, 0.05);
tr.passengersOnBoard = 4; tr.passengerBoardStop = s1;
returnToGarage(tr);
for(let k = 0; k < 60 && (tr.passengersOnBoard || 0) > 0; k++) T_.run(1, 0.05);
check('voyageurs du train rentré au dépôt descendus', (tr.passengersOnBoard || 0) === 0, { onboard: tr.passengersOnBoard, state: tr.state });

// visiteurs d'un lieu de loisirs sans ligne de retour : ils rentrent à pied (pas d'attente sans fin)
const resto = T_.build('restaurant', 70, 96);
if(resto){
  admitVisitors(resto, A, 3);
  const before = A.passengers || 0;
  T_.run(leisureStaySecs(resto) + 1.5, 0.05);
  check('visite terminée', leisureVisitorsOf(resto) === 0);
  check('pas de retour vers un arrêt sans ligne', (A.passengers || 0) <= before, [A.passengers, before]);
}
// invités Airbnb : ils occupent une place chez l'hôte mais restent des habitants de leur joueur
const HOST = 7, me = myOwner() ?? null;
const hostHome = T_.build('house', 80, 92);
if(hostHome){
  hostHome.owner = HOST; hostHome.starterHome = false; hostHome.protectedPop = 0;
  hostHome.pop = 3; hostHome.guests = [{ t:gtime, o:me, h:null }, { t:gtime, o:me, h:null }];
  const myPop = popTotal(me);
  refreshWorkerAllocation();
  check('hôte : invités hors de sa population', popTotal(HOST) === 1, popTotal(HOST));
  check('hôte : invités hors de ses ouvriers', (hostHome.workersIdle || 0) <= 1, hostHome.workersIdle);
  check('origine : population inchangée', popTotal(me) === myPop, [popTotal(me), myPop]);
  const mine = transitByOwner().get(me), host = transitByOwner().get(HOST);
  check('origine : invités comptés ailleurs', mine?.abroad === 2, mine?.abroad);
  check('hôte : bilan sans les invités', host?.pop === 1 && host?.abroad === 0, host && { pop: host.pop, abroad: host.abroad });
}
return { ok: errs.length === 0, errs };
