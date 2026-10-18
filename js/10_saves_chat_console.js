// ---------- compression des grilles pour le stockage ----------
// Une carte 224×224 sérialisée « à plat » pèse ~1 Mo par sauvegarde : c'est trop lourd à stocker et à
// transmettre. Les grilles sont très
// uniformes (herbe, eau…) : un codage par plages (valeur, longueur) les réduit
// d'un ou deux ordres de grandeur.
const SAVE_GRID_KEYS = ['terrain', 'terrainHeightMap', 'waterHeightMap', 'road', 'rail', 'railOwner', 'railTunnel', 'mapMask'];
function rleEncode(arr){
  const out = [];
  for(let i = 0; i < arr.length;){
    const v = arr[i];
    let n = 1;
    while(i + n < arr.length && arr[i + n] === v) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}
function rleDecode(rle){
  let total = 0;
  for(let i = 1; i < rle.length; i += 2) total += rle[i];
  const out = new Array(total);
  let p = 0;
  for(let i = 0; i < rle.length; i += 2){
    const v = rle[i], n = rle[i + 1];
    for(let k = 0; k < n; k++) out[p++] = v;
  }
  return out;
}
// Bâtiments : on omet les champs vides ou par défaut (null, false, 0, {}) que
// applySnapshot restaure de toute façon, et on arrondit les flottants. Les 0
// porteurs de sens (coordonnées, village n°0…) sont conservés. ~×4 plus léger.
const SAVE_KEEP_ZERO = new Set(['x', 'y', 'w', 'h', 'townId', 'stationGroupId', 'owner']);
const roundSave = v => Math.round(v * 1e4) / 1e4;
// champs dont la présence conditionne la restauration des passagers (applySnapshot)
const transitGateKey = (type, k) => (k === 'passengers' && type === 'bus_stop')
  || (k === 'passengersEntrant' && (type === 'train_station' || type === 'boat_depot' || type === 'air_terminal'));
function compactBuildingForStorage(o){
  const out = {};
  for(const k in o){
    let v = o[k];
    if(v == null || v === false || v === '') continue;
    if(v === 0 && !SAVE_KEEP_ZERO.has(k) && !transitGateKey(o.type, k)) continue;
    if(typeof v === 'number') v = roundSave(v);
    else if(typeof v === 'object' && !Array.isArray(v)){
      const keys = Object.keys(v);
      if(!keys.length) continue;
      let copy = null;
      for(const kk of keys){
        const x = v[kk];
        if(typeof x === 'number' && x !== roundSave(x)){ copy = copy || { ...v }; copy[kk] = roundSave(x); }
      }
      if(copy) v = copy;
    }
    out[k] = v;
  }
  return out;
}
function packStateForStorage(state){
  if(!state || state._rle) return state;
  const out = Object.assign({}, state, { _rle: [] });
  for(const k of SAVE_GRID_KEYS){
    if(Array.isArray(state[k])){ out[k] = rleEncode(state[k]); out._rle.push(k); }
  }
  if(Array.isArray(state.buildings)) out.buildings = state.buildings.map(compactBuildingForStorage);
  return out;
}
function unpackStateFromStorage(state){
  if(!state || !Array.isArray(state._rle)) return state;
  const out = Object.assign({}, state);
  for(const k of state._rle) if(Array.isArray(state[k])) out[k] = rleDecode(state[k]);
  delete out._rle;
  return out;
}

// ---------- sauvegarde automatique ----------
// Les sauvegardes auto vivent côté serveur (par room, partagées) : seul l'hôte ou
// un admin les écrit, le navigateur d'un joueur pouvant changer d'une session à l'autre.
function autoSaveServerName(slot){
  const room = MP.roomName || 'Monde';
  return '[Auto] ' + room + ' ' + slot;
}
function autoSaveServerPattern(){
  const room = MP.roomName || 'Monde';
  return new RegExp('^\\[Auto\\] ' + room.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\d+$', 'i');
}

function performAutoSave(){
  if(!buildings.length) return; // monde non initialisé
  if(!(mpInRoom() && mpHasAdminRights() && MP.token)) return; // un autre client hôte s'en charge
  const state = serializeState();
  const saves = (MP.saves || []).filter(s => autoSaveServerPattern().test(s.name))
    .sort((a,b) => new Date(a.date) - new Date(b.date)); // ancienne → récente
  const slotOf = s => +(/ (\d+)$/.exec(s.name)||[])[1] || 0;
  const lastSlot = saves.length > 0 ? slotOf(saves[saves.length - 1]) : 0;
  const nextSlot = (lastSlot % AUTO_SAVE_MAX) + 1;
  const name = autoSaveServerName(nextSlot);
  MP.ws.send(JSON.stringify({ type: 'save_game', token: MP.token, name, state: packStateForStorage(state) }));
  // MAJ optimiste : MP.saves n'est rafraîchi qu'à l'auth, sinon la rotation
  // se figerait sur une liste périmée et réécrirait toujours le même slot.
  MP.saves = (MP.saves || []).filter(s => s.name !== name);
  MP.saves.push({ name, date: new Date().toISOString() });
  // resynchronisation depuis le serveur (source de vérité)
  MP.ws.send(JSON.stringify({ type: 'list_saves', token: MP.token }));
  renderAutoSaves();
  toast('💾 Sauvegarde auto serveur — emplacement '+nextSlot+'/'+AUTO_SAVE_MAX);
}

function renderAutoSaves(){
  const el = $('autoSaveList');
  if(!el) return;
  const serverAutoSaves = (MP.saves || []).filter(s => autoSaveServerPattern().test(s.name))
    .sort((a,b) => new Date(b.date) - new Date(a.date));

  if(!serverAutoSaves.length){
    el.innerHTML = '<div style="color:#8fa3bf;font-size:11px;font-style:italic">Aucune sauvegarde auto</div>';
    return;
  }

  el.innerHTML = serverAutoSaves.map(s => {
    const d = new Date(s.date);
    const dateStr = d.toLocaleDateString('fr-FR')+' '
      + d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    return '<div style="display:flex;align-items:center;gap:4px;margin:2px 0;padding:3px 4px;'
      + 'background:#1d2939;border-radius:5px">'
      + '<span style="flex:1;font-size:12px">🌐 '+escHtml(s.name)+'</span>'
      + '<span style="color:#8fa3bf;font-size:10px;white-space:nowrap">'+escHtml(dateStr)+'</span>'
      + '<button class="tbtn" style="padding:1px 6px;font-size:11px" data-svautoload="'+escHtml(s.name)+'"'
      + (mpHasAdminRights() ? '' : ' disabled') + '>▶</button>'
      + '</div>';
  }).join('');

  el.querySelectorAll('[data-svautoload]').forEach(btn=>{
    btn.onclick = async ()=>{
      if(!mpHasAdminRights()) return;
      const name = btn.dataset.svautoload;
      if(!await confirmAction('Charger "'+name+'" ?\nLa partie en cours sera remplacée pour tous les joueurs.', {
        title: 'Charger une sauvegarde',
        okText: 'Charger',
      })) return;
      MP.ws.send(JSON.stringify({ type:'load_game', token:MP.token, name }));
    };
  });
}

function mpRenderChat(){
  const el = $('mpChatBox');
  if(!el) return;
  el.innerHTML = MP.chat.map(m=>
    '<div><span style="color:'+m.col+'">'+escHtml(m.name)+'</span>: '+escHtml(m.text)+'</div>'
  ).join('');
  el.scrollTop = el.scrollHeight;
}

function mpSendChat(){
  const inp = $('mpChatIn');
  const text = inp.value.trim();
  if(!text || !MP.connected) return;
  MP.ws.send(JSON.stringify({ type:'chat', text }));
  inp.value = '';
}

function escHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

mpInjectUI();
if(typeof Minimap !== 'undefined') Minimap.setVisible(!!UI_OPTIONS.panelMinimap);

buildToolbar();
genWorld();
// Vue d'accueil (avant connexion) : toute la carte dézoomée au maximum, biomes et noms de
// régions en vue d'ensemble
cam.z = ZOOM_MIN;
centerOn((mapBounds.x0 + mapBounds.x1) / 2 * TILE, (mapBounds.y0 + mapBounds.y1) / 2 * TILE);
renderAutoSaves();
requestAnimationFrame(frame);   // rendu (suspendu si onglet en arrière-plan)
startSimClock();                 // simulation (continue en arrière-plan)

// ======================================================================
// COMMANDES CONSOLE
// ======================================================================
window.regenExpansions = function(){
  generateExpansionTerrain();
  refreshExpansionSlots();
  toast('🌍 Terrain des zones d\'expansion régénéré.', 'win');
  console.info('[regenExpansions] Terrain non-jouable régénéré avec de nouvelles ressources.');
};

// Remet à zéro tous les passagers (arrêts de bus, gares, ports, aéroports et
// véhicules en charge) : les compteurs repartent des habitants sans travail.
window.resetTransitPassengers = function(){
  let n = 0;
  for(const b of buildings){
    if(b.dead) continue;
    if(b.type !== 'bus_stop' && !isTerminalType(b)) continue;
    b.passengers = 0; b.passengersEntrant = 0; b.passagersSortant = 0; b.passengersEntrantPending = 0;
    b.passengersQuota = null; b.passengersEntrantQuota = null;
    n++;
  }
  for(const v of vehicles){
    if(VEHICLE_TYPES[v.vtype]?.passengers || v.vtype === 'bus'){ v.cargo = 0; v.passengerBoardStop = null; }
    if(v.vtype === 'train'){ v.passengersOnBoard = 0; v.passengerBoardStop = null; }
  }
  if(typeof refreshTransitPassengerCaps === 'function') refreshTransitPassengerCaps();
  toast('🧹 Passagers remis à zéro ('+n+' arrêts/gares).', 'win');
  console.info('[resetTransitPassengers] '+n+' arrêts/gares vidés.');
};

// Génère des patchs de champs sur la zone jouable.
// Appelée par le serveur via server_cmd 'spawn_fields'.
function spawnFieldsOnMap(type, count){
  const ALIASES = { ble:'wheat', blé:'wheat', coton:'cotton' };
  const resolved = ALIASES[type] || String(type || '').toLowerCase();
  const TILE_TYPES = { wheat: T.WHEAT, cotton: T.COTTON };
  const tileType = TILE_TYPES[resolved];
  if(tileType === undefined){
    console.warn('[spawnFields] Type inconnu : "'+type+'".');
    return;
  }

  const n = Math.max(1, Math.round(count) || 3);
  const minRadius = 1;
  const maxRadius = resolved === 'cotton' ? 1 : 2;
  const fillChance = resolved === 'cotton' ? 0.65 : 0.85;

  let placed = 0;
  for(let k = 0; k < n; k++){
    let cx, cy, tries = 0;
    do {
      cx = mapBounds.x0 + 1 + (Math.random() * (mapBounds.x1 - mapBounds.x0 - 2)) | 0;
      cy = mapBounds.y0 + 1 + (Math.random() * (mapBounds.y1 - mapBounds.y0 - 2)) | 0;
    } while(terrain[cy*N+cx] === T.WATER && ++tries < 300);
    if(tries >= 300) continue;

    const r = minRadius + (Math.random() * (maxRadius - minRadius + 1)) | 0;
    for(let dy = -r; dy <= r; dy++) for(let dx = -r; dx <= r; dx++){
      const x = cx + dx, y = cy + dy;
      if(x < 0 || y < 0 || x >= N || y >= N) continue;
      if(dx*dx + dy*dy > r*r + 0.5) continue;
      if(terrain[y*N+x] === T.GRASS && Math.random() < fillChance){
        terrain[y*N+x] = tileType;
      }
    }
    placed++;
  }

  const label = resolved === 'wheat' ? 'blé 🌾' : 'coton ☁️';
  toast('🌱 '+placed+' patch(s) de '+label+' ajouté(s) par le serveur.', 'win');
  console.info('[spawnFields] '+placed+' patch(s) de '+resolved+' placés (count='+n+').');
}
