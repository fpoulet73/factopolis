// ---------- simulation ----------
function update(dt){
  gtime += dt;
  let starved = null;

  ensureAllStarterProtections();
  refreshWorkerAllocation();
  syncIncomingReservations();
  syncResidentReservations();
  // eff du joueur courant (pour statusOf)
  eff = myWallet().eff;

  for(const b of buildings){
    const w = walletOf(b.owner); // wallet du propriétaire du bâtiment
    const r = recipeOf(b);
    if(r && !b.paused){
      let outOK = true, inOK = true;
      for(const k in r.out) if((b.storage[k]||0) >= capOf(b,k)) outOK = false;
      for(const k in r.in)  if((b.storage[k]||0) <  r.in[k]) inOK = false;
      if(outOK && inOK){
        b.prog += dt * (workersRequiredOf(b) ? workersAllocatedOf(b) / workersRequiredOf(b) : w.eff);
        if(b.prog >= r.time){
          b.prog = 0;
          for(const k in r.in)  b.storage[k] -= r.in[k];
          for(const k in r.out) b.storage[k] = (b.storage[k]||0) + r.out[k];
        }
      }
    }
    const rc = BUILD[b.type].resid;
    if(rc && !b.starterHome && (b.storage.goods||0) > 0){
      b.starve = 0;
      b.ct += dt;
      if(b.ct >= rc.interval){
        b.ct = 0;
        b.storage.goods--;
        if((b.storage.bread||0) > 0) b.storage.bread--; // consommé si présent, pas obligatoire
        const fishBonus = (b.storage.fish_fillet||0) > 0;
        if(fishBonus) b.storage.fish_fillet--;
        const income = Math.round(rc.income * Math.max(1, b.pop) * (fishBonus ? 1.2 : 1));
        earnMoney(income, 'ventes', w);
        addFloat(b.x + (b.w-1)/2, b.y, '+'+income+' $', '#ffe9a0');
        if(b.pop + b.pending < rc.popCap) spawnWalker(b);
      }
    } else if(rc && b.starterHome){
      b.starve = 0; // maison protégée : pas de pénurie
      b.ct += dt;
      if(b.ct >= rc.interval){
        b.ct = 0;
        const income = rc.income * Math.max(1, b.pop);
        earnMoney(income, 'ventes', w);
        addFloat(b.x + (b.w-1)/2, b.y, '+'+income+' $', '#ffe9a0');
        if(b.pop + b.pending < rc.popCap) spawnWalker(b);
      }
    } else if(rc && !b.starterHome && b.pop > (b.protectedPop||0)){
      b.starve += dt;
      if(b.starve >= STARVE_DELAY){
        b.starve = 0;
        (starved ||= []).push(b);
      }
    } else if(rc){
      b.starve = 0;
    }
    // croissance bonus : stock > seuil ET logement non plein → +1 habitant toutes les X secondes
    if(rc && b.pop + b.pending < rc.popCap){
      const stockFull = (b.storage.goods||0) / rc.stockCap;
      if(stockFull > BONUS_GROWTH_THRESHOLD){
        b.bonusCt = (b.bonusCt||0) + dt;
        if(b.bonusCt >= BONUS_GROWTH_INTERVAL){
          b.bonusCt = 0;
          spawnWalker(b);
        }
      } else {
        b.bonusCt = 0;
      }
    } else if(rc){
      b.bonusCt = 0;
    }
  }
  if(starved) for(const b of starved){
    if(b.dead) continue;
    if(b.w*b.h > 1) splitBuilding(b);
    else leaveOne(b);
  }

  mergeTimer += dt;
  if(mergeTimer >= 1){ mergeTimer = 0; tryMerge(); tryMergeInd(); tryMergeDepot(); }

  dispatchTimer += dt;
  if(dispatchTimer >= 0.7){
    dispatchTimer = 0;
    for(const b of buildings){
      const maxTrucks = isStorageHub(b)
        ? 4 + b.w * b.h          // entrepôt : plus de camions pour servir plusieurs destinations
        : 2 + ((b.w*b.h)>>1);    // production : limite standard
      if(b.trucksOut >= maxTrucks) continue;
      const r = recipeOf(b);

      if(isStorageHub(b)){
        // entrepôt : dispatcher toutes les ressources avec demande, seuil = 1 unité
        for(const k in b.storage){
          if(b.trucksOut >= maxTrucks) break;
          if((b.storage[k]||0) < 1) continue;
          if(b.allow?.[k] === false) continue;
          tryDispatch(b, k);
        }
      } else {
        // bâtiment de production : dispatcher la ressource la plus abondante en sortie
        let best = null, amt = 0;
        for(const k in b.storage){
          if(b.storage[k] < 3) continue;
          if(r && k in r.out && b.storage[k] > amt){ best = k; amt = b.storage[k]; }
        }
        if(best) tryDispatch(b, best);
      }
    }
  }

  updateTrucks(dt);
  updateVehicles(dt);
  updateWalkers(dt);

  taxTimer += dt;
  if(taxTimer >= ECO.taxeInterval){
    taxTimer = 0;
    // taxes par wallet : taux plein si l'habitant travaille, /3 sinon
    for(const k in WALLETS){
      const oid = +k;
      const w = WALLETS[k];
      // Travailleurs effectivement actifs (industrie non pausée et stock de sortie non plein)
      let activeWorkers = 0;
      for(const b of buildings){
        if(b.dead || !ownedBy(b, oid) || !BUILD[b.type]?.ind || b.paused) continue;
        const r = recipeOf(b);
        if(!r) continue;
        let outFull = true;
        for(const rk in r.out){ if((b.storage[rk]||0) < OUTCAP){ outFull = false; break; } }
        if(!outFull) activeWorkers += workersAllocatedOf(b);
      }
      const total   = popTotal(oid);
      const working = Math.min(total, activeWorkers);
      const idle    = total - working;
      const t = ECO.taxe * working + (ECO.taxe / 3) * idle;
      earnMoney(t, 'taxes', w);
    }
  }

  upkeepTimer += dt;
  if(upkeepTimer >= IND_UPKEEP_INTERVAL){
    upkeepTimer = 0;
    for(const b of buildings){
      const u = upkeepOf(b);
      if(u <= 0) continue;
      const w = walletOf(b.owner);
      w.money -= u; w.fin.entretien += u;
      addFloat(b.x+(b.w-1)/2, b.y, '−'+(Math.round(u*10)/10)+' $', '#ff9a8a');
    }
  }

  // historique financier par wallet
  for(const k in WALLETS){
    const w = WALLETS[k];
    w.finTimer = (w.finTimer||0) + dt;
    if(w.finTimer >= 1){
      w.finTimer = 0;
      w.finHist = w.finHist || [];
      w.finHist.push({ ...w.fin });
      if(w.finHist.length > 61) w.finHist.shift();
    }
  }

  // milestones par wallet
  for(const k in WALLETS){
    const oid = +k;
    const w = WALLETS[k];
    if(w.mi == null) w.mi = 0;
    // n'afficher le toast que si c'est le joueur courant
    if(w.mi < MILESTONES.length && popTotal(oid) >= MILESTONES[w.mi]){
      if(+k === MP.myId)
        toast('🎉 '+MILESTONES[w.mi]+' habitants ! Ta ville prospère.','win');
      w.mi++;
    }
  }

  for(let i=floats.length-1;i>=0;i--){
    floats[i].life -= dt;
    if(floats[i].life <= 0) floats.splice(i,1);
  }
}

