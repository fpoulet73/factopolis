// ---------- biomes ----------
// La carte est découpée en grandes régions climatiques déduites de deux champs de bruit
// (température, humidité) échantillonnés dans le repère ABSOLU du monde (WORLD.seed,
// noiseOx/noiseOy) : rien à sauvegarder ni à synchroniser, l'hôte et les invités
// recalculent la même carte, et les tuiles ajoutées par growMap prolongent les biomes
// sans couture.
//
// Le biome oriente la génération (lacs, montagnes, forêts, gisements, dunes, tourbières)
// et le rendu (teinte du sol, détails, essences d'arbres, mini-carte, noms de régions).
// Les mondes créés avant les biomes (WORLD.biomes absent) restent en prairie partout :
// génération et rendu identiques à l'ancien comportement.

const BIOME = { PRAIRIE:0, FORET:1, DESERT:2, TOUNDRA:3, MARAIS:4, SAVANE:5, CANYON:6 };

// t/h : centre du biome dans l'espace (température, humidité) ∈ [0,1]² ; r : rayon relatif
// (plus grand = biome plus fréquent).
// gen.eau : biais du score d'eau (+ = plus sec), gen.relief : biais du score de montagne,
// gen.arbres : biais du score d'arbre (où vont les arbres), gen.densite : multiplicateur
// de la quantité d'arbres, gen.depart : pénalité du site de départ.
// res : probabilité (0..1) qu'une tache de chaque ressource se forme dans ce biome.
// sol : teintes de sol [sombre, clair] (null = herbe du pack graphique).
const BIOMES = [
  { key:'prairie', n:'Prairie',  ic:'🌿', t:0.50, h:0.52, r:1.45,
    gen:{ eau:0,     relief:-0.04, arbres:0,     densite:0.8,  depart:0 },
    res:{ wheat:1,    cotton:0.4,  iron:0.6, coal:0.5, copper:0.3, limestone:0.5, oil:0.1, gold:0.05 },
    sol:null, mini:[92, 156, 72], arbre:'mixed', miniArbre:[44, 106, 46],
    noms:['Plaine', 'Prairie', 'Val'], atout:'blé, fer et charbon' },
  { key:'foret',   n:'Forêt',    ic:'🌲', t:0.34, h:0.76, r:1.00,
    gen:{ eau:-0.02, relief:0.04,  arbres:0.55,  densite:3.0,  depart:2 },
    res:{ wheat:0.15, cotton:0.1,  iron:0.5, coal:1,   copper:0.3, limestone:0.3, oil:0.1, gold:0.1 },
    sol:['#2c5f2e', '#467d3c'], mini:[52, 106, 50], arbre:'conifer', miniArbre:[28, 82, 40],
    noms:['Forêt', 'Bois', 'Sylve'], atout:'bois en abondance et charbon' },
  { key:'desert',  n:'Désert',   ic:'🏜️', t:0.86, h:0.16, r:1.00,
    gen:{ eau:0.16,  relief:-0.12, arbres:-0.5,  densite:0.12, depart:16 },
    res:{ wheat:0.03, cotton:0.15, iron:0.3, coal:0.2, copper:0.5, limestone:0.4, oil:1,   gold:0.6 },
    sol:['#cfab6c', '#ead199'], mini:[222, 196, 138], arbre:'cactus', miniArbre:[96, 140, 70],
    noms:['Désert', 'Erg', 'Dunes'], atout:'pétrole, or et sable' },
  { key:'toundra', n:'Toundra',  ic:'❄️', t:0.08, h:0.50, r:1.00,
    gen:{ eau:-0.03, relief:0.10,  arbres:-0.05, densite:0.6,  depart:12 },
    res:{ wheat:0.05, cotton:0,    iron:1,   coal:0.6, copper:0.7, limestone:0.3, oil:0.4, gold:0.4 },
    sol:['#a3b6ab', '#dbe6e1'], mini:[200, 214, 208], arbre:'snowpine', miniArbre:[64, 102, 92],
    noms:['Toundra', 'Terres blanches', 'Plateau gelé'], atout:'fer et cuivre' },
  { key:'marais',  n:'Marais',   ic:'🐸', t:0.74, h:0.90, r:0.90,
    gen:{ eau:-0.12, relief:-0.18, arbres:0.35,  densite:1.8,  depart:6 },
    res:{ wheat:0.2,  cotton:0.8,  iron:0.2, coal:0.6, copper:0.1, limestone:0.2, oil:0.6, gold:0.1 },
    sol:['#4b6a38', '#6b8a48'], mini:[86, 116, 64], arbre:'jungle', miniArbre:[34, 84, 44],
    noms:['Marais', 'Marécages', 'Tourbières'], atout:'argile, coton et pêche' },
  { key:'savane',  n:'Savane',   ic:'🦒', t:0.78, h:0.48, r:1.00,
    gen:{ eau:0.07,  relief:-0.06, arbres:-0.25, densite:0.35, depart:2 },
    res:{ wheat:0.8,  cotton:1,    iron:0.4, coal:0.3, copper:0.6, limestone:0.5, oil:0.3, gold:0.2 },
    sol:['#a59e4c', '#cbbf6c'], mini:[186, 176, 92], arbre:'acacia', miniArbre:[104, 124, 52],
    noms:['Savane', 'Brousse', 'Steppe'], atout:'coton, blé et cuivre' },
  { key:'canyon',  n:'Canyon',   ic:'🏞️', t:0.44, h:0.10, r:0.90,
    gen:{ eau:0.10,  relief:0.16,  arbres:-0.45, densite:0.15, depart:12 },
    res:{ wheat:0.05, cotton:0.05, iron:0.6, coal:0.3, copper:1,   limestone:1,   oil:0.3, gold:1 },
    sol:['#ad5f3c', '#cf8c5c'], mini:[196, 120, 80], arbre:'shrub', miniArbre:[112, 100, 56],
    noms:['Canyon', 'Terres rouges', 'Mesa'], atout:'cuivre, calcaire et or' },
];
// Valeurs neutres (monde sans biomes) : génération strictement inchangée.
const BIOME_NEUTRAL = { eau:0, relief:0, arbres:0, densite:1, depart:0 };

