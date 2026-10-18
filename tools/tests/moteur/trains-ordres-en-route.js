// Ordres modifiés en circulation : le train rejoint la nouvelle gare sans repasser au dépôt.
T_.flatWorld();
T_.rail(T_.line(70,100,140,100));
const dep = T_.build('train_depot', 70, 99);
const a = T_.build('train_station', 80, 99); T_.build('train_station', 80, 100);
const b = T_.build('train_station', 100, 99); T_.build('train_station', 100, 100);
const c = T_.build('train_station', 130, 99); T_.build('train_station', 130, 100);
const { v } = T_.train(dep, [a, b], ['minerai']);
T_.run(12);
v.orders = [c, a]; v.orderModes = ['load_unload','load_unload'];
const applied = trainApplyOrdersLive(v);
let reachedC = false, depot = 0;
for(let k = 0; k < 1200; k++){ update(0.05); if(v.currentBuilding?.stationGroupId === c.stationGroupId) reachedC = true; if(v.atDepot) depot++; }
return { ok: applied && reachedC && depot === 0, applied, reachedC, depot };
