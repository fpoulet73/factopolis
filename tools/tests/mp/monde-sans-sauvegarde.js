// Un monde sans sauvegarde ne doit jamais charger la carte d'un autre monde :
// création, sauvegarde, quitter, nouveau monde vide, rejoindre → carte neuve.
module.exports = async ({ host, guest, waitFor }) => {
  const R = {};
  // sauvegarde du monde A (monde courant de l'hôte)
  await host.evaluate(() => { T_.flatWorld(); });
  const sigA = await host.evaluate(() => worldSignature());
  await host.evaluate(() => { MP.ws.send(JSON.stringify({ type:'save_game', token:MP.token, name:'carteA', state:packStateForStorage(serializeState()) })); });
  await host.waitForTimeout(800);
  await guest.evaluate(() => mpLeaveRoom());
  await waitFor(guest, () => MP.roomId == null);
  await host.evaluate(() => mpLeaveRoom());
  await waitFor(host, () => MP.roomId == null);
  // monde B, jamais sauvegardé
  await host.evaluate(() => { MP.pendingNewWorld = normalizeWorldConfig({ ...WORLD_DEFAULTS, seed: undefined }); MP.ws.send(JSON.stringify({ type:'create_room', name:'MondeB' + Date.now().toString(36).slice(-4) })); });
  await waitFor(host, () => MP.role === 'host');
  await host.evaluate(() => mpLeaveRoom());
  await waitFor(host, () => MP.roomId == null);
  const idB = await host.evaluate(() => MP.rooms.find(r => /^MondeB/.test(r.name))?.id);
  await host.evaluate(id => mpJoinRoom(id), idB);
  await waitFor(host, () => MP.role === 'host');
  await host.waitForTimeout(1000);
  const sigB2 = await host.evaluate(() => worldSignature());
  R.pasCarteA = sigB2 !== sigA;
  R.ok = R.pasCarteA && !!sigB2;
  return R;
};
