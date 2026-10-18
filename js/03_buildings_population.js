function newBuilding(type,x,y,w,h){
  const d = BUILD[type];
  // mpCreatedAt/mpConfirmedAt : suivi de la réconciliation multi (applyStateSync).
  // mpCreatedAt = horodatage création locale ; mpConfirmedAt = date du premier
  // snapshot hôte confirmant le bâtiment. Ignorés par serializeState (transitoires).
  const b = { type, x, y, w:w||d.size||1, h:h||d.size||1,
              storage:{}, inc:{}, prog:0, trucksOut:0, dead:false, owner:null,
              mpCreatedAt: performance.now(), mpConfirmedAt: null };
  // décor d'aéroport : style tiré au hasard à la pose (puis stocké, synchronisé, sauvegardé)
  // logements : design tiré au hasard à la pose et à chaque fusion (puis stocké, synchronisé, sauvegardé)
  if(d?.resid) b.design = Math.floor(Math.random() * (typeof ART_VARIANTS !== 'undefined' ? ART_VARIANTS : 8));
  if(type==='air_deco') b.decor = Math.floor(Math.random() * AIR_DECO_STYLES);
  if(type==='mine')  b.ore = DEPOSIT_ORES[terrain[y*N+x]] || 'coal';
  if(d?.storageHub && type !== 'tank'){
    b.allow = {}; b.sellTo = {}; b.sellMin = {}; b.trainAllow = {};
    for(const k in RES){ b.allow[k] = false; b.sellTo[k] = false; b.sellMin[k] = 0; b.trainAllow[k] = false; }
  }
  if(type==='tank'){
    b.allow = { water:true };
    b.sellTo = { water:false };
  }
  if(type==='garage' || d?.transportDepot) b.vehicles = [];
  if(type==='bus_stop'){
    b.passengers = 0;
    b.passengersMax = 0;
    b.passengersQuota = 0;
    b.passengersEntrant = 0;
    b.passagersSortant = 0;
  }
  if(AIR_TYPES.includes(type)) airVersion++;
  if(type==='train_station' || type==='boat_depot' || type==='air_terminal'){
    b.passengersEntrant = 0;
    b.passengersEntrantMax = 0;
    b.passengersEntrantQuota = 0;
    b.passagersSortant = 0;
    b.passengersEntrantPending = 0;
  }
  if(d.ind) b.paused = false;
  if(d.resid){
    b.pop = 0; b.protectedPop = 0; b.ct = 0; b.bonusCt = 0; b.pending = 0; b.pendingProtected = 0; b.starve = 0;
    b.upgradeProgress = {};
    b.upgradeInc = {};
    b.upgradePaused = {};
  }
  return b;
}

function normalizeResidentialUpgradeState(b){
  if(!BUILD[b.type]?.resid) return;
  if(!b.upgradeProgress || typeof b.upgradeProgress !== 'object') b.upgradeProgress = {};
  if(!b.upgradeInc || typeof b.upgradeInc !== 'object') b.upgradeInc = {};
  if(!b.upgradePaused || typeof b.upgradePaused !== 'object') b.upgradePaused = {};
  for(const r of residUpgradeResourcesOf(b)){
    const target = residUpgradeTargetOf(b, r);
    let progress = Math.max(0, Math.floor(b.upgradeProgress[r] || 0));
    if(!residConsumesResource(b, r) && (b.storage[r]||0) > 0){
      progress += Math.floor(b.storage[r] || 0);
      delete b.storage[r];
    }
    if(target > 0) b.upgradeProgress[r] = Math.min(target, progress);
    else delete b.upgradeProgress[r];
  }
  for(const r in b.upgradeProgress){
    if(!RES[r] || residUpgradeTargetOf(b, r) <= 0) delete b.upgradeProgress[r];
  }
  for(const r in b.upgradeInc){
    if(!RES[r] || residUpgradeTargetOf(b, r) <= 0) delete b.upgradeInc[r];
  }
  for(const r in b.upgradePaused){
    if(!RES[r] || residUpgradeTargetOf(b, r) <= 0) delete b.upgradePaused[r];
    else b.upgradePaused[r] = !!b.upgradePaused[r];
  }
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
  if(b.type==='terrassement') return null; // stockage passif, pas de cycle de production
  // centre spatial : pièces de fusée → cargaison de retour (cycle géré par updateSpaceCenter)
  // (time : assemblage sur le pas de tir, ou durée de la mission pendant le vol)
  if(b.type==='space_center') return { in:SPACE_ROCKET_PARTS, out:SPACE_CARGO, time: b.spacePhase === 'flight' ? SPACE_MISSION_TIME : SPACE_ASSEMBLY_TIME };
  if(d.recipe) return { in:d.recipe.in, out:d.recipe.out, time:d.time/prodMult(b) };
  return null;
}
// L'usine consomme-t-elle de l'eau ? (boulangerie, centrale à béton, usine chimique…)
// L'eau ne lui parvient que par une citerne proche (cf. tankNear).
const usesWater = b => !!recipeOf(b)?.in?.water;

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
  if(rc) return residConsumesResource(b, res) ? rc.stockCap : 0;
  const d = BUILD[b.type];
  if(d?.storageHub){
    if(b.type === 'tank') return res === 'water' ? TANK_STOCK_PER_CELL * b.w * b.h : 0;
    return (d.stockPerCell ?? DEPOT_STOCK_PER_CELL) * b.w * b.h;
  }
  if(b.type==='terrassement') return res === 'dirt' ? 80 : 0;
  const r = recipeOf(b);
  // les stocks des bâtiments industriels fusionnés grandissent avec leur taille
  return ((r && res in r.out) ? OUTCAP : INCAP) * (BUILD[b.type].ind ? b.w*b.h : 1);
}

