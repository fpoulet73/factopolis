// ---------- dépôts : avion ----------
// Structure prête pour l'implémentation du transport aérien.

BUILD.plane_depot = BUILD.plane_depot || {
  n: 'Dépôt avion',
  ic: '✈️',
  hk: '',
  cost: CFG.logistique?.avion?.cout ?? 2400,
  col: '#5c6f8f',
  hgt: 22,
  transportDepot: true,
  buyCatalog: [],
  desc: 'Dépôt aérien. Réservé à l’achat et à la gestion des avions.',
};
BUILD.plane_depot.transportDepot = true;
BUILD.plane_depot.buyCatalog = BUILD.plane_depot.buyCatalog || [];

registerDepotTool({
  key: 'avion',
  tool: 'plane_depot',
  label: 'Avion',
  icon: '✈️',
  desc: BUILD.plane_depot.desc,
});
