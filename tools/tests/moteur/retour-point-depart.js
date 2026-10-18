// Retour des habitants : en quittant une usine / un lieu, ils regagnent le point de transit
// d'où une ligne les ramène vers leur point de départ, pas le point de transit le plus proche.
T_.flatWorld();
myWallet().money = 1e6;
T_.rail(T_.line(80,100,130,100));
const dep = T_.build('train_depot', 80, 99);
const a = T_.build('train_station', 85, 99); T_.build('train_station', 85, 100);
const b = T_.build('train_station', 125, 99); T_.build('train_station', 125, 100);
// gare C sans ligne, toute proche de l'usine
const c = T_.build('train_station', 108, 99); T_.build('train_station', 108, 100);
T_.train(dep, [a, b], ['voiture']);
const errs = [];
const job = { type:'farm', x:110, y:95, w:1, h:1, owner:a.owner, commuters:{ [a.x + ',' + a.y]: 3 } };
if(returnHubFor(job, a, a.owner) !== a) errs.push('retour par la gare d\'arrivée attendu');
if(returnHubFor(job, null, a.owner) !== c) errs.push('arrivée inconnue : gare la plus proche attendue');
// gare D reliée à la même origine (B) par une autre ligne, plus proche que A : elle est retenue
const d = T_.build('train_station', 100, 99); T_.build('train_station', 100, 100);
T_.train(dep, [d, b], ['voiture']);
if(returnHubFor(job, a, a.owner) !== d) errs.push('gare desservant la même origine attendue');
const before = d.passengersEntrant || 0;
sendCommutersAway(job, a.x + ',' + a.y, 3);
if((d.passengersEntrant || 0) - before !== 3) errs.push('les 3 ouvriers doivent repartir de la gare D');
if(job.commuters[a.x + ',' + a.y]) errs.push('ouvriers non retirés du poste');
// un logement plus proche que toute gare utile : retour à pied
const h = T_.build('house', 111, 95);
if(!h) errs.push("logement non posé");
else { h.pop = 1; h.starterHome = false; }
const route = returnRouteFor(job, a, a.owner, x => x.owner === a.owner);
if(h && route.home !== h) errs.push('retour à pied vers le logement proche attendu');
return { ok: errs.length === 0, errs };
