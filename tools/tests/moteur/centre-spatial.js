// Centre spatial : bâtiment 3×3 qui exige des matériaux de chantier, assemble une
// fusée à partir des pièces livrées (ouvriers requis), la lance puis récupère la
// capsule et sa cargaison extraterrestre (hélium-3, xénite). État sauvegardé.
T_.flatWorld(true);
const errs = [];
const check = (label, cond, info) => { if(!cond) errs.push(label + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
const tryDo = (label, fn) => { try { fn(); } catch(e){ errs.push(label + ': ' + e.message); } };
for(const t of T_.line(90, 99, 110, 99)) road[t.y*N+t.x] = 1;
markGroundDirty();

const S = BUILD.space_center.size;
check('taille', S === 3, S);
const v0 = canPlace('space_center', 100, 100);
check('refus sans matériaux', !v0.ok && v0.materials, v0);
// emprise : une route traverse le chantier → refus
road[102*N+101] = 1;
const dep = T_.build('depot', 98, 104);
T_.stock(dep, buildMaterialsOf('space_center'));
check('emprise occupée refusée', !canPlace('space_center', 100, 100).ok);
road[102*N+101] = 0;
const money0 = myWallet().money, concrete0 = dep.storage.concrete;
const sc = T_.build('space_center', 100, 100);
check('posé', sc?.type === 'space_center' && sc.w === S && sc.h === S, sc && [sc.w, sc.h]);
check('prix', myWallet().money === money0 - BUILD.space_center.cost);
check('matériaux prélevés', dep.storage.concrete === concrete0 - buildMaterialsOf('space_center').concrete);
let cover = true;
for(let y = 100; y < 100 + S; y++) for(let x = 100; x < 100 + S; x++) if(bgrid[y*N+x] !== sc) cover = false;
check('emprise 3×3', cover);

// ouvriers : logements approvisionnés à portée
for(let x = 96; x < 108; x++){
  const h = T_.build('house', x, 98);
  if(h){ h.pop = 5; h.starterHome = false; h.protectedPop = 0; h.storage.fish_fillet = 10; }
}
// pièces de fusée
for(const k in SPACE_ROCKET_PARTS) sc.storage[k] = SPACE_ROCKET_PARTS[k];
T_.run(2, 0.1);
check('ouvriers', workersAllocatedOf(sc) === workersRequiredOf(sc), [workersAllocatedOf(sc), workersRequiredOf(sc)]);
check('assemblage', sc.prog > 0 && !sc.spacePhase && spacePadHasRocket(sc));
T_.run(SPACE_ASSEMBLY_TIME, 0.1);
check('décollage', sc.spacePhase === 'flight' && sc.launches === 1, [sc.spacePhase, sc.launches, sc.prog]);
check('pièces consommées', Object.keys(SPACE_ROCKET_PARTS).every(k => (sc.storage[k] || 0) === 0), sc.storage);
check('animation lancée', rocketFx.some(f => f.b === sc && f.kind === 'launch'));
check('une de la Gazette', !!newsFlags['fusee:' + sc.x + ',' + sc.y]);
check('objectif fusée', OBJECTIVES.some(o => /fusée/.test(o.txt) && o.check(null)));
tryDo('rendu en vol', () => { drawFn(); drawFn(); });
// sauvegarde en plein vol
tryDo('sauvegarde', () => applySnapshot(JSON.parse(JSON.stringify(serializeState()))));
const sc2 = bgrid[100*N+100];
check('rechargé en vol', sc2?.type === 'space_center' && sc2.spacePhase === 'flight' && sc2.launches === 1, sc2 && [sc2.spacePhase, sc2.launches]);
T_.run(SPACE_MISSION_TIME + 1, 0.1);
check('retour de capsule', sc2.spacePhase == null && Object.keys(SPACE_CARGO).every(k => (sc2.storage[k] || 0) >= SPACE_CARGO[k]), sc2.storage);
check('pas de second lancement sans pièces', sc2.launches === 1 && !(sc2.prog > 0));

// la xénite et l'hélium-3 alimentent le laboratoire quantique
WORLD.buildMaterials = false;
const lab = T_.build('plant', 96, 101); applyPlantUpgrade(lab, 'quantum_lab');
check('labo quantique', lab.type === 'quantum_lab' && accepts(lab, 'xenite') && accepts(lab, 'helium3'));

tryDo('panneau', () => { selected = sc2; selectedVehicle = null; $('info')._html = null; renderInfo(); if(!/Lancements/.test($('info').innerHTML)) throw new Error('ligne Lancements absente'); });
tryDo('art', () => { for(let k = 0; k < 4; k++){ rotate(1); drawBuildingBody(sc2); drawFn(); } });
return { ok: errs.length === 0, errs };
