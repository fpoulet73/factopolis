// ======================================================================
// MULTIJOUEUR — couche réseau WebSocket
// ======================================================================

// ---- sérialisation de l'état complet (hôte → invité) ----
function serializeState(){
  return {
    world: WORLD,
    size: N,
    mapBounds,
    expansionLevels,
    purchasedPieces: Array.from(purchasedPieces),
    mapMask: Array.from(mapMask),
    terrain: Array.from(terrain),
    road:    Array.from(road),
    wallets: WALLETS,
    homeless: homeless.map(h=>({ owner:h.owner ?? null, x:h.x, y:h.y, col:h.col, phase:h.phase })),
    gtime,
    paused, speed,
    buildings: buildings.map(b => ({
      type:b.type, x:b.x, y:b.y, w:b.w, h:b.h,
      storage:{...b.storage}, inc:{},
      prog:b.prog||0, trucksOut:b.trucksOut||0,
      pop:b.pop||0, protectedPop:b.protectedPop||0,
      ct:b.ct||0, pending:0, pendingProtected:0, starve:b.starve||0,
      ore:b.ore||null, allow:b.allow||null, sellTo:b.sellTo||null, sellMin:b.sellMin||null, paused:b.paused||false, owner:b.owner||null,
      starterHome:!!b.starterHome, starterSlots:b.starterSlots||0, townId:b.townId??null, name:b.name||null,
    })),
    towns: towns.map(t => ({ id:t.id, name:t.name, cx:t.cx, cy:t.cy })),
    nextTownId,
    vehicles: vehicles.map(v => ({
      id: v.id, vtype: v.vtype,
      garageX: v.garageRef.x, garageY: v.garageRef.y,
      sourceX: v.source && !v.source.dead ? v.source.x : null,
      sourceY: v.source && !v.source.dead ? v.source.y : null,
      destX:   v.dest   && !v.dest.dead   ? v.dest.x   : null,
      destY:   v.dest   && !v.dest.dead   ? v.dest.y   : null,
      state: v.state, cargo: v.cargo, res: v.res || null,
    })),
  };
}

// Relie le nouveau MP.myId aux données d'une session précédente
// Source 1 : prevOwnerId transmis par le serveur (reconnexion dans la même session)
// Source 2 : playerRegistry dans la sauvegarde (redémarrage serveur)
// Diffuse également le remap à l'hôte pour que son état reste cohérent
function remapOwnerId(){
  if(MP.myId == null || !MP.username) return;
  let oldId = MP.prevOwnerId;
  if((oldId == null || oldId === MP.myId) && MP.savedRegistry){
    const fromSave = MP.savedRegistry[MP.username];
    if(fromSave != null) oldId = Number(fromSave);
  }
  if(oldId == null || oldId === MP.myId || !Number.isFinite(Number(oldId))) return;
  oldId = Number(oldId);
  applyOwnerRemap(oldId, MP.myId);
  // Propager le remap à l'hôte et aux autres clients
  if(MP.connected && MP.role !== 'host'){
    netSend({ type:'owner_remap', oldId, newId:MP.myId });
  }
}

function applyOwnerRemap(oldId, newId){
  for(const b of buildings) if(b.owner === oldId) b.owner = newId;
  for(const h of homeless)  if(h.owner === oldId){ h.owner = newId; h.col = playerColor(newId); }
  if(WALLETS[oldId]){
    if(!WALLETS[newId] || (WALLETS[oldId].money||0) >= (WALLETS[newId]?.money||0)){
      WALLETS[newId] = WALLETS[oldId];
    }
    delete WALLETS[oldId];
  }
}

