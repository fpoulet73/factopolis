// Maisons de luxe : verrouillées sous 100 habitants (déblocage définitif), prix
// ×5, agrandissement (1 → 2 → 4 → 9 cases) uniquement en absorbant des maisons de
// luxe voisines posées par le joueur (jamais sur des cases vides), sans changer le
// nombre d'habitants, classe ouvriers → employés → cadres → patrons ; bloquées
// sans voisines ; jamais fusionnées avec des maisons basiques.
T_.flatWorld();
for(const t of T_.line(88, 100, 122, 100)) road[t.y*N+t.x] = 1;
markGroundDirty();
const errs = [];
const check = (label, cond) => { if(!cond) errs.push(label); };
const tryDo = (label, fn) => { try { fn(); } catch(e){ errs.push(label + ': ' + e.message); } };
// Remplit une maison de luxe et livre ses outils d'agrandissement.
const ready = b => {
  b.pop = BUILD[b.type].resid.popCap; b.starterHome = false; b.protectedPop = 0;
  for(const r of residRequiredOf(b)) b.storage[r] = 5;
  for(const r of residUpgradeResourcesOf(b)) b.upgradeProgress[r] = residUpgradeTargetOf(b, r);
};

check('verrouillée sous le seuil', !canPlace('lux_house', 100, 101).ok);
check('prix ×5', BUILD.lux_house.cost === BUILD.house.cost * 5);
check('niveaux agrandis non posables', !canPlace('lux_villa', 100, 101).ok);

// 100 habitants dans des maisons basiques → déblocage
const basics = [];
for(let x = 88; x < 108; x++){ const h = T_.build('house', x, 99); if(h){ h.pop = 5; h.starterHome = false; h.protectedPop = 0; basics.push(h); } }
T_.run(1.1, 0.1);
check('débloquée à 100 habitants', luxuryUnlocked() && myWallet().luxeUnlocked);
for(const h of basics) h.pop = 0;
check('déblocage définitif', luxuryUnlocked() && canPlace('lux_house', 100, 101).ok);

// 1 → 2 → 4 → 9 cases sur place, mêmes habitants, classe qui monte
const money0 = myWallet().money;
const lh = T_.build('lux_house', 100, 101);
check('pose', lh && lh.type === 'lux_house' && myWallet().money === money0 - BUILD.lux_house.cost);
const steps = [];
if(lh){
  check('classe initiale ouvriers', residClassOf(lh) === 'ouvrier');
  // seule, même avec de la place libre autour : aucun agrandissement
  ready(lh); T_.run(1.1, 0.1);
  check('aucun agrandissement seule', lh.type === 'lux_house' && lh.w * lh.h === 1);
  // cases à remplir par des maisons de luxe voisines, niveau par niveau
  const fill = {
    lux_villa:  [[101, 101]],
    lux_manor:  [[100, 102], [101, 102]],
    lux_estate: [[102, 101], [102, 102], [100, 103], [101, 103], [102, 103]],
  };
  for(const want of ['lux_villa', 'lux_manor', 'lux_estate']){
    for(const [fx, fy] of fill[want]) check('pose voisine ' + fx + ',' + fy, !!T_.build('lux_house', fx, fy));
    ready(lh);
    T_.run(1.1, 0.1);
    steps.push(lh.type + ' ' + lh.w + 'x' + lh.h + ' ' + residClassOf(lh) + ' pop ' + lh.pop);
    check('agrandi en ' + want, lh.type === want && !lh.dead && buildings.includes(lh));
  }
  check('9 cases', lh.w * lh.h === 9);
  check('habitants doublés à chaque agrandissement (capacité 40)', BUILD[lh.type].resid.popCap === 40 && lh.pop <= 40);
  check('patrons', residClassOf(lh) === 'patron');
  let cover = true;
  for(let y = lh.y; y < lh.y + lh.h; y++) for(let x = lh.x; x < lh.x + lh.w; x++)
    if(bgrid[y*N+x] !== lh || road[y*N+x]) cover = false;
  check('emprise entièrement absorbée', cover);
  check('voisines absorbées', !buildings.some(o => !o.dead && o !== lh && o.type === 'lux_house' && o.x >= lh.x && o.x < lh.x + lh.w && o.y >= lh.y && o.y < lh.y + lh.h));
  check('toujours relié à la route', adjRoadTiles(lh).length > 0);
  ready(lh); T_.run(1.1, 0.1);
  check('taille maximale', lh.type === 'lux_estate' && lh.w * lh.h === 9);
}

// sans voisine à absorber : pas d'agrandissement, statut explicite
const blocked = T_.build('lux_house', 112, 101);
if(blocked){
  ready(blocked);
  T_.run(1.1, 0.1);
  check('bloquée sans place', blocked.type === 'lux_house' && blocked.w * blocked.h === 1);
  check('statut bloqué', /bloqué/.test(statusOf(blocked)));
} else check('pose bloquée', false);

// deux maisons de luxe voisines prêtes : l'une absorbe l'autre en villa
const a = T_.build('lux_house', 117, 101), b2 = T_.build('lux_house', 118, 101);
if(a && b2){
  ready(a); ready(b2);
  T_.run(2.2, 0.1);
  check('une villa issue de deux maisons', [a, b2].filter(o => !o.dead).length === 1 && [a, b2].some(o => !o.dead && o.type === 'lux_villa'));
} else check('pose voisines', false);
check('aucune fusion basique avec le luxe', !buildings.some(o => !o.dead && BUILD[o.type].resid && !BUILD[o.type].lux && o.type !== 'house'));

// économie : patrons/employés relèvent la taxe moyenne
check('taxe par classe', popTaxMultiplier(null) > 1);

// panneaux et rendu des 4 niveaux
const lux = buildings.filter(o => !o.dead && BUILD[o.type].lux);
for(const o of lux){
  tryDo('info ' + o.type, () => { selected = o; selectedVehicle = null; $('info')._html = null; renderInfo(); });
  tryDo('art ' + o.type, () => { for(let k = 0; k < 4; k++){ rotate(1); drawBuildingBody(o); } });
}
tryDo('village', () => { const t = getTownOf(lh); if(t){ openTownPanel(t.id); closeTownPanel(); } });
tryDo('menu', () => {
  syncLuxeToolbar();
  const item = document.querySelector('[data-building-tool="lux_house"]');
  if(!item || item.style.display === 'none') throw new Error('entrée luxe absente du menu Bâtiments');
});
tryDo('sauvegarde', () => applySnapshot(JSON.parse(JSON.stringify(serializeState()))));
check('rechargé', buildings.some(o => o.type === 'lux_estate' && o.w === 3 && o.h === 3 && o.pop > 0));
tryDo('rendu', () => { drawFn(); drawFn(); });
return { ok: errs.length === 0, errs, steps };
