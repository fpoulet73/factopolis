// Noms uniques des arrêts, gares, aéroports et ports selon l'emplacement (village / région,
// lieu proche, bord de l'eau, direction), et détail des voyageurs d'un bus par joueur.
T_.flatWorld(false);
const errs = [];
const check = (label, cond, info) => { if(!cond) errs.push(label + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
for(const t of T_.line(80, 99, 140, 99)) road[t.y*N+t.x] = 1;
markGroundDirty();
for(let x = 82; x < 92; x++){ const h = T_.build('house', x, 98); if(h){ h.pop = 5; h.starterHome = false; } }
const town = towns[0];
check('un village existe', !!town);
const s1 = T_.build('bus_stop', 90, 100), s2 = T_.build('bus_stop', 95, 100), s3 = T_.build('bus_stop', 100, 100);
const std = T_.build('stadium', 112, 101);
const s4 = T_.build('bus_stop', 110, 100);
const names = [s1, s2, s3, s4].map(b => b?.name);
check('arrêts nommés', names.every(n => typeof n === 'string' && n.startsWith('Arrêt ')), names);
check('noms uniques', new Set(names).size === names.length, names);
check('lieu proche dans le nom', /Stade de foot/.test(s4.name), s4.name);
check('village dans le nom', names.slice(0, 3).every(n => n.includes(town.name.replace(/^Le /, '')) || n.includes(town.name)), [names, town.name]);
// port (au bord de l'eau) et aéroport
T_.water(120, 100, 130, 110);
const port = T_.build('boat_depot', 119, 104);
if(port) check('port nommé', /^Port /.test(port.name || ''), port.name);
const at = T_.build('air_terminal', 100, 120);
if(at) check('aéroport nommé', /^Aéroport /.test(at.name || ''), at.name);
// gares : uniques aussi
for(const t of T_.line(60, 130, 90, 130)) rail[t.y*N+t.x] = rail[t.y*N+t.x] || 0;
tryStations: {
  T_.rail(T_.line(60, 130, 100, 130));
  const g1 = T_.build('train_station', 70, 129), g2 = T_.build('train_station', 90, 129);
  if(g1 && g2){
    check('gares nommées', /^Gare /.test(g1.name) && /^Gare /.test(g2.name), [g1.name, g2.name]);
    check('gares uniques', g1.name !== g2.name, [g1.name, g2.name]);
  }
}
// un nom saisi par le joueur est conservé à la sauvegarde
s1.name = 'Mon arrêt';
applySnapshot(JSON.parse(JSON.stringify(serializeState())));
check('nom conservé', bgrid[100*N+90]?.name === 'Mon arrêt', bgrid[100*N+90]?.name);
// détail des voyageurs d'un bus : une ligne par joueur
const garage = T_.build('garage', 84, 101);
const v = createPersistentVehicle('bus', garage);
v.cargo = 7; v.cargoOwners = { 1: 4, 2: 3 };
let lines = busCargoLines(v);
check('détail bus : 2 joueurs', lines.length === 2 && lines[0].owner === 1 && lines[0].n === 4 && lines[1].owner === 2, lines);
v.cargoOwners = { 1: 4 }; // incohérent avec cargo → repli sur le propriétaire du dépôt
lines = busCargoLines(v);
check('détail bus : repli', lines.length === 1 && lines[0].n === 7, lines);
v.cargo = 0; check('bus vide : aucune ligne', busCargoLines(v).length === 0);
// panneau du bus : « Voyageurs », un clic (pointerdown) déplie une ligne par joueur
v.cargo = 5; v.cargoOwners = { 1: 3, 2: 2 }; v.state = 'to_dest';
selectedVehicle = v; selected = null; $('info')._html = null; renderInfo();
const row = $('info').querySelector('[data-bus-cargo]');
check('ligne Voyageurs', !!row && /Voyageurs/.test(row.textContent) && !/Cargaison/.test($('info').textContent), row && row.textContent);
row?.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, cancelable:true }));
check('détail déplié', $('info').querySelectorAll('.row[style*="padding-left"]').length === 2, $('info').innerHTML.length);
selectedVehicle = null;

// piétons : contournent les bâtiments (jamais de trace à l'intérieur d'un bâtiment tiers)
T_.flatWorld(false);
const wallBlds = [];
for(let y = 40; y < 56; y += 2) wallBlds.push(T_.build('house', 60, y));
const wA = { x:(50 + 0.5)*TILE, y:(48 + 0.5)*TILE }, wB = { x:(70 + 0.5)*TILE, y:(48 + 0.5)*TILE };
const direct = (() => { for(let k = 0; k <= 200; k++){ const x = wA.x + (wB.x - wA.x)*k/200, y = wA.y; if(bgrid[Math.floor(y/TILE)*N + Math.floor(x/TILE)]) return false; } return true; })();
check('mur de maisons sur le trajet direct', !direct);
const wp = walkPath(wA, wB);
check('chemin contourne (plusieurs points)', wp.length > 2, wp.length);
let inside = 0;
for(let i = 0; i < wp.length - 1; i++){
  const p = wp[i], q = wp[i+1], steps = Math.ceil(Math.hypot(q.x-p.x, q.y-p.y)/(TILE*0.1));
  for(let k = 0; k <= steps; k++){ const x = p.x + (q.x-p.x)*k/steps, y = p.y + (q.y-p.y)*k/steps; if(bgrid[Math.floor(y/TILE)*N + Math.floor(x/TILE)]) inside++; }
}
check('aucune traversée de bâtiment', inside === 0, inside);
check('départ/arrivée conservés', wp[0].x === wA.x && wp[wp.length-1].x === wB.x);
const clear = walkPath({ x:10*TILE, y:10*TILE }, { x:20*TILE, y:12*TILE });
check('trajet libre = ligne droite', clear.length === 2, clear.length);

return { ok: errs.length === 0, errs, names, port: port?.name, at: at?.name };