const BIOME_CFG = {
  actif: CFG.monde?.biomes?.actif !== false,
  echelle: clampNum(CFG.monde?.biomes?.echelle, 0.4, 3, 1),
};

const biomesActive = () => !!(WORLD && WORLD.biomes);

// Grilles par tuile : biome principal, biome voisin (frontière), mélange 0..8 (/16 → 0..0.5)
// et « cœur » (marge climatique, sert à placer les noms au centre des régions).
let biomeGrid = null, biomeAlt = null, biomeBlend = null, biomeCore = null;
let biomeArea = null; // fraction de la grille occupée par chaque biome
let biomeGridVersion = 0;
let _bgN = -1, _bgSeed = NaN, _bgOx = NaN, _bgOy = NaN, _bgOn = null;

function ensureBiomeGrid(){
  const on = biomesActive();
  const seed = WORLD?.seed, ox = WORLD?.noiseOx || 0, oy = WORLD?.noiseOy || 0;
  if(biomeGrid && _bgN === N && _bgSeed === seed && _bgOx === ox && _bgOy === oy && _bgOn === on) return;
  _bgN = N; _bgSeed = seed; _bgOx = ox; _bgOy = oy; _bgOn = on;
  biomeGridVersion++;
  biomeGrid = new Uint8Array(N * N);
  biomeAlt = new Uint8Array(N * N);
  biomeBlend = new Uint8Array(N * N);
  biomeCore = new Float32Array(N * N).fill(1);
  biomeArea = BIOMES.map((_, b) => b === BIOME.PRAIRIE ? 1 : 0);
  if(!on) return;
  const s = BIOME_CFG.echelle;
  const cell = c => Math.max(2, Math.round(c * s));
  const tA = valueNoise(cell(61)), tB = valueNoise(cell(17));
  const hA = valueNoise(cell(47)), hB = valueNoise(cell(13));
  const wob = valueNoise(6);
  const stretch = v => Math.max(0, Math.min(1, 0.5 + (v - 0.5) * 1.9));
  const counts = new Array(BIOMES.length).fill(0);
  for(let y = 0; y < N; y++) for(let x = 0; x < N; x++){
    const w = (wob(x, y) - 0.5) * 0.12; // frontières ondulées
    const temp = stretch(0.72 * tA(x, y) + 0.28 * tB(x, y)) + w;
    const hum  = stretch(0.72 * hA(x, y) + 0.28 * hB(x, y)) - w;
    let b1 = 0, d1 = Infinity, b2 = 0, d2 = Infinity;
    for(let b = 0; b < BIOMES.length; b++){
      const B = BIOMES[b];
      const d = Math.hypot(temp - B.t, hum - B.h) / B.r;
      if(d < d1){ b2 = b1; d2 = d1; b1 = b; d1 = d; }
      else if(d < d2){ b2 = b; d2 = d; }
    }
    const i = y * N + x, margin = d2 - d1;
    biomeGrid[i] = b1; biomeAlt[i] = b2;
    biomeBlend[i] = Math.round(8 * Math.max(0, 1 - margin / 0.10));
    biomeCore[i] = margin;
    counts[b1]++;
  }
  biomeArea = counts.map(c => c / (N * N));
}