function accepts(b,res){
  if(b.paused) return false; // un site en pause ne reçoit plus de livraisons
  if(res === 'water'){
    if(b.type === 'tank') return true;
    if(usesWater(b)) return tankNear(b);
    return false;
  }
  if(b.type==='tank') return false;
  if(b.type==='terrassement') return res === 'dirt' && (b.storage['dirt']||0) < 80;
  if(BUILD[b.type]?.storageHub) return b.allow?.[res] !== false;
  if(BUILD[b.type].resid){
    if(!residDeliveryResourcesOf(b).includes(res)) return false;
    if(b.starterHome) return false; // maisons protégées : pas besoin de ravitaillement
    return true;
  }
  const r = recipeOf(b);
  return !!(r && res in r.in);
}
function reserveIncomingResource(b,res,amt){
  const reservation = { stock:0, upgrade:0 };
  if(!(amt > 0)) return reservation;
  if(BUILD[b.type]?.resid){
    normalizeResidentialUpgradeState(b);
    const stockRoom = Math.max(0, capOf(b,res) - (b.storage[res]||0) - (b.inc[res]||0));
    reservation.stock = Math.min(amt, stockRoom);
    if(reservation.stock > 0) b.inc[res] = (b.inc[res]||0) + reservation.stock;
    const upgradeRoom = residUpgradePaused(b, res)
      ? 0
      : Math.max(0, residUpgradeRemainingOf(b, res) - (b.upgradeInc[res]||0));
    reservation.upgrade = Math.min(amt - reservation.stock, upgradeRoom);
    if(reservation.upgrade > 0) b.upgradeInc[res] = (b.upgradeInc[res]||0) + reservation.upgrade;
    return reservation;
  }
  reservation.stock = amt;
  b.inc[res] = (b.inc[res]||0) + amt;
  return reservation;
}
function releaseIncomingResource(b,res,reservation){
  if(!b || !reservation) return;
  if(reservation.stock > 0) b.inc[res] = Math.max(0, (b.inc[res]||0) - reservation.stock);
  if(reservation.upgrade > 0 && b.upgradeInc)
    b.upgradeInc[res] = Math.max(0, (b.upgradeInc[res]||0) - reservation.upgrade);
}
function depositResourceIntoBuilding(b,res,amt){
  if(!(amt > 0)) return 0;
  let remaining = amt;
  let delivered = 0;
  if(BUILD[b.type]?.resid) normalizeResidentialUpgradeState(b);
  const stockCap = capOf(b, res);
  if(stockCap > 0){
    const room = Math.max(0, stockCap - (b.storage[res]||0));
    const take = Math.min(remaining, room);
    if(take > 0){
      b.storage[res] = (b.storage[res]||0) + take;
      remaining -= take;
      delivered += take;
    }
  }
  if(BUILD[b.type]?.resid){
    const upgradeRoom = residUpgradePaused(b, res) ? 0 : residUpgradeRemainingOf(b, res);
    const take = Math.min(remaining, upgradeRoom);
    if(take > 0){
      b.upgradeProgress[res] = residUpgradeProgressOf(b, res) + take;
      remaining -= take;
      delivered += take;
    }
  }
  return delivered;
}
const space = (b,res)=>{
  const stockRoom = Math.max(0, capOf(b,res) - (b.storage[res]||0) - (b.inc[res]||0));
  if(!BUILD[b.type]?.resid) return stockRoom;
  normalizeResidentialUpgradeState(b);
  const upgradeRoom = residUpgradePaused(b, res)
    ? 0
    : Math.max(0, residUpgradeRemainingOf(b, res) - (b.upgradeInc[res]||0));
  return stockRoom + upgradeRoom;
};

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

