// Ligne à deux terminus : allers-retours, retournement du convoi (pas de wagons
// repliés à travers la locomotive), arrêts réguliers aux deux gares.
T_.flatWorld();
T_.rail(T_.line(80,100,120,100));
const dep = T_.build('train_depot', 80, 99);
const a = T_.build('train_station', 85, 99); T_.build('train_station', 85, 100);
const b = T_.build('train_station', 115, 99); T_.build('train_station', 115, 100);
const { v, r } = T_.train(dep, [a, b], ['minerai','minerai','voiture']);
let folds = 0, stops = 0, last = null;
for(let s = 0; s < 2400; s++){
  update(0.05);
  const loco = trainPose(v), w0 = trainWagonPose(v, 0), w2 = trainWagonPose(v, 2);
  if(s > 60 && loco && w0 && w2 && !(v.waitTimer > 0)){
    const d0 = Math.hypot(loco.u - w0.u, loco.v - w0.v), d2 = Math.hypot(loco.u - w2.u, loco.v - w2.v);
    if(d2 < d0 - 0.05) folds++;
  }
  const cur = v.currentBuilding ? v.currentBuilding.stationGroupId : null;
  if(cur != null && cur !== last) stops++;
  last = cur;
}
return { ok: r.ok && folds === 0 && stops >= 6, depart: r.ok, folds, stops };
