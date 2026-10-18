// Dépassement routier : un véhicule plus rapide double par la gauche un véhicule
// plus lent quand la voie d'en face est libre, se rabat devant lui, et reste derrière
// s'il y a du trafic en sens inverse ou si les deux roulent à la même vitesse.
T_.flatWorld(false);
const errs = [];
const check = (label, cond, info) => { if(!cond) errs.push(label + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
for(const t of T_.line(40, 100, 160, 100)) road[t.y*N+t.x] = 1;
markGroundDirty();
const P = x => ({ x:x*TILE + TILE/2, y:100*TILE + TILE/2 });
const path = (x0, x1) => { const out = [], s = Math.sign(x1 - x0); for(let x = x0; x !== x1 + s; x += s) out.push(P(x)); return out; };
const unit = (vtype, x0, x1) => ({ vtype, state:'moving', pts:path(x0, x1), seg:0, t:0 });
// Positions le long de l'axe x (même sens pour tous les véhicules testés).
const pos = u => u.pts[Math.min(u.seg, u.pts.length-1)].x + (u.seg < u.pts.length-1 ? (u.pts[u.seg+1].x - u.pts[u.seg].x) * u.t : 0);

function scenario(units, sec){
  trucks.length = 0; trucks.push(...units);
  const log = { overtook:false, minGap:Infinity };
  const dt = 0.05;
  for(let t = 0; t < sec; t += dt){
    roadTick++;
    for(const u of units) if(roadUnitMoving(u)) advanceRoadUnit(u, roadUnitSpeed(u) * TILE * dt);
    if(units[0].overtaking) log.overtook = true;
    // même voie, même sens : jamais l'un dans l'autre
    const [a, b] = units;
    if(!!a.overtaking === !!b.overtaking && roadUnitMoving(a) && roadUnitMoving(b)) log.minGap = Math.min(log.minGap, Math.abs(pos(a) - pos(b)) / TILE);
  }
  trucks.length = 0;
  return log;
}

// 1) camion rapide (4 cases/s) derrière un bus (3 cases/s), voie d'en face libre
check('vitesses de test', roadUnitSpeed({ vtype:'minerai' }) > roadUnitSpeed({ vtype:'bus' }));
let fast = unit('minerai', 45, 150), slow = unit('bus', 47, 150);
let r = scenario([fast, slow], 8);
check('dépasse le bus', r.overtook);
check('finit devant le bus', pos(fast) > pos(slow) + TILE * 0.3, [pos(fast) / TILE, pos(slow) / TILE]);
check('rabattu après le dépassement', !fast.overtaking);
check('pas de chevauchement sur une même voie', r.minGap > 0.3, r.minGap);

// 2) trafic continu en sens inverse : il reste derrière
fast = unit('minerai', 45, 150); slow = unit('bus', 47, 150);
const oncoming = [];
for(let x = 60; x <= 158; x += 3) oncoming.push(unit('bus', x, 40));
r = scenario([fast, slow, ...oncoming], 6);
check('pas de dépassement face au trafic', !r.overtook);
check('reste derrière le bus', pos(fast) < pos(slow), [pos(fast) / TILE, pos(slow) / TILE]);

// 3) même vitesse : pas de dépassement
fast = unit('bus', 45, 150); slow = unit('bus', 47, 150);
r = scenario([fast, slow], 6);
check('pas de dépassement à vitesse égale', !r.overtook);

return { ok: errs.length === 0, errs };
