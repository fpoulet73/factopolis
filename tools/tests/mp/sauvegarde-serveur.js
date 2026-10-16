// Multijoueur : sauvegarde sur le serveur (état compacté : grilles RLE,
// bâtiments sans champs par défaut), modification du monde, puis rechargement
// diffusé à toute la room. Hôte et invité doivent retrouver le monde sauvegardé.
module.exports = async ({ host, guest, waitFor }) => {
  const R = {};
  await host.evaluate(() => {
    T_.flatWorld();
    mapBounds = { x0:60, y0:60, x1:160, y1:160 };
    mapMask.fill(0);
    for(let y = 60; y < 160; y++) for(let x = 60; x < 160; x++) mapMask[y*N+x] = 1;
    refreshExpansionSlots(); markTerrainDirty();
    applyRoadPathWithNetwork(T_.line(80, 100, 110, 100));
    for(let x = 82; x < 100; x++) T_.build('house', x, 99);
    const p = T_.build('plant', 100, 101); applyPlantUpgrade(p, 'smelter');
    p.storage = { iron:3, coal:2.5 }; p.paused = true;
    T_.build('bus_stop', 90, 101);
    mpForceFullSnapshot();
  });
  await guest.waitForTimeout(1500);
  const snap = page => page.evaluate(() => ({
    sig: worldSignature(), n: buildings.length,
    sm: (b => b && { st: b.storage, paused: !!b.paused })(buildings.find(b => b.type === 'smelter')),
  }));
  R.before = await snap(host);
  await host.evaluate(() => {
    window.__saved = false;
    MP.ws.addEventListener('message', e => { try { if(JSON.parse(e.data).type === 'save_ok') window.__saved = true; } catch(_){} });
    MP.ws.send(JSON.stringify({ type:'save_game', token:MP.token, name:'test-mp', state:packStateForStorage(serializeState()) }));
  });
  R.saved = await waitFor(host, () => window.__saved, null, 8000);
  // le monde change (bâtiments détruits, route coupée)…
  await host.evaluate(() => {
    for(const b of buildings.filter(b => b.type === 'house').slice(0, 6)){ b.dead = true; setGrid(b, null); }
    buildings = buildings.filter(b => !b.dead);
    road[100*N+95] = 0; markGroundDirty();
    mpForceFullSnapshot();
  });
  await guest.waitForTimeout(1500);
  R.modified = (await snap(guest)).n;
  // …puis on recharge la sauvegarde pour toute la room
  await host.evaluate(() => MP.ws.send(JSON.stringify({ type:'load_game', token:MP.token, name:'test-mp' })));
  await guest.waitForTimeout(2500);
  R.hostAfter = await snap(host);
  R.guestAfter = await snap(guest);
  const same = (a, b) => a.sig === b.sig && a.n === b.n && JSON.stringify(a.sm) === JSON.stringify(b.sm);
  R.ok = R.saved && R.modified < R.before.n && same(R.before, R.hostAfter) && same(R.before, R.guestAfter);
  return R;
};
