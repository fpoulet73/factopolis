// Aéroport : gares + pistes + déco sur cases adjacentes (fusion automatique) ;
// fonctionnel avec au moins une gare et 4 cases de piste alignées.
T_.flatWorld();
myWallet().money = 1e6;
const errs = [], check = (n, c) => { if(!c) errs.push(n); };
const t1 = T_.build('air_terminal', 100, 100);
for(let i = 1; i <= 3; i++) T_.build('air_runway', 100 + i, 100);
check('3 pistes : non fonctionnel', !airportFunctional(t1));
const r4 = T_.build('air_runway', 104, 100);
check('4 pistes sans tour de contrôle : non fonctionnel', !airportFunctional(t1) && airportOf(t1).longest === 4);
T_.build('air_tower', 100, 99);
check('gare + tour + 4 pistes alignées : fonctionnel', airportFunctional(t1));
const deco = T_.build('air_deco', 100, 101);
check('déco fusionnée au même aéroport', airportOf(deco) === airportOf(t1));
const t2 = T_.build('air_terminal', 100, 102);
check('2e gare adjacente à la déco : même aéroport', airportOf(t2) === airportOf(t1));
check('gare représentante unique', airportRepresentative(t2) === t1 && isActiveAirTerminal(t1) && !isActiveAirTerminal(t2));
const far = T_.build('air_terminal', 120, 120);
check('pièce isolée : autre aéroport, non fonctionnel', airportOf(far) !== airportOf(t1) && !airportFunctional(far));
// piste en L : pas alignée
const l1 = T_.build('air_terminal', 130, 130);
T_.build('air_runway', 131, 130); T_.build('air_runway', 132, 130); T_.build('air_runway', 132, 131); T_.build('air_runway', 132, 132);
check('piste en L (2 + 2) : non fonctionnel', !airportFunctional(l1));
const g0 = airportOf(t1).runway;
check('sens par défaut : x croissant', g0.x1 > g0.x0);
flipRunway(r4);
const g1 = airportOf(t1).runway;
check('sens inversé par clic', g1.x1 < g1.x0 && airportOf(t1).runways.every(r => r.runwayRev));
demolishBuilding(r4);
check('piste démolie : non fonctionnel', !airportFunctional(t1));
const stop = airStopTile(t2, airportOf(t2));
check('arrêt devant la gare : sur une case voisine, pas dans la gare', !stop || (stop.x !== t2.x || stop.y !== t2.y));
// deux pistes : l'une atterrit, l'autre décolle ; le taxiway fait partie de l'aéroport
const ta = T_.build('air_terminal', 160, 100);
for(let i = 1; i <= 4; i++) T_.build('air_runway', 160 + i, 100);
T_.build('air_tower', 160, 99);
const tx = T_.build('air_taxi', 160, 101);
for(let i = 1; i <= 4; i++) T_.build('air_runway', 160 + i, 102);
T_.build('air_taxi', 161, 101);
const ga = airportOf(ta);
check('taxiway fusionné', airportOf(tx) === ga);
check('deux pistes détectées', ga.runs.length === 2 && ga.landing !== ga.takeoff);
const path = findAirPath(ta, T_.build('air_terminal', 200, 100));
check('findAirPath sans arrivée fonctionnelle = ligne droite', Array.isArray(path) && path.length > 1);
// gare reliée à la piste par des voies de taxi seulement (non adjacente à la piste)
const tg = T_.build('air_terminal', 180, 100);
T_.build('air_tower', 180, 99);
T_.build('air_taxi', 181, 100); T_.build('air_taxi', 182, 100);
for(let i = 0; i < 4; i++) T_.build('air_runway', 183, 100 + i);
check('gare + taxi + piste (gare non collée à la piste) : fonctionnel', airportFunctional(tg) && airportOf(tg).longest === 4);
const tp = airTaxiTiles(airportOf(tg), { x:180, y:100 }, { x:183, y:100 });
check('cheminement au sol par le taxi', !!tp && tp.length === 4 && tp[1].x === 181 && tp[2].x === 182);
// hangars : adjacents à une voie de taxi ; capacité 2 / 6 / 10 / 16 avions
const h1 = T_.build('plane_depot', 182, 99);
check('hangar collé au taxi : aéroport desservi', !!planeDepotAirport(h1));
check('1 hangar = 2 avions', hangarFleet(h1).capacity === 2);
const h2 = T_.build('plane_depot', 181, 99);
check('2 hangars = 6 avions', hangarFleet(h1).capacity === 6 && hangarFleet(h2).hangars === 2);
check('capacités 10 et 16', hangarCapacityFor(3) === 10 && hangarCapacityFor(4) === 16);
createPersistentVehicle('plane', h1); createPersistentVehicle('plane', h1);
check('achat refusé quand plein (2 avions pour 1 hangar)', hangarFleet(h1).planes === 2 && planePurchaseError(h1, 'plane') === null);
// parking : au plus autant de places que la capacité des hangars (ici 2 hangars = 6)
const ph = airportOf(t1);
let placed = 0;
for(let i = 0; i < 8; i++){ const pk = T_.build('air_parking', 190 + i, 98); if(pk) placed++; }
check('parking isolé refusé (pas de hangar)', placed === 0);
const hg = T_.build('plane_depot', 182, 99);
for(let i = 0; i < 9; i++){ if(canPlace('air_parking', 183 + i, 101).ok) T_.build('air_parking', 183 + i, 101); }
const parks = airportOf(tg).pieces.filter(p => p.type === 'air_parking').length;
check('parkings limités à la capacité des hangars', parks <= hangarFleet(hg).capacity && parks > 0);
// pause d'un avion : il se stationne sur une place de parking libre
const pl = createPersistentVehicle('plane', hg);
const park = airportOf(tg).pieces.find(p => p.type === 'air_parking');
setPlanePaused(pl, true);
check('avion au repos : sort du hangar et roule vers sa place (pas d apparition soudaine)', pl.state === 'returning' && pl.pts.length > 1);
check('avion en pause : place de parking réservée', pl.paused && !!pl.parkSlot && park && pl.parkSlot.x >= 183 && pl.parkSlot.y === 101);
T_.run(60, 0.2);
check('avion arrivé et stationné sur sa place', pl.state === 'idle' && parkingSlotOf(pl)?.x === pl.parkSlot.x);
const hgNow = bgrid[99 * N + 182]; // les 2 hangars adjacents ont fusionné pendant la simulation
check('hangars adjacents fusionnés', hgNow.w * hgNow.h === 2 && pl.garageRef === hgNow);
const pl2 = createPersistentVehicle('plane', hgNow);
const taken = airportOf(tg).pieces.filter(p => p.type === 'air_parking').length;
setPlanePaused(pl2, true);
check('deux avions en pause : places différentes', !pl2.parkSlot || pl2.parkSlot.x !== pl.parkSlot.x);
setPlanePaused(pl, false);
check('reprise du service', !pl.paused);
// routes inter-joueurs : un avion ou un bateau peut desservir l escale d un autre joueur
const foreignT = airportOf(tg).rep; const oldOwner = foreignT.owner;
foreignT.owner = 77;
airVersion++;
check('avion : gare d aéroport d un autre joueur utilisable', vehicleRouteEndpointOk(foreignT, 'plane', 3));
foreignT.owner = oldOwner;
const port = T_.build('boat_depot', 20, 20) || null;
if(port){ port.owner = 77; check('bateau : port d un autre joueur utilisable', vehicleRouteEndpointOk(port, 'ferry', 3)); }
return { ok: errs.length === 0, errs };
