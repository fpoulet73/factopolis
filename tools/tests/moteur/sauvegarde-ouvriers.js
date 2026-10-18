// Rechargement d'une partie : les usines restent pourvues en ouvriers (pas de départ à vide).
T_.flatWorld();
myWallet().money = 1e6;
const f = T_.build('factory', 100, 100);
for(let x = 96; x < 104; x++){ const h = T_.build('house', x, 103); if(h){ h.pop = 5; h.starterHome = false; } }
T_.run(30, 0.2);
const staffed = workersAllocatedOf(f);
const req = workersRequiredOf(f);
applySnapshot(JSON.parse(JSON.stringify(serializeState())));
T_.run(1, 0.2);
const f2 = buildings.find(b => b.type === 'factory' && b.x === 100 && b.y === 100);
const after = f2 ? workersAllocatedOf(f2) : -1;
return { ok: staffed > 0 && after >= staffed, staffed, req, after };
