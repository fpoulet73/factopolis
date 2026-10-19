// Les voyageurs d'un bus descendent à leur destination (passagers sortants de l'arrêt) et ne
// sont pas rembarqués aussitôt pour le trajet retour, même si l'arrêt d'origine a de la demande.
T_.flatWorld(false);
const errs = [];
const check = (label, cond, info) => { if(!cond) errs.push(label + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
for(const t of T_.line(80, 99, 130, 99)) road[t.y*N+t.x] = 1;
markGroundDirty();
for(let x = 82; x < 92; x++){ const h = T_.build('house', x, 98); if(h){ h.pop = 2; h.starterHome = false; h.protectedPop = 0; } } // demande à l'origine (des habitants : sinon la cohérence retire les voyageurs)
const garage = T_.build('garage', 84, 101);
const A = T_.build('bus_stop', 90, 100);
const B = T_.build('bus_stop', 110, 100);
check('demande à l’origine', stopHasDemand(A, null) === true);
const v = createPersistentVehicle('bus', garage);
v.source = A; v.dest = B;
check('route démarrée', startVehicleRoute(v) === true);
let arrivals = 0, bad = null;
let prev = v.state;
for(let k = 0; k < 4000 && arrivals < 3; k++){
  if(v.state === 'to_dest' && v.cargo === 0){ setBusLoad(v, 12, A); A.passagersSortant = 0; B.passagersSortant = 0; } // pas de reliquat d'un trajet précédent
  const before = v.state, cargoBefore = v.cargo, sortB = B.passagersSortant || 0;
  update(0.05);
  if(before === 'to_dest' && v.state === 'to_source' && cargoBefore > 0){
    arrivals++;
    if(!(v.cargo < cargoBefore && (B.passagersSortant || 0) >= sortB + cargoBefore - 0.001)) bad = { cargo: v.cargo, sortB, now: B.passagersSortant, cargoBefore };
  }
}
check('3 arrivées observées', arrivals === 3, arrivals);
check('descendus et non rembarqués', !bad, bad);
return { ok: errs.length === 0, errs };