// Compte les tuiles d'un type de terrain dans un rayon carré
function countTilesInRadius(x, y, r, tileType){
  let n = 0;
  for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
    const a = x+dx, c = y+dy;
    if(inMap(a,c) && terrain[c*N+a]===tileType) n++;
  }
  return n;
}

// Compte les bâtiments actifs d'un type dans un rayon (Chebyshev centre-à-centre)
function countBuildingsTypeInRadius(x, y, r, btype){
  let n = 0;
  for(const b of buildings){
    if(b.dead || b.type !== btype) continue;
    const cx = b.x + (b.w||1)/2 - 0.5, cy = b.y + (b.h||1)/2 - 0.5;
    if(Math.max(Math.abs(cx - x), Math.abs(cy - y)) <= r) n++;
  }
  return n;
}

// Vérifie la capacité : # fermes existantes < # tuiles de champ dans le rayon
function farmCapacityError(x, y, farmType, tileType){
  const r = Math.round(IND_RADIUS_BASE + IND_RADIUS_FACTOR); // rayon d'une ferme 1×1
  const tiles = countTilesInRadius(x, y, r, tileType);
  const farms = countBuildingsTypeInRadius(x, y, r, farmType);
  if(farms >= tiles)
    return 'Trop de fermes : '+farms+' usine'+(farms>1?'s':'')+' pour '+tiles+' tuile'+(tiles>1?'s':'')+' de champ';
  return '';
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

// Retourne l'usine de terrassement (appartenant à owner) la plus proche de (x,y)
// dans le rayon FILL_WATER_RADIUS et ayant au moins minDirt unités de terre.
// Retourne null si aucune n'est trouvée.
const FILL_WATER_RADIUS = CFG.production?.terrassement?.rayon ?? 10;
const FILL_WATER_COST   = 10; // unités de terre par tuile comblée
function terrassementNear(x, y, owner, minDirt = FILL_WATER_COST){
  let best = null, bestDist = Infinity;
  for(const b of buildings){
    if(b.dead || b.type !== 'terrassement') continue;
    if(!ownedBy(b, owner)) continue;
    if((b.storage['dirt']||0) < minDirt) continue;
    const cx = b.x + (b.w-1)/2, cy = b.y + (b.h-1)/2;
    const dist = Math.max(Math.abs(cx - x), Math.abs(cy - y));
    if(dist <= FILL_WATER_RADIUS && dist < bestDist){ best = b; bestDist = dist; }
  }
  return best;
}

// ---------- matériaux de chantier ----------
// Les grands bâtiments (gares, port, aéroport, centre spatial, usines avancées)
// exigent, en plus de leur prix, des matériaux stockés dans un entrepôt du joueur
// dont le rayon d'action couvre le chantier. Ils sont prélevés à la construction,
// dans les entrepôts les plus proches d'abord.
const buildMaterialsActive = () => BUILD_MATERIALS_ON && WORLD?.buildMaterials !== false && WORLD?.mode !== 'creative';
const buildMaterialsFor = type => buildMaterialsActive() ? buildMaterialsOf(type) : null;
// type réellement construit par un outil : l'outil « Gare » pose un quai sur un rail
const materialTypeForTool = (t, x, y) => t === 'train_station' && inMap(x, y) && rail[y*N+x] ? 'train_platform' : t;
// entrepôts (et marchés) du joueur dont le rayon couvre le centre du chantier, du plus proche au plus loin
function materialDepotsFor(x, y, w, h, owner){
  const cx = x + (w || 1) / 2 - 0.5, cy = y + (h || 1) / 2 - 0.5;
  const out = [];
  for(const d of buildings){
    if(d.dead || !isStorageDepot(d) || !ownedBy(d, owner)) continue;
    const c = centerOfBuilding(d);
    const dist = Math.max(Math.abs(c.x - cx), Math.abs(c.y - cy));
    if(dist <= depotRadiusOf(d)) out.push({ d, dist });
  }
  return out.sort((a, b) => a.dist - b.dist).map(o => o.d);
}
// quantités disponibles dans les entrepôts couvrant le chantier
function buildMaterialsStock(type, x, y, w, h, owner){
  const need = buildMaterialsFor(type);
  const have = {};
  if(!need) return have;
  for(const d of materialDepotsFor(x, y, w, h, owner))
    for(const r in need) have[r] = (have[r] || 0) + Math.floor(d.storage[r] || 0);
  return have;
}
// matériaux manquants { res: quantité } ou null si le chantier est approvisionné
function buildMaterialsMissing(type, x, y, w, h, owner){
  const need = buildMaterialsFor(type);
  if(!need) return null;
  const have = buildMaterialsStock(type, x, y, w, h, owner);
  const miss = {};
  for(const r in need) if((have[r] || 0) < need[r]) miss[r] = need[r] - (have[r] || 0);
  return Object.keys(miss).length ? miss : null;
}
function buildMaterialsError(type, x, y, w, h, owner){
  const miss = buildMaterialsMissing(type, x, y, w, h, owner);
  if(!miss) return '';
  return (materialDepotsFor(x, y, w, h, owner).length ? 'Matériaux de chantier manquants dans les entrepôts proches : '
    : 'Aucun entrepôt à portée du chantier. Matériaux requis : ') + resAmountsText(miss);
}
// prélève les matériaux (false si incomplets : rien n'est prélevé)
function consumeBuildMaterials(type, x, y, w, h, owner){
  const need = buildMaterialsFor(type);
  if(!need) return true;
  if(buildMaterialsMissing(type, x, y, w, h, owner)) return false;
  const depots = materialDepotsFor(x, y, w, h, owner);
  for(const r in need){
    let left = need[r];
    for(const d of depots){
      if(left <= 0) break;
      const take = Math.min(left, Math.floor(d.storage[r] || 0));
      if(take > 0){ d.storage[r] -= take; left -= take; }
    }
  }
  return true;
}

function playerColor(owner){
  if(owner == null) return '#e0e0e0';
  return (MP.players.find(p=>p.id===owner)||{}).color
    || MP.ownerColors?.[owner]
    || COLORS[(owner - 1) % COLORS.length]
    || '#e0e0e0';
}

function playerName(owner){
  if(owner == null) return 'Joueur';
  const p = MP.players.find(p=>p.id===owner);
  if(p && (p.name || p.username)) return p.name || p.username;
  if(WALLETS[owner]?.username) return WALLETS[owner].username;
  return 'Joueur #'+owner;
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
  const key = owner ?? currentWalletOwner();
  const w = walletOf(key);
  if(w.homelessSeeded) return;
  w.homelessSeeded = true;
}

// Le monde local du lobby devient celui d'une room fraîchement créée : ses bâtiments (sans
// propriétaire) reviennent au joueur qui l'héberge, sinon ils resteraient neutres.
function adoptNeutralBuildings(owner){
  if(owner == null) return;
  for(const b of buildings) if(!b.dead && b.owner == null) b.owner = owner;
}

function adoptNeutralWallet(owner){
  if(owner == null || owner === 0) return;
  if(WALLETS[owner]) return;
  if(WALLETS[0]){
    WALLETS[owner] = WALLETS[0];
    delete WALLETS[0];
  }
}

function adoptNeutralHomeless(owner){
  if(owner == null) return;
  adoptNeutralWallet(owner);
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
    if(WALLETS[currentWalletOwner()]) WALLETS[currentWalletOwner()].homelessSeeded = true;
  }
}

