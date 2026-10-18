// Sauvegarde compressée (RLE) puis rechargement : monde identique.
myWallet().money = 1e6;
for(const t of T_.line(mapBounds.x0+5, mapBounds.y0+20, mapBounds.x0+40, mapBounds.y0+20))
  if(canPlace('road', t.x, t.y).ok) road[t.y*N+t.x] = 1;
markGroundDirty();
for(let x = mapBounds.x0+5; x < mapBounds.x0+40; x++)
  if(canPlace('house', x, mapBounds.y0+19).ok) T_.build('house', x, mapBounds.y0+19);
const raw = JSON.stringify(serializeState()).length;
const packed = JSON.stringify(packStateForStorage(serializeState())).length;
publishNews('test:sauvegarde', '📰', 'Une de test', 'Persistée avec la partie.', null);
const before = { b: buildings.length, sig: worldSignature() };
const saved = unpackStateFromStorage(JSON.parse(JSON.stringify(packStateForStorage(serializeState()))));
genWorld(WORLD_DEFAULTS);
applySnapshot(saved);
const after = { b: buildings.length, sig: worldSignature(), pop: popTotal() };
const newsKept = !!newsFlags['test:sauvegarde'] && newsLog.some(n => n.title === 'Une de test');
return { ok: before.b === after.b && before.sig === after.sig && packed * 4 < raw && newsKept,
  before, after, ratio: +(raw / packed).toFixed(1), newsKept };
