// Voie unique avec évitement central et feux à sens unique : deux trains en sens
// opposés se croisent sans jamais se bloquer.
T_.flatWorld();
const L = T_.line;
T_.rail(L(70,100,130,100));
T_.rail([{x:94,y:100},{x:95,y:101},...L(96,102,104,102),{x:105,y:101},{x:106,y:100}]);
T_.sig(95,100,-1,0); T_.sig(106,100,-1,0); T_.sig(105,101,1,-1); T_.sig(94,100,1,1);
const d1 = T_.build('train_depot', 75, 101), d2 = T_.build('train_depot', 125, 101);
const a = T_.build('train_station', 72, 99); T_.build('train_station', 72, 100);
const b = T_.build('train_station', 128, 99); T_.build('train_station', 128, 100);
const t1 = T_.train(d1, [a,b], ['minerai','voiture']).v, t2 = T_.train(d2, [b,a], ['minerai','voiture']).v;
const arrivals = [0, 0], last = [null, null];
for(let s = 0; s < 9000; s++){
  update(0.1);
  [t1, t2].forEach((v, i) => { const c = v.currentBuilding?.stationGroupId ?? null; if(c != null && c !== last[i]) arrivals[i]++; last[i] = c; });
}
return { ok: arrivals.every(n => n >= 20) && t1.signalWaitTime < 10 && t2.signalWaitTime < 10, arrivals };
