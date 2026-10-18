// Chaînes de production avancées : chaque usine obtenue en spécialisant une usine
// abandonnée transforme ses entrées en sorties (ouvriers fournis par des logements
// voisins) ; les classes aisées réclament les biens de luxe.
T_.flatWorld();
const errs = [];
const check = (label, cond, info) => { if(!cond) errs.push(label + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
for(const t of T_.line(78, 99, 125, 99)) road[t.y*N+t.x] = 1;
markGroundDirty();
const types = ADVANCED_FACTORIES.map(f => f[0]);
const fac = {};
types.forEach((type, k) => {
  const b = T_.build('plant', 80 + k * 2, 100);
  const err = applyPlantUpgrade(b, type);
  if(err){ errs.push(type + ' : ' + err); return; }
  fac[type] = b;
});
// citerne pour les usines à eau
T_.build('tank', 79, 101);
// logements pleins et nourris : main-d'œuvre pour toutes les usines
for(let x = 78; x < 126; x++) for(const y of [97, 98]){
  const h = T_.build('house', x, y);
  if(h){ h.pop = 5; h.starterHome = false; h.protectedPop = 0; h.storage.fish_fillet = 10; }
}
const fill = () => { for(const t in fac){ const b = fac[t], r = recipeOf(b); for(const k in r.in) b.storage[k] = capOf(b, k); } };
const produced = {};
for(let step = 0; step < 50; step++){
  fill();
  T_.run(0.5, 0.1);
  for(const t in fac){
    const r = recipeOf(fac[t]);
    for(const k in r.out) produced[t + ':' + k] = Math.max(produced[t + ':' + k] || 0, fac[t].storage[k] || 0);
  }
}
for(const t in fac) for(const k in recipeOf(fac[t]).out)
  check('production ' + t + ' → ' + k, (produced[t + ':' + k] || 0) > 0, { workers: workersAllocatedOf(fac[t]) + '/' + workersRequiredOf(fac[t]) });
// chaîne cohérente : toute entrée d'une usine avancée est produite quelque part
const producedRes = new Set(['iron','coal','wood','wheat','cotton','water','fish','dirt', ...Object.values(DEPOSIT_ORES), 'oil', ...Object.keys(SPACE_CARGO)]);
for(const t in BUILD) for(const k in BUILD[t].recipe?.out || {}) producedRes.add(k);
for(const t of types) for(const k in BUILD[t].recipe.in) check('entrée produite : ' + k, producedRes.has(k));
for(const k in RES) check('ressource cataloguée ' + k, RES[k].cat && RES_CATEGORIES.some(c => c.key === RES[k].cat));
for(const r of ['steel_beam','concrete','window','circuit','furniture','helium3']) check('transportable ' + r, ALL_CARGO_RESOURCES.includes(r) && Object.values(TRAIN_WAGON_TYPES).some(w => w.resources.includes(r)));
// luxe : besoins des classes aisées, mais pas de priorité « vitale » sur les ouvriers
check('cadres : meubles', residRequiredOf('lux_manor').includes('furniture'));
check('patrons : électroménager', residRequiredOf('lux_estate').includes('appliances') && residBonusOf('lux_estate').includes('jewelry'));
check('luxe non vital', !essentialResources().has('furniture') && !essentialResources().has('appliances'));
check('gratte-ciel : béton et vitres', residUpgradeTargetOf('tower3', 'concrete') > 0 && residUpgradeTargetOf('tower3', 'window') > 0);
return { ok: errs.length === 0, errs };
