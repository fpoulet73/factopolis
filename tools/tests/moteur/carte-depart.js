// Zone de départ garantie sur des cartes générées : un emplacement de pêcheur
// constructible, du fer, du charbon et des arbres à portée du site de départ.
const fails = [];
for(let m = 0; m < 6; m++){
  genWorld({ size: 128 });
  const s = starterSite;
  if(!s){ fails.push(m + ': pas de site'); continue; }
  const near = (pred, r) => {
    for(let y = s.y - r; y <= s.y + r; y++) for(let x = s.x - r; x <= s.x + r; x++)
      if(inMap(x, y) && mapMask[y*N+x] && pred(x, y)) return true;
    return false;
  };
  const checks = {
    pecheur: near((x, y) => canPlace('fisher', x, y).ok, 6),
    fer: near((x, y) => terrain[y*N+x] === T.IRON, 11),
    charbon: near((x, y) => terrain[y*N+x] === T.COAL, 11),
    arbres: near((x, y) => terrain[y*N+x] === T.TREE, 8),
    maison: near((x, y) => canPlace('house', x, y).ok, 1),
  };
  for(const k in checks) if(!checks[k]) fails.push(m + ': ' + k);
}
return { ok: fails.length === 0, fails };
