// Migration d'hôte : l'hôte quitte la partie pendant qu'un train circule ;
// l'invité, promu hôte, reprend la simulation (temps et train avancent).
module.exports = async ({ host, guest, waitFor }) => {
  await host.evaluate(() => {
    T_.flatWorld();
    applyRailPathWithNetwork(T_.line(80,100,130,100));
    const b = (t,x,y) => { setTool(t); clickFn(x,y); setTool('select'); return bgrid[y*N+x]; };
    const dep = b('train_depot', 80, 99);
    const a = b('train_station', 85, 99); b('train_station', 85, 100);
    const c = b('train_station', 125, 99); b('train_station', 125, 100);
    const v = createPersistentVehicle('train', dep);
    v.wagons = [trainCreateWagon('minerai'), trainCreateWagon('voiture')];
    v.orders = [a, c]; v.orderModes = ['load_unload','load_unload']; syncTrainOrders(v);
    setTrainDepotDeparture(v, true);
    paused = false;
    mpForceFullSnapshot();
  });
  await guest.waitForTimeout(3500);
  await host.evaluate(() => mpLeaveRoom());
  const promoted = await waitFor(guest, () => MP.role === 'host', null, 8000);
  const g0 = await guest.evaluate(() => { paused = false; return { gtime, tile: trainTileIndex(vehicles.find(v => v.vtype === 'train')) }; });
  await guest.waitForTimeout(5000);
  const g1 = await guest.evaluate(() => ({ gtime, tile: trainTileIndex(vehicles.find(v => v.vtype === 'train')) }));
  return { ok: promoted && g1.gtime > g0.gtime + 2 && g1.tile !== g0.tile, promoted, g0, g1 };
};