function assignHomelessToHousing(owner){
  if(!homeless?.length) return;
  for(const h of homeless)
    if(h.owner === owner) h.col = playerColor(owner);
  const homes = buildings
    .filter(b=>!b.dead && BUILD[b.type].resid && ownedBy(b, owner) && !b.airbnbOnly)
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
        id: nextWalkerId++,
        pts: walkPath({ x:h.x, y:h.y }, { x:(home.x+home.w/2)*TILE, y:(home.y+home.h/2)*TILE }, home),
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
      id: nextWalkerId++,
      pts: walkPath({ x:h.x, y:h.y }, exit),
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

// Passe une maison en / hors « Airbnb uniquement ». En activant, les habitants du propriétaire
// (hors invités) quittent la maison : ils rejoignent un autre logement libre, sinon la carte.
// Rayon d'attractivité d'un lieu de loisirs (cases), borné par la config ; la valeur par défaut
// du type n'est pas stockée.
function setLeisureRadius(b, r){
  if(!isLeisure(b)) return;
  r = Math.max(LEISURE_RADIUS_MIN, Math.min(LEISURE_RADIUS_MAX, Math.round(+r) || LEISURE_RADIUS_MIN));
  b.attractRadius = r === BUILD[b.type].leisure.radius ? undefined : r;
}

function setAirbnbOnly(b, on){
  if(!b || b.dead || !BUILD[b.type]?.resid || b.starterHome) return;
  if(!on){ b.airbnbOnly = undefined; return; }
  b.airbnbOnly = true;
  const guests = Math.min((b.guests || []).length, b.pop || 0);
  const own = (b.pop || 0) - guests;
  if(own <= 0) return;
  b.pop = own;                                   // makeResidentsHomeless ne déloge que les habitants propres
  const evicted = makeResidentsHomeless(b);
  b.pop = guests;
  b.protectedPop = Math.min(b.protectedPop || 0, b.pop);
  addFloat(b.x, b.y-0.5, '−'+own+' 👤', '#ff9a8a');
  routeUnhousedResidents(b.owner ?? null, evicted);
}

function demolishBuilding(b, refundOwner){
  if(!b || b.dead) return 0;
  const owner = b.owner ?? null;
  const townId = b.townId ?? null;
  if(AIR_TYPES.includes(b.type)) airVersion++;
  if(BUILD[b.type]?.resid) evictGuests(b); // les invités d'un autre joueur repartent en transport
  if(BUILD[b.type]?.leisure) evictVisitors(b); // lieu de loisirs : les visiteurs repartent en transport
  const evicted = makeResidentsHomeless(b);
  // ouvriers venus par transport : ils rejoignent la maison libre / le point de transit le plus proche
  if(b.commuters) for(const key of Object.keys(b.commuters)) sendCommutersAway(b, key, b.commuters[key]);
  sendRouteVehiclesHome(b); // les véhicules de la route retournent au dépôt
  b.dead = true;
  buildings.splice(buildings.indexOf(b),1);
  setGrid(b,null);
  if(b.type === 'train_station' || b.type === 'train_platform') stationLayoutVersion++;
  if(selected===b) selected = null;
  // retirer les véhicules du dépôt démoli et rembourser 50% de leur valeur
  if((b.type === 'garage' || BUILD[b.type]?.transportDepot) && b.vehicles){
    const transitVehicles = vehicles.filter(v => v.garageRef === b);
    const lostValue = depotVehicleValue(b);
    vehicles = vehicles.filter(v => v.garageRef !== b);
    if(vehicleRouteMode && vehicleRouteMode.vehicle && vehicleRouteMode.vehicle.garageRef === b) vehicleRouteMode = null;
    if(lostValue > 0){
      const vehRefund = Math.floor(lostValue * 0.5);
      const target = walletOf(refundOwner ?? owner);
      earnMoney(vehRefund, 'rembours', target);
      if(transitVehicles.length > 0){
        const center = centerOfBuilding(b);
        addFloat(center.x, center.y, '+'+vehRefund+' $ ('+transitVehicles.length+' véhicule(s))', '#ffb04d');
      }
    }
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

// checkMaterials=false : seules les règles de terrain (le panneau affiche alors les
// spécialisations en attente de matériaux au lieu de les masquer).
function plantUpgradeError(b, targetType, checkMaterials = true){
  if(!b || b.dead || b.type !== 'plant') return 'Usine déjà spécialisée';
  if(!PLANT_UPGRADES[targetType]) return 'Type d\'usine invalide';
  if(targetType === 'farm'){
    if(!fieldNear(b.x, b.y, 2)) return 'Aucun champ de blé à moins de 2 cases';
    const capErr = farmCapacityError(b.x, b.y, 'farm', T.WHEAT);
    if(capErr) return capErr;
  }
  if(targetType === 'cotton_farm'){
    if(!cottonFieldNear(b.x, b.y, 2)) return 'Aucun champ de coton à moins de 2 cases';
    const capErr = farmCapacityError(b.x, b.y, 'cotton_farm', T.COTTON);
    if(capErr) return capErr;
  }
  if(targetType === 'lumber' && !treeNear(b.x, b.y, 2))
    return 'Aucun arbre à moins de 2 cases';
  if(targetType === 'fisher' && !waterNear(b.x, b.y, 1))
    return 'Doit être au bord de l\'eau';
  if(targetType === 'pump' && !waterNear(b.x, b.y, 1))
    return 'Doit être au bord de l\'eau';
  if(targetType === 'mine' && !isMineDeposit(terrain[b.y*N+b.x]))
    return 'Doit être sur un gisement';
  if(!checkMaterials) return '';
  return buildMaterialsError(targetType, b.x, b.y, b.w, b.h, b.owner ?? null);
}

function applyPlantUpgrade(b, targetType){
  const err = plantUpgradeError(b, targetType);
  if(err) return err;
  consumeBuildMaterials(targetType, b.x, b.y, b.w, b.h, b.owner ?? null);
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