function applySnapshot(d){
  if(d.mapBounds){
    // Format récent : d.size = N_FULL, mapBounds fourni
    WORLD = normalizeWorldConfig(d.world || { ...WORLD, size: d.size });
    setMapSize(d.size || N);
    terrain = Uint8Array.from(d.terrain);
    road    = Uint8Array.from(d.road);
    mapBounds = { ...d.mapBounds };
    expansionLevels = d.expansionLevels || { left:0, right:0, top:0, bottom:0 };
    purchasedPieces = new Set(d.purchasedPieces||[]);
    if(d.mapMask){
      mapMask = Uint8Array.from(d.mapMask);
    } else {
      // Ancienne sauvegarde sans mapMask : reconstruire le masque ET le terrain des marges
      mapMask.fill(0);
      for(let y=mapBounds.y0; y<mapBounds.y1; y++)
        for(let x=mapBounds.x0; x<mapBounds.x1; x++)
          mapMask[y*N+x] = 1;
      generateExpansionTerrain(); // les marges étaient vides (tout herbe)
    }
  } else {
    // Ancien format : d.size = N_PLAY, migration vers la nouvelle structure
    const N_PLAY = d.size || 64;
    const N_FULL_MAP = N_PLAY + 2 * EXP_MARGIN;
    WORLD = normalizeWorldConfig(d.world || { ...WORLD, size: N_PLAY });
    setMapSize(N_FULL_MAP);
    mapBounds = { x0: EXP_MARGIN, y0: EXP_MARGIN, x1: EXP_MARGIN + N_PLAY, y1: EXP_MARGIN + N_PLAY };
    expansionLevels = { left:0, right:0, top:0, bottom:0 };
    purchasedPieces = new Set();
    // Déplacer le terrain dans la grande grille
    const oldTerrain = Uint8Array.from(d.terrain);
    const oldRoad    = Uint8Array.from(d.road);
    terrain = new Uint8Array(N_FULL_MAP * N_FULL_MAP);
    road    = new Uint8Array(N_FULL_MAP * N_FULL_MAP);
    for(let y=0; y<N_PLAY; y++) for(let x=0; x<N_PLAY; x++){
      terrain[(y+EXP_MARGIN)*N_FULL_MAP+(x+EXP_MARGIN)] = oldTerrain[y*N_PLAY+x];
      road   [(y+EXP_MARGIN)*N_FULL_MAP+(x+EXP_MARGIN)] = oldRoad   [y*N_PLAY+x];
    }
    // Décaler toutes les coordonnées de EXP_MARGIN tuiles
    for(const o of d.buildings) { o.x += EXP_MARGIN; o.y += EXP_MARGIN; }
    if(Array.isArray(d.towns)) for(const t of d.towns) { t.cx += EXP_MARGIN; t.cy += EXP_MARGIN; }
    if(Array.isArray(d.vehicles)) for(const v of d.vehicles){
      if(v.garageX != null) v.garageX += EXP_MARGIN;
      if(v.garageY != null) v.garageY += EXP_MARGIN;
      if(v.sourceX != null) v.sourceX += EXP_MARGIN;
      if(v.sourceY != null) v.sourceY += EXP_MARGIN;
      if(v.destX   != null) v.destX   += EXP_MARGIN;
      if(v.destY   != null) v.destY   += EXP_MARGIN;
    }
    if(Array.isArray(d.homeless)) for(const h of d.homeless){
      h.x += EXP_MARGIN * TILE;
      h.y += EXP_MARGIN * TILE;
    }
    // Remplir le masque et générer le terrain des marges (migration : marges = tout herbe)
    mapMask.fill(0);
    for(let y=mapBounds.y0; y<mapBounds.y1; y++)
      for(let x=mapBounds.x0; x<mapBounds.x1; x++)
        mapMask[y*N+x] = 1;
    generateExpansionTerrain();
    // Re-centrer la caméra sur la zone jouable migée
    const pcx = (mapBounds.x0 + mapBounds.x1) / 2;
    const pcy = (mapBounds.y0 + mapBounds.y1) / 2;
    cam.z = 1;
    centerOn(pcx * TILE + TILE/2, pcy * TILE + TILE/2);
  }
  selectedExpansion = null; hoveredExpansion = null;
  // Sauvegarder le registre des joueurs (pour récupération après redémarrage serveur)
  if(d.playerRegistry && typeof d.playerRegistry === 'object') MP.savedRegistry = d.playerRegistry;
  gtime    = d.gtime || 0;
  WALLETS  = {};
  if(d.wallets){ for(const k in d.wallets) WALLETS[k] = d.wallets[k]; }
  paused   = d.paused;  speed   = d.speed||1;
  $('bPause').textContent = paused ? '▶' : '⏸';
  $('bPause').classList.toggle('on', paused);
  document.querySelectorAll('.spd').forEach(b=> b.classList.toggle('on', +b.dataset.s===speed));

  buildings = []; trucks = []; walkers = []; homeless = []; floats = [];
  vehicles = []; vehicleRouteMode = null; nextVehicleId = 0;
  towns = []; nextTownId = 0; selectedTownId = null; townLabelHits = [];
  bgrid = new Array(N*N).fill(null);
  selected = null;

  // Restaurer les villes
  if(Array.isArray(d.towns)){
    towns = d.towns.map(t => ({ id:t.id, name:t.name, cx:t.cx, cy:t.cy }));
    nextTownId = d.nextTownId ?? (towns.reduce((m,t)=>Math.max(m,t.id),-1) + 1);
  }

  for(const o of d.buildings){
    if(!BUILD[o.type]) continue;
    const b = newBuilding(o.type, o.x, o.y, o.w, o.h);
    Object.assign(b, {
      storage:o.storage||{}, inc:{},
      prog:o.prog||0, trucksOut:0,
      pop:o.pop||0, protectedPop:o.protectedPop||0,
      ct:o.ct||0, pending:0, pendingProtected:0, starve:o.starve||0,
    });
    if(o.ore)   b.ore   = o.ore;
    if(o.allow) b.allow = o.allow;
    if(o.sellTo) b.sellTo = o.sellTo;
    if(o.sellMin) b.sellMin = o.sellMin;
    if(o.paused != null) b.paused = o.paused;
    if(o.owner  != null) b.owner  = o.owner;
    if(o.starterHome) b.starterHome = true;
    if(o.starterSlots) b.starterSlots = o.starterSlots;
    if(o.townId != null) b.townId = o.townId;
    if(o.name   != null) b.name   = o.name;
    buildings.push(b);
    setGrid(b,b);
  }
  // Migration : assign townId aux maisons sans village et noms aux industries sans nom
  for(const b of buildings){
    if(BUILD[b.type]?.resid && b.townId == null) assignBuildingToTown(b, true);
    if(BUILD[b.type]?.ind   && !b.name)          assignIndustryName(b);
  }
  ensureSelectedTown();
  for(const k in WALLETS) WALLETS[k].starterHomes = 0;
  for(const b of buildings){
    if(!b.starterHome) continue;
    const w = walletOf(b.owner);
    const slots = b.starterSlots || Math.max(1, b.protectedPop || 0);
    w.starterHomes = Math.min(2, (w.starterHomes||0) + slots);
    w.starterHomesGranted = Math.max(w.starterHomesGranted||0, w.starterHomes);
  }
  ensureAllStarterProtections();
  if(Array.isArray(d.homeless)){
    homeless = d.homeless.map(h=>({
      owner:h.owner ?? null,
      x:h.x, y:h.y,
      col:h.col || playerColor(h.owner),
      phase:h.phase || 0,
    }));
    if(MP.connected && MP.role === 'host' && MP.myId != null) adoptSoloHomeless(MP.myId);
    for(const h of homeless) h.col = playerColor(h.owner);
    for(const h of homeless) walletOf(h.owner).homelessSeeded = true;
  }
  // Restaurer les véhicules persistants
  if(Array.isArray(d.vehicles)){
    for(const sv of d.vehicles){
      if(!VEHICLE_TYPES[sv.vtype]) continue;
      const garage = buildings.find(b=>b.x===sv.garageX && b.y===sv.garageY && b.type==='garage');
      if(!garage) continue;
      const source = sv.sourceX != null ? buildings.find(b=>b.x===sv.sourceX && b.y===sv.sourceY) : null;
      const dest   = sv.destX   != null ? buildings.find(b=>b.x===sv.destX   && b.y===sv.destY)   : null;
      const v = createPersistentVehicle(sv.vtype, garage, sv.id ?? null);
      if(!v) continue;
      v.source = source || null;
      v.dest = dest || null;
      v.cargo = sv.cargo || 0;
      v.res = sv.res || null;
      // Recalculer le chemin si la route était en cours
      if(source && dest && sv.state !== 'idle'){
        const from = sv.state === 'to_dest' ? source : garage;
        const to   = sv.state === 'to_dest' ? dest   : source;
        const pts = findRoadPath(from, to);
        if(pts){ v.pts = pts; v.state = sv.state; }
        // Recompute viz route
        const fwd = findRoadPath(source, dest);
        const bwd = findRoadPath(dest, source);
        v.vizRoute = { fwd: fwd || [], bwd: bwd || [] };
      }
    }
  }
  refreshExpansionSlots();
  remapOwnerId();
}

