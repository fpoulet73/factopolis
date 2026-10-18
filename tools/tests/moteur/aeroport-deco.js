// Décor d'aéroport : style tiré au hasard à la pose, conservé à la sauvegarde, dessiné sans erreur.
T_.flatWorld();
const errs = [], seen = new Set();
for(let i = 0; i < 40; i++){
  const b = T_.build('air_deco', 90 + (i % 20), 90 + Math.floor(i / 20) * 2);
  if(!b){ errs.push('pose ' + i); continue; }
  if(!Number.isInteger(b.decor) || b.decor < 0 || b.decor >= AIR_DECO_STYLES) errs.push('decor invalide ' + b.decor);
  seen.add(b.decor);
}
if(seen.size < 3) errs.push('peu de variété : ' + [...seen]);
const before = buildings.filter(b => b.type === 'air_deco').map(b => b.x + ',' + b.y + ':' + b.decor).sort().join('|');
for(let s = 0; s < AIR_DECO_STYLES; s++){
  const b = buildings.find(o => o.type === 'air_deco'); const old = b.decor; b.decor = s;
  try { for(let k = 0; k < 4; k++){ rotate(1); drawBuildingBody(b); } } catch(e){ errs.push('rendu style ' + s + ' : ' + e.message); }
  b.decor = old;
}
applySnapshot(JSON.parse(JSON.stringify(serializeState())));
const after = buildings.filter(b => b.type === 'air_deco').map(b => b.x + ',' + b.y + ':' + b.decor).sort().join('|');
if(before !== after) errs.push('décor perdu au rechargement');
try { drawFn(); drawFn(); } catch(e){ errs.push('drawFn : ' + e.message); }
return { ok: errs.length === 0, errs, styles: [...seen].sort() };