function biomeIdAt(x, y){
  if(!biomesActive() || x < 0 || y < 0 || x >= N || y >= N) return BIOME.PRAIRIE;
  ensureBiomeGrid();
  return biomeGrid[y * N + x];
}
const biomeAt = (x, y) => BIOMES[biomeIdAt(x, y)];

// Paramètre de génération mélangé aux frontières (transition douce entre biomes).
function biomeMix(x, y, key){
  if(!biomesActive() || x < 0 || y < 0 || x >= N || y >= N) return BIOME_NEUTRAL[key];
  ensureBiomeGrid();
  const i = y * N + x;
  const a = BIOMES[biomeGrid[i]].gen[key], bl = biomeBlend[i];
  if(!bl) return a;
  return a + (BIOMES[biomeAlt[i]].gen[key] - a) * bl / 16;
}

// Probabilité qu'une tache de ressource `key` (clé de WORLD.resources) prenne en (x,y).
function biomeResWeight(key, x, y){
  if(!biomesActive() || x < 0 || y < 0 || x >= N || y >= N) return 1;
  ensureBiomeGrid();
  const i = y * N + x;
  const a = BIOMES[biomeGrid[i]].res[key] ?? 1, bl = biomeBlend[i];
  if(!bl) return a;
  return a + ((BIOMES[biomeAlt[i]].res[key] ?? 1) - a) * bl / 16;
}

// Poids moyen d'une ressource sur toute la grille : le nombre de taches tentées est divisé
// par ce poids pour que la richesse globale de la carte reste celle de la config, tandis
// qu'une région d'un seul biome (expansion) se spécialise réellement.
function biomeResMean(key){
  if(!biomesActive()) return 1;
  ensureBiomeGrid();
  let m = 0;
  for(let b = 0; b < BIOMES.length; b++) m += biomeArea[b] * (BIOMES[b].res[key] ?? 1);
  return Math.max(0.05, m);
}

// Nombre d'arbres d'une zone : quota de base × densité moyenne des biomes des candidats.
function biomeTreeQuota(base, candidates){
  if(!biomesActive() || !candidates.length) return base;
  let s = 0;
  for(const c of candidates) s += biomeMix(c.x, c.y, 'densite');
  return Math.round(base * s / candidates.length);
}

// Essence d'arbre : celle du biome ; palmiers autour des oasis du désert.
function biomeTreeStyleAt(x, y){
  const b = biomeIdAt(x, y);
  if(b === BIOME.DESERT){
    for(let dy = -2; dy <= 2; dy++) for(let dx = -2; dx <= 2; dx++){
      const nx = x + dx, ny = y + dy;
      if(nx >= 0 && ny >= 0 && nx < N && ny < N && terrain[ny * N + nx] === T.WATER) return 'palm';
    }
  }
  return BIOMES[b].arbre;
}

