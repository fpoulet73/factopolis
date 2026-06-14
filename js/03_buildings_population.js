function newBuilding(type,x,y,w,h){
  const d = BUILD[type];
  const b = { type, x, y, w:w||d.size||1, h:h||d.size||1,
              storage:{}, inc:{}, prog:0, trucksOut:0, dead:false, owner:null };
  if(type==='mine')  b.ore = terrain[y*N+x]===T.IRON ? 'iron' : 'coal';
  if(type==='depot'){
    b.allow = {}; b.sellTo = {}; b.sellMin = {};
    for(const k in RES){ b.allow[k] = k !== 'water'; b.sellTo[k] = false; b.sellMin[k] = 0; }
  }
  if(type==='tank'){
    b.allow = { water:true };
    b.sellTo = { water:false };
  }
  if(type==='garage') b.vehicles = [];
  if(d.ind) b.paused = false;
  if(d.resid){ b.pop = 0; b.protectedPop = 0; b.ct = 0; b.bonusCt = 0; b.pending = 0; b.pendingProtected = 0; b.starve = 0; }
  return b;
}

function markStarterHomeIfNeeded(b){
  if(!b || b.type !== 'house') return;
  const w = walletOf(b.owner);
  if((w.starterHomesGranted||0) >= 2) return;
  b.starterHome = true;
  b.starterSlots = 1; // 1 slot de départ par maison initiale
  b.protectedPop = b.protectedPop || 0;
  w.starterHomes = (w.starterHomes||0) + 1;
  w.starterHomesGranted = (w.starterHomesGranted||0) + 1;
}

function ensureStarterProtectionForOwner(owner){
  const starterBuildings = buildings.filter(b=>
    !b.dead && ownedBy(b, owner) && BUILD[b.type]?.resid && b.starterHome
  );
  for(const b of starterBuildings){
    if((b.pop||0) > 0 && (b.protectedPop||0) < 1) b.protectedPop = 1;
  }
}

function normalizeStarterProtectionForOwner(owner){
  const owned = buildings
    .filter(b=>!b.dead && ownedBy(b, owner) && BUILD[b.type]?.resid)
    .sort((a,b)=> (a.y-b.y) || (a.x-b.x));
  let remaining = 2;
  for(const b of owned){
    const slots = b.starterHome ? Math.max(1, b.starterSlots || (b.protectedPop||0) || 1) : 0;
    if(slots > 0 && remaining > 0){
      const keep = Math.min(slots, remaining);
      b.starterHome = true;
      b.starterSlots = keep;
      b.protectedPop = Math.min(Math.max(b.protectedPop||0, Math.min(keep, b.pop||0)), b.pop||0);
      remaining -= keep;
    } else {
      b.starterHome = false;
      b.starterSlots = 0;
      b.protectedPop = 0;
      b.pendingProtected = 0;
    }
  }
  const current = 2 - remaining;
  const w = walletOf(owner);
  w.starterHomes = current;
  w.starterHomesGranted = Math.max(w.starterHomesGranted||0, current);
}

function ensureAllStarterProtections(){
  const owners = new Set();
  for(const b of buildings) if(BUILD[b.type].resid) owners.add(b.owner ?? MP.myId);
  for(const h of homeless) owners.add(h.owner ?? MP.myId);
  if(MP.myId != null) owners.add(MP.myId);
  for(const o of owners){
    normalizeStarterProtectionForOwner(o);
    ensureStarterProtectionForOwner(o);
  }
}

function setGrid(b,val){
  for(let y=b.y; y<b.y+b.h; y++)
    for(let x=b.x; x<b.x+b.w; x++) bgrid[y*N+x] = val;
}

function recipeOf(b){
  const d = BUILD[b.type];
  if(b.type==='mine') return { in:{}, out:{ [b.ore]: d.qty||1 }, time:d.time/prodMult(b) };
  if(d.recipe) return { in:d.recipe.in, out:d.recipe.out, time:d.time/prodMult(b) };
  return null;
}

function adjRoadTiles(b){
  const a = [], w = b.w||1, h = b.h||1;
  for(let x=b.x; x<b.x+w; x++){
    if(inMap(x,b.y-1) && road[(b.y-1)*N+x]) a.push((b.y-1)*N+x);
    if(inMap(x,b.y+h) && road[(b.y+h)*N+x]) a.push((b.y+h)*N+x);
  }
  for(let y=b.y; y<b.y+h; y++){
    if(inMap(b.x-1,y) && road[y*N+b.x-1]) a.push(y*N+b.x-1);
    if(inMap(b.x+w,y) && road[y*N+b.x+w]) a.push(y*N+b.x+w);
  }
  return a;
}

function capOf(b,res){
  const rc = BUILD[b.type].resid;
  if(rc) return rc.stockCap;
  if(b.type==='tank') return res === 'water' ? TANK_STOCK_PER_CELL * b.w * b.h : 0;
  if(b.type==='depot') return DEPOT_STOCK_PER_CELL * b.w * b.h;
  const r = recipeOf(b);
  // les stocks des bâtiments industriels fusionnés grandissent avec leur taille
  return ((r && res in r.out) ? OUTCAP : INCAP) * (BUILD[b.type].ind ? b.w*b.h : 1);
}

