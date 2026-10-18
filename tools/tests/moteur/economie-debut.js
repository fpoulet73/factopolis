// Début de partie type : 2 maisons de départ, filière poisson, 4 maisons. La
// ville doit se peupler (rayon de travail, sous-produit non bloquant), gagner de
// l'argent et franchir les premiers objectifs.
T_.flatWorld();
myWallet().money = 2500; WALLETS[0].fin = FIN_ZERO();
T_.water(86, 96, 96, 108);
for(const t of T_.line(96,100,120,100)) if(canPlace('road', t.x, t.y).ok){ road[t.y*N+t.x] = 1; spendMoney(BUILD.road.cost, 'construction'); }
markGroundDirty();
T_.build('house', 100, 99); T_.build('house', 101, 99);
T_.run(120, 0.1);
T_.build('fisher', 96, 101);
const pl = T_.build('plant', 98, 101); applyPlantUpgrade(pl, 'fishery'); spendMoney(BUILD.fishery.cost, 'construction');
T_.run(180, 0.1);
for(const x of [102,103,104,105]) T_.build('house', x, 99);
const money0 = myWallet().money;
T_.run(600, 0.1);
const pop = popTotal(), money = myWallet().money;
return { ok: pop >= 25 && money > money0 + 300 && myWallet().objIndex >= 4, pop, money: Math.round(money), objIndex: myWallet().objIndex };