// ---- patch minimal d'une action entrante ----
function applyAction(msg){
  const { act } = msg;
  switch(act.type){
    case 'road':   road[act.i] = 1; break;
    case 'bulldoze_road': road[act.i] = 0; earnMoney(3, 'rembours', walletOf(msg.from)); break;
    case 'bulldoze_tree': terrain[act.i] = T.GRASS; break;
    case 'terraform': terrain[act.i] = T.GRASS; break;
    case 'bulldoze_bld': {
      const b = bgrid[act.by*N+act.bx];
      if(!b) break;
      // valider le droit de démolition côté receveur aussi
      if(b.owner && b.owner !== msg.from) break;
      demolishBuilding(b, msg.from);
      break;
    }
    case 'build': {
      const cost = BUILD[act.btype].cost||0;
      const wSender = walletOf(msg.from);
      if(msg.fromUsername) wSender.username = msg.fromUsername;
      if(act.btype === 'road'){
        road[act.y*N+act.x] = 1;
        wSender.money -= cost; wSender.fin.construction += cost;
        break;
      }
      const b = newBuilding(act.btype, act.x, act.y);
      b.owner = msg.from;
      markStarterHomeIfNeeded(b);
      assignBuildingToTown(b);
      assignIndustryName(b);
      buildings.push(b); bgrid[act.y*N+act.x] = b;
      wSender.money -= cost; wSender.fin.construction += cost;
      if(BUILD[b.type].resid) assignHomelessToHousing(b.owner);
      break;
    }
    case 'toggle_bld_pause': {
      const b = bgrid[act.y*N+act.x];
      if(!b || !BUILD[b.type]?.ind) break;
      if(b.owner && b.owner !== msg.from) break;
      b.paused = !!act.paused;
      break;
    }
    case 'upgrade_plant': {
      const b = bgrid[act.y*N+act.x];
      if(!b || b.owner !== msg.from) break;
      const targetType = act.targetType;
      const err = plantUpgradeError(b, targetType);
      if(err) break;
      const cost = BUILD[targetType].cost || 0;
      const wSender = walletOf(msg.from);
      wSender.money -= cost;
      wSender.fin.construction = (wSender.fin.construction||0) + cost;
      applyPlantUpgrade(b, targetType);
      break;
    }
    case 'buy_vehicle': {
      if(!VEHICLE_TYPES[act.vtype]) break;
      const garage = buildings.find(b=>b.x===act.garageX && b.y===act.garageY && b.type==='garage');
      if(!garage || garage.owner !== msg.from) break;
      if(vehicles.some(v=>String(v.id) === String(act.id))) break;
      const cost = VEHICLE_TYPES[act.vtype].cost || 0;
      const wSender = walletOf(msg.from);
      wSender.money -= cost;
      wSender.fin.construction = (wSender.fin.construction||0) + cost;
      createPersistentVehicle(act.vtype, garage, act.id);
      break;
    }
    case 'sell_vehicle': {
      const v = vehicles.find(v=>String(v.id) === String(act.id));
      if(!v || v.garageRef?.owner !== msg.from) break;
      const refund = Math.floor((VEHICLE_TYPES[v.vtype]?.cost||0) * 0.5);
      walletOf(msg.from).money += refund;
      walletOf(msg.from).fin.rembours = (walletOf(msg.from).fin.rembours||0) + refund;
      removePersistentVehicle(v);
      break;
    }
    case 'route_vehicle': {
      const v = vehicles.find(v=>String(v.id) === String(act.id));
      if(!v || v.garageRef?.owner !== msg.from) break;
      const source = buildings.find(b=>b.x===act.sourceX && b.y===act.sourceY);
      const dest   = buildings.find(b=>b.x===act.destX   && b.y===act.destY);
      if(!source || !dest) break;
      if(!vehicleRouteEndpointOk(source) || !vehicleRouteEndpointOk(dest)) break;
      v.source = source;
      v.dest = dest;
      startVehicleRoute(v);
      break;
    }
    case 'return_vehicle': {
      const v = vehicles.find(v=>String(v.id) === String(act.id));
      if(!v || v.garageRef?.owner !== msg.from) break;
      returnToGarage(v);
      break;
    }
    case 'owner_remap':
      applyOwnerRemap(act.oldId, act.newId);
      break;
    case 'pause': togglePause(); break;
    case 'speed': {
      speed = act.s; paused = false;
      document.querySelectorAll('.spd').forEach(b=> b.classList.toggle('on', +b.dataset.s===act.s));
      if($('bPause').textContent==='▶'){ paused=false; $('bPause').textContent='⏸'; $('bPause').classList.remove('on'); }
      break;
    }
    default: break;
  }
}

// ---- envoi d'une action au réseau ----
function netSend(act){
  if(!MP.ws || !MP.connected) return;
  MP.ws.send(JSON.stringify({ type:'action', act }));
}

