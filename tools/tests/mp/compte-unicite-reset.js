// Comptes : nom et email uniques (insensible à la casse) ; échec de login → lien
// « mot de passe oublié » ; code reçu par email → nouveau mot de passe.
const fs = require('fs');

module.exports = async ({ host, guest, waitFor }) => {
  const R = {};
  const outbox = process.env.FACTOPOLIS_MAIL_OUTBOX;
  const mails = () => fs.existsSync(outbox) ? fs.readFileSync(outbox, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const hostName = await host.evaluate(() => MP.username);
  const hostEmail = hostName + '@test.be';
  // l'invité se déconnecte de son compte pour tenter des inscriptions
  await guest.evaluate(() => { window.confirmAction = async () => true; });
  await guest.evaluate(() => mpLogoutAccount());
  await waitFor(guest, () => !MP.username && MP.roomId == null);
  const lastErr = () => guest.evaluate(() => $('mpAuthErr').textContent);
  const register = (u, e) => guest.evaluate(([u, e]) => { $('mpAuthErr').textContent = ''; MP.ws.send(JSON.stringify({ type:'register', username:u, password:'pass1234', email:e })); }, [u, e]);
  await register(hostName.toUpperCase(), 'autre@test.be');
  await waitFor(guest, () => /déjà pris/.test($('mpAuthErr').textContent), null, 3000);
  R.nomUnique = /déjà pris/.test(await lastErr());
  await register('nouveau' + Date.now().toString(36).slice(-5), hostEmail.toUpperCase());
  await waitFor(guest, () => /déjà utilisé/.test($('mpAuthErr').textContent), null, 3000);
  R.emailUnique = /déjà utilisé/.test(await lastErr());
  // mauvais mot de passe → lien de réinitialisation
  await guest.evaluate(n => MP.ws.send(JSON.stringify({ type:'login', username:n, password:'faux' })), hostName);
  await waitFor(guest, () => $('mpResetLink').style.display !== 'none', null, 3000);
  R.lienReset = await guest.evaluate(() => $('mpResetLink').style.display !== 'none');
  // réinitialisation avec un mauvais code, puis le bon
  await guest.evaluate(n => { $('mpAuthUser').value = n; $('mpResetLink').click(); $('mpBtnResetSend').click(); }, hostName);
  await waitFor(guest, () => $('mpResetStep2').style.display !== 'none', null, 3000);
  const mail = mails().find(m => m.to === hostEmail);
  R.mailEnvoye = !!mail;
  const code = /(\d{6})/.exec(mail?.text || '')?.[1];
  await guest.evaluate(() => { $('mpResetCode').value = '000000'; $('mpResetPwd').value = 'nouveau-mdp'; $('mpBtnResetConfirm').click(); });
  await waitFor(guest, () => /invalide/.test($('mpResetMsg').textContent), null, 3000);
  R.mauvaisCode = await guest.evaluate(() => /invalide/.test($('mpResetMsg').textContent));
  await guest.evaluate(c => { $('mpResetCode').value = c; $('mpBtnResetConfirm').click(); }, code);
  await waitFor(guest, () => $('mpResetBlock').style.display === 'none', null, 3000);
  R.resetOk = await guest.evaluate(() => $('mpResetBlock').style.display === 'none');
  // ancien mot de passe refusé, nouveau accepté
  await guest.evaluate(n => MP.ws.send(JSON.stringify({ type:'login', username:n, password:'pass1234' })), hostName);
  await guest.waitForTimeout(400);
  R.ancienRefuse = await guest.evaluate(() => !MP.username);
  await guest.evaluate(n => MP.ws.send(JSON.stringify({ type:'login', username:n, password:'nouveau-mdp' })), hostName);
  R.nouveauOk = await waitFor(guest, n => MP.username === n, hostName, 4000);
  R.ok = Object.values(R).every(Boolean);
  return R;
};
