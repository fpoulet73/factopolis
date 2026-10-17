// Défilement incrémental du buffer-sol : le contenu glissé + bandes redessinées doit être
// identique (à l'anti-crénelage près) à une reconstruction complète à la même position, et
// beaucoup moins coûteux. Monde de relief avec routes, rails, eau, biomes.
genWorld({ size: 128, seed: 777 });
paused = true;
for(let x = 40; x < 110; x++){ road[70*N+x] = 1; road[(40+x%30)*N+60] = 1; }
markGroundDirty();
cam.z = 1; syncTargetCam(); centerOn(N/2*TILE, N/2*TILE);
draw();
const snap = () => { const c = groundCacheCtx.getImageData(0, 0, groundCache.width, groundCache.height); return c.data; };
const fails = [];
const results = [];
// Phase 1 — coût (sans lecture de pixels, qui fait basculer le canvas en rendu logiciel)
let sumScroll = 0, sumFull = 0, nTime = 0;
for(let k = 0; k < 6; k++){
  const dir = k % 2 ? -1 : 1;
  markGroundDirty(); centerOn(N/2*TILE, N/2*TILE); draw();
  cam.x += 300 * dir; cam.y += 60 * dir; syncTargetCam();
  let t = performance.now(); draw(); const ts = performance.now() - t;
  markGroundDirty(); t = performance.now(); draw(); const tf = performance.now() - t;
  if(k > 0){ sumScroll += ts; sumFull += tf; nTime++; }
}
const timing = { scrollMs: +(sumScroll / nTime).toFixed(1), fullMs: +(sumFull / nTime).toFixed(1) };
if(timing.scrollMs > timing.fullMs * 0.7) fails.push('défilement pas plus rapide que la reconstruction ' + JSON.stringify(timing));
for(const [mx, my] of [[300, 0], [-300, 40], [20, 280], [260, -250], [-280, -270]]){
  markGroundDirty(); centerOn(N/2*TILE, N/2*TILE); draw();
  const key0 = _bufContentKey, tex0 = groundTexVersion;
  cam.x += mx; cam.y += my; syncTargetCam();
  const t0 = performance.now(); draw(); const tScroll = performance.now() - t0;
  const scrolled = groundTexVersion > tex0;
  const A = snap();
  // référence : reconstruction complète à la MÊME origine de cuisson
  const cx = cacheCamX, cy = cacheCamY;
  const camSave = { x: cam.x, y: cam.y };
  cam.x = cx; cam.y = cy; syncTargetCam(); markGroundDirty();
  const t1 = performance.now(); draw(); const tFull = performance.now() - t1;
  const B = snap();
  let diff = 0, total = A.length / 4;
  for(let i = 0; i < A.length; i += 4){
    if(Math.abs(A[i]-B[i]) > 24 || Math.abs(A[i+1]-B[i+1]) > 24 || Math.abs(A[i+2]-B[i+2]) > 24 || Math.abs(A[i+3]-B[i+3]) > 24) diff++;
  }
  const frac = diff / total;
  results.push({ mx, my, scrolled, diffPct: +(frac * 100).toFixed(3), scrollMs: Math.round(tScroll), fullMs: Math.round(tFull) });
  if(!scrolled) fails.push('pas de défilement pour ' + mx + ',' + my);
  if(frac > 0.002) fails.push('écart ' + (frac*100).toFixed(2) + ' % pour ' + mx + ',' + my);
}
return { ok: fails.length === 0, fails, timing, results };
