// Matériaux de chantier : les grands bâtiments (port, pièces d'aéroport, centre
// spatial, usines avancées) exigent, en plus de leur prix, des matériaux stockés
// dans un entrepôt du joueur dont le rayon couvre le chantier ; ils sont prélevés à
// la construction. Gares, quais et dépôts de train n'en demandent pas. Nouveaux
// gisements (cuivre, or, calcaire, sable, argile) exploités par la mine, puits de
// pétrole sur nappe.
T_.flatWorld(true);
const errs = [];
const check = (label, cond, info) => { if(!cond) errs.push(label + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
T_.rail(T_.line(80, 100, 120, 100));

// --- ferroviaire : aucun matériau ---
check('gare sans matériaux', !buildMaterialsOf('train_station') && !buildMaterialsOf('train_platform') && !buildMaterialsOf('train_depot'));
check('gare posée sans entrepôt', T_.build('train_station', 110, 101)?.type === 'train_station');
check('quai posé sans entrepôt', T_.build('train_station', 110, 100)?.type === 'train_platform');
check('dépôt de train posé sans entrepôt', T_.build('train_depot', 116, 101)?.type === 'train_depot');

// --- hangar d'aéroport : refusé sans entrepôt, puis avec un stock incomplet ---
const need = buildMaterialsOf('plane_depot');
check('config hangar', need && need.concrete > 0 && need.steel_beam > 0, need);
const v0 = canPlace('plane_depot', 90, 102);
check('refus sans entrepôt', !v0.ok && /entrepôt/.test(v0.msg || '') && v0.materials, v0);
const dep = T_.build('depot', 92, 103);
check('entrepôt posé (pas de matériaux)', !!dep);
T_.stock(dep, { steel_beam: 1 });
const v1 = canPlace('plane_depot', 90, 102);
check('refus stock incomplet', !v1.ok && v1.materials && v1.materials.steel_beam === need.steel_beam - 1, v1);
// stock complet : un hangar + une piste
const rw = buildMaterialsOf('air_runway');
T_.stock(dep, { ...need, steel_beam: need.steel_beam - 1, concrete: need.concrete + rw.concrete, paint: need.paint + rw.paint });
const before = { ...dep.storage };
const money0 = myWallet().money;
const hg = T_.build('plane_depot', 90, 102);
check('hangar posé', hg?.type === 'plane_depot');
check('prix débité', myWallet().money === money0 - BUILD.plane_depot.cost);
check('matériaux prélevés', dep.storage.concrete === before.concrete - need.concrete && dep.storage.steel_plate === before.steel_plate - need.steel_plate, dep.storage);
const piste = T_.build('air_runway', 90, 104);
check('piste posée', piste?.type === 'air_runway');
check('matériaux de la piste', dep.storage.concrete === 0 && dep.storage.paint === 0, dep.storage);
// hors du rayon de l'entrepôt : refusé même avec du stock
T_.stock(dep, rw);
const far = canPlace('air_runway', 112, 108);
check('hors rayon refusé', !far.ok && far.materials, far);

// --- usine avancée par spécialisation (raffinerie) ---
const plant = T_.build('plant', 94, 104);
const refErr = plantUpgradeError(plant, 'refinery');
check('raffinerie sans matériaux', /Matériaux|entrepôt/.test(refErr), refErr);
check('terrain ok (affichée dans le panneau)', plantUpgradeError(plant, 'refinery', false) === '');
T_.stock(dep, buildMaterialsOf('refinery'));
const plateBefore = dep.storage.steel_plate || 0;
check('spécialisation', applyPlantUpgrade(plant, 'refinery') === '' && plant.type === 'refinery');
check('matériaux usine prélevés', dep.storage.steel_plate === plateBefore - buildMaterialsOf('refinery').steel_plate);
// les usines simples n'en demandent pas
const p2 = T_.build('plant', 95, 104);
check('cimenterie libre', applyPlantUpgrade(p2, 'cement_plant') === '' && p2.type === 'cement_plant');

// --- aéroport : cartes électroniques, fil de cuivre… ---
const at = canPlace('air_terminal', 93, 106);
check('gare aéroport exige des cartes', !at.ok && at.materials?.circuit > 0, at);
T_.stock(dep, buildMaterialsOf('air_terminal'));
check('gare aéroport posée', T_.build('air_terminal', 93, 106)?.type === 'air_terminal');

// --- bac à sable : plus d'exigence ---
WORLD.buildMaterials = false;
check('bac à sable', canPlace('air_runway', 112, 108).ok);
WORLD.buildMaterials = true;

// --- gisements : la mine extrait le minerai de sa tuile ---
const ores = [[T.COPPER, 'copper_ore'], [T.GOLD, 'gold_ore'], [T.LIMESTONE, 'limestone'], [T.SAND, 'sand'], [T.CLAY, 'clay'], [T.IRON, 'iron']];
ores.forEach(([t, res], k) => { terrain[110*N + 80 + k * 2] = t; });
terrain[110*N + 95] = T.OIL;
markTerrainDirty();
const mines = ores.map(([t, res], k) => ({ res, b: T_.build('mine', 80 + k * 2, 110) }));
for(const m of mines) check('mine ' + m.res, m.b?.ore === m.res, m.b?.ore);
check('puits refusé hors nappe', !canPlace('oil_well', 96, 110).ok);
const well = T_.build('oil_well', 95, 110);
check('puits sur nappe', well?.type === 'oil_well' && recipeOf(well).out.oil > 0);
check('mine refusée sur nappe', (() => { terrain[110*N+97] = T.OIL; return !canPlace('mine', 97, 110).ok; })());
check('bulldozer rase les gisements', canPlace('terraform', 97, 110).ok);

// --- eau : la centrale à béton et l'usine chimique la reçoivent par une citerne ---
const cp = T_.build('plant', 100, 112); applyPlantUpgrade(cp, 'concrete_plant');
check('béton : eau refusée sans citerne', !accepts(cp, 'water'));
T_.build('tank', 102, 112);
check('béton : eau acceptée avec citerne', accepts(cp, 'water'));

// --- interface : infobulles, panneaux ---
check('infobulle matériaux', /Matériaux de chantier/.test(toolTitle('boat_depot')) && /Corde/.test(toolTitle('boat_depot')));
check('prix 🏗️', /🏗️/.test(toolCostLabel('plane_depot')) && !/🏗️/.test(toolCostLabel('house')));
const tryDo = (label, fn) => { try { fn(); } catch(e){ errs.push(label + ': ' + e.message); } };
const p3 = T_.build('plant', 104, 104);
tryDo('panneau usine abandonnée', () => {
  selected = p3; selectedVehicle = null; $('info')._html = null; renderInfo();
  const html = $('info').innerHTML;
  if(!/Chimie/.test(html) || !/Électronique/.test(html) || !/Raffinerie/.test(html)) throw new Error('spécialisations avancées absentes');
});
tryDo('panneau entrepôt', () => {
  selected = dep; $('info')._html = null; renderInfo();
  if(!/Matériaux de chantier/.test($('info').innerHTML)) throw new Error('famille de ressources absente');
});
check('pas de 🏗️ sur la gare', !/🏗️/.test(toolCostLabel('train_station')) && !/Matériaux de chantier/.test(toolTitle('train_depot')));
tryDo('fantôme de placement', () => { setTool('air_runway'); mouse.tx = 112; mouse.ty = 108; drawFn(); setTool('select'); });
tryDo('rendu', () => { for(let k = 0; k < 4; k++){ rotate(1); drawFn(); } });
return { ok: errs.length === 0, errs };
