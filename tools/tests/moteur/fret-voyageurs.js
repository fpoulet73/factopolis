// Fret via entrepôts liés + voyageurs d'un village : le fer est livré et payé UNE
// fois (pas de rente en le renvoyant en navette), des voyageurs voyagent.
T_.flatWorld();
myWallet().money = 1e6; WALLETS[0].fin = FIN_ZERO(); WALLETS[0].ventesDetail = { res:{}, veh:{} };
T_.rail(T_.line(80,100,130,100));
const dep = T_.build('train_depot', 80, 99);
const a = T_.build('train_station', 85, 99); T_.build('train_station', 85, 100);
const b = T_.build('train_station', 125, 99); T_.build('train_station', 125, 100);
const da = T_.build('depot', 86, 99), db = T_.build('depot', 126, 99);
for(const k in RES){ da.allow[k] = db.allow[k] = true; da.trainAllow[k] = db.trainAllow[k] = true; }
da.storage.iron = 20;
for(let x = 82; x < 90; x++){ const h = T_.build('house', x, 96); if(h){ h.pop = 5; h.starterHome = false; h.storage.fish_fillet = 10; } }
const { v } = T_.train(dep, [a, b], ['minerai','minerai','voiture']);
let delivered = 0, pax = 0;
for(let s = 0; s < 720; s++){
  update(0.25);
  delivered = Math.max(delivered, db.storage.iron || 0);
  pax = Math.max(pax, v.passengersOnBoard || 0);
}
const freightOnce = Math.round(20 * TRADE_PRICES.iron * 40 * TRAIN_FREIGHT_FACTOR);
const trainRev = myWallet().ventesDetail.veh.train || 0;
const passengerRev = trainRev - freightOnce;
return { ok: delivered === 20 && pax > 0 && passengerRev > 0 && passengerRev < freightOnce * 6, delivered, pax, trainRev, freightOnce };
