// ---------- compression des grilles pour le stockage local ----------
// Une carte 224×224 sérialisée « à plat » pèse ~1 Mo par sauvegarde : le quota du
// localStorage (~5 Mo) ne tenait que quelques emplacements. Les grilles sont très
// uniformes (herbe, eau…) : un codage par plages (valeur, longueur) les réduit
// d'un ou deux ordres de grandeur.
const LOCAL_SAVE_GRID_KEYS = ['terrain', 'terrainHeightMap', 'waterHeightMap', 'road', 'rail', 'railOwner', 'railTunnel', 'mapMask'];
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
const LOCAL_SAVE_KEEP_ZERO = new Set(['x', 'y', 'w', 'h', 'townId', 'stationGroupId', 'owner']);
const roundSave = v => Math.round(v * 1e4) / 1e4;
// champs dont la présence conditionne la restauration des passagers (applySnapshot)
const transitGateKey = (type, k) => (k === 'passengers' && type === 'bus_stop')
  || (k === 'passengersEntrant' && (type === 'train_station' || type === 'boat_depot' || type === 'plane_depot'));
function compactBuildingForStorage(o){
  const out = {};
  for(const k in o){
    let v = o[k];
    if(v == null || v === false || v === '') continue;
    if(v === 0 && !LOCAL_SAVE_KEEP_ZERO.has(k) && !transitGateKey(o.type, k)) continue;
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
  for(const k of LOCAL_SAVE_GRID_KEYS){
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
function autoSaveStorageKey(){
  return MP.roomId != null ? AUTO_SAVE_KEY + '_r' + MP.roomId : AUTO_SAVE_KEY;
}
function autoSaveServerName(slot){
  const room = MP.roomName || 'Monde';
  return '[Auto] ' + room + ' ' + slot;
}
function autoSaveServerPattern(){
  const room = MP.roomName || 'Monde';
  return new RegExp('^\\[Auto\\] ' + room.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\d+$', 'i');
}

// Une room est rattachée au serveur : ses sauvegardes auto vivent côté serveur
// (partagées, par-room) et non dans le localStorage du navigateur de l'hôte
// courant — celui-ci pouvant changer de joueur/appareil d'une session à l'autre.
function autoSaveIsRoom(){
  return MP.roomId != null;
}

// Stockage local : un INDEX léger (emplacement/nom + date) et une clé par
// sauvegarde. Écrire une sauvegarde ne relit/réécrit plus toutes les autres
// (l'ancien format, un seul tableau de plusieurs Mo, figeait le jeu ~0,4 s à
// chaque sauvegarde auto d'une grande ville). L'ancien format est migré.
function lsGetJSON(key, def){
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : def; } catch(e){ return def; }
}
// setItem avec éviction : en cas de quota plein, `evict()` libère de la place
// (renvoie false s'il n'y a plus rien à supprimer) puis on réessaie.
function lsSetWithEviction(key, value, evict){
  for(;;){
    try { localStorage.setItem(key, value); return true; }
    catch(e){
      if(!isQuotaExceeded(e) || !evict || !evict()) return false;
    }
  }
}
// Migre un ancien tableau [{…, state}] vers index + clés individuelles.
function migrateSaveList(indexKey, list, idOf){
  if(!Array.isArray(list) || !list.some(e => e && e.state)) return list;
  const index = [];
  let removedOld = false;
  for(const e of list){
    if(!e || !e.state) continue;
    const id = idOf(e);
    const value = JSON.stringify(e.state);
    const ok = lsSetWithEviction(indexKey + '#' + id, value, () => {
      if(removedOld) return false;
      localStorage.removeItem(indexKey); removedOld = true; // les données sont en mémoire
      return true;
    });
    if(!ok) continue;
    const entry = Object.assign({}, e); delete entry.state;
    index.push(entry);
  }
  try { localStorage.setItem(indexKey, JSON.stringify(index)); } catch(e){}
  return index;
}
function loadAutoSaves(){
  const key = autoSaveStorageKey();
  return migrateSaveList(key, lsGetJSON(key, []), e => e.slot);
}
function loadAutoSaveState(slot){
  return lsGetJSON(autoSaveStorageKey() + '#' + slot, null);
}

function performAutoSave(){
  if(!buildings.length) return; // monde non initialisé
  const state = serializeState();

  // --- En room : sauvegarde serveur uniquement (par-room, partagée) ---
  if(autoSaveIsRoom()){
    if(MP.connected && mpHasAdminRights() && MP.token){
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
    // Si pas hôte/déconnecté : rien à faire, un autre client hôte s'en charge.
    return;
  }

  // --- En solo : sauvegarde dans le localStorage du navigateur ---
  const key = autoSaveStorageKey();
  let saves = loadAutoSaves();
  const lastSlot = saves.length > 0 ? saves[saves.length - 1].slot : 0;
  const nextSlot = (lastSlot % AUTO_SAVE_MAX) + 1;
  saves = saves.filter(s => s.slot !== nextSlot);
  const wanted = Math.min(AUTO_SAVE_MAX, saves.length + 1);
  // En cas de quota plein, on supprime les emplacements les plus anciens
  // et on réessaie jusqu'à ce que ça tienne.
  const stored = lsSetWithEviction(key + '#' + nextSlot, JSON.stringify(packStateForStorage(state)), () => {
    const old = saves.shift();
    if(!old) return false;
    localStorage.removeItem(key + '#' + old.slot);
    return true;
  });
  if(stored) saves.push({ slot: nextSlot, date: new Date().toISOString() });
  saves = saves.slice(-AUTO_SAVE_MAX);
  try { localStorage.setItem(key, JSON.stringify(saves)); } catch(e){}

  renderAutoSaves();
  if(stored){
    if(saves.length < wanted){
      toast('💾 Sauvegarde auto '+nextSlot+'/'+AUTO_SAVE_MAX+' (anciennes purgées, stockage limité)', 'win');
    } else {
      toast('💾 Sauvegarde auto — emplacement '+nextSlot+'/'+AUTO_SAVE_MAX);
    }
  } else {
    toast('⚠️ Sauvegarde auto impossible (stockage plein)', 'err');
  }
}

function isQuotaExceeded(e){
  return e && (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 || e.code === 1014
  );
}

function renderAutoSaves(){
  const el = $('autoSaveList');
  if(!el) return;
  // En room : uniquement les sauvegardes serveur (par-room, partagées). Les
  // sauvegardes locales sont liées au navigateur et inutiles si l'hôte change.
  const localSaves = autoSaveIsRoom() ? []
    : loadAutoSaves().sort((a,b)=> new Date(b.date) - new Date(a.date));
  // sauvegardes auto côté serveur (noms correspondant au pattern _Auto_*)
  const serverAutoSaves = (MP.saves || []).filter(s => autoSaveServerPattern().test(s.name))
    .sort((a,b) => new Date(b.date) - new Date(a.date));

  if(!localSaves.length && !serverAutoSaves.length){
    el.innerHTML = '<div style="color:#8fa3bf;font-size:11px;font-style:italic">Aucune sauvegarde auto</div>';
    return;
  }

  const localHtml = localSaves.map(s => {
    const d = new Date(s.date);
    const dateStr = d.toLocaleDateString('fr-FR')+' '
      + d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    return '<div style="display:flex;align-items:center;gap:4px;margin:2px 0;padding:3px 4px;'
      + 'background:#1d2939;border-radius:5px">'
      + '<span style="flex:1;font-size:12px">🔄 Auto-'+s.slot+'</span>'
      + '<span style="color:#8fa3bf;font-size:10px;white-space:nowrap">'+dateStr+'</span>'
      + '<button class="tbtn" style="padding:1px 6px;font-size:11px" data-autoload="'+s.slot+'">▶</button>'
      + '</div>';
  }).join('');

  const serverHtml = serverAutoSaves.map(s => {
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

  el.innerHTML = localHtml + serverHtml;

  el.querySelectorAll('[data-autoload]').forEach(btn=>{
    btn.onclick = async ()=>{
      const slot = +btn.dataset.autoload;
      const sv = loadAutoSaves().find(s => s.slot === slot);
      const st = sv && loadAutoSaveState(slot);
      if(!st){ toast('⛔ Sauvegarde introuvable', 'err'); return; }
      const d = new Date(sv.date);
      const label = d.toLocaleDateString('fr-FR')+' '+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
      if(!await confirmAction('Charger la sauvegarde automatique du '+label+' ?', {
        title: 'Charger une sauvegarde auto',
        okText: 'Charger',
      })) return;
      applySnapshot(unpackStateFromStorage(st));
      focusCameraOnWorld();
      autoSaveTimer = AUTO_SAVE_INTERVAL;
      toast('📥 Sauvegarde auto chargée', 'win');
    };
  });

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

// ---------- panneau « Partie » (solo) ----------
// Nouvelle carte, sauvegardes locales nommées, sauvegardes auto, export/import
// d'un fichier JSON. En multijoueur, la partie appartient à la room : ce panneau
// renvoie vers le panneau multijoueur (sauvegardes gérées par l'hôte).
const LOCAL_SAVES_KEY = 'factopolis_saves';
const LOCAL_SAVES_MAX = 12;
let _localSaveSeq = 0;
// Index [{ id, name, date }] ; l'état de chaque partie est sous LOCAL_SAVES_KEY#id.
function loadLocalSaves(){
  return migrateSaveList(LOCAL_SAVES_KEY, lsGetJSON(LOCAL_SAVES_KEY, []),
    e => (e.id = e.id || (Date.now().toString(36) + '-' + (_localSaveSeq++))));
}
function loadLocalSaveState(entry){
  return entry ? lsGetJSON(LOCAL_SAVES_KEY + '#' + entry.id, null) : null;
}
function storeLocalSaves(list){
  try { localStorage.setItem(LOCAL_SAVES_KEY, JSON.stringify(list)); return true; }
  catch(e){ toast('⚠️ Sauvegarde impossible', 'err'); return false; }
}
function deleteLocalSave(entry){
  if(!entry) return;
  localStorage.removeItem(LOCAL_SAVES_KEY + '#' + entry.id);
  storeLocalSaves(loadLocalSaves().filter(s => s.id !== entry.id));
}
function localSaveNow(name){
  name = String(name || '').trim().slice(0, 48) || ('Partie ' + new Date().toLocaleString('fr-FR'));
  let list = loadLocalSaves();
  for(const s of list.filter(s => s.name === name)) localStorage.removeItem(LOCAL_SAVES_KEY + '#' + s.id);
  list = list.filter(s => s.name !== name);
  // au-delà du maximum, les plus anciennes partent
  while(list.length >= LOCAL_SAVES_MAX) localStorage.removeItem(LOCAL_SAVES_KEY + '#' + list.pop().id);
  const entry = { id: Date.now().toString(36) + '-' + (_localSaveSeq++), name, date: new Date().toISOString() };
  // quota plein : on sacrifie d'abord les sauvegardes AUTO les plus anciennes
  const ok = lsSetWithEviction(LOCAL_SAVES_KEY + '#' + entry.id, JSON.stringify(packStateForStorage(serializeState())), () => {
    const autos = loadAutoSaves();
    if(autos.length <= 1) return false;
    const old = autos.shift();
    localStorage.removeItem(autoSaveStorageKey() + '#' + old.slot);
    try { localStorage.setItem(autoSaveStorageKey(), JSON.stringify(autos)); } catch(e){}
    return true;
  });
  if(!ok){
    toast('⚠️ Stockage du navigateur plein : supprime une sauvegarde ou exporte la partie.', 'err');
  } else {
    list.unshift(entry);
    if(storeLocalSaves(list)) toast('💾 Partie « ' + name + ' » sauvegardée', 'win');
  }
  renderGamePanel();
}
function exportGameFile(){
  const data = { meta: { name: 'Factopolis', date: new Date().toISOString(), version: 1 }, state: packStateForStorage(serializeState()) };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'factopolis-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function importGameFile(file){
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const state = unpackStateFromStorage(data.state || data);
      if(!state || !Array.isArray(state.buildings) || !state.terrain) throw new Error('format');
      applySnapshot(state);
      focusCameraOnWorld();
      autoSaveTimer = AUTO_SAVE_INTERVAL;
      toast('📥 Partie importée', 'win');
      renderGamePanel();
    } catch(e){ toast('⛔ Fichier de sauvegarde invalide', 'err'); }
  };
  reader.readAsText(file);
}
function injectGamePanel(){
  const sep = document.createElement('span'); sep.className = 'sep';
  const btn = document.createElement('button');
  btn.className = 'tbtn'; btn.id = 'bGame'; btn.textContent = '💾';
  btn.title = 'Nouvelle carte, sauvegarder, charger, exporter';
  btn.onclick = () => { const p = $('gamePanel'); p.style.display = p.style.display === 'block' ? 'none' : 'block'; renderGamePanel(); };
  $('topbar').appendChild(sep); $('topbar').appendChild(btn);
  const panel = document.createElement('div');
  panel.id = 'gamePanel'; panel.className = 'panel';
  panel.style.cssText = 'top:70px;left:300px;width:290px;max-height:calc(100vh - 90px);overflow-y:auto;padding:12px 14px;font-size:13px;display:none;z-index:20';
  document.body.appendChild(panel);
}
function renderGamePanel(){
  const p = $('gamePanel');
  if(!p || p.style.display !== 'block') return;
  const inRoom = mpInRoom();
  let h = '<div class="panel-head"><h3 style="font-size:15px">💾 Partie</h3><button class="tbtn" id="gpClose" aria-label="Fermer">✕</button></div>';
  if(inRoom){
    h += '<div style="color:#8fa3bf;line-height:1.45">Tu joues dans le monde multijoueur <b>'+escHtml(MP.roomName || '')+'</b>. '
      + 'Les sauvegardes y sont partagées et gérées par l’hôte depuis le panneau 🌐 Multijoueur.</div>';
  } else {
    const sizes = MAP_SIZE_OPTIONS.map(s => '<option value="'+s+'"'+(s === WORLD.size ? ' selected' : '')+'>'+s+'×'+s+'</option>').join('');
    h += '<div class="opt-title" style="padding:4px 0">Nouvelle carte</div>'
      + '<div style="display:flex;gap:6px;margin-bottom:8px"><select id="gpSize" class="opt-select" style="margin:0;flex:1">'+sizes+'</select>'
      + '<button class="tbtn" id="gpNew">🌍 Créer</button></div>';
    h += '<div class="opt-title" style="padding:4px 0">Sauvegarder</div>'
      + '<div style="display:flex;gap:6px;margin-bottom:6px"><input id="gpName" type="text" placeholder="Nom de la partie" class="opt-select" style="margin:0;flex:1">'
      + '<button class="tbtn" id="gpSave">💾</button></div>';
    const saves = loadLocalSaves();
    h += saves.length ? saves.map((s, i) =>
        '<div style="display:flex;align-items:center;gap:4px;margin:2px 0;padding:3px 4px;background:#1d2939;border-radius:5px">'
        + '<span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📄 '+escHtml(s.name)+'</span>'
        + '<span style="color:#8fa3bf;font-size:10px">'+escHtml(new Date(s.date).toLocaleDateString('fr-FR'))+'</span>'
        + '<button class="tbtn" style="padding:1px 6px;font-size:11px" data-gp-load="'+i+'">▶</button>'
        + '<button class="tbtn" style="padding:1px 6px;font-size:11px;color:#ff9a8a" data-gp-del="'+i+'">✕</button></div>').join('')
      : '<div style="color:#8fa3bf;font-size:11px;font-style:italic">Aucune sauvegarde</div>';
    const autos = loadAutoSaves().sort((a, b) => new Date(b.date) - new Date(a.date));
    h += '<div class="opt-title" style="padding:8px 0 4px">Sauvegardes auto (toutes les '+Math.round(AUTO_SAVE_INTERVAL / 60)+' min)</div>';
    h += autos.length ? autos.map(s =>
        '<div style="display:flex;align-items:center;gap:4px;margin:2px 0;padding:3px 4px;background:#1d2939;border-radius:5px">'
        + '<span style="flex:1;font-size:12px">🔄 Auto-'+s.slot+'</span>'
        + '<span style="color:#8fa3bf;font-size:10px">'+escHtml(new Date(s.date).toLocaleString('fr-FR',{ day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }))+'</span>'
        + '<button class="tbtn" style="padding:1px 6px;font-size:11px" data-gp-auto="'+s.slot+'">▶</button></div>').join('')
      : '<div style="color:#8fa3bf;font-size:11px;font-style:italic">Aucune sauvegarde auto</div>';
    h += '<div style="display:flex;gap:6px;margin-top:10px">'
      + '<button class="tbtn" id="gpExport" style="flex:1">📤 Exporter</button>'
      + '<button class="tbtn" id="gpImport" style="flex:1">📥 Importer</button>'
      + '<input id="gpFile" type="file" accept=".json,application/json" style="display:none"></div>';
  }
  p.innerHTML = h;
  ensurePanelDragHandle('gamePanel');
  $('gpClose').onclick = () => { p.style.display = 'none'; };
  if(inRoom) return;
  $('gpNew').onclick = async () => {
    if(!await confirmAction('Créer une nouvelle carte ?\nLa partie en cours sera perdue si elle n’est pas sauvegardée.', { title:'Nouvelle carte', okText:'Créer', danger:true })) return;
    genWorld(normalizeWorldConfig({ ...WORLD, size: +$('gpSize').value, seed: undefined }));
    autoSaveTimer = AUTO_SAVE_INTERVAL;
    toast('🌍 Nouvelle carte', 'win');
    renderGamePanel();
  };
  $('gpSave').onclick = () => localSaveNow($('gpName').value);
  $('gpName').onkeydown = e => { if(e.key === 'Enter') localSaveNow($('gpName').value); };
  $('gpExport').onclick = exportGameFile;
  $('gpImport').onclick = () => $('gpFile').click();
  $('gpFile').onchange = e => { const f = e.target.files?.[0]; if(f) importGameFile(f); e.target.value = ''; };
  p.querySelectorAll('[data-gp-load]').forEach(b => b.onclick = async () => {
    const s = loadLocalSaves()[+b.dataset.gpLoad];
    if(!s || !await confirmAction('Charger « '+s.name+' » ?', { title:'Charger une partie', okText:'Charger' })) return;
    const st = loadLocalSaveState(s);
    if(!st){ toast('⛔ Sauvegarde introuvable', 'err'); return; }
    applySnapshot(unpackStateFromStorage(st));
    focusCameraOnWorld();
    autoSaveTimer = AUTO_SAVE_INTERVAL;
    toast('📥 Partie « '+s.name+' » chargée', 'win');
  });
  p.querySelectorAll('[data-gp-del]').forEach(b => b.onclick = async () => {
    const s = loadLocalSaves()[+b.dataset.gpDel];
    if(!s || !await confirmAction('Supprimer « '+s.name+' » ?', { title:'Supprimer', okText:'Supprimer', danger:true })) return;
    deleteLocalSave(s);
    renderGamePanel();
  });
  p.querySelectorAll('[data-gp-auto]').forEach(b => b.onclick = async () => {
    const s = loadAutoSaves().find(x => x.slot === +b.dataset.gpAuto);
    if(!s || !await confirmAction('Charger la sauvegarde auto '+s.slot+' ?', { title:'Charger', okText:'Charger' })) return;
    const st = loadAutoSaveState(s.slot);
    if(!st){ toast('⛔ Sauvegarde introuvable', 'err'); return; }
    applySnapshot(unpackStateFromStorage(st));
    focusCameraOnWorld();
    autoSaveTimer = AUTO_SAVE_INTERVAL;
    toast('📥 Sauvegarde auto chargée', 'win');
  });
}

injectGamePanel();
mpInjectUI();
if(typeof Minimap !== 'undefined') Minimap.setVisible(!!UI_OPTIONS.panelMinimap);

buildToolbar();
genWorld();
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
    if(b.type !== 'bus_stop' && b.type !== 'train_station' && b.type !== 'boat_depot' && b.type !== 'plane_depot') continue;
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