function accepts(b,res){
  if(b.paused) return false; // un site en pause ne reçoit plus de livraisons
  if(res === 'water'){
    if(b.type === 'tank') return true;
    if(b.type === 'bakery') return tankNear(b);
    return false;
  }
  if(b.type==='tank') return false;
  if(b.type==='depot') return b.allow?.[res] !== false;
  if(BUILD[b.type].resid){
    if(!residDeliveryResourcesOf(b).includes(res)) return false;
    if(b.starterHome) return false; // maisons protégées : pas besoin de ravitaillement
    return true;
  }
  const r = recipeOf(b);
  return !!(r && res in r.in);
}
const space = (b,res)=> capOf(b,res) - (b.storage[res]||0) - (b.inc[res]||0);

function treeNear(x,y,r){
  for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
    const a = x+dx, c = y+dy;
    if(inMap(a,c) && terrain[c*N+a]===T.TREE) return true;
  }
  return false;
}

function fieldNear(x,y,r){
  for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
    const a = x+dx, c = y+dy;
    if(inMap(a,c) && terrain[c*N+a]===T.WHEAT) return true;
  }
  return false;
}

function cottonFieldNear(x,y,r){
  for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
    const a = x+dx, c = y+dy;
    if(inMap(a,c) && terrain[c*N+a]===T.COTTON) return true;
  }
  return false;
}

function waterNear(x,y,r){
  for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
    const a = x+dx, c = y+dy;
    if(inMap(a,c) && terrain[c*N+a]===T.WATER) return true;
  }
  return false;
}

function tankNear(b){
  const center = centerOfBuilding(b);
  return buildings.some(o => {
    if(o.dead || o.type !== 'tank') return false;
    if(!ownedBy(o, b.owner)) return false;
    const oc = centerOfBuilding(o);
    return Math.max(Math.abs(oc.x - center.x), Math.abs(oc.y - center.y)) <= BAKERY_TANK_RADIUS;
  });
}

function playerColor(owner){
  if(owner == null) return '#e0e0e0';
  return (MP.players.find(p=>p.id===owner)||{}).color || COLORS[(owner - 1) % COLORS.length] || '#e0e0e0';
}

function findEmptySpawnTiles(owner, count){
  const seed = owner == null ? 17 : owner * 97 + 13;
  const cx = Math.max(4, Math.min(N-5, ((seed * 37) % Math.max(1, N-8)) + 4));
  const cy = Math.max(4, Math.min(N-5, ((seed * 53) % Math.max(1, N-8)) + 4));
  const out = [];
  for(let r=0; r<N && out.length<count; r++){
    for(let y=cy-r; y<=cy+r && out.length<count; y++) for(let x=cx-r; x<=cx+r && out.length<count; x++){
      if(x<0||y<0||x>=N||y>=N) continue;
      if(Math.max(Math.abs(x-cx), Math.abs(y-cy)) !== r) continue;
      const i = y*N+x;
      if(terrain[i] !== T.GRASS || road[i] || bgrid[i]) continue;
      if(out.some(p=>p.x===x && p.y===y)) continue;
      out.push({ x, y });
    }
  }
  return out;
}

function ensureHomelessForOwner(owner){
  const key = owner ?? MP.myId;
  const w = walletOf(key);
  if(w.homelessSeeded) return;
  const hasPresence =
    homeless.some(h=> (h.owner ?? MP.myId) === key)
    || walkers.some(wk=>wk.fromHomeless && wk.target && (wk.target.owner ?? MP.myId) === key)
    || buildings.some(b=>ownedBy(b, owner) && BUILD[b.type].resid && ((b.pop||0) > 0 || (b.pending||0) > 0));
  if(hasPresence){ w.homelessSeeded = true; return; }
  w.homelessSeeded = true;
  const tiles = findEmptySpawnTiles(owner, START_HOMELESS);
  for(let i=0; i<START_HOMELESS; i++){
    const t = tiles[i] || { x:(N>>1), y:(N>>1) };
    homeless.push({
      owner,
      x:t.x*TILE+TILE/2,
      y:t.y*TILE+TILE/2,
      col: playerColor(owner),
      phase: (i*1.73) % 7,
    });
  }
}

function adoptSoloHomeless(owner){
  if(owner == null) return;
  let adopted = 0;
  for(const h of homeless){
    if(h.owner == null){
      h.owner = owner;
      h.col = playerColor(owner);
      adopted++;
    }
  }
  if(adopted){
    const w = walletOf(owner);
    w.homelessSeeded = true;
    if(WALLETS[MP.myId ?? 0]) WALLETS[MP.myId ?? 0].homelessSeeded = true;
  }
}

