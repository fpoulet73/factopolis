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

function loadAutoSaves(){
  try { return JSON.parse(localStorage.getItem(autoSaveStorageKey()) || '[]'); } catch(e){ return []; }
}

function performAutoSave(){
  if(!buildings.length) return; // monde non initialisé
  const saves = loadAutoSaves();
  const lastSlot = saves.length > 0 ? saves[saves.length - 1].slot : 0;
  const nextSlot = (lastSlot % AUTO_SAVE_MAX) + 1;
  const entry = { slot: nextSlot, date: new Date().toISOString(), state: serializeState() };
  const updated = saves.filter(s => s.slot !== nextSlot);
  updated.push(entry);
  const trimmed = updated.slice(-AUTO_SAVE_MAX);
  try {
    localStorage.setItem(autoSaveStorageKey(), JSON.stringify(trimmed));
  } catch(e){
    toast('⚠️ Sauvegarde auto impossible (stockage plein)', 'err');
    return;
  }
  renderAutoSaves();
  toast('💾 Sauvegarde auto — emplacement '+nextSlot+'/'+AUTO_SAVE_MAX);
  if(MP.connected && mpHasAdminRights() && MP.token){
    MP.ws.send(JSON.stringify({
      type: 'save_game', token: MP.token,
      name: autoSaveServerName(nextSlot),
      state: serializeState(),
    }));
  }
}

function renderAutoSaves(){
  const el = $('autoSaveList');
  if(!el) return;
  const localSaves = loadAutoSaves().sort((a,b)=> new Date(b.date) - new Date(a.date));
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
      if(!sv) return;
      const d = new Date(sv.date);
      const label = d.toLocaleDateString('fr-FR')+' '+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
      if(!await confirmAction('Charger la sauvegarde automatique du '+label+' ?', {
        title: 'Charger une sauvegarde auto',
        okText: 'Charger',
      })) return;
      applySnapshot(sv.state);
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

mpInjectUI();

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