// un rectangle w×h entièrement couvert de logements pleins strictement plus
// petits → fusion en bâtiment de niveau supérieur
function checkRect(x,y,w,h){
  const area = w*h, set = [];
  for(let yy=y; yy<y+h; yy++) for(let xx=x; xx<x+w; xx++){
    const b = bgrid[yy*N+xx];
    if(!b) return null;
    const rc = BUILD[b.type].resid;
    if(!rc) return null;                                        // pas un logement
    if(b.w*b.h >= area) return null;                            // pas plus petit
    if(b.x<x || b.y<y || b.x+b.w>x+w || b.y+b.h>y+h) return null; // déborde du rectangle
    if(b.pop < rc.popCap) return null;                          // pas plein
    if(!b.starterHome && ((b.storage.goods||0) <= 0 || (b.storage.bread||0) <= 0)) return null; // pain requis pour fusion, poisson = bonus
    if(!set.includes(b)) set.push(b);
  }
  return set;
}

// rectangle couvert de bâtiments de production IDENTIQUES plus petits → fusion
function checkRectInd(x,y,w,h){
  const area = w*h;
  const first = bgrid[y*N+x];
  if(!first || !BUILD[first.type].ind) return null;
  const type = first.type, ore = first.ore;
  const set = [];
  for(let yy=y; yy<y+h; yy++) for(let xx=x; xx<x+w; xx++){
    const b = bgrid[yy*N+xx];
    if(!b || b.type!==type || b.paused) return null;
    if(b.w*b.h >= area) return null;
    if(b.x<x || b.y<y || b.x+b.w>x+w || b.y+b.h>y+h) return null;
    if(type==='mine' && b.ore!==ore) return null;
    if(!set.includes(b)) set.push(b);
  }
  return set;
}

