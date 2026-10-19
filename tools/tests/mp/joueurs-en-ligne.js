// Compteur « joueurs connectés / joueurs au total » : reçu du serveur dès la connexion,
// mis à jour à l'arrivée et au départ d'un joueur.
const read = page => page.evaluate(() => document.getElementById('onlineStats')?.textContent || '');
module.exports = async ({ host, guest, waitFor }) => {
  const parse = t => { const m = /(\d+) \/ (\d+)/.exec(t); return m ? [+m[1], +m[2]] : null; };
  await waitFor(host, () => !!document.getElementById('onlineStats'), null, 5000);
  const a = parse(await read(host));
  const errs = [];
  // même compteur dans le lobby de la fenêtre multijoueur
  const line = await guest.evaluate(() => document.getElementById('mpOnlineLine')?.textContent || '');
  if(!/\d+ \/ \d+/.test(line)) errs.push('compteur absent de la fenêtre multijoueur : ' + line);
  if(!a || a[0] < 2 || a[1] < a[0]) errs.push('compteur initial ' + JSON.stringify(a));
  await guest.evaluate(() => MP.ws.close());
  const down = await waitFor(host, n => /(\d+) \/ /.exec(document.getElementById('onlineStats').textContent)[1] < n, a ? a[0] : 2, 6000);
  if(!down) errs.push('compteur non décrémenté après départ');
  // dans le monde : le joueur parti reste compté dans le total (1 en ligne / 2 joueurs du monde)
  const inRoom = await waitFor(host, () => /^🟢 1 \/ 2 joueurs dans ce monde$/.test(document.getElementById('mpOnlineLine').textContent), null, 6000);
  if(!inRoom) errs.push('total du monde : ' + await host.evaluate(() => document.getElementById('mpOnlineLine').textContent));
  return { ok: !errs.length, errs, before: a };
};
