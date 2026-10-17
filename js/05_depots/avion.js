// ---------- dépôts : aéroport (avions) ----------
// L'aéroport se compose de pièces posées sur des cases adjacentes (fusion automatique) :
//   - Gare (air_terminal) : point d'embarquement / d'arrivée des voyageurs ;
//   - Piste (air_runway)  : au moins 4 cases alignées pour que l'aéroport fonctionne ;
//   - Tour de contrôle (air_tower) : indispensable pour que l'aéroport fonctionne ;
//   - Déco (air_deco)     : décor.
// Il est fonctionnel avec au moins une gare, une tour de contrôle et AIR_RUNWAY_MIN cases de piste alignées.
// Le dépôt d'aéroport (plane_depot) ne sert plus qu'à acheter les avions et à créer les
// lignes entre gares d\'aéroport : il n'accueille plus de voyageurs.

const AIR_RUNWAY_MIN = CFG.logistique?.avion?.pisteMin ?? 4;
const AIR_DECO_STYLES = 6; // nombre de styles de décor dessinés (07_rendering_art.js)
const AIR_TYPES = ['air_terminal', 'air_runway', 'air_taxi', 'air_parking', 'air_tower', 'air_deco'];

BUILD.air_terminal = BUILD.air_terminal || {
  n: 'Gare aéroport', ic: '🛄', hk: '',
  cost: CFG.logistique?.avion?.gare?.cout ?? 400, col: '#9fb0c2', hgt: 14,
  desc: 'Gare d\'aéroport : les voyageurs sans emploi du rayon y embarquent. Posée contre d\'autres pièces, '
    + 'elle fusionne avec l\'aéroport. Il faut au moins une gare, une tour de contrôle et ' + AIR_RUNWAY_MIN + ' cases de piste alignées.',
};
BUILD.air_runway = BUILD.air_runway || {
  n: 'Piste', ic: '🛫', hk: '',
  cost: CFG.logistique?.avion?.piste?.cout ?? 80, col: '#4a4f55', hgt: 1,
  desc: 'Case de piste : ' + AIR_RUNWAY_MIN + ' cases alignées minimum pour un aéroport fonctionnel.',
};
BUILD.air_taxi = BUILD.air_taxi || {
  n: 'Taxi', ic: '🟨', hk: '',
  cost: CFG.logistique?.avion?.taxi?.cout ?? 40, col: '#6b7078', hgt: 1,
  desc: 'Voie de circulation : plus étroite que la piste, avec une ligne jaune centrale. '
    + 'Les avions l\'empruntent pour rejoindre la gare ou le dépôt depuis la piste.',
};
BUILD.air_parking = BUILD.air_parking || {
  n: 'Parking', ic: '🅿️', hk: '',
  cost: CFG.logistique?.avion?.parking?.cout ?? 30, col: '#9aa1a8', hgt: 1,
  desc: 'Place de parking pour un avion au repos. Au maximum autant de places que la capacité des hangars de l\'aéroport.',
};
BUILD.air_tower = BUILD.air_tower || {
  n: 'Tour de contrôle', ic: '🗼', hk: '',
  cost: CFG.logistique?.avion?.tour?.cout ?? 300, col: '#c9d3dc', hgt: 60,
  desc: 'Tour de contrôle (indispensable à un aéroport fonctionnel), surmontée d\'un radar rotatif. Fusionne avec l\'aéroport voisin.',
};
BUILD.air_deco = BUILD.air_deco || {
  n: 'Déco', ic: '🌳', hk: '',
  cost: CFG.logistique?.avion?.deco?.cout ?? 25, col: '#6c8f4a', hgt: 5,
  desc: 'Décor d\'aéroport (parking, pelouse, balisage). Fusionne avec l\'aéroport voisin.',
};

BUILD.plane_depot = BUILD.plane_depot || {
  n: 'Dépôt aéroport',
  ic: '✈️',
  hk: '',
  cost: CFG.logistique?.avion?.cout ?? 3500,
  col: '#5c6f8f',
  hgt: 22,
  transportDepot: true,
  buyCatalog: ['plane'],
  desc: 'Dépôt d\'aéroport : achète les avions et crée les lignes entre gares d\'aéroport. '
    + 'Hangar : à poser contre une voie de taxi de l\'aéroport. Il ne transporte aucun voyageur lui-même.',
};
BUILD.plane_depot.transportDepot = true;
BUILD.plane_depot.buyCatalog = ['plane'];

