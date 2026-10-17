// Dépôt ferroviaire : un wagon précis du train se revend (50 %) depuis le panneau du dépôt.
T_.flatWorld();
const errs = [], check = (n, c) => { if(!c) errs.push(n); };
T_.rail(T_.line(84, 110, 120, 110));
const dep = T_.build('train_depot', 86, 109);
T_.build('train_station', 100, 109); T_.build('train_station', 100, 110);
const st = bgrid[110 * N + 100], st2 = bgrid[109 * N + 100];
const { v } = T_.train(dep, [st, st2], ['minerai', 'cereale', 'voiture']);
check('train au dépôt', trainPresentAtDepot(v) || v.state === 'idle');
selected = dep; $('info')._html = null; renderInfo();
const btns = document.querySelectorAll('#info [data-sell-wagon]');
check('un bouton par wagon', btns.length === v.wagons.length && btns.length === 3);
const second = v.wagons[1].type, money = myWallet().money;
btns[1].click();
check('wagon retiré (le 2e)', v.wagons.length === 2 && !v.wagons.some(w => w.type === second));
check('remboursement 50 %', Math.round(myWallet().money - money) === Math.floor(TRAIN_WAGON_COST * 0.5));
$('info')._html = null; renderInfo();
check('panneau mis à jour', document.querySelectorAll('#info [data-sell-wagon]').length === 2);
return { ok: errs.length === 0, errs, wagons: v.wagons.map(w => w.type) };
