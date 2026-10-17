// Outil Canal : creuse la tuile de 3 niveaux et la met en eau, à niveau avec les berges.
T_.flatWorld();
myWallet().money = 1e6;
const x = 120, y = 120, i = y * N + x;
for(let dy = -2; dy <= 2; dy++) for(let dx = -2; dx <= 2; dx++) terrainHeightMap[(y + dy) * N + x + dx] = 4;
rebuildWaterLevels();
const money0 = myWallet().money;
const okBefore = canPlace('terraform_canal', x, y).ok;
setTool('terraform_canal'); clickAt(x, y);
const wet = terrain[i] === T.WATER;
const lvl = terrainHeightMap[i];
const water = waterLevelAt(x, y);
const spent = money0 - myWallet().money;
const again = canPlace('terraform_canal', x, y).ok; // déjà en eau : refusé
// un canal voisin se raccorde à la même nappe
clickAt(x + 1, y);
const joined = terrain[y * N + x + 1] === T.WATER;
return { ok: okBefore && wet && lvl === 1 && water === 3 && spent === BUILD.terraform_canal.cost && !again && joined, okBefore, wet, lvl, water, spent, again, joined };