registerDepotTool({
  key: 'avion',
  tool: 'plane_depot',
  label: 'Dépôt aéroport',
  icon: '✈️',
  desc: BUILD.plane_depot.desc,
});

// ---------- groupes d'aéroport (calculés à la demande, jamais stockés) ----------
let airVersion = 0;                 // incrémenté à chaque pose / démolition d'une pièce
let _airCache = null;
const isAirPiece = b => !!b && !b.dead && AIR_TYPES.includes(b.type);
function airportGroups(){
  if(_airCache && _airCache.list === buildings && _airCache.len === buildings.length && _airCache.ver === airVersion) return _airCache;
  const byPiece = new Map(), groups = [];
  const pieces = buildings.filter(isAirPiece);
  for(const p of pieces){
    if(byPiece.has(p)) continue;
    const g = { pieces:[], terminals:[], towers:[], runways:[], longest:0, runway:null, functional:false, rep:null, id:groups.length };
    const stack = [p]; byPiece.set(p, g);
    while(stack.length){
      const c = stack.pop(); g.pieces.push(c);
      for(const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const nx = c.x + dx, ny = c.y + dy;
        if(nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const o = bgrid[ny * N + nx];
        if(o && !byPiece.has(o) && isAirPiece(o)){ byPiece.set(o, g); stack.push(o); }
      }
    }
    g.terminals = g.pieces.filter(o => o.type === 'air_terminal').sort((a, c) => (a.y - c.y) || (a.x - c.x));
    g.runways = g.pieces.filter(o => o.type === 'air_runway');
    const set = new Set(g.runways.map(o => o.x + ',' + o.y));
    const rwAt = new Map(g.runways.map(o => [o.x + ',' + o.y, o]));
    g.runs = [];
    for(const r of g.runways){
      for(const [dx, dy] of [[1,0],[0,1]]){
        if(set.has((r.x - dx) + ',' + (r.y - dy))) continue; // début d'une file
        let n = 0; while(set.has((r.x + dx * n) + ',' + (r.y + dy * n))) n++;
        if(n > g.longest) g.longest = n;
        if(n < AIR_RUNWAY_MIN) continue;
        const cells = []; for(let i = 0; i < n; i++) cells.push(rwAt.get((r.x + dx * i) + ',' + (r.y + dy * i)));
        // sens de la piste : atterrissage / décollage de x0,y0 vers x1,y1 (inversé si la piste est retournée)
        const rev = !!r.runwayRev;
        const run = { cells, set:new Set(cells.map(c => c.x + ',' + c.y)), length:n,
          x0: rev ? r.x + dx * (n - 1) : r.x, y0: rev ? r.y + dy * (n - 1) : r.y,
          x1: rev ? r.x : r.x + dx * (n - 1),  y1: rev ? r.y : r.y + dy * (n - 1) };
        g.runs.push(run);
      }
    }
    // plusieurs pistes : la plus longue sert à atterrir, la suivante à décoller (une seule : les deux)
    g.runs.sort((a, c) => (c.length - a.length) || (a.y0 - c.y0) || (a.x0 - c.x0));
    g.runs.forEach((run, i) => { run.id = g.id + ':' + i; });
    g.runway = g.runs[0] || null;
    g.landing = g.runs[0] || null;
    g.takeoff = g.runs[1] || g.runs[0] || null;
    g.rep = g.terminals[0] || null;
    g.towers = g.pieces.filter(o => o.type === 'air_tower');
    g.functional = !!g.rep && g.towers.length >= 1 && g.longest >= AIR_RUNWAY_MIN;
    groups.push(g);
  }
  const centers = buildings.filter(isAirPiece).map(o => ({ x:o.x + 0.5, y:o.y + 0.5 }));
  const runByCell = new Map();
  for(const g of groups) for(const run of g.runs) for(const k of run.set) if(!runByCell.has(k)) runByCell.set(k, run);
  return (_airCache = { list:buildings, len:buildings.length, ver:airVersion, byPiece, groups, centers, runByCell });
}
const airportOf = b => (isAirPiece(b) ? airportGroups().byPiece.get(b) || null : null);
const airportFunctional = b => !!airportOf(b)?.functional;
// gare « représentante » de l'aéroport : c'est elle qui porte les compteurs de voyageurs
const airportRepresentative = b => airportOf(b)?.rep || null;
const isActiveAirTerminal = b => !!b && b.type === 'air_terminal' && !b.dead && airportOf(b)?.functional && airportOf(b).rep === b;
// points de transit de voyageurs : gares, ports, gares d'aéroport actives (+ arrêts de bus)
const isTerminalHub = b => !!b && !b.dead && (b.type === 'train_station' || b.type === 'boat_depot' || isActiveAirTerminal(b));
const isTransitHub = b => !!b && !b.dead && (b.type === 'bus_stop' || isTerminalHub(b));
// Inverse le sens d'UNE piste de l'aéroport (clic sur la piste avec l'outil Piste) :
// toutes les cases de cette file de piste prennent le même sens.
function flipRunway(b){
  const g = airportOf(b);
  if(!g) return;
  const key = b.x + ',' + b.y;
  const run = g.runs.find(r => r.set.has(key));
  const rev = !b.runwayRev;
  for(const r of (run ? run.cells : [b])) r.runwayRev = rev;
  airVersion++;
}
// Dépôt d'aéroport (hangar) : il doit être adjacent à au moins une voie de taxi (et non
// relié à une route) ; ses avions utilisent alors les pistes de cet aéroport.
function planeDepotAirport(d){
  if(!d || d.dead || d.type !== 'plane_depot') return null;
  for(const o of buildings){
    if(o.dead || o.type !== 'air_taxi' || buildingEdgeGap(d, o) !== 0) continue;
    const g = airportOf(o);
    if(g?.functional) return g;
  }
  return null;
}
// aéroport desservi par un point d'arrêt d'avion : gare d'aéroport ou dépôt collé à la piste
const airportOfStop = b => (b?.type === 'plane_depot' ? planeDepotAirport(b) : airportOf(b));
// Altitude (px) d'un avion à la position (tuiles) : 0 au sol sur les pièces de l'aéroport
// (piste : décollage et atterrissage sur toute sa longueur), puis elle monte avec la
// distance à l'aéroport le plus proche.
function airAltitudeAt(tx, ty){
  let dmin = Infinity;
  for(const c of airportGroups().centers){
    const d = Math.hypot(tx - c.x, ty - c.y);
    if(d < dmin) dmin = d;
  }
  return dmin === Infinity ? 0 : Math.min(70, 26 * Math.max(0, dmin - 0.8));
}
// Cheminement au sol : suite de cases de l'aéroport (BFS sur ses pièces, 4 voisins) entre
// deux cases ; l'avion ne sort pas de l'aéroport pour rejoindre la gare ou la piste.
function airTaxiTiles(g, from, to){
  const key = (x, y) => x + ',' + y;
  const at = new Map(g.pieces.map(p => [key(p.x, p.y), p]));
  const start = key(from.x, from.y), goal = key(to.x, to.y);
  if(!at.has(start) || !at.has(goal)) return null;
  // coût par case : on préfère les voies de circulation, on évite de rouler sur la piste ou la déco
  const cost = p => p.type === 'air_taxi' ? 1 : p.type === 'air_terminal' ? 1.2 : p.type === 'air_runway' ? 3 : 8;
  const dist = new Map([[start, 0]]), prev = new Map([[start, null]]), open = [start];
  while(open.length){
    let bi = 0; for(let i = 1; i < open.length; i++) if(dist.get(open[i]) < dist.get(open[bi])) bi = i;
    const c = open.splice(bi, 1)[0];
    if(c === goal) break;
    const [cx, cy] = c.split(',').map(Number);
    for(const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const k = key(cx + dx, cy + dy), p = at.get(k);
      if(!p) continue;
      const nd = dist.get(c) + cost(p);
      if(!dist.has(k) || nd < dist.get(k)){ dist.set(k, nd); prev.set(k, c); open.push(k); }
    }
  }
  if(!prev.has(goal)) return null;
  const out = [];
  for(let c = goal; c; c = prev.get(c)){ const [x, y] = c.split(',').map(Number); out.push({ x, y }); }
  return out.reverse();
}
// Case d'arrêt d'un avion devant une gare d'aéroport : une case voisine de la gare (voie de
// taxi de préférence) ; l'avion s'y arrête sans entrer dans la gare.
function airStopTile(b, g){
  if(!b || b.type !== 'air_terminal' || !g) return null;
  const rank = o => o.type === 'air_taxi' ? 0 : o.type === 'air_deco' ? 1 : 9; // jamais sur la piste ni la tour
  let best = null;
  for(const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const o = bgrid[(b.y + dy) * N + (b.x + dx)];
    if(!o || o.dead || !isAirPiece(o) || airportOf(o) !== g || o.type === 'air_terminal') continue;
    if(rank(o) < 9 && (!best || rank(o) < rank(best))) best = o;
  }
  return best ? { x:best.x, y:best.y } : null;
}
// Pièce de l'aéroport où se « raccroche » un point d'arrêt : sa propre case (gare) ou la
// voie de taxi contre laquelle le dépôt (hangar) est collé.
function airAnchorTile(b, g){
  if(b.type === 'air_terminal') return airStopTile(b, g) || { x:b.x, y:b.y }; // s'arrête devant la gare
  if(isAirPiece(b)) return { x:b.x, y:b.y };
  const r = g.pieces.find(o => o.type === 'air_taxi' && buildingEdgeGap(b, o) === 0);
  return r ? { x:r.x, y:r.y } : null;
}
// Il suffit qu'UNE gare de l'aéroport touche une route (gares adjacentes = un seul aéroport).
const airportHasRoadAccess = b => !!airportOf(b)?.terminals.some(t => adjRoadTiles(t).length > 0);
// Voisinage d'une pièce (4 directions monde) : sert au dessin (pistes continues, gares
// fusionnées) et à la signature de texture. Chaque direction : t = gare, r = piste, d = déco, - = rien.
function airNeighborKey(b){
  let k = '';
  for(const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const x = b.x + dx, y = b.y + dy;
    const o = (x >= 0 && y >= 0 && x < N && y < N) ? bgrid[y * N + x] : null;
    k += !isAirPiece(o) ? '-' : o.type === 'air_terminal' ? 't' : o.type === 'air_runway' ? 'r' : o.type === 'air_taxi' ? 'x' : o.type === 'air_tower' ? 'w' : o.type === 'air_parking' ? 'p' : 'd';
  }
  return k + (b.runwayRev ? 'R' : '');
}
// version « par type » (sauvegarde / réseau), indépendante de l'état fonctionnel
const isTerminalType = b => !!b && (b.type === 'train_station' || b.type === 'boat_depot' || b.type === 'air_terminal');

// ---------- circulation : une piste ne sert qu'à un avion à la fois ----------
// piste (file de cases) sous la position (tuiles) d'un avion
const airRunwayAt = (tx, ty) => airportGroups().runByCell.get(Math.floor(tx) + ',' + Math.floor(ty)) || null;
// position (tuiles) d'un avion sur son tracé, éventuellement `ahead` tuiles plus loin
function planePosTiles(v, ahead = 0){
  const pts = v.pts;
  if(!pts || pts.length < 2) return null;
  let seg = Math.min(v.seg || 0, pts.length - 2), t = v.t || 0;
  let a = pts[seg], b = pts[seg + 1];
  let px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
  let left = ahead * TILE;
  while(left > 0){
    const d = Math.hypot(b.x - px, b.y - py);
    if(d >= left){ const k = left / (d || 1); px += (b.x - px) * k; py += (b.y - py) * k; left = 0; break; }
    left -= d; px = b.x; py = b.y; seg++;
    if(seg >= pts.length - 1) break;
    a = pts[seg]; b = pts[seg + 1];
  }
  return { x:px / TILE, y:py / TILE };
}
// L'avion doit-il s'arrêter (au sol avant la piste, ou en l'air avant l'approche) parce que
// la piste qu'il va emprunter est occupée par un autre avion ?
function planeMustHold(v){
  const here = planePosTiles(v);
  if(!here) return false;
  const alt = airAltitudeAt(here.x, here.y);
  const ahead = planePosTiles(v, alt > 5 ? 7 : 1.6);
  const rwHere = airRunwayAt(here.x, here.y), rwAhead = airRunwayAt(ahead.x, ahead.y);
  if(!rwAhead || rwAhead === rwHere) return false;
  for(const u of vehicles){
    if(u === v || u.state === 'idle' || VEHICLE_TYPES[u.vtype]?.mode !== 'air') continue;
    const up = planePosTiles(u);
    if(up && airRunwayAt(up.x, up.y) === rwAhead) return true;
  }
  return false;
}

// Vitesse d'un avion (fraction de sa vitesse de croisière) selon l'endroit où il se trouve :
//  - taxi, gare, déco : il roule doucement ;
//  - piste au décollage : il accélère sur toute la longueur de la piste ;
//  - piste à l'atterrissage : il ralentit sur toute la longueur de la piste ;
//  - en l'air : vitesse de croisière.
function planeSpeedFactor(v){
  const p = planePosTiles(v);
  if(!p) return 1;
  const alt = airAltitudeAt(p.x, p.y);
  if(alt > 0.5) return 0.85 + 0.15 * Math.min(1, alt / 40);
  const run = airRunwayAt(p.x, p.y);
  if(!run) return 0.25;
  const dx = run.x1 - run.x0, dy = run.y1 - run.y0, len2 = (dx * dx + dy * dy) || 1;
  const f = Math.max(0, Math.min(1, ((p.x - (run.x0 + 0.5)) * dx + (p.y - (run.y0 + 0.5)) * dy) / len2));
  // décollage : au-delà du bout de la piste l'avion est en l'air ; atterrissage : il reste au sol
  const ahead = planePosTiles(v, run.length + 2);
  const takeoff = !!ahead && airAltitudeAt(ahead.x, ahead.y) > 10;
  return takeoff ? 0.25 + 0.75 * f * f : 0.9 - 0.65 * f;
}

// ---------- capacité des hangars ----------
// 1 hangar : 2 avions ; 2 : 6 ; 3 : 10 ; 4 : 16 ; puis +6 par hangar supplémentaire.
// Les hangars d'un même aéroport (collés à ses voies de taxi) mettent leur capacité en commun.
const HANGAR_PLANE_CAPACITY = [0, 2, 6, 10, 16];
const hangarCapacityFor = n => n <= 0 ? 0 : n < HANGAR_PLANE_CAPACITY.length ? HANGAR_PLANE_CAPACITY[n] : 16 + 6 * (n - 4);
function hangarsOf(d){
  const g = planeDepotAirport(d);
  return g ? buildings.filter(o => !o.dead && o.type === 'plane_depot' && planeDepotAirport(o) === g) : [d];
}
function hangarFleet(d){
  const hs = hangarsOf(d);
  const planes = vehicles.filter(v => VEHICLE_TYPES[v.vtype]?.mode === 'air' && hs.includes(v.garageRef)).length;
  return { hangars:hs.length, planes, capacity:hangarCapacityFor(hs.length) };
}
// Peut-on acheter un avion de plus dans ce hangar ?
function planePurchaseError(d, vtype){
  if(d?.type !== 'plane_depot' || VEHICLE_TYPES[vtype]?.mode !== 'air') return null;
  const f = hangarFleet(d);
  return f.planes >= f.capacity
    ? 'Hangars pleins : ' + f.planes + ' / ' + f.capacity + ' avions (1 hangar = 2, 2 = 6, 3 = 10, 4 = 16). Construis un hangar de plus contre une voie de taxi.'
    : null;
}

// ---------- parking des avions ----------
// Une case de parking accueille un avion au repos. Leur nombre est limité à la capacité des
// hangars de l'aéroport (1 hangar = 2 places, 2 = 6, 3 = 10, 4 = 16…).
function airParkingError(x, y){
  const groups = new Set();
  for(const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const nx = x + dx, ny = y + dy;
    if(nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    const o = bgrid[ny * N + nx];
    const g = isAirPiece(o) ? airportOf(o) : null;
    if(g) groups.add(g);
  }
  if(!groups.size) return 'Le parking doit être posé contre un aéroport (avec au moins un hangar).';
  let parkings = 0;
  for(const g of groups) parkings += g.pieces.filter(p => p.type === 'air_parking').length;
  const hangars = buildings.filter(o => !o.dead && o.type === 'plane_depot' && groups.has(planeDepotAirport(o))).length;
  const cap = hangarCapacityFor(hangars);
  if(parkings + 1 > cap)
    return cap <= 0 ? 'Il faut au moins un hangar contre une voie de taxi de l' + String.fromCharCode(39) + 'aéroport avant de poser un parking.'
      : 'Parking complet : ' + cap + ' place' + (cap > 1 ? 's' : '') + ' maximum pour ' + hangars + ' hangar' + (hangars > 1 ? 's' : '') + '.';
  return null;
}
// Cases de parking d'un aéroport déjà attribuées (v.parkSlot d'un autre avion)
function airFreeParkingSlot(g, except){
  if(!g) return null;
  const taken = new Set();
  for(const u of vehicles) if(u !== except && u.parkSlot && VEHICLE_TYPES[u.vtype]?.mode === 'air') taken.add(u.parkSlot.x + ',' + u.parkSlot.y);
  const slot = g.pieces.filter(p => p.type === 'air_parking' && !taken.has(p.x + ',' + p.y))
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))[0];
  return slot ? { x:slot.x, y:slot.y } : null;
}
// case de parking occupée par un avion au repos : celle qui lui a été réservée (pause), sinon la
// première libre de son aéroport
let _parkCache = null;
function parkingSlotOf(v){
  const key = airVersion + ':' + vehicles.length + ':' + buildings.length + ':' + Math.floor(performance.now() / 250); // l'état au repos change : on recalcule 4×/s
  if(!_parkCache || _parkCache.key !== key || _parkCache.list !== vehicles){
    const map = new Map();
    for(const g of airportGroups().groups){
      const slots = g.pieces.filter(p => p.type === 'air_parking').sort((a, b) => (a.y - b.y) || (a.x - b.x));
      if(!slots.length) continue;
      const used = new Set();
      const planes = vehicles.filter(u => u.state === 'idle' && VEHICLE_TYPES[u.vtype]?.mode === 'air' && planeDepotAirport(u.garageRef) === g)
        .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric:true }));
      for(const u of planes){           // réservations (pause) d'abord
        const k = u.parkSlot && slots.find(p => p.x === u.parkSlot.x && p.y === u.parkSlot.y);
        if(k && !used.has(k)){ used.add(k); map.set(u, { x:k.x, y:k.y }); }
      }
      for(const u of planes){           // les autres : première place libre
        if(map.has(u)) continue;
        const k = slots.find(p => !used.has(p) && !vehicles.some(w => w !== u && w.parkSlot && w.parkSlot.x === p.x && w.parkSlot.y === p.y));
        if(k){ used.add(k); map.set(u, { x:k.x, y:k.y }); }
      }
    }
    _parkCache = { key, list:vehicles, map };
  }
  return _parkCache.map.get(v) || null;
}

