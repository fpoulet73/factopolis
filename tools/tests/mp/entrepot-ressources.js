// Les clics de l'invité doivent survivre aux synchronisations de l'hôte.
module.exports = async ({ host, guest, waitFor }) => {
  const gid = await guest.evaluate(() => MP.myId);
  await host.evaluate(gid => {
    T_.flatWorld(); paused = true;
    T_.rail(T_.line(95, 98, 105, 98));
    const depot = T_.build('depot', 100, 100);
    const station = T_.build('train_station', 100, 99);
    depot.owner = station.owner = gid;
    mpForceFullSnapshot();
  }, gid);
  if(!await waitFor(guest, () => bgrid[100*N+100]?.owner === MP.myId)) return { ok:false, stage:'snapshot' };
  const steps = [];
  async function clickResource(station, allowed, trainAllowed){
    await guest.evaluate(station => {
      selected = bgrid[(station ? 99 : 100)*N+100];
      $('info')._html = null; renderInfo();
    }, station);
    await guest.locator(station ? '[data-station-depot-toggle-res="iron"]' : '[data-toggle-res="iron"]').click();
    const matches = expected => {
      const b = bgrid[100*N+100];
      return (b.allow.iron !== false) === expected.allowed && (b.trainAllow.iron !== false) === expected.trainAllowed;
    };
    const expected = { allowed, trainAllowed };
    const received = await waitFor(host, matches, expected, 3000);
    // Plusieurs cycles monde : le réglage doit rester visible chez l'invité.
    await guest.waitForTimeout(2200);
    steps.push(received && await guest.evaluate(matches, expected));
  }
  await clickResource(false, true, false);
  await clickResource(false, false, false);
  await clickResource(true, true, false);
  await clickResource(true, true, true);
  await clickResource(true, false, true);
  // Une action envoyée par un autre propriétaire est ignorée.
  await host.evaluate(() => netSend({ type:'set_depot_resource', x:100, y:100, res:'iron', allowed:true }));
  await guest.waitForTimeout(300);
  const protectedOwner = await guest.evaluate(() => bgrid[100*N+100].allow.iron === false);
  return { ok:steps.every(Boolean) && protectedOwner, steps, protectedOwner };
};
