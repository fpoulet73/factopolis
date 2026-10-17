// Logements : design aléatoire à la pose / fusion, conservé par la sauvegarde.
T_.flatWorld();
myWallet().money = 1e6;
const hs = [];
for(let x = 100; x < 108; x++){ const h = T_.build('house', x, 100); if(h){ h.pop = 5; h.starterHome = false; hs.push(h); } }
const designs = new Set(hs.map(h => h.design));
const allInts = hs.every(h => Number.isInteger(h.design));
const before = hs.map(h => h.x + ':' + h.design).join(',');
applySnapshot(JSON.parse(JSON.stringify(serializeState())));
const after = buildings.filter(b => b.type === 'house' && b.y === 100).sort((a, b) => a.x - b.x).map(h => h.x + ':' + h.design).join(',');
return { ok: allInts && designs.size > 1 && before === after, designs: [...designs], before, after };