// Reliefs propres aux biomes, dans la zone inScope(x,y) : dunes de sable au cœur des
// déserts, tourbières argileuses dans les marais. Ne touche que l'herbe.
function applyBiomeFeatures(inScope){
  if(!biomesActive()) return;
  ensureBiomeGrid();
  const dune = valueNoise(8), peat = valueNoise(10);
  for(let y = 0; y < N; y++) for(let x = 0; x < N; x++){
    if(inScope && !inScope(x, y)) continue;
    const i = y * N + x;
    if(terrain[i] !== T.GRASS || biomeBlend[i] > 3) continue;
    const b = biomeGrid[i];
    if(b === BIOME.DESERT && dune(x, y) > 0.68 && Math.random() < 0.7) terrain[i] = T.SAND;
    else if(b === BIOME.MARAIS && peat(x, y) > 0.82 && Math.random() < 0.75 && !tileTouchesWater(x, y)) terrain[i] = T.CLAY;
  }
}

// Nom de région déterministe (repère absolu → stable quand la grille grandit).
function biomeRegionName(b, x, y){
  const ax = x - (WORLD?.noiseOx || 0), ay = y - (WORLD?.noiseOy || 0);
  const B = BIOMES[b];
  const pre = B.noms[(((ax * 31 + ay * 17 + b * 7) % B.noms.length) + B.noms.length) % B.noms.length];
  return pre + ' ' + deNom(generateTownName(ax * 3 + b * 101, ay * 5 - b * 37));
}

// Régions nommées de la zone jouable : composantes connexes d'un même biome assez
// grandes, étiquetées au point le plus « profond » du biome (centre climatique).
let _biomeRegions = null, _biomeRegionsKey = '';
function biomeRegions(){
  if(!biomesActive()) return [];
  ensureBiomeGrid();
  const key = terrainVersion + '|' + biomeGridVersion;
  if(_biomeRegions && _biomeRegionsKey === key) return _biomeRegions;
  _biomeRegionsKey = key;
  _biomeRegions = [];
  const seen = new Uint8Array(N * N);
  const stack = [];
  for(let i0 = 0; i0 < N * N; i0++){
    if(seen[i0] || !mapMask[i0]) continue;
    const b = biomeGrid[i0];
    seen[i0] = 1; stack.length = 0; stack.push(i0);
    let count = 0, best = i0, bestCore = -1;
    while(stack.length){
      const j = stack.pop();
      count++;
      if(biomeCore[j] > bestCore){ bestCore = biomeCore[j]; best = j; }
      const jx = j % N, jy = (j / N) | 0;
      for(const [dx, dy] of DIRS){
        const nx = jx + dx, ny = jy + dy;
        if(nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const k = ny * N + nx;
        if(seen[k] || !mapMask[k] || biomeGrid[k] !== b) continue;
        seen[k] = 1; stack.push(k);
      }
    }
    if(count < 300) continue; // seules les vraies régions sont nommées
    const x = best % N, y = (best / N) | 0;
    _biomeRegions.push({ b, x, y, count, name: biomeRegionName(b, x, y) });
  }
  return _biomeRegions;
}

// Biomes présents dans un ensemble de tuiles (pred(x,y)) : [{ b, pct }] décroissant.
function biomeComposition(x0, y0, x1, y1, pred){
  const counts = new Array(BIOMES.length).fill(0);
  let total = 0;
  for(let y = Math.max(0, y0); y < Math.min(N, y1); y++) for(let x = Math.max(0, x0); x < Math.min(N, x1); x++){
    if(pred && !pred(x, y)) continue;
    counts[biomeIdAt(x, y)]++; total++;
  }
  if(!total) return [];
  return counts.map((c, b) => ({ b, pct: Math.round(100 * c / total) }))
    .filter(e => e.pct > 0).sort((a, b) => b.pct - a.pct);
}

// Biomes déjà présents dans la zone jouable (pour annoncer les découvertes).
function biomesInPlayArea(){
  const set = new Set();
  if(!biomesActive()) return set;
  ensureBiomeGrid();
  for(let i = 0; i < N * N; i++) if(mapMask[i]) set.add(biomeGrid[i]);
  return set;
}
