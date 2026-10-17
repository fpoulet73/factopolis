// Multijoueur : les biomes survivent à la création de la room (hello) et au bouton
// « Créer la carte » ; l'hôte et l'invité partagent la même graine et la même grille de
// biomes (le serveur ne doit plus retirer biomes/graine de la config du monde).
module.exports = async ({ host, guest, waitFor }) => {
  const sig = () => {
    ensureBiomeGrid();
    let h = 0;
    for(let i = 0; i < biomeGrid.length; i++) h = (Math.imul(h, 31) + biomeGrid[i]) | 0;
    return { biomes: WORLD.biomes, seed: WORLD.seed, n: N, h };
  };
  const res = {};
  // 1) après création de la room : le monde de l'hôte garde ses biomes, l'invité les reçoit
  res.hostRoom = await host.evaluate(sig);
  await waitFor(guest, s => WORLD.seed === s, res.hostRoom.seed, 5000);
  res.guestRoom = await guest.evaluate(sig);
  // 2) nouvelle carte via le bouton (confirmation validée)
  const oldSeed = res.hostRoom.seed;
  await host.evaluate(async () => {
    const p = $('mpBtnNewWorld').onclick();
    $('confirmOk').click();
    await p;
  });
  await waitFor(host, s => WORLD.seed !== s && WORLD.biomes === true, oldSeed, 8000);
  await waitFor(guest, s => WORLD.seed !== s, oldSeed, 8000);
  await host.waitForTimeout(500);
  res.hostNew = await host.evaluate(sig);
  res.guestNew = await guest.evaluate(sig);
  const same = (a, b) => a.biomes === true && b.biomes === true && a.seed === b.seed && a.n === b.n && a.h === b.h;
  res.ok = same(res.hostRoom, res.guestRoom) && same(res.hostNew, res.guestNew) && res.hostNew.seed !== oldSeed;
  return res;
};
