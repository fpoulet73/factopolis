// Milieu de partie : une ville nourrie au poisson à laquelle on ajoute une
// filière acier → outils. Les ouvriers des filières vitales (poisson) ne doivent
// pas être aspirés par la nouvelle industrie (spirale de déclin), et les outils
// doivent aller aux logements pleins pour déclencher une première fusion.
T_.flatWorld();
myWallet().money = 12000; WALLETS[0].fin = FIN_ZERO();
T_.water(84, 92, 92, 112);
terrain[106*N+97] = T.IRON; terrain[106*N+98] = T.IRON;
terrain[106*N+100] = T.COAL; terrain[106*N+101] = T.COAL;
for(let x = 106; x < 110; x++) for(let y = 107; y < 109; y++) terrain[y*N+x] = T.TREE;
markTerrainDirty();
for(const t of [...T_.line(92,104,112,104), ...T_.line(104,96,104,110)])
  if(canPlace('road', t.x, t.y).ok) road[t.y*N+t.x] = 1;
markGroundDirty();
for(let x = 96; x < 104; x++) T_.build('house', x, 103);
const fishers = [T_.build('fisher', 92, 103), T_.build('fisher', 92, 108)];
const fishery = T_.build('plant', 94, 105); applyPlantUpgrade(fishery, 'fishery');
T_.run(240, 0.1);
T_.build('mine', 97, 106); T_.build('mine', 100, 106);
const sm = T_.build('plant', 98, 101); applyPlantUpgrade(sm, 'smelter');
T_.build('lumber', 106, 105);
const fa = T_.build('plant', 105, 101); applyPlantUpgrade(fa, 'factory');
let firstMerge = null;
for(let k = 0; k < 30 && firstMerge == null; k++){
  T_.run(60, 0.1);
  if(buildings.some(b => BUILD[b.type].resid && b.type !== 'house')) firstMerge = Math.round(gtime / 60);
}
const pop = popTotal();
// avant correctif : les postes « les plus gros » (fonderie, usine) passaient en
// premier, les pêcheurs finissaient sans ouvrier et la ville plafonnait à 10 hab.
const fishStaffed = [...fishers, fishery].every(b => workersAllocatedOf(b) === workersRequiredOf(b));
return { ok: fishStaffed && pop >= 35 && firstMerge != null, fishStaffed, pop, firstMerge };
