// Sauvegarde locale compressée (RLE) puis rechargement : monde identique.
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
localSaveNow('test-auto');
const saved = loadLocalSaves().find(s => s.name === 'test-auto');
genWorld(WORLD_DEFAULTS);
applySnapshot(unpackStateFromStorage(loadLocalSaveState(saved)));
const after = { b: buildings.length, sig: worldSignature(), pop: popTotal() };
const newsKept = !!newsFlags['test:sauvegarde'] && newsLog.some(n => n.title === 'Une de test');
deleteLocalSave(saved);
const cleaned = !loadLocalSaves().some(s => s.name === 'test-auto') && localStorage.getItem(LOCAL_SAVES_KEY + '#' + saved.id) == null;
// sauvegarde auto : une clé par emplacement, rechargeable
performAutoSave();
const autos = loadAutoSaves(), last = autos[autos.length - 1];
const autoOk = !!last && !last.state && !!loadAutoSaveState(last.slot);
// migration de l'ancien format (tableau unique avec les états)
localStorage.setItem(LOCAL_SAVES_KEY, JSON.stringify([{ name:'ancienne', date:new Date().toISOString(), state:packStateForStorage(serializeState()) }]));
const mig = loadLocalSaves();
const migOk = mig.length === 1 && !mig[0].state && !!loadLocalSaveState(mig[0]);
deleteLocalSave(mig[0]);
return { ok: before.b === after.b && before.sig === after.sig && packed * 4 < raw && cleaned && autoOk && migOk && newsKept,
  before, after, ratio: +(raw / packed).toFixed(1), cleaned, autoOk, migOk, newsKept };
