// Deux gares d'aéroport fusionnées : un seul badge (🛄), sur la gare principale.
T_.flatWorld();
const errs = [];
const t1 = T_.build('air_terminal', 100, 100), t2 = T_.build('air_terminal', 101, 100);
const rep = airportRepresentative(t1);
const other = rep === t1 ? t2 : t1;
let signs = 0;
const orig = window.artSign;
window.artSign = (...a) => { signs++; return orig(...a); };
const draw = b => { const n = signs; drawBuildingBody(b); return signs - n; };
const nRep = draw(rep), nOther = draw(other);
window.artSign = orig;
if(nRep !== 1) errs.push('badge absent sur la gare principale : ' + nRep);
if(nOther !== 0) errs.push('badge en double sur la 2e gare : ' + nOther);
try { drawFn(); drawFn(); } catch(e){ errs.push('rendu : ' + e.message); }
return { ok: errs.length === 0, errs };
