// ---------- dépôts : port (bateaux) ----------
// Le port se pose au bord de l'eau. Il sert de dépôt (achat des bateaux) ET
// d'escale : fret via un entrepôt collé au port, voyageurs du voisinage.

BUILD.boat_depot = BUILD.boat_depot || {
  n: 'Port',
  ic: '⚓',
  hk: '',
  cost: CFG.logistique?.bateau?.cout ?? 1400,
  col: '#3f6f8f',
  hgt: 22,
  transportDepot: true,
  buyCatalog: ['cargo_ship', 'ferry'],
  desc: 'Port au bord de l’eau : achète des cargos (fret via un entrepôt collé au port) '
    + 'et des ferries (voyageurs sans emploi du voisinage). Les bateaux relient deux ports par l’eau.',
};
BUILD.boat_depot.transportDepot = true;
BUILD.boat_depot.buyCatalog = ['cargo_ship', 'ferry'];

registerDepotTool({
  key: 'bateau',
  tool: 'boat_depot',
  label: 'Port',
  icon: '⚓',
  desc: BUILD.boat_depot.desc,
});
