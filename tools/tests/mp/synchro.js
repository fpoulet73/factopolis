// Multijoueur : constructions des deux côtés (tracés groupés), signaux de jonction
// / rouge forcé, train de l'invité, expansion, vitesse 3×, auto-réparation d'une
// divergence du monde de l'invité.
module.exports = async ({ host, guest }) => {
  const R = {};
  const guestId = await guest.evaluate(() => MP.myId);
  // à l'arrivée, la caméra de l'invité est sur le site de départ du monde de l'hôte
  const site = await host.evaluate(() => starterSite);
  R.camOk = await guest.evaluate(s => {
    if(!s || typeof screenCenterWorldPx !== 'function') return true;
    const [wx, wy] = screenCenterWorldPx();
    return Math.abs(wx / TILE - s.x) < 3 && Math.abs(wy / TILE - s.y) < 3;
  }, site);
  const sigs = async () => [await host.evaluate(() => worldSignature()), await guest.evaluate(() => worldSignature())];
  await host.evaluate(gid => {
    T_.flatWorld();
    walletOf(gid).money = 5e6;
    mapBounds = { x0:60, y0:60, x1:160, y1:160 };
    mapMask.fill(0);
    for(let y = 60; y < 160; y++) for(let x = 60; x < 160; x++) mapMask[y*N+x] = 1;
    refreshExpansionSlots(); markTerrainDirty();
    mpForceFullSnapshot();
  }, guestId);
  await guest.waitForTimeout(1500);
  const s0 = await sigs();
  await host.evaluate(() => {
    applyRailPathWithNetwork(T_.line(80,100,120,100));
    const b = (t,x,y) => { setTool(t); clickFn(x,y); setTool('select'); };
    b('train_depot', 80, 99); b('train_station', 85, 99); b('train_station', 85, 100);
  });
  await guest.evaluate(() => {
    applyRoadPathWithNetwork(T_.line(70,120,110,120));
    applyRailPathWithNetwork(T_.line(70,130,130,130));
    const b = (t,x,y) => { setTool(t); clickFn(x,y); setTool('select'); };
    b('train_depot', 70, 129);
    b('train_station', 90, 129); b('train_station', 90, 130);
    b('train_station', 125, 129); b('train_station', 125, 130);
    setTool('rail_signal2'); mouse.x = 0; mouse.y = 0; clickFn(100,130); clickFn(100,130); setTool('select');
  });
  await guest.waitForTimeout(2500);
  const s1 = await sigs();
  R.signals = await host.evaluate(() => Object.values(railSignals).map(s => s.kind + ':' + s.forcedRed));
  R.depotName = await host.evaluate(() => bgrid[129*N+70]?.name || null);
  // retrait du signal, puis train de l'invité
  await guest.evaluate(() => { setTool('rail_signal2'); clickFn(100,130); setTool('select'); });
  await guest.evaluate(() => {
    const d = bgrid[129*N+70];
    spendMoney(VEHICLE_TYPES.train.cost, 'construction');
    const v = createPersistentVehicle('train', d);
    v.id = String(v.id); v.mpPendingAck = true; v.mpCreatedRealTime = performance.now();
    netSend({ type:'buy_vehicle', id:v.id, vtype:'train', garageX:d.x, garageY:d.y });
    window.__gv = v.id;
  });
  await guest.waitForTimeout(1500);
  await guest.evaluate(() => {
    const v = vehicles.find(x => String(x.id) === window.__gv);
    v.wagons = [trainCreateWagon('minerai'), trainCreateWagon('voiture')];
    syncTrainConfig(v);
    v.orders = [bgrid[129*N+90], bgrid[129*N+125]]; v.orderModes = ['load_unload','load_unload'];
    v.orderIndex = 0; syncTrainOrders(v); v.ordersDraft = false;
    netSend({ type:'route_vehicle', id:v.id, orderIndex:0, orders:v.orders.map(o => ({ x:o.x, y:o.y })), orderModes:v.orderModes.slice() });
  });
  await guest.waitForTimeout(1200);
  R.flag = await guest.evaluate(() => {
    const v = vehicles.find(x => String(x.id) === window.__gv);
    const r = setVehicleDepotDeparture(v, true);
    netSend({ type:'depot_departure_flag', id:v.id, armed:true });
    return r.ok;
  });
  await host.evaluate(() => document.querySelector('.spd[data-s="3"]').click());
  await guest.waitForTimeout(5000);
  R.speed = [await host.evaluate(() => speed), await guest.evaluate(() => speed)];
  R.trainRuns = await host.evaluate(() => vehicles.some(v => v.vtype === 'train' && v.state !== 'idle'));
  await guest.evaluate(() => buyExpansionAction(expansions.find(e => e.side === 'right' && e.pieceIndex === 0)));
  await guest.waitForTimeout(2500);
  const s2 = await sigs();
  // divergence volontaire de l'invité → resynchronisation automatique
  await guest.evaluate(() => { for(let x = 60; x < 80; x++) road[150*N+x] = 1; markGroundDirty(); MP.lastWorldEditAt = 0; });
  await guest.waitForTimeout(6500);
  const s3 = await sigs();
  R.sigs = [s0, s1, s2, s3];
  // la Gazette : publiée par l'hôte (premier train en gare), reçue par l'invité
  R.news = [await host.evaluate(() => newsLog.map(n => n.id + ':' + n.title).join(' / ')),
            await guest.evaluate(() => newsLog.map(n => n.id + ':' + n.title).join(' / '))];
  R.newsOk = R.news[0].length > 0 && R.news[0] === R.news[1]
    && await guest.evaluate(() => newsSeenId === (newsLog[newsLog.length - 1]?.id || 0));
  R.ok = [s0, s1, s2, s3].every(([a, b]) => a === b)
    && R.signals.includes('junction:true') && !!R.depotName && R.flag && R.trainRuns
    && R.speed[0] === 3 && R.speed[1] === 3 && R.camOk && R.newsOk;
  return R;
};