function tryMergeInd(){
  for(const [w,h] of IND_SHAPES_ALL){
    for(let y=0; y<=N-h; y++) for(let x=0; x<=N-w; x++){
      const set = checkRectInd(x,y,w,h);
      if(!set) continue;
      const type = set[0].type, ore = set[0].ore, owner = set[0].owner||null;
      if(!indShapeAllowed(type, w, h)) continue;
      const store = {};
      let wasSel = false;
      for(const o of set){
        for(const k in o.storage) store[k] = (store[k]||0) + o.storage[k];
        if(o===selected) wasSel = true;
        o.dead = true;
        setGrid(o,null);
      }
      buildings = buildings.filter(o=> !o.dead);
      const t = newBuilding(type, x, y, w, h);
      if(ore) t.ore = ore;
      t.owner = owner;
      for(const k in store) t.storage[k] = Math.min(capOf(t,k), store[k]);
      buildings.push(t);
      setGrid(t,t);
      if(wasSel) selected = t;
      toast('🏭 '+set.length+' × '+BUILD[type].n+' → '+w+'×'+h
        +' — production ×'+prodMult(t).toFixed(1)+' !','win');
      return true;
    }
  }
  return false;
}

function tryMerge(){
  for(const L of MERGE_ORDER){
    for(const [w,h] of L.shapes){
      for(let y=0; y<=N-h; y++) for(let x=0; x<=N-w; x++){
        const set = checkRect(x,y,w,h);
        if(!set) continue;
        const d = BUILD[L.key];
        let goods = 0, bread = 0, fishFillet = 0, pop = 0, protectedPop = 0, wasSel = false;
        const owner = set[0].owner||null;
        for(const o of set){
          goods += o.storage.goods||0;
          bread += o.storage.bread||0;
          fishFillet += o.storage.fish_fillet||0;
          pop += o.pop;
          protectedPop += o.protectedPop||0;
          if(o===selected) wasSel = true;
          o.dead = true;
          setGrid(o,null);
        }
        buildings = buildings.filter(o=> !o.dead);
        const t = newBuilding(L.key, x, y, w, h);
        t.owner = owner;
        t.townId = set[0].townId ?? null; // hériter le village du premier composant
        t.pop = Math.min(d.resid.popCap, pop);
        t.protectedPop = Math.min(t.pop, protectedPop);
        t.starterHome = t.protectedPop > 0 || set.some(o => o.starterHome);
        // Conserver le nombre total de slots de départ absorbés
        t.starterSlots = set.reduce((s, o) => s + (o.starterSlots || (o.starterHome ? 1 : 0)), 0);
        t.storage.goods = Math.min(d.resid.stockCap, goods);
        t.storage.bread = Math.min(d.resid.stockCap, bread);
        t.storage.fish_fillet = Math.min(d.resid.stockCap, fishFillet);
        buildings.push(t);
        setGrid(t,t);
        if(wasSel) selected = t;
        toast('🏗️ '+set.length+' logements pleins → '+d.n+' ('+w+'×'+h+') !','win');
        return; // une fusion à la fois : la liste vient d'être modifiée
      }
    }
  }
}

// ---------- piétons (nouveaux habitants) ----------
function growPop(b, protectedResident=false){
  const rc = BUILD[b.type].resid;
  if(b.pop < rc.popCap){
    b.pop++;
    if(protectedResident) b.protectedPop = Math.min(b.pop, (b.protectedPop||0) + 1);
    addFloat(b.x+(b.w-1)/2, b.y-0.5, '+1 👤', '#9fe8c9');
  }
}

