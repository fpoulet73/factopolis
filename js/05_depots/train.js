// ---------- dépôts : train ----------

if(BUILD.train_depot){
  BUILD.train_depot.transportDepot = true;
  BUILD.train_depot.buyCatalog = BUILD.train_depot.buyCatalog || ['train'];
  BUILD.train_depot.desc = BUILD.train_depot.desc || 'Dépôt ferroviaire. Réservé à l’achat et à la gestion des trains.';
}

registerDepotTool({
  key: 'train',
  tool: 'train_depot',
  label: 'Train',
  icon: '🚂',
  desc: BUILD.train_depot?.desc || 'Dépôt ferroviaire. Réservé à l’achat et à la gestion des trains.',
});