// ---- connection ----
function mpConnect(url){
  if(MP.ws){ MP.ws.close(); }
  const ws = new WebSocket(url);
  MP.ws = ws;

  ws.onopen = () => {
    MP.connected = true;
    MP.shutdownNotice = false;
    MP.shutdownMessage = '';
    toast('🌐 Connecté au serveur multijoueur');
    mpUpdateUI();
    // tentative de reprise de session via token stocké
    const saved = localStorage.getItem('fp_token');
    if(saved) ws.send(JSON.stringify({ type:'resume', token:saved }));
  };

  ws.onclose = () => {
    const stopped = MP.shutdownNotice;
    MP.connected = false;
    MP.role = null;
    MP.isAdmin = false;
    MP.players = [];
    MP.cursors = {};
    MP.username = null;
    MP.token = null;
    MP.saves = [];
    MP.shutdownNotice = false;
    const closeMsg = MP.shutdownMessage || 'Serveur arrêté';
    MP.shutdownMessage = '';
    toast(stopped ? '🔌 '+closeMsg : '🔌 Déconnecté du serveur','err');
    mpUpdateUI();
    mpRenderPlayerList();
  };

  ws.onerror = () => {
    toast('⚠️ Erreur de connexion','err');
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    switch(msg.type){
      case 'hello':
        MP.myId    = msg.id;
        MP.myColor = msg.color;
        MP.myName  = msg.name;
        MP.role    = msg.role;
        MP.isAdmin = !!msg.isAdmin;
        if(msg.worldConfig) WORLD = normalizeWorldConfig(msg.worldConfig);
        adoptSoloHomeless(MP.myId);
        ensureHomelessForOwner(MP.myId);
        resetSelectedTown();
        toast((msg.role==='host' ? '👑 Tu es l\'hôte' : '👥 Tu as rejoint la partie')+' (#'+msg.id+')');
        mpUpdateUI();
        break;

      case 'promoted_host':
        MP.role = 'host';
        MP.isAdmin = false;
        if(msg.worldConfig) WORLD = normalizeWorldConfig(msg.worldConfig);
        toast('👑 Tu es maintenant l\'hôte de la partie');
        mpUpdateUI();
        break;

      case 'admin_promoted':
        MP.isAdmin = true;
        toast('🛡️ Tu es maintenant administrateur');
        mpUpdateUI();
        break;

      case 'admin_changed':
        if(msg.playerId === MP.myId) MP.isAdmin = !!msg.isAdmin;
        toast('🛡️ Un joueur a été promu administrateur');
        mpUpdateUI();
        break;

      case 'snapshot_request':
        // l'hôte envoie l'état complet à un invité
        if(MP.role === 'host'){
          MP.ws.send(JSON.stringify({
            type:'snapshot', forId: msg.forId,
            state: serializeState(),
          }));
        }
        break;

      case 'snapshot':
        // l'invité reçoit l'état initial
        applySnapshot(msg.state);
        resetSelectedTown();
        toast('📥 Carte synchronisée');
        break;

      case 'action':
        // recevoir une action d'un autre joueur
        applyAction(msg);
        break;

      case 'cursor':
        if(msg.from !== MP.myId)
          MP.cursors[msg.from] = { tx:msg.tx, ty:msg.ty,
            color: (MP.players.find(p=>p.id===msg.from)||{}).color || '#fff',
            name:  (MP.players.find(p=>p.id===msg.from)||{}).name  || '?',
            ts: Date.now() };
        break;

      case 'chat': {
        const entry = { name:msg.name, text:msg.text, col:(MP.players.find(p=>p.id===msg.from)||{}).color||'#fff' };
        MP.chat.push(entry);
        if(MP.chat.length > 30) MP.chat.shift();
        mpRenderChat();
        toast('💬 '+msg.name+': '+msg.text);
        break;
      }

      case 'player_list': {
        MP.players = msg.players;
        MP.isAdmin = !!(MP.players.find(p=>p.id===MP.myId)||{}).isAdmin;
        for(const p of MP.players) ensureHomelessForOwner(p.id);
        // Synchroniser la couleur du joueur local si elle a changé (après auth)
        const myEntry = MP.players.find(p=>p.id===MP.myId);
        if(myEntry && myEntry.color !== MP.myColor){ MP.myColor = myEntry.color; }
        for(const h of homeless) h.col = playerColor(h.owner);
        for(const p of MP.players) assignHomelessToHousing(p.id);
        ensureSelectedTown();
        mpUpdateUI();
        mpRenderPlayerList();
        // mettre à jour les couleurs des curseurs
        for(const p of MP.players)
          if(MP.cursors[p.id]) MP.cursors[p.id].color = p.color;
        break;
      }

      case 'player_left':
        delete MP.cursors[msg.id];
        if(msg.id !== MP.myId){
          const leaverName = msg.username || msg.name || ('Joueur #'+msg.id);
          toast('👤 '+leaverName+' a quitté la partie');
        }
        mpRenderPlayerList();
        break;

      case 'auth_ok':
        MP.username = msg.username;
        MP.token    = msg.token;
        MP.myColor  = msg.color;
        MP.myName   = msg.username;
        MP.prevOwnerId = null;
        // Stocker l'ancien id de connexion fourni par le serveur pour le remappage
        if(msg.prevOwnerId != null && msg.prevOwnerId !== MP.myId) MP.prevOwnerId = msg.prevOwnerId;
        // Fallback : chercher dans le registry sauvegardé (cas redémarrage serveur)
        if(!MP.prevOwnerId && MP.savedRegistry){
          const fromSave = MP.savedRegistry[msg.username];
          if(fromSave != null && Number(fromSave) !== MP.myId) MP.prevOwnerId = Number(fromSave);
        }
        for(const h of homeless) if(h.owner === MP.myId) h.col = msg.color;
        localStorage.setItem('fp_token', msg.token);
        $('mpAuthPwd').value = '';
        mpShowAuthError('');
        toast('👤 Connecté en tant que ' + msg.username);
        // Relier l'ancien id aux données déjà chargées (si snapshot déjà arrivé)
        remapOwnerId();
        resetSelectedTown();
        mpUpdateUI();
        // récupérer la liste des sauvegardes
        MP.ws.send(JSON.stringify({ type:'list_saves', token:MP.token }));
        break;

      case 'logout_ok':
        MP.username = null;
        MP.token = null;
        MP.saves = [];
        MP.myName = msg.name || 'Moi';
        MP.myColor = msg.color || MP.myColor;
        localStorage.removeItem('fp_token');
        $('mpAuthPwd').value = '';
        mpShowAuthError('');
        toast('Compte déconnecté');
        mpUpdateUI();
        mpRenderSaves();
        break;

      case 'auth_err':
        mpShowAuthError(msg.msg);
        break;

      case 'saves_list':
        MP.saves = msg.saves || [];
        mpRenderSaves();
        renderAutoSaves();
        break;

      case 'save_ok':
        toast('💾 Sauvegarde "'+msg.name+'" enregistrée');
        $('mpSaveName').value = '';
        break;

      case 'save_err':
        toast('💾 ' + msg.msg, 'err');
        break;

      case 'permission_err':
        toast('⛔ ' + msg.msg, 'err');
        break;

      case 'save_deleted':
        toast('🗑️ Sauvegarde supprimée');
        break;

      case 'game_saved':
        if(msg.savedBy !== MP.username)
          toast('💾 '+msg.savedBy+' a sauvegardé la partie : "'+msg.name+'"');
        break;

      case 'game_loaded':
        applySnapshot(msg.state);
        resetSelectedTown();
        toast('📂 Partie "'+msg.name+'" chargée par '+msg.loadedBy);
        break;

      case 'game_new_world':
        applySnapshot(msg.state);
        if(msg.config) WORLD = normalizeWorldConfig(msg.config);
        resetSelectedTown();
        toast('🌍 Nouvelle carte créée par '+msg.createdBy);
        mpUpdateUI();
        break;

      case 'server_full':
        toast('⛔ '+msg.msg, 'err');
        break;

      case 'server_shutdown':
        MP.shutdownNotice = true;
        MP.shutdownMessage = msg.msg || 'Serveur arrêté';
        if(MP.ws) MP.ws.close();
        break;

      case 'server_cmd':
        if(msg.cmd === 'regen_expansions'){
          generateExpansionTerrain();
          refreshExpansionSlots();
          toast('🌍 Terrain des zones d\'expansion régénéré par le serveur.', 'win');
        } else if(msg.cmd === 'set_money'){
          const amount = Math.round(Number(msg.amount));
          if(Number.isFinite(amount)){
            myWallet().money = amount;
            toast('💰 Solde fixé à '+amount.toLocaleString()+' $ par le serveur.', 'win');
          }
        }
        break;
    }
  };
}

