// Outil Terraforming > Ressource : réservé au propriétaire du monde (créateur). Il ajoute une
// ressource sur l'herbe libre, synchronisée chez l'invité ; l'invité ne peut ni l'utiliser ni forger l'action.
module.exports = async ({ host, guest, waitFor }) => {
  const R = {};
  await host.evaluate(() => { T_.flatWorld(true); paused = true; mpForceFullSnapshot(); });
  await waitFor(guest, () => WORLD.buildMaterials === false || WORLD.buildMaterials === true, null, 5000);
  R.hoteProprietaire = await host.evaluate(() => canAddResources());
  R.inviteNonProprietaire = await guest.evaluate(() => !canAddResources());
  // l'hôte ajoute de l'or (zone 2×2), du pétrole et une forêt
  await host.evaluate(() => {
    terraformRadius = 2; terraformResource = T.GOLD;
    setTool('terraform_resource'); clickFn(100, 100);
    terraformRadius = 1; terraformResource = T.OIL; clickFn(110, 100);
    terraformResource = T.TREE; clickFn(112, 100);
    setTool('select');
  });
  R.hote = await host.evaluate(() => [100, 101].every(y => [100, 101].every(x => terrain[y*N+x] === T.GOLD)) && terrain[100*N+110] === T.OIL && terrain[100*N+112] === T.TREE);
  R.inviteRecoit = await waitFor(guest, () => terrain[101*N+101] === T.GOLD && terrain[100*N+110] === T.OIL && terrain[100*N+112] === T.TREE, null, 5000);
  // pas de pose sur un bâtiment / une route
  await host.evaluate(() => { T_.build('house', 120, 100); terraformResource = T.COAL; setTool('terraform_resource'); clickFn(120, 100); setTool('select'); });
  R.batimentIntact = await host.evaluate(() => terrain[100*N+120] === T.GRASS && !!bgrid[100*N+120]);
  // l'invité : outil refusé, action forgée ignorée
  await guest.evaluate(() => { terraformResource = T.IRON; setTool('terraform_resource'); clickFn(130, 100); setTool('select'); });
  await guest.evaluate(() => netSend({ type:'terraform_resource', tiles:[100*N+131], res:T.IRON }));
  await host.waitForTimeout(800);
  R.invitéRefuse = await host.evaluate(() => terrain[100*N+130] === T.GRASS && terrain[100*N+131] === T.GRASS)
    && await guest.evaluate(() => terrain[100*N+130] === T.GRASS);
  R.ok = Object.values(R).every(Boolean);
  return R;
};
