// Feux de circulation : réglage du monde réservé à l'hôte, appliqué à tous les joueurs.
module.exports = async ({ host, guest, waitFor }) => {
  const menu = page => page.evaluate(() => { refreshOptMenu(); const el = $('optDisableTrafficLights'); return { shown: el.style.display !== 'none', off: trafficLightsOff }; });
  const before = { host: await menu(host), guest: await menu(guest) };
  // l'invité ne peut pas le basculer (clic ignoré, rien n'est envoyé)
  await guest.evaluate(() => $('optDisableTrafficLights').click());
  await guest.waitForTimeout(500);
  const guestTry = await host.evaluate(() => trafficLightsOff);
  // l'hôte le désactive : l'invité suit
  await host.evaluate(() => $('optDisableTrafficLights').click());
  const synced = await waitFor(guest, () => trafficLightsOff === true, null, 5000);
  // un invité qui forge l'action n'est pas relayé par le serveur
  await host.evaluate(() => { trafficLightsOff = false; });
  await guest.evaluate(() => netSend({ type:'traffic_lights', off:true }));
  await host.waitForTimeout(600);
  const forged = await host.evaluate(() => trafficLightsOff);
  const ok = before.host.shown && !before.guest.shown && !guestTry && synced && forged === false;
  return { ok, before, guestTry, synced, forged };
};
