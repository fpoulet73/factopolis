// ---------- sauvegarde automatique ----------
function loadAutoSaves(){
  try { return JSON.parse(localStorage.getItem(AUTO_SAVE_KEY) || '[]'); } catch(e){ return []; }
}

function performAutoSave(){
  if(!buildings.length) return; // monde non initialisé
  const saves = loadAutoSaves();
  const lastSlot = saves.length > 0 ? saves[saves.length - 1].slot : 0;
  const nextSlot = (lastSlot % AUTO_SAVE_MAX) + 1;
  const entry = { slot: nextSlot, date: new Date().toISOString(), state: serializeState() };
  const updated = saves.filter(s => s.slot !== nextSlot);
  updated.push(entry);
  // conserver uniquement les MAX dernières
  const trimmed = updated.slice(-AUTO_SAVE_MAX);
  try {
    localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(trimmed));
  } catch(e){
    toast('⚠️ Sauvegarde auto impossible (stockage plein)', 'err');
    return;
  }
  renderAutoSaves();
  toast('💾 Sauvegarde auto — emplacement '+nextSlot+'/'+AUTO_SAVE_MAX);
  // Envoyer aussi au serveur si connecté et admin
  if(MP.connected && mpHasAdminRights() && MP.token){
    MP.ws.send(JSON.stringify({
      type: 'save_game', token: MP.token,
      name: '[Auto] ' + nextSlot,
      state: serializeState(),
    }));
  }
}

function renderAutoSaves(){
  const el = $('autoSaveList');
  if(!el) return;
  const localSaves = loadAutoSaves().sort((a,b)=> new Date(b.date) - new Date(a.date));
  // sauvegardes auto côté serveur (noms correspondant au pattern _Auto_*)
  const serverAutoSaves = (MP.saves || []).filter(s => /^[\[_]Auto[\]_ ]/i.test(s.name))
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
    btn.onclick = ()=>{
      const slot = +btn.dataset.autoload;
      const sv = loadAutoSaves().find(s => s.slot === slot);
      if(!sv) return;
      const d = new Date(sv.date);
      const label = d.toLocaleDateString('fr-FR')+' '+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
      if(!confirm('Charger la sauvegarde automatique du '+label+' ?')) return;
      applySnapshot(sv.state);
      autoSaveTimer = AUTO_SAVE_INTERVAL;
      toast('📥 Sauvegarde auto chargée', 'win');
    };
  });

  el.querySelectorAll('[data-svautoload]').forEach(btn=>{
    btn.onclick = ()=>{
      if(!mpHasAdminRights()) return;
      const name = btn.dataset.svautoload;
      if(!confirm('Charger "'+name+'" ? La partie en cours sera remplacée pour tous les joueurs.')) return;
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
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

mpInjectUI();

buildToolbar();
genWorld();
$('help').style.display = 'block';
renderAutoSaves();
requestAnimationFrame(frame);

// ======================================================================
// COMMANDES CONSOLE
// ======================================================================
window.regenExpansions = function(){
  generateExpansionTerrain();
  refreshExpansionSlots();
  toast('🌍 Terrain des zones d\'expansion régénéré.', 'win');
  console.info('[regenExpansions] Terrain non-jouable régénéré avec de nouvelles ressources.');
};