// ---------- pause d'un avion ----------
// En pause, l'avion termine son vol, rejoint son aéroport de base et se stationne sur une place
// de parking libre ; s'il n'y en a aucune, il retourne au hangar. Sa ligne est conservée et
// reprend à la sortie de pause.
function setPlanePaused(v, paused){
  if(!v || VEHICLE_TYPES[v.vtype]?.mode !== 'air') return false;
  paused = !!paused;
  if(!!v.paused === paused) return true;
  v.paused = paused;
  if(paused){
    v._pauseRoute = (v.source && v.dest) ? { source:v.source, dest:v.dest } : v._pauseRoute || null;
    const g = planeDepotAirport(v.garageRef);
    v.parkSlot = airFreeParkingSlot(g, v);                 // null : pas de place → retour au hangar
    if(v.state === 'idle'){
      v.source = null; v.dest = null;
      // il sort du hangar et roule jusqu'à sa place (jamais d'apparition soudaine)
      const pts = v.parkSlot ? findAirTaxiPath(v.garageRef, v.parkSlot) : null;
      if(pts){ v.state = 'returning'; v.pts = pts; v.seg = 0; v.t = 0; v.waitTimer = 0; v.atDepot = false; v.currentBuilding = null; }
    } else {
      // en vol : il se réaligne depuis sa position sur la piste d'atterrissage de sa base ;
      // au sol (roulage, escale) : il finit l'escale en cours puis rentre (cf. updateVehicles)
      const p = planePosTiles(v);
      const flying = p && airAltitudeAt(p.x, p.y) > 0.5 && v.pts?.length > 1;
      if(flying){
        const sg = Math.min(v.seg || 0, v.pts.length - 2), a = v.pts[sg], b = v.pts[sg + 1];
        const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const path = findAirPath(v.garageRef, v.garageRef, { fromPoint:{ x:p.x * TILE, y:p.y * TILE }, heading:{ x:(b.x - a.x) / d, y:(b.y - a.y) / d }, toTile:v.parkSlot || undefined });
        if(path){
          v.source = null; v.dest = null; v.vizRoute = null; v.cargo = 0; v.res = null;
          v.state = 'returning'; v.pts = path; v.seg = 0; v.t = 0; v.waitTimer = 0; v.atDepot = false; v.currentBuilding = null;
        }
      }
    }
  } else {
    if(v._pauseRoute && !v._pauseRoute.source.dead && !v._pauseRoute.dest.dead){
      v.source = v._pauseRoute.source; v.dest = v._pauseRoute.dest;
      v.depotDepartureArmed = true;
    }
    v._pauseRoute = null;
  }
  return true;
}