// Dijkstra du pourtour du logement vers le bord de carte le plus accessible
// (routes : rapides, herbe : moyen, forêt : lent ; eau et bâtiments bloquent)
// renvoie les étapes du bord de la carte jusqu'au bâtiment, ou null si enclavé
function pathToEdge(b){
  const walkable = i => terrain[i]!==T.WATER && !bgrid[i];
  const costOf = i => road[i] ? 1 : (terrain[i]===T.TREE ? 6 : (terrain[i]===T.WHEAT ? 4 : 3));

  dist.fill(-1);
  const heap = [];
  const hpush = (c,i)=>{
    heap.push([c,i]);
    let j = heap.length-1;
    while(j>0){
      const p = (j-1)>>1;
      if(heap[p][0] <= heap[j][0]) break;
      [heap[p],heap[j]] = [heap[j],heap[p]]; j = p;
    }
  };
  const hpop = ()=>{
    const top = heap[0], last = heap.pop();
    if(heap.length){
      heap[0] = last;
      let j = 0;
      for(;;){
        const l = 2*j+1, r = l+1;
        let m = j;
        if(l<heap.length && heap[l][0]<heap[m][0]) m = l;
        if(r<heap.length && heap[r][0]<heap[m][0]) m = r;
        if(m===j) break;
        [heap[m],heap[j]] = [heap[j],heap[m]]; j = m;
      }
    }
    return top;
  };

  for(let y=b.y-1; y<=b.y+b.h; y++) for(let x=b.x-1; x<=b.x+b.w; x++){
    if(!inMap(x,y)) continue;
    if(x>=b.x && x<b.x+b.w && y>=b.y && y<b.y+b.h) continue; // intérieur du bâtiment
    const i = y*N+x;
    if(!walkable(i)) continue;
    dist[i] = costOf(i); prev[i] = -1; hpush(dist[i], i);
  }

  let goal = -1;
  while(heap.length){
    const [c,i] = hpop();
    if(c > dist[i]) continue;
    const x = i%N, y = (i/N)|0;
    // Tuile sur le bord de la zone jouable (a au moins un voisin hors masque)
    if(x<=0||y<=0||x>=N-1||y>=N-1||mapMask[i-1]===0||mapMask[i+1]===0||mapMask[i-N]===0||mapMask[i+N]===0){ goal=i; break; }
    for(const [dx,dy] of DIRS){
      const nx = x+dx, ny = y+dy;
      if(!inMap(nx,ny)) continue;
      const ni = ny*N+nx;
      if(!walkable(ni)) continue;
      const nc = c + costOf(ni);
      if(dist[ni]<0 || nc<dist[ni]){ dist[ni] = nc; prev[ni] = i; hpush(nc,ni); }
    }
  }
  if(goal < 0) return null; // enclavé

  // prev pointe vers la maison → suivre depuis le bord donne l'ordre de marche
  const pts = [];
  for(let t=goal; t!==-1; t=prev[t])
    pts.push({ x:(t%N)*TILE+TILE/2, y:((t/N)|0)*TILE+TILE/2 });
  pts.push({ x:(b.x+b.w/2)*TILE, y:(b.y+b.h/2)*TILE });
  return pts;
}

function spawnWalker(b){
  if(walkers.length > 80){ growPop(b); return; }
  const pts = pathToEdge(b);
  if(!pts){ growPop(b); return; } // logement enclavé : arrivée instantanée
  b.pending++;
  walkers.push({ pts, seg:0, t:0, target:b,
                 col: playerColor(b.owner),
                 phase: Math.random()*7 });
}

// n habitants quittent le bâtiment à pied (la population est déjà décomptée)
function spawnLeavers(b, n){
  for(let i=0; i<n && walkers.length<=80; i++){
    const pts = pathToEdge(b);
    if(!pts) return;
    walkers.push({ pts:[...pts].reverse(), seg:0, t:0, target:null, leaving:true,
                   col: playerColor(b.owner),
                   phase: Math.random()*7 });
  }
}