function assignHomelessToHousing(owner){
  if(!homeless?.length) return;
  for(const h of homeless)
    if(h.owner === owner) h.col = playerColor(owner);
  const homes = buildings
    .filter(b=>!b.dead && BUILD[b.type].resid && ownedBy(b, owner))
    .sort((a,b)=> (b.starterHome?1:0)-(a.starterHome?1:0) || (a.y-b.y) || (a.x-b.x));
  for(const home of homes){
    const rc = BUILD[home.type].resid;
    while(home.pop + home.pending < rc.popCap){
      const idx = homeless.findIndex(h=> h.owner === owner);
      if(idx < 0) return;
      const h = homeless.splice(idx, 1)[0];
      const protectedResident = !!home.starterHome && (home.protectedPop||0) + (home.pendingProtected||0) < 1;
      home.pending++;
      if(protectedResident) home.pendingProtected = (home.pendingProtected||0) + 1;
      walkers.push({
        pts:[
          { x:h.x, y:h.y },
          { x:(home.x+home.w/2)*TILE, y:(home.y+home.h/2)*TILE },
        ],
        seg:0, t:0, target:home, fromHomeless:true, protectedResident,
        col:h.col, phase:h.phase,
      });
    }
  }
}

function randomExitPoint(){
  const side = (Math.random()*4)|0;
  if(side===0) return { x:-TILE, y:Math.random()*N*TILE };
  if(side===1) return { x:(N+1)*TILE, y:Math.random()*N*TILE };
  if(side===2) return { x:Math.random()*N*TILE, y:-TILE };
  return { x:Math.random()*N*TILE, y:(N+1)*TILE };
}

function routeUnhousedResidents(owner, residents){
  assignHomelessToHousing(owner);
  for(const h of residents){
    const i = homeless.indexOf(h);
    if(i < 0) continue;
    const exit = randomExitPoint();
    homeless.splice(i, 1);
    walkers.push({
      pts:[{ x:h.x, y:h.y }, exit],
      seg:0, t:0, target:null, leaving:true,
      col:h.col || playerColor(owner), phase:h.phase || Math.random()*7,
    });
  }
}

function makeResidentsHomeless(b){
  const count = b.pop||0;
  if(!count || !BUILD[b.type]?.resid) return [];
  b.pop = 0;
  const owner = b.owner ?? null;
  const created = [];
  for(let i=0; i<count; i++){
    const ox = ((i % Math.max(1, b.w)) + 0.5) / Math.max(1, b.w);
    const oy = (((i / Math.max(1, b.w))|0) % Math.max(1, b.h) + 0.5) / Math.max(1, b.h);
    const h = {
      owner,
      x:(b.x + ox*b.w)*TILE,
      y:(b.y + oy*b.h)*TILE,
      col:playerColor(owner),
      phase:Math.random()*7,
    };
    homeless.push(h);
    created.push(h);
  }
  return created;
}

function demolishBuilding(b, refundOwner){
  if(!b || b.dead) return 0;
  const owner = b.owner ?? null;
  const townId = b.townId ?? null;
  const evicted = makeResidentsHomeless(b);
  b.dead = true;
  buildings.splice(buildings.indexOf(b),1);
  setGrid(b,null);
  if(selected===b) selected = null;
  // retirer les véhicules du garage démoli
  if(b.type === 'garage' && b.vehicles){
    vehicles = vehicles.filter(v => v.garageRef !== b);
    if(vehicleRouteMode && vehicleRouteMode.vehicle.garageRef === b) vehicleRouteMode = null;
  }
  // supprimer la ville si tous ses bâtiments résidentiels sont détruits
  if(BUILD[b.type]?.resid && townId != null){
    const stillHasHouses = buildings.some(bl => !bl.dead && bl.townId === townId && BUILD[bl.type]?.resid);
    if(!stillHasHouses) towns = towns.filter(t => t.id !== townId);
  }
  const refund = Math.floor((BUILD[b.type].cost||0)*0.3);
  earnMoney(refund, 'rembours', walletOf(refundOwner ?? owner));
  routeUnhousedResidents(owner, evicted);
  return refund;
}

function setBuildingPaused(b, pausedState, broadcastChange=true){
  if(!b || !BUILD[b.type]?.ind) return;
  b.paused = !!pausedState;
  if(broadcastChange && MP.connected){
    netSend({ type:'toggle_bld_pause', x:b.x, y:b.y, paused:b.paused });
  }
}

function plantUpgradeError(b, targetType){
  if(!b || b.dead || b.type !== 'plant') return 'Usine déjà spécialisée';
  if(!PLANT_UPGRADES[targetType]) return 'Type d\'usine invalide';
  if(targetType === 'farm' && !fieldNear(b.x, b.y, 2))
    return 'Aucun champ de blé à moins de 2 cases';
  if(targetType === 'cotton_farm' && !cottonFieldNear(b.x, b.y, 2))
    return 'Aucun champ de coton à moins de 2 cases';
  return '';
}

function applyPlantUpgrade(b, targetType){
  const err = plantUpgradeError(b, targetType);
  if(err) return err;
  b.type = targetType;
  b.storage = {};
  b.inc = {};
  b.prog = 0;
  b.trucksOut = 0;
  b.paused = false;
  b.name = null;
  assignIndustryName(b);
  return '';
}