function mpDisconnect(){
  if(MP.ws){ MP.ws.close(); MP.ws = null; }
  MP.connected = false;
  MP.role = null;
  MP.isAdmin = false;
  MP.username = null;
  MP.token = null;
  MP.saves = [];
  mpUpdateUI();
}

function mpLogoutAccount(){
  localStorage.removeItem('fp_token');
  MP.username = null;
  MP.token = null;
  MP.saves = [];
  if(MP.ws && MP.connected) MP.ws.send(JSON.stringify({ type:'logout' }));
  mpShowAuthError('');
  $('mpAuthUser').value = '';
  $('mpAuthPwd').value = '';
  mpUpdateUI();
  mpRenderSaves();
}

// ---- interception des clics (via clickFn défini plus haut) ----
clickFn = function(x,y){
  // Zones d'expansion cliquables quel que soit l'outil ou le contexte réseau
  if(!inMap(x,y)){
    const exp = expansions.find(e=>e.inPiece(x,y));
    if(exp){ selectedExpansion = exp; selected = null; selectedVehicle = null; hudTimer = 0; }
    return;
  }
  const i = y*N+x;
  if(tool==='select'){ clickAt(x,y); return; }
  if(!MP.connected){
    toast('🌐 Connecte-toi au serveur multijoueur pour construire','err');
    return;
  }

  if(tool==='bulldoze'){
    if(bgrid[i]){
      // ne pas envoyer l'action si le bâtiment appartient à quelqu'un d'autre
      if(bgrid[i].owner && bgrid[i].owner !== MP.myId){ clickAt(x,y); return; }
      netSend({ type:'bulldoze_bld', bx:bgrid[i].x, by:bgrid[i].y });
    } else if(road[i]){
      netSend({ type:'bulldoze_road', i });
    } else if(terrain[i]===T.TREE || terrain[i]===T.WHEAT){
      netSend({ type:'bulldoze_tree', i });
    }
    clickAt(x,y);
    return;
  }
  if(tool==='terraform'){
    const ter = terrain[i];
    if(!bgrid[i] && (ter===T.TREE || ter===T.WHEAT || ter===T.IRON || ter===T.COAL)){
      netSend({ type:'terraform', i });
      clickAt(x,y);
    }
    return;
  }
  const v = canPlace(tool,x,y);
  if(!v.ok){ clickAt(x,y); return; }
  if((BUILD[tool].cost||0) > myWallet().money){ clickAt(x,y); return; }
  netSend({ type:'build', btype:tool, x, y });
  clickAt(x,y);
};

// ---- envoi du curseur réseau (ajouté à mousemove existant) ----
let _lastCursorTx = -1, _lastCursorTy = -1;
addEventListener('mousemove', () => {
  if(!MP.connected) return;
  if(mouse.tx !== _lastCursorTx || mouse.ty !== _lastCursorTy){
    _lastCursorTx = mouse.tx; _lastCursorTy = mouse.ty;
    MP.ws.send(JSON.stringify({ type:'cursor', tx:mouse.tx, ty:mouse.ty }));
  }
});

