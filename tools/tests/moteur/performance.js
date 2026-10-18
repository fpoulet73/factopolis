// Grosse ville (~3700 bâtiments) : coût de la simulation par pas d'affichage.
T_.flatWorld();
const x0 = 70, y0 = 70, size = 80, ind = ['smelter','factory','mill','bakery','weaver','fishery'];
for(let y = y0; y < y0+size; y++) for(let x = x0; x < x0+size; x++)
  if((x-x0) % 5 === 0 || (y-y0) % 5 === 0) road[y*N+x] = 1;
markGroundDirty();
for(let y = y0; y < y0+size; y++) for(let x = x0; x < x0+size; x++){
  if((x-x0) % 5 === 0 || (y-y0) % 5 === 0) continue;
  const r = (x*7 + y*13) % 10;
  if(r < 6){ const b = T_.build('house', x, y); if(b) b.pop = 5; }
  else if(r < 8){ const b = T_.build('plant', x, y); if(b) applyPlantUpgrade(b, ind[(x+y) % ind.length]); }
  else if(r < 9) T_.build('depot', x, y);
}
T_.run(2, 0.05);
const t0 = performance.now();
for(let k = 0; k < 120; k++) update(1/60);
const perStep = (performance.now() - t0) / 120;
const t1 = performance.now(); refreshWorkerAllocation(); const alloc = performance.now() - t1;
// rendu : premier affichage dézoomé (toute la ville visible). Les bâtiments
// identiques partagent leur texture cuite : quelques dizaines de textures, pas 3700.
cam.z = 0.4; centerOn(110 * TILE, 110 * TILE);
const t2 = performance.now(); drawFn(); const firstDraw = performance.now() - t2;
const st = PixiSprites.stats();
// sauvegarde auto : une seule clé écrite, état compacté
const t3 = performance.now(); packStateForStorage(serializeState()); const autosave = performance.now() - t3;
return { ok: perStep < 8 && alloc < 40 && st.sharedBodies < 400 && firstDraw < 4000 && autosave < 150,
  buildings: buildings.length, perStepMs: +perStep.toFixed(2), allocMs: +alloc.toFixed(1),
  firstDrawMs: Math.round(firstDraw), textures: st.sharedBodies, nodes: st.buildingNodes, autosaveMs: Math.round(autosave) };
