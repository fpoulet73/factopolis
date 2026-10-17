// Biomes : variété sur la carte, essences/forêts cohérentes, déterminisme (même graine →
// même carte, y compris après agrandissement de la grille), mondes anciens en prairie,
// et toutes les ressources présentes dans la zone jouable.
const fails = [];
const info = {};
const RES_TYPES = [T.TREE, T.WHEAT, T.COTTON, T.IRON, T.COAL, T.COPPER, T.LIMESTONE, T.OIL, T.GOLD];
let forestTrees = 0, forestTiles = 0, dryTrees = 0, dryTiles = 0;
for(let m = 0; m < 3; m++){
  genWorld({ size: 128 });
  if(!WORLD.biomes){ fails.push(m + ': WORLD.biomes inactif'); continue; }
  ensureBiomeGrid();
  const seen = new Set();
  for(let i = 0; i < N * N; i++){
    const b = biomeGrid[i];
    seen.add(b);
    if(terrain[i] === T.WATER || biomeBlend[i]) continue;
    if(b === BIOME.FORET){ forestTiles++; if(terrain[i] === T.TREE) forestTrees++; }
    if(b === BIOME.DESERT || b === BIOME.CANYON){ dryTiles++; if(terrain[i] === T.TREE) dryTrees++; }
  }
  if(seen.size < 3) fails.push(m + ': seulement ' + seen.size + ' biome(s)');
  info['carte' + m] = [...seen].map(b => BIOMES[b].key).join(',');
  // toutes les ressources dans la zone jouable
  const inPlay = new Set();
  for(let i = 0; i < N * N; i++) if(mapMask[i]) inPlay.add(terrain[i]);
  for(const t of RES_TYPES) if(!inPlay.has(t)) fails.push(m + ': ressource ' + t + ' absente de la zone jouable');
  // déterminisme : recalcul forcé → même grille
  const before = biomeGrid.slice();
  _bgN = -1; ensureBiomeGrid();
  if(before.some((b, i) => b !== biomeGrid[i])) fails.push(m + ': grille non déterministe');
  // agrandissement de la grille : les biomes suivent les tuiles décalées
  const oldN = N, probe = [];
  for(let k = 0; k < 50; k++){ const x = (Math.random() * oldN) | 0, y = (Math.random() * oldN) | 0; probe.push({ x, y, b: biomeGrid[y * oldN + x] }); }
  const grown = growMap({ left: 6, right: 0, top: 4, bottom: 0 });
  if(grown){
    ensureBiomeGrid();
    for(const p of probe) if(biomeGrid[(p.y + grown.dy) * N + p.x + grown.dx] !== p.b){ fails.push(m + ': biome décalé après growMap'); break; }
  }
  const regions = biomeRegions();
  if(regions.some(r => !r.name || r.name.length < 4)) fails.push(m + ': région sans nom');
  info['regions' + m] = regions.slice(0, 4).map(r => r.name);
}
// Les forêts sont plus boisées que les déserts/canyons (si les deux existent)
if(forestTiles > 300 && dryTiles > 300){
  const fd = forestTrees / forestTiles, dd = dryTrees / dryTiles;
  info.densiteArbres = { foret: +fd.toFixed(3), sec: +dd.toFixed(3) };
  if(fd <= dd * 2) fails.push('forêt pas plus boisée que le désert (' + fd.toFixed(3) + ' vs ' + dd.toFixed(3) + ')');
}
// Chaque essence d'arbre se dessine sans erreur
const cv2 = document.createElement('canvas'); cv2.width = 64; cv2.height = 64;
const saved = ctx; ctx = cv2.getContext('2d');
try {
  for(const style of ['mixed', 'conifer', 'snowpine', 'jungle', 'acacia', 'cactus', 'palm', 'shrub'])
    for(let k = 0; k < 8; k++) drawTree(0, 0, k * 3, k * 5, style);
} catch(e){ fails.push('drawTree : ' + e.message); }
finally { ctx = saved; }
// Monde ancien (sans biomes) : prairie partout
const prev = WORLD.biomes;
WORLD.biomes = false;
if(biomeIdAt(10, 10) !== BIOME.PRAIRIE || biomeMix(10, 10, 'eau') !== 0 || biomeResWeight('oil', 10, 10) !== 1)
  fails.push('monde sans biomes : valeurs non neutres');
WORLD.biomes = prev;
if(normalizeWorldConfig({}).biomes !== false) fails.push('normalizeWorldConfig : biomes actif par défaut sur un monde ancien');
return { ok: fails.length === 0, fails, info };