// ---- interception pause / speed pour diffusion réseau ----
$('bPause').onclick = ()=>{ togglePause(); if(MP.connected) netSend({ type:'pause' }); };

document.querySelectorAll('.spd').forEach(b=>{
  b.onclick = ()=>{
    speed = +b.dataset.s;
    document.querySelectorAll('.spd').forEach(x=> x.classList.toggle('on', x===b));
    if(paused){ paused=false; $('bPause').textContent='⏸'; $('bPause').classList.remove('on'); }
    if(MP.connected) netSend({ type:'speed', s:speed });
  };
});

// ---- rendu des curseurs (via drawFn défini plus haut) ----
drawFn = function(){
  draw();
  if(!MP.connected) return;
  const now = Date.now();
  ctx.setTransform(DPR*cam.z, 0, 0, DPR*cam.z, -cam.x*DPR*cam.z, -cam.y*DPR*cam.z);
  for(const cid in MP.cursors){
    const c = MP.cursors[cid];
    if(now - c.ts > 5000) continue;
    const [rx,ry] = rotIdx(c.tx, c.ty);
    const pt = iso(rx+0.5, ry+0.5);
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = c.color; ctx.lineWidth = 2;
    diamond(rx, ry, 1, 1); ctx.stroke();
    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = c.color; ctx.textAlign = 'center';
    ctx.fillText(c.name, pt[0], pt[1] - TH*0.7);
    ctx.restore();
  }
};

// ---- interface multijoueur ----
const INP = 'width:100%;box-sizing:border-box;background:#16202f;border:1px solid #36465e;'+
            'color:#e8eef7;border-radius:6px;padding:5px 8px;font-size:12px;margin-bottom:5px';
const INP2 = INP.replace('margin-bottom:5px','');
let mpNewCollapsed = true;

