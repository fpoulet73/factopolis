// Seul le propriétaire du monde (créateur) peut démolir les bâtiments des autres joueurs,
// après confirmation ; l'invité ne peut pas démolir ceux de l'hôte.
module.exports = async ({ host, guest, waitFor }) => {
  const R = {};
  const gid = await guest.evaluate(() => MP.myId);
  const hid = await host.evaluate(() => MP.myId);
  await host.evaluate(gid => {
    T_.flatWorld(true); paused = true;
    walletOf(gid).money = 1e6; walletOf(MP.myId).money = 1e6;
    mpForceFullSnapshot();
  }, gid);
  await waitFor(guest, () => WORLD.buildMaterials === false || WORLD.buildMaterials === true, null, 5000);
  await host.evaluate(() => { window.confirmCalls = 0; window.confirmAnswer = true; window.confirmAction = async () => { window.confirmCalls++; return window.confirmAnswer; }; });
  await guest.evaluate(() => { window.confirmAction = async () => true; });
  // bâtiments : une maison de l'invité, une de l'hôte
  await guest.evaluate(() => { setTool('house'); clickFn(100, 100); setTool('select'); });
  R.maisonInvite = await waitFor(host, gid => bgrid[100*N+100]?.owner === gid, gid, 5000);
  await host.evaluate(() => { setTool('house'); clickFn(110, 110); setTool('select'); });
  R.maisonHote = await waitFor(guest, hid => bgrid[110*N+110]?.owner === hid, hid, 5000);
  // l'invité n'a pas le droit de démolir la maison de l'hôte
  await guest.evaluate(() => { setTool('terraform'); clickFn(110, 110); setTool('select'); });
  await guest.waitForTimeout(800);
  R.invitéRefuse = await host.evaluate(() => !!bgrid[110*N+110]);
  // action forgée de l'invité : ignorée
  await guest.evaluate(() => netSend({ type:'bulldoze_bld', bx:110, by:110 }));
  await host.waitForTimeout(800);
  R.forgeIgnoree = await host.evaluate(() => !!bgrid[110*N+110]);
  // l'hôte (créateur) refuse la confirmation : rien ne bouge
  await host.evaluate(() => { window.confirmAnswer = false; setTool('terraform'); clickFn(100, 100); setTool('select'); });
  await host.waitForTimeout(500);
  R.confirmationDemandee = await host.evaluate(() => window.confirmCalls === 1);
  R.annule = await host.evaluate(() => !!bgrid[100*N+100]) && await guest.evaluate(() => !!bgrid[100*N+100]);
  // confirmation acceptée : la maison de l'invité disparaît des deux côtés
  await host.evaluate(() => { window.confirmAnswer = true; setTool('terraform'); clickFn(100, 100); setTool('select'); });
  R.demoliHote = await waitFor(host, () => !bgrid[100*N+100], null, 3000);
  R.demoliInvite = await waitFor(guest, () => !bgrid[100*N+100], null, 5000);
  R.ok = Object.values(R).every(Boolean);
  return R;
};
