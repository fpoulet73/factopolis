// ---------- dépôts : aéroport (avions) ----------
// L'aéroport sert de dépôt (achat des avions) et d'escale pour les voyageurs
// sans emploi de son rayon. Les avions volent en ligne droite entre aéroports.

BUILD.plane_depot = BUILD.plane_depot || {
  n: 'Aéroport',
  ic: '✈️',
  hk: '',
  cost: CFG.logistique?.avion?.cout ?? 3500,
  col: '#5c6f8f',
  hgt: 22,
  transportDepot: true,
  buyCatalog: ['plane'],
  desc: 'Aéroport : achète des avions de ligne qui transportent les voyageurs sans emploi '
    + 'de son rayon vers un autre aéroport, en vol direct. Très rapide, très rentable sur longue distance.',
};
BUILD.plane_depot.transportDepot = true;
BUILD.plane_depot.buyCatalog = ['plane'];

registerDepotTool({
  key: 'avion',
  tool: 'plane_depot',
  label: 'Aéroport',
  icon: '✈️',
  desc: BUILD.plane_depot.desc,
});
