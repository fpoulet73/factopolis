// ---------- dépôts : véhicules ----------

BUILD.garage = BUILD.garage || {};
BUILD.garage.transportDepot = true;
BUILD.garage.buyCatalog = BUILD.garage.buyCatalog || Object.keys(VEHICLE_TYPES).filter(k => !VEHICLE_TYPES[k].buyDisabled && k !== 'train');

registerDepotTool({
  key: 'vehicules',
  tool: 'garage',
  label: 'Véhicules',
  icon: '🚛',
  desc: BUILD.garage?.desc || 'Dépôt pour les véhicules routiers.',
});
