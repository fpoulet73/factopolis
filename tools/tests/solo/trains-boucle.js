// Boucle à sens unique avec signaux et 3 trains partis ensemble du dépôt :
// jamais deux locomotives dans le même canton, aucun blocage.
T_.flatWorld();
const L = T_.line;
T_.rail([...L(82,90,118,90), ...L(119,91,120,92), ...L(120,93,120,108), ...L(119,109,118,110), ...L(117,110,82,110), ...L(81,109,80,108), ...L(80,107,80,92), ...L(81,91,82,90)]);
for(const x of [85,95,105,115]) T_.sig(x,90,-1,0);
for(const y of [95,100,105]) T_.sig(120,y,0,-1);
for(const x of [115,105,95,85]) T_.sig(x,110,1,0);
for(const y of [105,100,95]) T_.sig(80,y,0,1);
const dep = T_.build('train_depot', 90, 89);
const a = T_.build('train_station', 100, 89); T_.build('train_station', 100, 90);
const b = T_.build('train_station', 100, 111); T_.build('train_station', 100, 110);
const trains = [0,1,2].map(() => T_.train(dep, [a,b], ['minerai','voiture']).v);
let maxSameBlock = 0, stuck = 0;
const visits = trains.map(() => 0), last = trains.map(() => null);
for(let s = 0; s < 6000; s++){
  update(0.1);
  const blk = {};
  trains.forEach((v, i) => {
    stuck = Math.max(stuck, v.signalWaitTime || 0);
    const cur = v.currentBuilding?.stationGroupId ?? null;
    if(cur != null && cur !== last[i]) visits[i]++;
    last[i] = cur;
    if(v.state !== 'idle' && v.currentRailBlock >= 0) blk[v.currentRailBlock] = (blk[v.currentRailBlock] || 0) + 1;
  });
  maxSameBlock = Math.max(maxSameBlock, ...Object.values(blk), 0);
}
return { ok: maxSameBlock <= 1 && stuck < 10 && visits.every(n => n >= 8), maxSameBlock, stuck, visits };
