// Multijoueur : l'hôte valide les matériaux de chantier de l'invité (entrepôt de
// l'invité couvrant le chantier) et les prélève ; une pose forcée sans matériaux
// (action envoyée directement) est ignorée. Les gares restent libres.
module.exports = async ({ host, guest, waitFor }) => {
  const gid = await guest.evaluate(() => MP.myId);
  await host.evaluate(gid => {
    T_.flatWorld(true); paused = true;
    walletOf(gid).money = 1e6;
    applyRailPathWithNetwork(T_.line(96, 100, 116, 100));
    mpForceFullSnapshot();
  }, gid);
  if(!await waitFor(guest, () => !!rail[100*N+100] && WORLD.buildMaterials === true, null, 5000)) return { ok:false, stage:'snapshot' };
  // gare ferroviaire : aucun matériau requis
  await guest.evaluate(() => { setTool('train_station'); clickFn(110, 99); setTool('select'); });
  const stationFree = await waitFor(host, () => bgrid[99*N+110]?.type === 'train_station', null, 5000);
  // entrepôt de l'invité (aucun matériau requis)
  await guest.evaluate(() => { setTool('depot'); clickFn(100, 103); setTool('select'); });
  if(!await waitFor(host, gid => bgrid[103*N+100]?.type === 'depot' && bgrid[103*N+100].owner === gid, gid, 5000)) return { ok:false, stage:'entrepôt' };
  // piste d'aéroport sans matériaux : refus local, rien n'est envoyé
  const refusedLocally = await guest.evaluate(() => {
    const v = canPlace('air_runway', 100, 105);
    setTool('air_runway'); clickFn(100, 105); setTool('select');
    return !v.ok && !!v.materials;
  });
  // l'hôte remplit l'entrepôt de l'invité puis synchronise
  await host.evaluate(() => {
    T_.stock(bgrid[103*N+100], buildMaterialsOf('air_runway'));
    mpForceFullSnapshot();
  });
  if(!await waitFor(guest, () => (bgrid[103*N+100]?.storage.concrete || 0) >= buildMaterialsOf('air_runway').concrete, null, 5000)) return { ok:false, stage:'stock' };
  await guest.evaluate(() => { setTool('air_runway'); clickFn(100, 105); setTool('select'); });
  const placed = await waitFor(host, () => bgrid[105*N+100]?.type === 'air_runway', null, 5000);
  const consumed = await host.evaluate(() => (bgrid[103*N+100].storage.concrete || 0) === 0 && (bgrid[103*N+100].storage.paint || 0) === 0);
  // action forgée hors de portée de tout entrepôt : l'hôte l'ignore
  await guest.evaluate(() => netSend({ type:'build', btype:'air_runway', x:114, y:110 }));
  await host.waitForTimeout(1500);
  const forgedIgnored = await host.evaluate(() => !bgrid[110*N+114]);
  return { ok: stationFree && refusedLocally && placed && consumed && forgedIgnored, stationFree, refusedLocally, placed, consumed, forgedIgnored };
};