// pénurie : un bâtiment fusionné se sépare en maisons individuelles,
// l'excédent d'habitants quitte la ville
function splitBuilding(b){
  if((b.pop||0) <= (b.protectedPop||0)) return;
  const houseCap = BUILD.house.resid.popCap;
  const houseStockCap = BUILD.house.resid.stockCap;
  const wasSel = selected===b;
  const owner = b.owner ?? null;
  let pop = b.pop;
  let protectedPop = b.protectedPop||0;
  let goodsPool = b.storage.goods||0;
  let breadPool = b.storage.bread||0;
  let fishFilletPool = b.storage.fish_fillet||0;
  const area = b.w * b.h;
  const excess = Math.max(0, pop - area * houseCap);
  b.dead = true;
  buildings.splice(buildings.indexOf(b),1);
  setGrid(b,null);
  pop -= excess;
  const newHouses = [];
  for(let y=b.y; y<b.y+b.h; y++) for(let x=b.x; x<b.x+b.w; x++){
    const h = newBuilding('house',x,y);
    h.owner = owner;
    h.pop = Math.min(houseCap, pop);
    pop -= h.pop;
    h.protectedPop = Math.min(h.pop, protectedPop);
    h.starterHome = h.protectedPop > 0;
    protectedPop -= h.protectedPop;
    h.starve = 0;
    // distribuer marchandises et pain équitablement entre les nouvelles maisons
    const shareG = Math.min(houseStockCap, Math.floor(goodsPool / area));
    const shareB = Math.min(houseStockCap, Math.floor(breadPool / area));
    const shareF = Math.min(houseStockCap, Math.floor(fishFilletPool / area));
    h.storage.goods = shareG;
    h.storage.bread = shareB;
    h.storage.fish_fillet = shareF;
    goodsPool -= shareG;
    breadPool  -= shareB;
    fishFilletPool -= shareF;
    buildings.push(h);
    setGrid(h,h);
    newHouses.push(h);
    if(wasSel && x===b.x && y===b.y) selected = h;
  }
  // donner le reste aux premières maisons
  for(const h of newHouses){
    if(goodsPool <= 0 && breadPool <= 0 && fishFilletPool <= 0) break;
    if(goodsPool > 0){
      const space = houseStockCap - (h.storage.goods||0);
      const give = Math.min(space, goodsPool);
      h.storage.goods += give; goodsPool -= give;
    }
    if(breadPool > 0){
      const space = houseStockCap - (h.storage.bread||0);
      const give = Math.min(space, breadPool);
      h.storage.bread += give; breadPool -= give;
    }
    if(fishFilletPool > 0){
      const space = houseStockCap - (h.storage.fish_fillet||0);
      const give = Math.min(space, fishFilletPool);
      h.storage.fish_fillet += give; fishFilletPool -= give;
    }
  }
  if(excess > 0) spawnLeavers(bgrid[b.y*N+b.x], excess);
  toast('📉 '+BUILD[b.type].n+' sans outils : défusion'
    + (excess>0 ? ', '+excess+" habitants s'en vont" : ''),'err');
  if(excess > 0) addFloat(b.x+(b.w-1)/2, b.y, '−'+excess+' 👤', '#ff9a8a');
  // tenter de remplir les maisons incomplètes avec les sans-abri disponibles
  assignHomelessToHousing(owner);
}

// pénurie d'une maison simple : un habitant part
function leaveOne(b){
  if(b.pop <= (b.protectedPop||0)) return;
  b.pop--;
  addFloat(b.x, b.y-0.5, '−1 👤', '#ff9a8a');
  spawnLeavers(b, 1);
}

function updateWalkers(dt){
  for(let i=walkers.length-1;i>=0;i--){
    const wk = walkers[i];
    let move = WALK_SPEED*TILE*dt;
    while(move>0 && wk.seg < wk.pts.length-1){
      const a = wk.pts[wk.seg], b = wk.pts[wk.seg+1];
      const d = Math.hypot(b.x-a.x, b.y-a.y) || 1;
      const remain = (1-wk.t)*d;
      if(move >= remain){ move -= remain; wk.seg++; wk.t = 0; }
      else { wk.t += move/d; move = 0; }
    }
    if(wk.seg >= wk.pts.length-1){
      if(wk.leaving){ walkers.splice(i,1); continue; } // parti pour de bon
      let tg = wk.target;
      if(tg.dead){
        // bâtiment disparu (fusion ou split) : chercher un logement incomplet proche
        const ox = tg.x, oy = tg.y;
        let best = null, bestPop = Infinity;
        for(const c of buildings){
          if(c.dead || !BUILD[c.type].resid) continue;
          if(c.pop + c.pending >= BUILD[c.type].resid.popCap) continue;
          const d = Math.abs(c.x - ox) + Math.abs(c.y - oy);
          if(d < 4 && c.pop < bestPop){ bestPop = c.pop; best = c; }
        }
        tg = best;
      } else {
        tg.pending--;
        if(wk.protectedResident) tg.pendingProtected = Math.max(0, (tg.pendingProtected||0) - 1);
      }
      if(tg) growPop(tg, wk.protectedResident);
      else if(wk.fromHomeless){
        const exit = randomExitPoint();
        walkers.push({
          pts:[wk.pts[wk.pts.length-1], exit],
          seg:0, t:0, target:null, leaving:true,
          col:wk.col, phase:wk.phase,
        });
      }
      walkers.splice(i,1);
    }
  }
}
