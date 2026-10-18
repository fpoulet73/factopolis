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

check('15 lieux', LEISURE_TYPES.length === 15, LEISURE_TYPES);
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

// rayon d'attractivité du lieu : l'arrêt doit se trouver dans CE rayon (réglable), peu importe le sien
const far = T_.build('restaurant', 97, 100);
const stop3 = T_.build('bus_stop', 112, 100);
stop2.passagersSortant = 0;
for(let k = 0; k < 40 && workersAllocatedOf(far) < workersRequiredOf(far); k++) T_.run(0.5, 0.1);
const dFar = buildingDistance(far, stop3);
check('lieu : personnel', leisureCapacityOf(far) > 0, [workersAllocatedOf(far), workersRequiredOf(far)]);
check('rayon par défaut', leisureRadiusOf(far) === BUILD.restaurant.leisure.radius && far.attractRadius === undefined, leisureRadiusOf(far));
check('arrêt hors du rayon du lieu', dFar > leisureRadiusOf(far), [dFar, leisureRadiusOf(far)]);
stop3.passagersSortant = 5;
T_.run(1.05, 0.05);
check('hors rayon : aucun visiteur', leisureVisitorsOf(far) === 0, leisureVisitorsOf(far));
setLeisureRadius(far, 9999); check('rayon max', leisureRadiusOf(far) === LEISURE_RADIUS_MAX);
setLeisureRadius(far, 1); check('rayon min', leisureRadiusOf(far) === LEISURE_RADIUS_MIN);
const wanted = Math.ceil(dFar) + 1;
setLeisureRadius(far, wanted);
check('rayon réglé', leisureRadiusOf(far) === wanted && far.attractRadius === wanted, leisureRadiusOf(far));
stop3.passagersSortant = 5;
T_.run(1.05, 0.05);
check('dans le rayon : visiteurs', leisureVisitorsOf(far) > 0, leisureVisitorsOf(far));
tryDo('rayon sauvegardé', () => applySnapshot(JSON.parse(JSON.stringify(serializeState()))));
const far2 = bgrid[100*N+97];
check('rayon rechargé', far2 && far2.attractRadius === wanted, far2 && far2.attractRadius);
demolishBuilding(far2, far2.owner);

// personnel manquant : les premiers voyageurs qui se présentent sont recrutés (avant d'être visiteurs)
const lonely = T_.build('restaurant', 116, 101);
check('lieu isolé sans personnel', lonely && workersAllocatedOf(lonely) === 0 && workersRequiredOf(lonely) > 0, lonely && [workersAllocatedOf(lonely), workersRequiredOf(lonely)]);
const stopL = bgrid[100*N+112]; // objets recréés par le rechargement
stopL.passagersSortant = 6;
T_.run(1.1, 0.05);
const walking = walkers.filter(w => w.cj && w.cj.jx === lonely.x && w.cj.jy === lonely.y).reduce((n, w) => n + w.cj.n, 0);
check('voyageurs recrutés en route', walking + (lonely.workersAssigned || 0) >= workersRequiredOf(lonely), [walking, lonely.workersAssigned, leisureVisitorsOf(lonely)]);
T_.run(20, 0.1);
check('poste pourvu par les voyageurs', workersAllocatedOf(lonely) > 0, workersAllocatedOf(lonely));
demolishBuilding(lonely, lonely.owner);

// panneau et rendu de chaque lieu (4 rotations)
const spots = { restaurant:[104, 104], cinema:[107, 104], museum:[110, 104], treetop:[113, 104], marina:[116, 104], spa:[119, 104],
  hotel:[122, 104], concert_hall:[104, 108], zoo:[108, 108], casino:[112, 108], stadium:[116, 108], theme_park:[121, 108], tennis:[104, 113], basketball:[107, 113], baseball:[110, 113] };
terrain[102*N+113] = T.TREE; T_.water(115, 94, 124, 104);
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
  // base nautique : flottille sur les cases d'eau du rayon, tous les types d'engins
  const marina = placed.find(b => b.type === 'marina');
  const wt = marinaWaterTiles(marina);
  if(wt.length < 2) throw new Error('cases d’eau autour de la base nautique : ' + wt.length);
  if(wt.some(t => terrain[t.y*N+t.x] !== T.WATER)) throw new Error('engin hors de l’eau');
  const touchesShore = t => { for(let dy = -1; dy <= 1; dy++) for(let dx = -1; dx <= 1; dx++) if(terrain[(t.y+dy)*N + t.x+dx] !== T.WATER) return true; return false; };
  if(wt.some(touchesShore)) throw new Error('engin sur une case d’eau collée à la rive');
  for(let k = 0; k < WATER_CRAFT.length; k++) drawWaterCraft(wt[k % wt.length], k, 3.3, 7);
  // poissons : animés au zoom proche (plus cuits dans le sol), cuits sinon
  if(!fishAnimated()) throw new Error('poissons non animés au zoom max');
  drawFishFx();
  cam.z = z0;
  for(const b of placed) delete b.visitors;
});
tryDo('art', () => { for(let k = 0; k < 4; k++){ rotate(1); for(const b of placed) drawBuildingBody(b); drawFn(); } });

// orientation : posée (touche T), réglable, sauvegardée, et cohérente avec la rotation caméra
leisurePlaceDir = 2;
const turned = T_.build('cinema', 104, 120);
leisurePlaceDir = 0;
check('orientation à la pose', turned && leisureDirOf(turned) === 2, turned && turned.dir);
rotateLeisure(turned.x, turned.y, -1);
check('pivoter (bouton / T)', leisureDirOf(turned) === 3, turned.dir);
tryDo('orientation sauvegardée', () => applySnapshot(JSON.parse(JSON.stringify(serializeState()))));
const turned2 = bgrid[120*N+104];
check('orientation rechargée', turned2 && leisureDirOf(turned2) === 3, turned2 && turned2.dir);
// un point du repère local du lieu retombe au même endroit du monde quelle que soit la rotation caméra
const worldOf = (b, lu, lv) => {
  const F = leisureFxFrame(b), p = artXfUV(F.X, F.cu + lu, F.cv + lv);
  return invRotF(p[0], p[1]).map(c => Math.round(c * 1000) / 1000);
};
for(const dir of [0, 1, 2, 3]){
  setLeisureDir(turned2, dir);
  const ref = JSON.stringify(worldOf(turned2, 0.4, -0.25));
  for(let k = 0; k < 4; k++){
    rotate(1);
    const w = JSON.stringify(worldOf(turned2, 0.4, -0.25));
    if(w !== ref){ errs.push('orientation ' + dir + ' incohérente à la rotation ' + rot + ' : ' + w + ' ≠ ' + ref); break; }
  }
}
setLeisureDir(turned2, 1);
check('orientation 1 ≠ 0', JSON.stringify(worldOf(turned2, 0.4, 0)) !== (setLeisureDir(turned2, 0), JSON.stringify(worldOf(turned2, 0.4, 0))));
tryDo('art orienté', () => {
  const all = buildings.filter(b => isLeisure(b) && !b.dead);
  for(const b of all) b.visitors = [{ t:gtime, n:4, o:null }];
  for(const dir of [1, 2, 3]) for(let k = 0; k < 4; k++){
    rotate(1);
    for(const b of all){ setLeisureDir(b, dir); drawBuildingBody(b); for(const t of [0, 2.4]) drawOneLeisureFx(b, leisureFxFrame(b), t, 0.6, 7); }
  }
  for(const b of all){ setLeisureDir(b, 0); delete b.visitors; }
  drawFn();
});
return { ok: errs.length === 0, errs };
