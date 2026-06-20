// ---------- dépôts : bateau ----------
// Structure prête pour l'implémentation du transport maritime.

BUILD.boat_depot = BUILD.boat_depot || {
  n: 'Dépôt bateau',
  ic: '🚢',
  hk: '',
  cost: CFG.logistique?.bateau?.cout ?? 1400,
  col: '#3f6f8f',
  hgt: 22,
  transportDepot: true,
  buyCatalog: [],
  desc: 'Dépôt maritime. Réservé à l’achat et à la gestion des bateaux.',
};
BUILD.boat_depot.transportDepot = true;
BUILD.boat_depot.buyCatalog = BUILD.boat_depot.buyCatalog || [];

registerDepotTool({
  key: 'bateau',
  tool: 'boat_depot',
  label: 'Bateau',
  icon: '🚢',
  desc: BUILD.boat_depot.desc,
});
