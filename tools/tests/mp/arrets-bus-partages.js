// Un bus invité dessert des arrêts étrangers et chaque propriétaire est payé.
module.exports = async ({ host, guest, waitFor }) => {
  const guestId = await guest.evaluate(() => MP.myId);
  const thirdId = 9999;
  await host.evaluate(({ guestId, thirdId }) => {
    T_.flatWorld(); paused = true;
    applyRoadPathWithNetwork(T_.line(78, 100, 99, 100));
    const garage = T_.build('garage', 80, 99);
    const a = T_.build('bus_stop', 85, 99);
    const b = T_.build('bus_stop', 95, 99);
    if(!garage || !a || !b) throw new Error('Bâtiments de test manquants');
    garage.owner = guestId;
    a.owner = MP.myId;
    b.owner = thirdId;
    const v = createPersistentVehicle('bus', garage);
    v.id = String(v.id);
    window.__sharedBusId = v.id;
    mpForceFullSnapshot();
  }, { guestId, thirdId });
  const ready = await waitFor(guest, () => vehicles.some(v => v.vtype === 'bus' && v.garageRef?.owner === MP.myId), null, 5000);
  if(!ready) return { ok:false, stage:'snapshot' };
  const endpoints = await guest.evaluate(() => {
    const v = vehicles.find(v => v.vtype === 'bus' && v.garageRef?.owner === MP.myId);
    const a = bgrid[99*N+85], b = bgrid[99*N+95];
    const allowed = vehicleRouteEndpointOk(a, 'bus', MP.myId) && vehicleRouteEndpointOk(b, 'bus', MP.myId);
    const garageDenied = !vehicleRouteEndpointOk(v.garageRef, 'bus', 9999);
    netSend({ type:'route_vehicle', id:v.id, sourceX:a.x, sourceY:a.y, destX:b.x, destY:b.y });
    return { allowed, garageDenied };
  });
  const routed = await waitFor(host, () => {
    const v = vehicles.find(v => v.id === window.__sharedBusId);
    return v?.source?.x === 85 && v?.dest?.x === 95;
  }, null, 5000);
  const revenue = await host.evaluate(({ guestId, thirdId }) => {
    const v = vehicles.find(v => v.id === window.__sharedBusId);
    const ids = [guestId, MP.myId, thirdId];
    const before = ids.map(id => walletOf(id).money);
    busEarnRevenue(v, 10, 10, v.source, v.dest);
    const gained = ids.map((id, i) => walletOf(id).money - before[i]);
    const total = Math.round(100 * BUS_FARE_FACTOR);
    const busPart = Math.round(total * BUS_OWNER_SHARE);
    return { gained, expected:[busPart, Math.ceil((total - busPart)/2), Math.floor((total - busPart)/2)] };
  }, { guestId, thirdId });
  return { ok:endpoints.allowed && endpoints.garageDenied && routed
    && JSON.stringify(revenue.gained) === JSON.stringify(revenue.expected), endpoints, routed, revenue };
};
