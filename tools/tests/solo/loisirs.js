// Lieux de loisirs : les voyageurs arrivés à un point de transit voisin s'y rendent en
// priorité (avant un logement), paient l'entrée au propriétaire, puis repartent au bout
// de la durée de visite en passagers entrants. Capacité réduite sans personnel,
// contraintes de site (arbres, eau), sauvegarde, démolition, rendu.
T_.flatWorld(false);
const errs = [];
const check = (label, cond, info) => { if(!cond) errs.push(label + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
const tryDo = (label, fn) => { try { fn(); } catch(e){ errs.push(label + ': ' + e.message); } };
for(const t of T_.line(88, 99, 112, 99)) road[t.y*N+t.x] = 1;
markGroundDirty();

check('12 lieux', LEISURE_TYPES.length === 12, LEISURE_TYPES);
check('menu Loisirs', !!document.querySelector('[data-leisure-tool="stadium"]'));
// contraintes de site
check('accrobranche sans arbre refusé', !canPlace('treetop', 120, 120).ok);
terrain[119*N+121] = T.TREE;
check('accrobranche près d’un arbre', canPlace('treetop', 120, 120).ok, canPlace('treetop', 120, 120));
check('base nautique loin de l’eau refusée', !canPlace('marina', 130, 120).ok);

// habitants (ouvriers du lieu) et arrêt de bus
for(let x = 90; x < 102; x++){
  const h = T_.build('house', x, 98);
  if(h){ h.pop = 5; h.starterHome = false; h.protectedPop = 0; h.storage.fish_fillet = 10; }
}
const stop = T_.build('bus_stop', 95, 100);
const money0 = myWallet().money;
const resto = T_.build('restaurant', 97, 100);
check('restaurant posé', resto?.type === 'restaurant' && myWallet().money === money0 - BUILD.restaurant.cost);
check('sans personnel : capacité nulle', leisureCapacityOf(resto) === 0);
for(let k = 0; k < 40 && workersAllocatedOf(resto) < workersRequiredOf(resto); k++) T_.run(0.5, 0.1); // les employés arrivent à pied
check('personnel en poste', workersAllocatedOf(resto) === workersRequiredOf(resto), [workersAllocatedOf(resto), workersRequiredOf(resto)]);
const cap = BUILD.restaurant.leisure.capacity, fee = BUILD.restaurant.leisure.fee;
check('capacité pleine', leisureCapacityOf(resto) === cap);

// 30 voyageurs arrivent à l'arrêt : priorité au restaurant, dans la limite de sa capacité
stop.passagersSortant = 30;
const cash0 = myWallet().money, fin0 = myWallet().fin.loisirs || 0;
T_.run(1.05, 0.05);
const inside = leisureVisitorsOf(resto);
check('visiteurs entrés', inside > 0 && inside <= cap, inside);
check('entrée payée', (myWallet().fin.loisirs || 0) - fin0 === inside * fee, [(myWallet().fin.loisirs || 0) - fin0, inside * fee]);
check('argent crédité', myWallet().money - cash0 >= inside * fee - 50, myWallet().money - cash0);
T_.run(0.9, 0.05);
check('capacité respectée', leisureVisitorsOf(resto) <= cap, leisureVisitorsOf(resto));
check('comptés en voyageurs', [...transitByOwner().values()].reduce((s, r) => s + r.visiting, 0) === leisureVisitorsOf(resto));

// sauvegarde pendant la visite
const before = leisureVisitorsOf(resto);
tryDo('sauvegarde', () => applySnapshot(JSON.parse(JSON.stringify(serializeState()))));
const r2 = bgrid[100*N+97], stop2 = bgrid[100*N+95];
check('visiteurs rechargés', r2 && leisureVisitorsOf(r2) === before && (r2.visitsTotal || 0) >= before, r2 && [leisureVisitorsOf(r2), before]);

// fin de visite : retour à l'arrêt en passagers entrants
const pass0 = stop2.passengers || 0;
stop2.passagersSortant = 0;
T_.run(leisureStaySecs(r2) + 1.2, 0.05);
check('visite terminée', leisureVisitorsOf(r2) === 0, leisureVisitorsOf(r2));
check('retour en passagers entrants', (stop2.passengers || 0) > pass0, [stop2.passengers, pass0]);

// démolition en pleine visite : les visiteurs repartent aussitôt
stop2.passagersSortant = 5;
T_.run(1.05, 0.05);
const n = leisureVisitorsOf(r2), p1 = stop2.passengers || 0;
check('nouvelle visite', n > 0, n);
demolishBuilding(r2, r2.owner);
check('démolition : visiteurs à l’arrêt', (stop2.passengers || 0) >= p1 + n, [stop2.passengers, p1, n]);

// panneau et rendu de chaque lieu (4 rotations)
const spots = { restaurant:[104, 104], cinema:[107, 104], museum:[110, 104], treetop:[113, 104], marina:[116, 104], spa:[119, 104],
  hotel:[122, 104], concert_hall:[104, 108], zoo:[108, 108], casino:[112, 108], stadium:[116, 108], theme_park:[121, 108] };
terrain[102*N+113] = T.TREE; T_.water(116, 103, 118, 104);
const placed = [];
LEISURE_TYPES.forEach(t => {
  const [x, y] = spots[t];
  const b = T_.build(t, x, y);
  if(b?.type === t) placed.push(b); else errs.push('pose ' + t + ' : ' + JSON.stringify(canPlace(t, x, y)));
});
// matériaux de chantier : chaque lieu en exige, pris dans un entrepôt à portée
check('matériaux définis', LEISURE_TYPES.every(t => buildMaterialsOf(t)), LEISURE_TYPES.filter(t => !buildMaterialsOf(t)));
WORLD.buildMaterials = true;
const v0 = canPlace('zoo', 104, 130);
check('zoo refusé sans matériaux', !v0.ok && v0.materials, v0);
const dep = T_.build('depot', 102, 131);
T_.stock(dep, buildMaterialsOf('zoo'));
const wood0 = dep.storage.wood;
const zoo2 = T_.build('zoo', 104, 130);
check('zoo posé avec matériaux', zoo2?.type === 'zoo', canPlace('zoo', 104, 130));
check('matériaux prélevés', dep.storage.wood === wood0 - buildMaterialsOf('zoo').wood, [dep.storage.wood, wood0]);
check('coût affiché 🏗️', /🏗️/.test(document.querySelector('[data-leisure-tool="zoo"]')?.innerHTML || ''));
WORLD.buildMaterials = false;

tryDo('panneau', () => { selected = placed[0]; selectedVehicle = null; $('info')._html = null; renderInfo(); if(!/Visiteurs/.test($('info').innerHTML)) throw new Error('ligne Visiteurs absente'); });
tryDo('animations', () => {
  for(const b of placed) b.visitors = [{ t:gtime, n:Math.ceil(BUILD[b.type].leisure.capacity / 2), o:null }];
  const z0 = cam.z; cam.z = ZOOM_MAX;
  for(let k = 0; k < 4; k++){
    rotate(1);
    for(const b of placed) for(const t of [0, 1.7, 9.3]) drawOneLeisureFx(b, leisureFxFrame(b), t, 0.5, 7);
    drawLeisureFx(); drawFn();
  }
  cam.z = z0;
  for(const b of placed) delete b.visitors;
});
tryDo('art', () => { for(let k = 0; k < 4; k++){ rotate(1); for(const b of placed) drawBuildingBody(b); drawFn(); } });
return { ok: errs.length === 0, errs };