function mpInjectUI(){
  // bouton dans le topbar
  const sep = document.createElement('span'); sep.className = 'sep';
  const btn = document.createElement('button');
  btn.className = 'tbtn'; btn.id = 'bMP';
  btn.textContent = '🌐 Multijoueur'; btn.onclick = mpTogglePanel;
  $('topbar').appendChild(sep); $('topbar').appendChild(btn);

  // panneau principal (scrollable, assez haut)
  const panel = document.createElement('div');
  panel.id = 'mpPanel'; panel.className = 'panel';
  panel.style.cssText =
    'top:70px;left:12px;width:280px;max-height:calc(100vh - 90px);'+
    'overflow-y:auto;padding:12px 14px;font-size:13px;display:none;z-index:20';

  panel.innerHTML = `
<h3 style="margin:0 0 8px;font-size:15px">🌐 Multijoueur</h3>

<!-- connexion au serveur -->
<div id="mpConnBlock">
  <input id="mpUrl" type="text" placeholder="ws://localhost:8765"
    value="ws://${location.hostname}:8765" style="${INP}">
  <div style="display:flex;gap:6px">
    <button class="tbtn" id="mpBtnConn" style="flex:1">Connexion</button>
    <button class="tbtn" id="mpBtnDisc" style="flex:1;display:none">Déconnecter</button>
  </div>
</div>

<div id="mpStatus" style="color:#8fa3bf;font-style:italic;margin:6px 0">Non connecté</div>

<!-- auth (visible quand connecté mais non authentifié) -->
<div id="mpAuthBlock" style="display:none">
  <div style="color:#8fa3bf;font-size:11px;margin-bottom:4px">Compte joueur</div>
  <input id="mpAuthUser" type="text"     placeholder="Nom d'utilisateur" style="${INP}">
  <input id="mpAuthPwd"  type="password" placeholder="Mot de passe"      style="${INP}">
  <div id="mpAuthErr" style="color:#ff9a8a;font-size:11px;min-height:14px;margin-bottom:4px"></div>
  <div style="display:flex;gap:6px">
    <button class="tbtn" id="mpBtnLogin"    style="flex:1">Connexion</button>
    <button class="tbtn" id="mpBtnRegister" style="flex:1">Créer compte</button>
  </div>
</div>

<div id="mpAccountBlock" style="display:none">
  <div style="display:flex;gap:6px;align-items:center">
    <span id="mpAccountName" style="flex:1;color:#8fa3bf;font-size:11px"></span>
    <button class="tbtn" id="mpBtnSwitchAccount" style="padding:2px 8px;font-size:11px">Changer compte</button>
  </div>
</div>

<!-- section saves (visible quand authentifié) -->
<div id="mpNewBlock" style="display:none">
  <div style="border-top:1px solid #36465e;margin:8px 0"></div>
  <button class="tbtn" id="mpBtnNewToggle" style="width:100%;display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
    <span>🌍 Nouvelle carte</span><span id="mpNewChevron">▸</span>
  </button>
  <div id="mpNewContent" style="display:none">
    <label style="display:block;color:#8fa3bf;font-size:11px">Taille de carte</label>
    <input id="mpWorldSize" type="number" min="32" max="128" step="8" style="${INP}">
    <label style="display:block;color:#8fa3bf;font-size:11px">Joueurs max</label>
    <input id="mpMaxPlayers" type="number" min="1" max="32" step="1" style="${INP}">
    <label style="display:block;color:#8fa3bf;font-size:11px">Arbres / bois (%)</label>
    <input id="mpResTree" type="number" min="0" max="40" step="0.5" style="${INP}">
    <label style="display:block;color:#8fa3bf;font-size:11px">Champs de blé (%)</label>
    <input id="mpResWheat" type="number" min="0" max="40" step="0.5" style="${INP}">
    <label style="display:block;color:#8fa3bf;font-size:11px">Fer (%)</label>
    <input id="mpResIron" type="number" min="0" max="40" step="0.5" style="${INP}">
    <label style="display:block;color:#8fa3bf;font-size:11px">Charbon (%)</label>
    <input id="mpResCoal" type="number" min="0" max="40" step="0.5" style="${INP}">
    <button class="tbtn" id="mpBtnNewWorld" style="width:100%">Créer la carte</button>
    <div id="mpWorldErr" style="color:#ff9a8a;font-size:11px;min-height:14px;margin-top:4px"></div>
  </div>
</div>

<div id="mpSaveBlock" style="display:none">
  <div style="border-top:1px solid #36465e;margin:8px 0"></div>
  <div style="color:#8fa3bf;font-size:11px;margin-bottom:4px">💾 Sauvegardes <span id="mpSaveLock"></span></div>
  <div style="display:flex;gap:5px;margin-bottom:5px">
    <input id="mpSaveName" type="text" placeholder="Nom de la sauvegarde"
      style="${INP2};flex:1;margin:0">
    <button class="tbtn" id="mpBtnSave" title="Sauvegarder">💾</button>
  </div>
  <div id="mpSaveList" style="max-height:130px;overflow-y:auto;margin-bottom:4px"></div>
  <div id="mpSaveErr" style="color:#ff9a8a;font-size:11px;min-height:14px"></div>
</div>

<!-- joueurs connectés -->
<div style="border-top:1px solid #36465e;margin:8px 0"></div>
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
  <div style="color:#8fa3bf;font-size:11px">🔄 Sauvegardes auto</div>
  <span id="autoSaveCountdown" style="color:#6e8aa0;font-size:10px"></span>
</div>
<div id="autoSaveList" style="max-height:130px;overflow-y:auto;margin-bottom:4px"></div>

<div style="border-top:1px solid #36465e;margin:8px 0"></div>
<div style="color:#8fa3bf;font-size:11px;margin-bottom:4px">👥 Joueurs</div>
<div id="mpPlayers" style="margin-bottom:6px"></div>

<!-- chat -->
<div style="border-top:1px solid #36465e;margin:8px 0"></div>
<div id="mpChatBox" style="max-height:100px;overflow-y:auto;margin-bottom:5px;
     background:#16202f;border-radius:6px;padding:6px;font-size:11px"></div>
<div style="display:flex;gap:4px">
  <input id="mpChatIn" type="text" placeholder="Message…"
    style="flex:1;${INP2}">
  <button class="tbtn" id="mpBtnSend">↵</button>
</div>`;

  document.body.appendChild(panel);

  // --- événements ---
  $('mpBtnConn').onclick = ()=> mpConnect($('mpUrl').value.trim() || 'ws://localhost:8765');
  $('mpBtnDisc').onclick = mpDisconnect;
  $('mpBtnSwitchAccount').onclick = mpLogoutAccount;
  $('mpBtnNewToggle').onclick = ()=>{
    mpNewCollapsed = !mpNewCollapsed;
    mpRenderNewCollapse();
  };

  $('mpBtnLogin').onclick = ()=>{
    const u = $('mpAuthUser').value.trim(), p = $('mpAuthPwd').value;
    if(!u||!p){ mpShowAuthError('Remplis les deux champs'); return; }
    MP.ws.send(JSON.stringify({ type:'login', username:u, password:p }));
  };
  $('mpBtnRegister').onclick = ()=>{
    const u = $('mpAuthUser').value.trim(), p = $('mpAuthPwd').value;
    if(!u||!p){ mpShowAuthError('Remplis les deux champs'); return; }
    MP.ws.send(JSON.stringify({ type:'register', username:u, password:p }));
  };
  $('mpAuthPwd').addEventListener('keydown', e=>{
    if(e.key==='Enter') $('mpBtnLogin').click();
  });

  $('mpBtnSave').onclick = ()=>{
    if(!mpHasAdminRights()){ $('mpSaveErr').textContent = 'Réservé à l’hôte/admin'; return; }
    const name = $('mpSaveName').value.trim();
    if(!name){ $('mpSaveErr').textContent = 'Entre un nom'; return; }
    if(!MP.token){ $('mpSaveErr').textContent = 'Non authentifié'; return; }
    $('mpSaveErr').textContent = '';
    MP.ws.send(JSON.stringify({ type:'save_game', token:MP.token, name, state:serializeState() }));
  };
  $('mpSaveName').addEventListener('keydown', e=>{ if(e.key==='Enter') $('mpBtnSave').click(); });

  $('mpBtnNewWorld').onclick = ()=>{
    if(!mpHasAdminRights()){ $('mpWorldErr').textContent = 'Réservé à l’hôte/admin'; return; }
    if(!confirm('Créer une nouvelle carte ? La partie en cours sera remplacée pour tous les joueurs.')) return;
    const config = normalizeWorldConfig({
      size: $('mpWorldSize').value,
      maxPlayers: $('mpMaxPlayers').value,
      resources: {
        tree: $('mpResTree').value,
        wheat: $('mpResWheat').value,
        iron: $('mpResIron').value,
        coal: $('mpResCoal').value,
      },
    });
    genWorld(config);
    MP.ws.send(JSON.stringify({ type:'new_world', config, state:serializeState() }));
    $('mpWorldErr').textContent = '';
  };

  $('mpBtnSend').onclick = mpSendChat;
  $('mpChatIn').addEventListener('keydown', e=>{ if(e.key==='Enter') mpSendChat(); });
}

function mpTogglePanel(){
  const p = $('mpPanel');
  p.style.display = p.style.display==='block' ? 'none' : 'block';
  if(p.style.display === 'block') mpSyncWorldInputs();
}

