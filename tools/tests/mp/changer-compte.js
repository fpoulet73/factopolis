// Changer de compte en pleine partie : on quitte le monde, se déconnecte du compte,
// puis on peut se connecter avec un autre compte et rejoindre un monde.
module.exports = async ({ host, guest, waitFor }) => {
  const R = {};
  // la confirmation est validée automatiquement
  await guest.evaluate(() => { window.confirmAction = async () => true; });
  await guest.evaluate(() => mpLogoutAccount());
  R.quitte = await waitFor(guest, () => MP.roomId == null && !MP.username);
  R.formAuth = await guest.evaluate(() => $('mpAuthBlock').style.display !== 'none');
  const u2 = 'z' + Date.now().toString(36).slice(-6);
  await guest.evaluate(u => MP.ws.send(JSON.stringify({ type:'register', username:u, password:'pass1234', email:u+'@test.be' })), u2);
  R.nouveauCompte = await waitFor(guest, u => MP.username === u, u2, 5000);
  const roomId = await host.evaluate(() => MP.roomId);
  await guest.evaluate(id => mpJoinRoom(id), roomId);
  R.rejoint = await waitFor(guest, () => MP.role === 'guest' && !MP.awaitingSnapshot);
  R.ok = Object.values(R).every(Boolean);
  return R;
};
