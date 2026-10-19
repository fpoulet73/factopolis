// Progression : les objectifs s'ouvrent en parallèle (arbre de prérequis) et
// débloquent bâtiments, spécialisations d'usine et véhicules. Verrouillé = pose,
// outil et spécialisation refusés, mais l'outil reste visible (grisé). Une ancienne
// partie garde l'accès aux fonctionnalités qu'elle utilisait déjà.
T_.flatWorld();
WORLD.progression = true;
objectivesSettleUntil = 0;
const errs = [];
const check = (label, cond, info) => { if(!cond) errs.push(label + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };

// arbre cohérent
check('beaucoup d’objectifs', OBJECTIVES.length >= 40, OBJECTIVES.length);
check('identifiants uniques', new Set(OBJECTIVES.map(o => o.id)).size === OBJECTIVES.length);
for(const o of OBJECTIVES) for(const r of o.req) check('prérequis connu ' + o.id + '→' + r, !!OBJECTIVE_BY_ID[r]);
for(const f in FEATURE_UNLOCK) check('fonctionnalité connue ' + f, f.startsWith('v:') ? !!VEHICLE_TYPES[f.slice(2)] : !!BUILD[f]);
for(const k of LEISURE_TYPES) check('loisir à débloquer ' + k, !!FEATURE_UNLOCK[k]);

const w = myWallet();
delete w.objDone; delete w.objGranted;
updateObjectives();
check('initialisé vide', w.objDone && Object.keys(w.objDone).length === 0, w.objDone);
const open0 = OBJECTIVES.filter(o => objectiveOpen(w, o)).map(o => o.id);
check('objectifs en parallèle', open0.length >= 3, open0);

// verrous
const mineTry = canPlace('mine', 50, 50);
check('mine verrouillée', !mineTry.ok && mineTry.locked, mineTry);
check('maison accessible', canPlace('house', 60, 60).ok);
setTool('rail');
check('outil rail refusé', tool !== 'rail', tool);
buildToolbar();
check('rail grisé', document.querySelector('[data-train-tool="rail"]')?.classList.contains('feat-locked'));
check('menu Train grisé', document.querySelector('.tool-group-btn[data-t="rail"]')?.classList.contains('feat-locked'));
check('maison active', !document.querySelector('[data-building-tool="house"]')?.classList.contains('feat-locked'));
const plant = T_.build('plant', 80, 80);
check('aciérie verrouillée', /🔒/.test(plantUpgradeError(plant, 'smelter')), plantUpgradeError(plant, 'smelter'));
check('poissonnerie accessible', plantUpgradeError(plant, 'fishery') === '', plantUpgradeError(plant, 'fishery'));
check('bus verrouillé', !featureUnlocked('v:bus'));

// objectif atteint → prime + déblocage
terrain[70 * N + 72] = T.TREE; markTerrainDirty();
const lum = T_.build('lumber', 70, 70);
check('bûcheron posé', lum?.type === 'lumber');
const money0 = w.money;
updateObjectives();
check('objectif bûcheron', objectiveDone(w, 'lumber'));
check('prime versée', w.money === money0 + OBJECTIVE_BY_ID.lumber.reward, [money0, w.money]);
check('mine débloquée', !canPlace('mine', 50, 50).locked);
syncToolbarLocks();
check('mine dégrisée', !document.querySelector('[data-resource-tool="mine"]')?.classList.contains('feat-locked'));

// ancienne partie : un dépôt de train déjà construit garde le ferroviaire accessible
const td = newBuilding('train_depot', 90, 90);
buildings.push(td); setGrid(td, td);
delete w.objDone; delete w.objGranted;
updateObjectives();
check('rail accordé', featureUnlocked('rail') && featureUnlocked('v:train'));
check('objectif rempli revalidé', objectiveDone(w, 'lumber'));
check('aciérie toujours verrouillée', !featureUnlocked('smelter'));

// progression désactivée : tout est accessible
WORLD.progression = false;
check('sans progression', featureUnlocked('smelter') && !canPlace('mine', 50, 50).locked);

return { ok: !errs.length, errs };
