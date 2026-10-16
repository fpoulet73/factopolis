// Gare à deux quais derrière un feu de jonction : les deux quais servent, aucun
// chevauchement de cantons (empreinte loco + wagons), aucun blocage.
T_.flatWorld();
const L = T_.line;
T_.rail([...L(82,90,118,90), ...L(119,91,120,92), ...L(120,93,120,108), ...L(119,109,118,110), ...L(117,110,82,110), ...L(81,109,80,108), ...L(80,107,80,92), ...L(81,91,82,90)]);
T_.rail([{x:93,y:90},{x:94,y:89},...L(95,88,105,88),{x:106,y:89},{x:107,y:90}]);
for(const y of [95,100,105]) T_.sig(120,y,0,-1);
for(const x of [115,105,95,85]) T_.sig(x,110,1,0);
for(const y of [105,100,95]) T_.sig(80,y,0,1);
T_.sig(86,90,-1,0); T_.sig(115,90,-1,0);
T_.sig(93,90,-1,0,'junction'); T_.sig(94,90,-1,0); T_.sig(94,89,-1,1);
T_.sig(107,90,-1,0); T_.sig(107,90,-1,-1);
const dep = T_.build('train_depot', 84, 89);
const a = T_.build('train_station', 99, 89); T_.build('train_station', 100, 89); T_.build('train_station', 101, 89);
for(const x of [99,100,101]){ T_.build('train_station', x, 90); T_.build('train_station', x, 88); }
const b = T_.build('train_station', 100, 111); T_.build('train_station', 100, 110);
const trains = [0,1,2,3].map(() => T_.train(dep, [a,b], ['minerai','voiture']).v);
const used = new Set(); let overlap = 0, stuck = 0;
for(let s = 0; s < 6000; s++){
  update(0.1);
  const blk = {};
  for(const v of trains){
    stuck = Math.max(stuck, v.signalWaitTime || 0);
    if(v.currentBuilding?.stationGroupId === a.stationGroupId) used.add((trainTileIndex(v) / N) | 0);
    if(v.state === 'idle') continue;
    for(const bl of trainFootprintBlockSet(v)) blk[bl] = (blk[bl] || 0) + 1;
  }
  if(Math.max(0, ...Object.values(blk)) > 1) overlap++;
}
return { ok: used.size === 2 && overlap === 0 && stuck < 10, platformsUsed:[...used], overlap, stuck };
