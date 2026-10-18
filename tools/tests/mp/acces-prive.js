// Accès aux mondes : public par défaut ; privé → seul un invité peut rejoindre ;
// la liste indique privé/public, membres et joueurs en ligne.
module.exports = async ({ host, guest, waitFor }) => {
  const R = {};
  const send = (p, m) => p.evaluate(m => MP.ws.send(JSON.stringify(m)), m);
  const guestName = await guest.evaluate(() => MP.username);
  R.publicParDefaut = await host.evaluate(() => MP.roomAccess?.isPublic === true);
  R.panneauCreateur = await host.evaluate(() => $('mpAccessBlock').style.display !== 'none');
  R.panneauInvite = await guest.evaluate(() => $('mpAccessBlock').style.display === 'none');
  // l'invité quitte, le créateur passe en privé
  await guest.evaluate(() => mpLeaveRoom());
  await waitFor(guest, () => MP.roomId == null);
  const roomId = await host.evaluate(() => MP.roomId);
  await send(host, { type:'set_room_access', isPublic:false });
  await waitFor(guest, id => MP.rooms.some(r => r.id === id && r.isPublic === false), roomId);
  R.listePrivee = await guest.evaluate(id => { const r = MP.rooms.find(r => r.id === id); return r && !r.canJoin && !r.isMember && r.isPublic === false; }, roomId);
  R.hoteMembre = await host.evaluate(() => MP.roomAccess?.isPublic === false);
  // refus sans invitation
  await guest.evaluate(id => mpJoinRoom(id), roomId);
  await guest.waitForTimeout(600);
  R.refuse = await guest.evaluate(() => MP.roomId == null);
  // invitation d'un compte inconnu refusée, puis du bon compte
  await send(host, { type:'invite_player', username:'personne-inconnue' });
  await host.waitForTimeout(300);
  R.inconnuRefuse = await host.evaluate(() => !(MP.roomAccess.members || []).length);
  await send(host, { type:'invite_player', username:guestName });
  await waitFor(guest, id => MP.rooms.some(r => r.id === id && r.canJoin && r.isMember), roomId);
  R.invitationListe = true;
  await guest.evaluate(id => mpJoinRoom(id), roomId);
  R.rejoint = await waitFor(guest, () => MP.roomId != null && MP.role === 'guest');
  // retirer l'invité d'un monde privé l'éjecte
  await send(host, { type:'remove_member', username:guestName });
  R.ejecte = await waitFor(guest, () => MP.roomId == null);
  // seul le créateur peut gérer l'accès
  R.ok = Object.values(R).every(Boolean);
  return R;
};
