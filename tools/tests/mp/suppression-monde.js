// Multijoueur : seul le créateur peut supprimer le monde ; en partie, l'URL et le
// bouton Déconnecter sont masqués et le titre du panneau est le nom du monde.
module.exports = async ({ host, guest, waitFor }) => {
  const R = {};
  const ui = p => p.evaluate(() => ({
    title: $('mpTitle').textContent,
    connHidden: $('mpConnBlock').style.display === 'none',
    delShown: $('mpBtnDeleteRoom').style.display !== 'none',
    room: MP.roomName,
  }));
  const h = await ui(host), g = await ui(guest);
  R.titre = h.title === '🌍 ' + h.room && g.title === '🌍 ' + g.room;
  R.connMasque = h.connHidden && g.connHidden;
  R.boutonCreateurSeul = h.delShown && !g.delShown;
  // l'invité ne peut pas supprimer (refus serveur)
  await guest.evaluate(() => MP.ws.send(JSON.stringify({ type:'delete_room' })));
  await guest.waitForTimeout(500);
  R.invitéToujoursLà = await guest.evaluate(() => MP.roomId != null);
  // le créateur supprime : tout le monde retourne au lobby
  await host.evaluate(() => MP.ws.send(JSON.stringify({ type:'delete_room' })));
  R.hoteSorti = await waitFor(host, () => MP.roomId == null);
  R.invitéSorti = await waitFor(guest, () => MP.roomId == null);
  R.titreLobby = (await ui(host)).title === '🌐 Multijoueur';
  R.ok = Object.values(R).every(Boolean);
  return R;
};
