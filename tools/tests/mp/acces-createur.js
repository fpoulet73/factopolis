// Le créateur d'un monde privé le rejoint sans invitation (même après l'avoir quitté).
module.exports = async ({ host, guest, waitFor }) => {
  const R = {};
  const roomId = await host.evaluate(() => MP.roomId);
  await host.evaluate(() => MP.ws.send(JSON.stringify({ type:'set_room_access', isPublic:false })));
  await guest.evaluate(() => mpLeaveRoom());
  await waitFor(guest, () => MP.roomId == null);
  await host.evaluate(() => mpLeaveRoom());
  await waitFor(host, () => MP.roomId == null);
  R.listeJoignable = await waitFor(host, id => MP.rooms.some(r => r.id === id && r.isPublic === false && r.canJoin && r.isCreator), roomId, 3000);
  await host.evaluate(id => mpJoinRoom(id), roomId);
  R.rejoint = await waitFor(host, () => MP.roomId != null && MP.role != null, null, 5000);
  R.ok = Object.values(R).every(Boolean);
  return R;
};
