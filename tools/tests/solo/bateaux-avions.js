// Port + cargo + ferry, aéroports + avion : tous transportent et rapportent.
T_.flatWorld();
myWallet().money = 1e6; WALLETS[0].ventesDetail = { res:{}, veh:{} };
T_.water(96, 90, 126, 104); T_.water(96, 104, 104, 118);
const pA = T_.build('boat_depot', 95, 95), pB = T_.build('boat_depot', 104, 112);
const dA = T_.build('depot', 94, 95), dB = T_.build('depot', 105, 112);
for(const k in RES){ dA.allow[k] = dB.allow[k] = true; dA.trainAllow[k] = dB.trainAllow[k] = undefined; }
dA.storage.steel = 20;
for(let x = 88; x < 94; x++){ const h = T_.build('house', x, 92); if(h){ h.pop = 5; h.starterHome = false; h.storage.fish_fillet = 10; } }
for(let x = 105; x < 111; x++){ const h = T_.build('house', x, 115); if(h){ h.pop = 5; h.starterHome = false; h.storage.fish_fillet = 10; } }
const airA = T_.build('plane_depot', 86, 100), airB = T_.build('plane_depot', 140, 120);
for(let x = 136; x < 142; x++){ const h = T_.build('house', x, 123); if(h){ h.pop = 5; h.starterHome = false; h.storage.fish_fillet = 10; } }
const mk = (vt, g, a, b) => { const v = createPersistentVehicle(vt, g); v.source = a; v.dest = b; v.depotDepartureArmed = true; return v; };
mk('cargo_ship', pA, pA, pB); mk('ferry', pA, pA, pB); mk('plane', airA, airA, airB);
T_.run(180, 0.2);
const veh = myWallet().ventesDetail.veh;
return { ok: (veh.cargo_ship || 0) > 0 && (veh.ferry || 0) > 0 && (veh.plane || 0) > 0, veh, waterPath: (findWaterPath(pA, pB) || []).length };