function mpUpdateUI(){
  const conn = $('mpBtnConn'), disc = $('mpBtnDisc'), st = $('mpStatus');
  if(!conn) return;

  if(MP.connected){
    conn.style.display  = 'none';
    disc.style.display  = '';
    $('mpAuthBlock').style.display = MP.username ? 'none' : '';
    $('mpAccountBlock').style.display = MP.username ? '' : 'none';
    $('mpSaveBlock').style.display = MP.username ? '' : 'none';
    $('mpNewBlock').style.display = mpHasAdminRights() ? '' : 'none';
    $('mpBtnSave').disabled = !mpHasAdminRights();
    $('mpSaveLock').textContent = mpHasAdminRights() ? '' : '(hôte/admin)';
    if(MP.username){
      st.textContent = (MP.role==='host'?'👑 ':MP.isAdmin?'🛡️ ':'👥 ')+MP.username;
      st.style.color = MP.myColor;
      $('mpAccountName').textContent = 'Compte: ' + MP.username;
    } else {
      st.textContent = (MP.role==='host'?'👑 Hôte':MP.isAdmin?'🛡️ Admin':'👥 Invité')+' · non identifié';
      st.style.color = '#8fa3bf';
    }
  } else {
    conn.style.display = '';
    disc.style.display = 'none';
    $('mpAuthBlock').style.display = 'none';
    $('mpAccountBlock').style.display = 'none';
    $('mpSaveBlock').style.display = 'none';
    $('mpNewBlock').style.display = 'none';
    st.textContent = 'Non connecté';
    st.style.color = '#8fa3bf';
  }
  mpSyncWorldInputs();
  mpRenderNewCollapse();
  renderAutoSaves();
}

function mpRenderNewCollapse(){
  const body = $('mpNewContent'), chev = $('mpNewChevron');
  if(!body || !chev) return;
  body.style.display = mpNewCollapsed ? 'none' : '';
  chev.textContent = mpNewCollapsed ? '▸' : '▾';
}

function mpSyncWorldInputs(){
  if(!$('mpWorldSize')) return;
  $('mpWorldSize').value = WORLD.size;
  $('mpMaxPlayers').value = WORLD.maxPlayers;
  $('mpResTree').value = WORLD.resources.tree;
  $('mpResWheat').value = WORLD.resources.wheat;
  $('mpResIron').value = WORLD.resources.iron;
  $('mpResCoal').value = WORLD.resources.coal;
}

function mpShowAuthError(msg){
  const el = $('mpAuthErr');
  if(el) el.textContent = msg;
}

function mpRenderPlayerList(){
  const el = $('mpPlayers');
  if(!el) return;
  el.innerHTML = MP.players.map(p=>
    '<div style="display:flex;align-items:center;gap:6px;margin:2px 0">'
    + '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:'+p.color+'"></span>'
    + '<span style="color:'+p.color+';flex:1">'+(p.isHost?'👑 ':p.isAdmin?'🛡️ ':'')
    + escHtml(p.name) + (p.username ? ' <span style="color:#8fa3bf;font-size:10px">('+escHtml(p.username)+')</span>' : '')
    + '</span>'
    + (mpHasAdminRights() && !p.isHost && !p.isAdmin && p.id !== MP.myId
      ? '<button class="tbtn" style="padding:1px 6px;font-size:11px" data-promote="'+p.id+'">Admin</button>' : '')
    + '</div>'
  ).join('');
  el.querySelectorAll('[data-promote]').forEach(btn=>{
    btn.onclick = ()=>{
      MP.ws.send(JSON.stringify({ type:'promote_admin', playerId:+btn.dataset.promote }));
    };
  });
}

function mpRenderSaves(){
  const el = $('mpSaveList');
  if(!el) return;
  const saves = MP.saves.filter(s => !/^[\[_]Auto[\]_ ]/i.test(s.name));
  if(!saves.length){
    el.innerHTML = '<div style="color:#8fa3bf;font-size:11px;font-style:italic">Aucune sauvegarde</div>';
    return;
  }
  el.innerHTML = saves.map(s=>{
    const d = new Date(s.date);
    const dateStr = d.toLocaleDateString('fr-FR')+' '+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    return '<div style="display:flex;align-items:center;gap:4px;margin:2px 0;padding:3px 4px;'+
           'background:#1d2939;border-radius:5px">'
      + '<span style="flex:1;font-size:12px">📄 '+escHtml(s.name)+'</span>'
      + '<span style="color:#8fa3bf;font-size:10px;white-space:nowrap">'+escHtml(dateStr)+'</span>'
      + '<button class="tbtn" style="padding:1px 6px;font-size:11px" title="Écraser cette sauvegarde" data-overwrite="'+escHtml(s.name)+'"'
      + (mpHasAdminRights() ? '' : ' disabled') + '>💾</button>'
      + '<button class="tbtn" style="padding:1px 6px;font-size:11px" data-load="'+escHtml(s.name)+'"'
      + (mpHasAdminRights() ? '' : ' disabled') + '>▶</button>'
      + '<button class="tbtn" style="padding:1px 6px;font-size:11px;color:#ff9a8a" data-del="'+escHtml(s.name)+'"'
      + (mpHasAdminRights() ? '' : ' disabled') + '>✕</button>'
      + '</div>';
  }).join('');

  el.querySelectorAll('[data-overwrite]').forEach(btn=>{
    btn.onclick = ()=>{
      if(!mpHasAdminRights()) return;
      const name = btn.dataset.overwrite;
      if(!confirm('Écraser la sauvegarde "'+name+'" avec la partie en cours ?')) return;
      MP.ws.send(JSON.stringify({ type:'save_game', token:MP.token, name, state:serializeState() }));
    };
  });

  el.querySelectorAll('[data-load]').forEach(btn=>{
    btn.onclick = ()=>{
      if(!mpHasAdminRights()) return;
      if(!confirm('Charger "'+btn.dataset.load+'" ? La partie en cours sera remplacée pour tous les joueurs.')) return;
      MP.ws.send(JSON.stringify({ type:'load_game', token:MP.token, name:btn.dataset.load }));
    };
  });
  el.querySelectorAll('[data-del]').forEach(btn=>{
    btn.onclick = ()=>{
      if(!mpHasAdminRights()) return;
      if(!confirm('Supprimer "'+btn.dataset.del+'" ?')) return;
      MP.ws.send(JSON.stringify({ type:'delete_save', token:MP.token, name:btn.dataset.del }));
    };
  });
}
