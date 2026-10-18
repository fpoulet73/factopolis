// Magasins : un magasin vierge se spécialise (épicerie, fournitures, outils, bricolage), se
// ravitaille auprès des entrepôts proches et vend aux logements de son rayon, au profit de son
// propriétaire. Sauvegarde, démolition, interface, rendu.
T_.flatWorld(false);
const errs = [];
const check = (label, cond, info) => { if(!cond) errs.push(label + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
const tryDo = (label, fn) => { try { fn(); } catch(e){ errs.push(label + ': ' + e.message); } };
for(const t of T_.line(88, 99, 112, 99)) road[t.y*N+t.x] = 1;
markGroundDirty();

check('4 types de magasin', SHOP_TYPES.length === 4, SHOP_TYPES);
check('menu Bâtiments : magasin', !!document.querySelector('[data-building-tool="shop"]'));
check('magasin vierge sans stock', BUILD.shop.shopBlank && !BUILD.shop.shop);

// logements (consomment du filet de poisson) et entrepôt approvisionné
const homes = [];
for(let x = 90; x < 100; x++){
  const h = T_.build('house', x, 98);
  if(h){ h.pop = 5; h.starterHome = false; h.protectedPop = 0; h.storage = {}; homes.push(h); }
}
const depot = T_.build('depot', 94, 100);
T_.stock(depot, { fish_fillet: 200, bread: 100 });
const money0 = myWallet().money;
const shop = T_.build('shop', 97, 100);
check('magasin vierge posé', shop?.type === 'shop' && myWallet().money === money0 - BUILD.shop.cost, shop && [shop.type, myWallet().money - money0]);
check('vierge : spécialisations proposées', Object.keys(SHOP_UPGRADES).every(t => !plantUpgradeError(shop, t)));
check('usine : pas de type magasin', plantUpgradeError({ type:'plant', x:1, y:1, w:1, h:1, dead:false }, 'shop_food') !== '');

// spécialisation
const cost = BUILD.shop_food.cost, m1 = myWallet().money;
tryDo('spécialisation', () => { spendMoney(cost, 'construction'); const e = applyPlantUpgrade(shop, 'shop_food'); if(e) throw new Error(e); });
check('épicerie', shop.type === 'shop_food' && isShop(shop), shop.type);
check('déjà spécialisé : refus', plantUpgradeError(shop, 'shop_tools') !== '');
check('accepte le pain, pas les outils', accepts(shop, 'bread') && !accepts(shop, 'goods'));
check('capacité par produit', capOf(shop, 'bread') === BUILD.shop_food.shop.capacity && capOf(shop, 'goods') === 0);

// ravitaillement par l'entrepôt (le magasin n'est pas servi par une usine)
T_.run(25, 0.1);
const got = (shop.storage.bread || 0) + (shop.storage.fish_fillet || 0) + (shop.shopSales || 0);
check('ravitaillé par l’entrepôt', got > 0, [shop.storage, shop.shopSales]);
check('pas de re-expédition du stock', (shop.trucksOut || 0) === 0, shop.trucksOut);

// vente aux logements du rayon, payée au propriétaire (même joueur : ventes et achats se compensent)
shop.storage = { bread: 20, fish_fillet: 20 };
for(const h of homes) h.storage = {};
depot.storage = {}; depot.allow = {};          // plus de livraison directe : seul le magasin sert
const w = myWallet(), sales0 = shop.shopSales || 0, inc0 = shop.shopIncome || 0, v0 = w.fin.ventes, a0 = w.fin.achats || 0;
T_.run(3.1, 0.1);
check('ventes', (shop.shopSales || 0) > sales0, [shop.shopSales, sales0]);
check('recettes du magasin', (shop.shopIncome || 0) > inc0, [shop.shopIncome, inc0]);
check('ventes comptabilisées', w.fin.ventes > v0 && (w.fin.achats || 0) > a0, [w.fin.ventes - v0, (w.fin.achats || 0) - a0]);
check('logements servis', homes.some(h => (h.storage.bread || 0) > 0 || (h.storage.fish_fillet || 0) > 0));
check('stock du magasin entamé', (shop.storage.bread || 0) + (shop.storage.fish_fillet || 0) < 40, shop.storage);

// hors rayon : pas de vente
const far = T_.build('house', 112, 98);
far.pop = 5; far.starterHome = false; far.storage = {};
shop.storage = { bread: 20, fish_fillet: 20 };
for(const h of homes) h.storage = { bread: 99, fish_fillet: 99 }; // pleins : seul far demanderait
T_.run(3.1, 0.1);
check('hors rayon : aucune vente', !(far.storage.bread || far.storage.fish_fillet), far.storage);

// fonds insuffisants du logement : pas de vente
for(const h of homes) h.storage = {};
const bal = w.money; w.money = 0;
const s1 = shop.shopSales || 0;
T_.run(2.1, 0.1);
check('sans argent : aucune vente', (shop.shopSales || 0) === s1 && w.money >= 0, [shop.shopSales, s1, w.money]);
w.money = bal;

// sauvegarde / rechargement
tryDo('sauvegarde', () => applySnapshot(JSON.parse(JSON.stringify(serializeState()))));
const shop2 = bgrid[100*N+97];
check('magasin rechargé', shop2?.type === 'shop_food' && shop2.shopSales === shop.shopSales && shop2.shopIncome === shop.shopIncome, shop2 && [shop2.type, shop2.shopSales]);

// chaîne : un second magasin du même type, dans le rayon du premier mais hors de portée de l'entrepôt,
// est ravitaillé par le premier ; stocks équilibrés sur la chaîne
tryDo('chaîne', () => {
  const R = shopRadiusOf(shop2);
  const dp = bgrid[100*N+94];
  const gx = 97 + Math.min(R, 12);
  const b2 = T_.build('shop', gx, 100);
  if(!b2) throw new Error('pose du 2e magasin impossible');
  applyPlantUpgrade(b2, 'shop_food');
  if(buildingDistance(dp, b2) <= depotRadiusOf(dp)){ errs.push('chaîne : le 2e magasin est déjà à portée de l’entrepôt'); return; }
  check('chaîne de 2', shopChainOf(shop2).length === 2 && shopChainOf(b2).length === 2, shopChainOf(shop2).length);
  shop2.storage = { bread: 40, fish_fillet: 0 }; b2.storage = {};
  dp.storage = {}; dp.allow = {};
  T_.run(12, 0.1);
  check('2e magasin ravitaillé par le 1er', (b2.storage.bread || 0) >= 15, b2.storage);
  check('stocks équilibrés', Math.abs((shop2.storage.bread || 0) - (b2.storage.bread || 0)) <= 2, [shop2.storage.bread, b2.storage.bread]);
  // autre type ou autre propriétaire : pas de chaîne
  const other = T_.build('shop', gx, 102); applyPlantUpgrade(other, 'shop_tools');
  check('autre type : hors chaîne', !shopChainOf(shop2).includes(other));
  const foreign = T_.build('shop', gx - 2, 102); applyPlantUpgrade(foreign, 'shop_food'); foreign.owner = 987;
  check('autre propriétaire : hors chaîne', !shopChainOf(shop2).includes(foreign));
  for(const x of [b2, other, foreign]) demolishBuilding(x, x.owner);
});

// panneau, rayon, rendu (4 rotations), démolition
tryDo('panneau', () => {
  selected = shop2; selectedVehicle = null; $('info')._html = null; renderInfo();
  if(!/Rayon de chalandise/.test($('info').innerHTML)) throw new Error('ligne Rayon absente');
  const blank = T_.build('shop', 100, 101);
  selected = blank; $('info')._html = null; renderInfo();
  if(!document.querySelector('#info [data-plant-upgrade="shop_tools"]')) throw new Error('boutons de spécialisation absents');
  demolishBuilding(blank, blank.owner);
});
tryDo('rendu', () => {
  const tools = T_.build('shop', 102, 101); applyPlantUpgrade(tools, 'shop_tools');
  const blank = T_.build('shop', 104, 101);
  for(let k = 0; k < 4; k++){ rotate(1); for(const b of [shop2, tools, blank]) drawBuildingBody(b); drawFn(); }
});
const n0 = buildings.length;
demolishBuilding(shop2, shop2.owner);
check('démolition', shop2.dead && buildings.filter(b => !b.dead).length < n0 || shop2.dead);
return { ok: errs.length === 0, errs };
