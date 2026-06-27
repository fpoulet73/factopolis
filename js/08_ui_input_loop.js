// ---------- HUD ----------
const $ = id => document.getElementById(id);

function formatGameDate(gt){
  const pad = n => String(n).padStart(2,'0');
  const d = new Date(GAME_EPOCH_MS + (gt || 0) * GAME_HOURS_PER_SEC * 3600000);
  return pad(d.getUTCDate())+'/'+pad(d.getUTCMonth()+1)+'/'+d.getUTCFullYear()
       + ' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes());
}
let hudTimer = 0;
function updateHUD(dt){
  hudTimer -= dt;
  if(hudTimer > 0) return;
  hudTimer = 0.2;
  const town = ensureSelectedTown();
  const pop = town ? townPopTotal(town.id) : popTotal();
  const cap = town ? townHousingCap(town.id) : housingCap();
  const jobs = town ? townReachableJobs(town.id) : jobsTotal();
  const workers = town ? townAllocatedWorkers(town.id) : Math.min(popTotal(), jobs);
  const mEl = $('hMoney');
  const myMoney = myWallet().money;
  mEl.textContent = Math.floor(myMoney).toLocaleString('fr-FR');
  mEl.style.color = myMoney < 0 ? '#ff8a7a' : '';
  const townEl = $('hTown');
  if(townEl) townEl.textContent = town ? town.name : '—';
  $('hPop').textContent = pop + ' / ' + cap;
  $('hJobs').textContent = workers + ' / ' + jobs;
  $('hTrucks').textContent = trucks.length;
  // Compteur sauvegarde auto
  const cdEl = $('autoSaveCountdown');
  if(cdEl){
    const s = Math.ceil(autoSaveTimer);
    cdEl.textContent = s >= 60 ? 'dans '+(Math.ceil(s/60))+' min' : 'dans '+s+' s';
  }
  // Date/heure du jeu
  const gdEl = $('gameDate');
  if(gdEl){
    const ms = GAME_EPOCH_MS + (gtime || 0) * GAME_HOURS_PER_SEC * 3600000;
    const d  = new Date(ms);
    const pad = n => String(n).padStart(2,'0');
    const day = pad(d.getUTCDate()), mon = pad(d.getUTCMonth()+1), yr = d.getUTCFullYear();
    const hr  = pad(d.getUTCHours()), min = pad(d.getUTCMinutes());
    gdEl.textContent = `📅 ${day}/${mon}/${yr}  🕐 ${hr}:${min}`;
  }
  renderInfo();
  renderFinance();
  if(trainConfigVehicle) renderTrainPanel();
}

// ---------- panneau finances ----------
function toggleFinance(){
  const p = $('finance');
  p.style.display = p.style.display==='block' ? 'none' : 'block';
  renderFinance();
}
function renderFinance(){
  const p = $('finance');
  if(p.style.display !== 'block') return;
  const wt = myWallet();
  const fin = wt.fin, finHist = wt.finHist || [];
  const base = finHist[0] || fin;
  const wl = Math.max(1, finHist.length);
  const rate = c => (fin[c]-base[c])*60/wl;
  const fmt = n => Math.round(Math.abs(n)).toLocaleString('fr-FR');
  const row = (lbl,c,sign,cls)=>
    '<tr class="'+cls+'"><td>'+lbl+'</td>'
    + '<td class="r">'+sign+fmt(fin[c])+' $</td>'
    + '<td class="r">'+sign+fmt(rate(c))+' $</td></tr>';
  const netT = fin.ventes+fin.taxes+fin.rembours-fin.construction-fin.entretien-(fin.expansion||0);
  const netR = rate('ventes')+rate('taxes')+rate('rembours')
             - rate('construction')-rate('entretien')-rate('expansion');
  const sgn = n => n>=0 ? '+' : '−';
  p.innerHTML =
    '<div class="panel-head"><h3>💰 Finances</h3><button class="tbtn" id="bFinX" aria-label="Fermer">✕</button></div>'
    + '<table>'
    + '<tr class="hdr"><td></td><td class="r">Total</td><td class="r">Par minute</td></tr>'
    + row('Ventes d\'outils','ventes','+','in')
    + row('Taxes des habitants','taxes','+','in')
    + row('Remboursements','rembours','+','in')
    + row('Construction','construction','−','out')
    + row('Entretien industriel','entretien','−','out')
    + ((fin.expansion||0) > 0 ? row('Expansions carte','expansion','−','out') : '')
    + '<tr class="net"><td>Bilan</td><td class="r">'+sgn(netT)+fmt(netT)+' $</td>'
    + '<td class="r">'+sgn(netR)+fmt(netR)+' $</td></tr>'
    + '</table>';
  ensurePanelDragHandle('finance');
}

let panelDragState = null;

function makePanelDraggable(id){
  const panel = $(id);
  if(!panel) return;
  panel.dataset.draggable = '1';
  panel.addEventListener('pointerdown', e => {
    if(e.pointerType === 'mouse' && e.button !== 0) return; // clic droit/molette réservés au canvas
    const handle = e.target.closest('.panel-head, h3, h2');
    if(!handle || !panel.contains(handle)) return;
    if(e.target.closest('button, input, select, textarea, label, a')) return;
    const rect = panel.getBoundingClientRect();
    panel.style.left = rect.left + 'px';
    panel.style.top = rect.top + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.transform = 'none';
    handle.style.cursor = 'move';
    panelDragState = {
      panel,
      pointerId: e.pointerId,
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
    };
    try { panel.setPointerCapture(e.pointerId); } catch(_){}
    e.preventDefault();
  });
}

function ensurePanelDragHandle(id){
  const panel = $(id);
  if(!panel) return;
  const h3 = panel.querySelector('.panel-head, h3, h2');
  if(!h3 || h3.querySelector('.panel-drag-handle')) return;
  const span = document.createElement('span');
  span.className = 'panel-drag-handle';
  span.textContent = '⋮⋮';
  h3.prepend(span);
}

addEventListener('pointermove', e => {
  if(!panelDragState) return;
  if(e.pointerId !== panelDragState.pointerId) return;
  const panel = panelDragState.panel;
  const maxLeft = Math.max(0, innerWidth - panel.offsetWidth);
  const maxTop = Math.max(0, innerHeight - panel.offsetHeight);
  const left = Math.max(0, Math.min(maxLeft, e.clientX - panelDragState.dx));
  const top = Math.max(0, Math.min(maxTop, e.clientY - panelDragState.dy));
  panel.style.left = left + 'px';
  panel.style.top = top + 'px';
});

function endPanelDrag(){
  if(!panelDragState) return;
  try { panelDragState.panel.releasePointerCapture(panelDragState.pointerId); } catch(_){}
  panelDragState = null;
}
addEventListener('pointerup', endPanelDrag);
addEventListener('pointercancel', endPanelDrag);

makePanelDraggable('info');
makePanelDraggable('townPanel');
makePanelDraggable('trainPanel');
makePanelDraggable('finance');
makePanelDraggable('help');

function closeInfoPanel(){
  const p = $('info');
  if(!p) return;
  p.style.display = 'none';
  p._html = null;
  p._b = null;
  selected = null;
  selectedVehicle = null;
  selectedExpansion = null;
}

let trainConfigVehicle = null;
let trainConfigSelectedWagonIndex = -1;
let trainConfigLocoSelected = false;

function closeTrainPanel(){
  const p = $('trainPanel');
  if(p){
    p.style.display = 'none';
    p._html = null;
    p._trainId = null;
  }
  if(vehicleRouteMode?.step === 'train_order_append') vehicleRouteMode = null;
  trainConfigVehicle = null;
  trainConfigSelectedWagonIndex = -1;
  trainConfigLocoSelected = false;
}

// Texte flottant centré dans un panneau (feedback d'achat / remboursement).
function panelFloat(panelId, text, color){
  const p = $(panelId);
  if(!p) return;
  const r = p.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'panel-float';
  el.textContent = text;
  el.style.color = color || '#ffe9a0';
  el.style.left = (r.left + r.width / 2) + 'px';
  el.style.top = (r.top + r.height / 2) + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

function trainDepotFlagButtonHtml(v, attrs=''){
  const state = trainDepotFlagState(v);
  if(!state) return '';
  const color = state.armed ? '#7dda5a' : '#ff7474';
  const icon = state.armed ? '🚩' : '🟥';
  const label = state.armed ? 'Drapeau vert' : 'Drapeau rouge';
  return '<button class="tbtn" data-train-flag="'+v.id+'" style="width:auto;margin:0;color:'+color+';font-weight:bold"'
    + attrs + '>'+icon+' '+label+'</button>';
}

function handleTrainDepotFlagClick(v){
  if(!v || v.vtype !== 'train') return;
  if(MP.connected && v.garageRef?.owner && v.garageRef.owner !== MP.myId){
    toast('⛔ Ce train appartient à un autre joueur.','err');
    return;
  }
  if(!trainPresentAtDepot(v)){
    toast('⛔ Le train doit être dans le dépôt.','err');
    return;
  }
  const nextArmed = !trainDepotDepartureArmed(v);
  const res = setTrainDepotDeparture(v, nextArmed);
  if(!res.ok){
    if(res.reason === 'route_missing') toast('⛔ Il faut d’abord une route valide avec au moins 2 arrêts.','err');
    else if(res.reason === 'no_path') toast('⛔ Aucun chemin ferroviaire continu depuis le dépôt.','err');
    else toast('⛔ Départ impossible depuis ce dépôt.','err');
    return;
  }
  if(MP.connected) netSend({ type:'train_depot_flag', id:v.id, armed:nextArmed });
  if(nextArmed){
    if(res.waiting) toast('🚩 Drapeau vert. Le train partira dès que la voie de sortie sera libre.','win');
    else toast('🚩 Drapeau vert. Départ autorisé.','win');
  } else {
    toast('🟥 Drapeau rouge. Départ annulé.','win');
  }
  if(trainConfigVehicle === v) renderTrainPanel();
  renderInfo();
}

// Clic direct sur le drapeau du dépôt (rendu dans le monde). Le drapeau regroupe
// tous les trains présents avec une route : on bascule l'autorisation de départ
// pour tous d'un coup, ce qui reflète la couleur agrégée du drapeau (vert = tous
// armés). Cela arme le départ immédiatement au lieu de seulement ouvrir un panneau.
function handleTrainDepotFlagToggle(depot){
  if(!depot || depot.dead) return;
  const trains = (depot.vehicles || []).filter(v => trainPresentAtDepot(v) && (v.orders?.length || 0) >= 2);
  if(!trains.length) return;
  // Si tous les trains armables sont déjà verts, on les remet au rouge ; sinon on
  // arme tous ceux qui peuvent l'être.
  const target = !trains.every(v => trainDepotDepartureArmed(v));
  let changed = 0, waiting = 0, failReason = null;
  for(const v of trains){
    if(MP.connected && v.garageRef?.owner && v.garageRef.owner !== MP.myId) continue;
    if(trainDepotDepartureArmed(v) === target) continue;
    const res = setTrainDepotDeparture(v, target);
    if(!res.ok){ failReason = res.reason || 'route_missing'; continue; }
    changed++;
    if(res.waiting) waiting++;
    if(MP.connected) netSend({ type:'train_depot_flag', id:v.id, armed:target });
  }
  if(changed){
    if(!target) toast('🟥 Drapeau rouge. Départ annulé.','win');
    else if(waiting) toast('🚩 Drapeau vert. Le train partira dès que la voie de sortie sera libre.','win');
    else toast('🚩 Drapeau vert. Départ autorisé.','win');
  } else if(failReason === 'no_path'){
    toast('⛔ Aucun chemin ferroviaire continu depuis le dépôt.','err');
  } else if(failReason){
    toast('⛔ Il faut d’abord une route valide avec au moins 2 arrêts.','err');
  }
  if(trainConfigVehicle && trains.includes(trainConfigVehicle)) renderTrainPanel();
}

function openTrainPanel(v){
  if(!v || v.vtype !== 'train') return;
  if(!trainPresentAtDepot(v)){
    toast('⛔ La configuration du train n’est possible que dans le dépôt.','err');
    return;
  }
  trainConfigVehicle = v;
  trainNormalizeWagons(v);
  trainConfigSelectedWagonIndex = Math.min(Math.max(0, trainConfigSelectedWagonIndex), Math.max(0, (v.wagons?.length || 0) - 1));
  renderTrainPanel();
}

function syncTrainConfig(v){
  trainNormalizeWagons(v);
  if(v.res && trainWagonCapacityForRes(v, v.res) < v.cargo){ v.cargo = 0; v.res = null; }
  if(MP.connected) netSend({
    type:'configure_train',
    id:v.id,
    wagons:(v.wagons || []).map(w => ({ type:w.type, resource:w.resource || null })),
    engineMult:v.engineMult || 1,
  });
}

function renderTrainPanel(){
  const p = $('trainPanel');
  const v = trainConfigVehicle;
  if(!p || !v) return;
  if(v.vtype === 'train' && !v.name) assignTrainVehicleName(v);
  const wagons = trainNormalizeWagons(v);
  const orders = Array.isArray(v.orders) ? v.orders.filter(b => b && !b.dead) : [];
  const flagState = trainDepotFlagState(v);
  const selectedWagon = wagons[trainConfigSelectedWagonIndex] || null;
  const selectedWagonDef = selectedWagon ? trainWagonDef(selectedWagon) : null;
  let h = '<div class="panel-head"><h3><span style="font-size:22px">🚂</span> '+escHtml(v.name || 'Configurer le train')+'</h3>'
    + '<button class="tbtn" id="tpClose" aria-label="Fermer">✕</button></div>';
  h += '<div class="row"><span>Présence</span><b>'+(trainPresentAtDepot(v) ? 'Dans le dépôt' : 'En ligne')+'</b></div>';
  if(flagState)
    h += '<div class="row"><span>Drapeau</span><b style="color:'+(flagState.armed ? '#7dda5a' : '#ff7474')+'">'+(flagState.armed ? 'Vert' : 'Rouge')+'</b></div>';
  h += '<div class="row"><span>Capacité totale</span><b>'+trainTotalCapacity(v)+'</b></div>';
  const _passCap = trainPassengerCapacity(v);
  if(_passCap > 0)
    h += '<div class="row"><span>Passagers à bord</span><b style="color:#c8e040">'+(v.passengersOnBoard||0)+' / '+_passCap+' 🚃</b></div>';
  if(v.boughtAtGtime != null)
    h += '<div class="row"><span>Acheté le</span><b style="color:#8fa3bf">'+formatGameDate(v.boughtAtGtime)+'</b></div>';
  const _engineMult = v.engineMult || 1;
  const _baseSpeed = VEHICLE_TYPES['train']?.speed ?? 0;
  h += '<div class="row"><span>Vitesse</span><b>'+(Math.round(_baseSpeed * _engineMult * 10) / 10)+' cases/s'+(_engineMult > 1 ? ' <span style="font-size:11px;color:#7dda5a">moteur ×'+_engineMult+'</span>' : '')+'</b></div>';
  const _trainBaseCost = VEHICLE_TYPES['train']?.maintenanceCost ?? 0;
  if(_trainBaseCost > 0){
    const _days = v.maintenanceDaysPaid || 0;
    const _completedMonths = Math.floor(_days / 30);
    const _nextCost = Math.round(_trainBaseCost * _engineMult * Math.pow(1 + VEHICLE_MAINTENANCE_RATE, _completedMonths));
    const _nextDue = v.boughtAtGtime != null ? formatGameDate(v.boughtAtGtime + VEHICLE_MAINTENANCE_DAY * (_days + 1)) : '—';
    h += '<div class="row"><span>Entretien journalier</span><b style="color:#ff9a8a">'+_nextCost+' $'+(_completedMonths > 0 ? ' <span style="font-size:11px;color:#8fa3bf">(mois '+(_completedMonths+1)+')</span>' : '')+'</b></div>';
    h += '<div class="row"><span>Prochain paiement</span><b style="color:#8fa3bf">'+_nextDue+'</b></div>';
  }
  // Distribution du cargo par wagon (pour affichage)
  const _totalFreightCap = wagons.reduce((s, w) => {
    const d = trainWagonDef(w);
    return s + ((!d?.passenger && v.res && trainWagonAcceptedResources(w).includes(v.res)) ? d.capacite : 0);
  }, 0);
  const _totalPassCap2 = wagons.reduce((s, w) => {
    const d = trainWagonDef(w); return s + (d?.passenger ? d.capacite : 0);
  }, 0);
  let _freightRemainder = v.cargo || 0;
  let _passRemainder = v.passengersOnBoard || 0;
  const _wagonLoad = wagons.map((wagon, idx) => {
    const d = trainWagonDef(wagon);
    if(d?.passenger && _totalPassCap2 > 0){
      const share = idx === wagons.length - 1
        ? _passRemainder
        : Math.round((v.passengersOnBoard || 0) * d.capacite / _totalPassCap2);
      _passRemainder -= share;
      return { amt: share, res: null, passenger: true, cap: d.capacite };
    }
    if(!d?.passenger && v.res && _totalFreightCap > 0 && trainWagonAcceptedResources(wagon).includes(v.res)){
      const share = idx === wagons.length - 1
        ? Math.max(0, _freightRemainder)
        : Math.round((v.cargo || 0) * d.capacite / _totalFreightCap);
      _freightRemainder -= share;
      return { amt: share, res: v.res, passenger: false, cap: d.capacite };
    }
    return { amt: 0, res: null, passenger: d?.passenger || false, cap: d?.capacite || 0 };
  });

  h += '<div class="tp-section"><div class="tp-section-title">Composition</div>';
  h += '<div style="display:flex;gap:5px;align-items:stretch;overflow-x:auto;padding:6px 2px 8px">';
  h += '<button class="tbtn" data-train-loco="1" title="Améliorations moteur" style="width:auto;margin:0;min-width:52px;padding:0;align-self:stretch;display:flex;border-radius:7px;'
    + 'border:'+(trainConfigLocoSelected ? '2px solid #ffe082' : '1px solid #36465e')+';background:#4f5c6f;align-items:center;justify-content:center;color:#fff;font-size:18px">🚂</button>';
  wagons.forEach((wagon, idx) => {
    const def = trainWagonDef(wagon);
    const selected = idx === trainConfigSelectedWagonIndex;
    const res = trainWagonSelectedResource(wagon);
    const resLabel = res ? ((RES[res]?.ic || '') + ' ' + (RES[res]?.n || res)) : 'Toutes';
    const load = _wagonLoad[idx];
    const pct = load.cap > 0 ? Math.min(100, Math.round(load.amt / load.cap * 100)) : 0;
    const loadColor = load.passenger ? '#c8e040' : (load.res ? RES[load.res]?.c || '#ffe082' : '#8fa3bf');
    const loadLabel = load.passenger
      ? (load.amt > 0 ? load.amt+' 👤' : '—')
      : (load.res && load.amt > 0 ? (RES[load.res]?.ic||'')+' '+load.amt : '—');
    h += '<button class="tbtn" data-train-wagon-pick="'+idx+'" style="width:auto;margin:0;min-width:62px;padding:3px 4px;'
      + 'border:'+(selected ? '2px solid #ffe082' : '1px solid #36465e')+';background:#142031;display:flex;flex-direction:column;gap:2px">'
      + '<div style="flex:1;min-height:24px;border-radius:6px;background:'+def.color+';border:2px solid #2f3640;display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px">'+def.icone+'</div>'
      + '<div style="font-size:10px;font-weight:bold;line-height:1.1">'+escHtml(def.nom.replace(/^Wagon\s+/,'').replace(/^Wagon\s+/,''))+'</div>'
      + '<div style="font-size:9px;line-height:1.1;color:'+(res ? '#ffe082' : '#8fa3bf')+'">'+escHtml(resLabel)+'</div>'
      + '<div style="font-size:10px;font-weight:bold;line-height:1.1;color:'+loadColor+'">'+loadLabel+'</div>'
      + (load.cap > 0 ? '<div style="height:3px;border-radius:2px;background:#1a2535"><i style="display:block;height:100%;width:'+pct+'%;background:'+loadColor+';border-radius:2px"></i></div>' : '')
      + '</button>';
  });
  h += '</div>';
  if(trainConfigLocoSelected){
    const _curMult = v.engineMult || 1;
    const _money = myWallet().money;
    const _curIdx = TRAIN_ENGINE_UPGRADES.reduce((acc, up, i) => up.facteur <= _curMult ? i : acc, -1);
    const _next = TRAIN_ENGINE_UPGRADES[_curIdx + 1] || null;
    h += '<div style="margin-top:4px;padding:8px;border:1px solid #36465e;border-radius:8px;background:#142031">';
    h += '<div style="font-size:12px;margin-bottom:6px"><b>🚂 Moteur</b> · niveau actuel <b style="color:#7dda5a">×'+_curMult+'</b></div>';
    h += '<div style="font-size:11px;color:#8fa3bf;margin-bottom:8px">Chaque niveau augmente la vitesse et l’entretien journalier du même facteur.</div>';
    h += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
    if(_next){
      const affordable = _money >= _next.cout;
      h += '<button class="tbtn" data-train-engine-up="1" style="width:auto;margin:0;'+(affordable ? 'border-color:#7dda5a' : 'opacity:0.55;color:#ff9a8a')+'">'
        + '⬆ Améliorer → ×'+_next.facteur+' · '+_next.cout.toLocaleString('fr-FR')+' $</button>';
    } else {
      h += '<button class="tbtn" disabled style="width:auto;margin:0;opacity:0.5">Niveau maximum atteint</button>';
    }
    if(_curIdx >= 0){
      const refund = Math.floor(TRAIN_ENGINE_UPGRADES[_curIdx].cout * 0.5);
      const prevMult = _curIdx > 0 ? TRAIN_ENGINE_UPGRADES[_curIdx - 1].facteur : 1;
      h += '<button class="tbtn" data-train-engine-down="1" style="width:auto;margin:0;color:#ff9a8a">'
        + '⬇ Retirer → ×'+prevMult+' · +'+refund.toLocaleString('fr-FR')+' $</button>';
    }
    h += '</div></div>';
  } else if(selectedWagon && selectedWagonDef){
    h += '<div style="margin-top:4px;padding:8px;border:1px solid #36465e;border-radius:8px;background:#142031">';
    h += '<div style="font-size:12px;margin-bottom:6px"><b>'+selectedWagonDef.icone+' '+escHtml(selectedWagonDef.nom)+'</b> · capacité '+selectedWagonDef.capacite+'</div>';
    h += '<div style="font-size:11px;color:#8fa3bf;margin-bottom:6px">Ressource acceptée par ce wagon</div>';
    h += '<div style="display:flex;flex-wrap:wrap;gap:4px">';
    h += '<button class="tbtn" data-train-wagon-resource="-1" style="width:auto;margin:0;'+(!trainWagonSelectedResource(selectedWagon) ? 'border-color:#ffe082;color:#ffe082' : '')+'">Toutes</button>';
    for(const res of selectedWagonDef.resources){
      const active = trainWagonSelectedResource(selectedWagon) === res;
      h += '<button class="tbtn" data-train-wagon-resource="'+escHtml(res)+'" style="width:auto;margin:0;'+(active ? 'border-color:#ffe082;color:#ffe082' : '')+'">'
        + (RES[res]?.ic || '')+' '+escHtml(RES[res]?.n || res)+'</button>';
    }
    h += '</div></div>';
  }
  h += '</div>';
  // Section Contenu - afficher le contenu de chaque wagon
  h += '<div class="tp-section"><div class="tp-section-title">Contenu des wagons</div>';
  let hasContent = false;
  wagons.forEach((wagon, idx) => {
    const def = trainWagonDef(wagon);
    const load = _wagonLoad[idx];
    if(load.amt > 0){
      hasContent = true;
      const resIcon = load.passenger ? '👤' : (load.res ? RES[load.res]?.ic || '📦' : '📦');
      const resName = load.passenger ? 'Passagers' : (load.res ? RES[load.res]?.n || load.res : 'Vide');
      h += '<div style="font-size:11px;margin:4px 0;padding:6px;background:#16202f;border-radius:4px;border-left:3px solid '+(load.passenger ? '#c8e040' : (load.res ? RES[load.res]?.c || '#ffe082' : '#8fa3bf'))+';">'
         + '<div style="display:flex;justify-content:space-between;margin-bottom:2px">'
         + '<span><b>'+def.icone+' '+escHtml(def.nom.replace(/^Wagon\s+/,''))+'</b></span>'
         + '<span style="color:#8fa3bf;font-size:10px">'+load.amt+' / '+load.cap+'</span>'
         + '</div>'
         + '<div style="height:3px;border-radius:2px;background:#0a0f18;overflow:hidden">'
         + '<i style="display:block;height:100%;width:'+(load.cap > 0 ? Math.round(load.amt / load.cap * 100) : 0)+'%;background:'+(load.passenger ? '#c8e040' : (load.res ? RES[load.res]?.c || '#ffe082' : '#8fa3bf'))+';border-radius:2px"></i>'
         + '</div>'
         + '<div style="font-size:10px;color:#8fa3bf;margin-top:3px">'+resIcon+' '+escHtml(resName)+'</div>'
         + '</div>';
    }
  });
  if(!hasContent){
    h += '<div style="color:#8fa3bf;font-style:italic;font-size:11px">Tous les wagons sont vides.</div>';
  }
  h += '</div>';
  h += '<div class="tp-section"><div class="tp-section-title">Wagons <span style="font-size:11px;color:#8fa3bf;font-weight:normal">('+TRAIN_WAGON_COST.toLocaleString('fr-FR')+' $ / wagon)</span></div><div class="tp-wagon-grid">';
  for(const [key, def] of Object.entries(TRAIN_WAGON_TYPES)){
    const count = wagons.filter(w => trainWagonTypeKey(w) === key).length;
    h += '<div class="tp-order"><div><div>'+def.icone+' <b>'+def.nom+'</b></div><div style="font-size:11px;color:#8fa3bf">'+def.resources.map(r => RES[r]?.ic || r).join(' ')+' · '+def.capacite+'</div></div>'
      + '<div class="tp-inline"><button class="tbtn" data-train-wagon-del="'+key+'" style="width:auto;margin:0">−</button><b>'+count+'</b><button class="tbtn" data-train-wagon-add="'+key+'" style="width:auto;margin:0">+</button></div></div>';
  }
  h += '</div></div>';
  h += '<div class="tp-section"><div class="tp-section-title">Ordres</div>';
  if(orders.length){
    orders.forEach((b, idx) => {
      const mode = v.orderModes?.[idx] || 'load_unload';
      const modeLabel = mode === 'load' ? '📥 Load' :
                        mode === 'unload' ? '📤 Unload' :
                        '🔄 Load&Unload';
      h += '<div class="tp-order"><div><b>'+(idx + 1)+'.</b> '+escHtml(trainStopLabel(b))
         + ' <span style="font-size:10px;color:#8fa3bf;margin-left:8px">'+modeLabel+'</span></div>'
         + '<div style="display:flex;gap:4px">'
         + '<button class="tbtn" data-train-order-mode="'+idx+'" style="width:auto;margin:0;font-size:10px;padding:2px 6px">Changer</button>'
         + '<button class="tbtn" data-train-order-del="'+idx+'" style="width:auto;margin:0;color:#ff9a8a;font-size:10px;padding:2px 6px">Supprimer</button>'
         + '</div></div>';
    });
  } else {
    h += '<div style="color:#8fa3bf;font-style:italic">Aucun arrêt défini.</div>';
  }
  h += '<div class="tp-inline" style="margin-top:8px">'
    + '<button class="tbtn" id="tpAddStop" style="width:auto;margin:0">➕ Ajouter un arrêt</button>'
    + '<button class="tbtn" id="tpClearStops" style="width:auto;margin:0">Vider la route</button>'
    + '</div>';
  if(vehicleRouteMode?.step === 'train_order_append' && vehicleRouteMode.vehicle === v)
    h += '<div style="margin-top:8px;color:#e8d48b">Clique sur une gare ou un dépôt ferroviaire pour ajouter un arrêt.</div>';
  h += '</div>';
  h += '<div class="tp-section"><div class="tp-section-title">Actions</div>'
    + '<div class="tp-inline">'
    + '<button class="tbtn" id="tpApplyRoute" style="width:auto;margin:0">✅ Enregistrer la route</button>'
    + (flagState ? trainDepotFlagButtonHtml(v, ' id="tpTrainFlag"') : '')
    + '<button class="tbtn" id="tpSelectTrain" style="width:auto;margin:0">🎯 Sélectionner le train</button>'
    + '</div></div>';
  p.style.display = 'block';
  if(p._html === h && p._trainId === v.id) return;
  p._html = h;
  p._trainId = v.id;
  p.innerHTML = h;
  ensurePanelDragHandle('trainPanel');
  $('tpClose').onclick = () => closeTrainPanel();
  p.querySelectorAll('[data-train-wagon-pick]').forEach(btn => btn.onclick = ()=>{
    trainConfigSelectedWagonIndex = +btn.dataset.trainWagonPick;
    trainConfigLocoSelected = false;
    renderTrainPanel();
  });
  const locoBtn = p.querySelector('[data-train-loco]');
  if(locoBtn) locoBtn.onclick = ()=>{
    trainConfigLocoSelected = !trainConfigLocoSelected;
    renderTrainPanel();
  };
  const engineUpBtn = p.querySelector('[data-train-engine-up]');
  if(engineUpBtn) engineUpBtn.onclick = ()=>{
    const curMult = v.engineMult || 1;
    const curIdx = TRAIN_ENGINE_UPGRADES.reduce((acc, u, i) => u.facteur <= curMult ? i : acc, -1);
    const next = TRAIN_ENGINE_UPGRADES[curIdx + 1];
    if(!next) return;
    if(myWallet().money < next.cout){ toast('⛔ Fonds insuffisants ('+next.cout.toLocaleString('fr-FR')+' $).','err'); return; }
    spendMoney(next.cout, 'construction');
    v.engineMult = next.facteur;
    syncTrainConfig(v);
    panelFloat('trainPanel', '−'+next.cout.toLocaleString('fr-FR')+' $ · 🚂 ×'+next.facteur, '#ff6b6b');
    renderTrainPanel();
    renderInfo();
  };
  const engineDownBtn = p.querySelector('[data-train-engine-down]');
  if(engineDownBtn) engineDownBtn.onclick = ()=>{
    const curMult = v.engineMult || 1;
    const curIdx = TRAIN_ENGINE_UPGRADES.reduce((acc, u, i) => u.facteur <= curMult ? i : acc, -1);
    if(curIdx < 0) return;
    const refund = Math.floor(TRAIN_ENGINE_UPGRADES[curIdx].cout * 0.5);
    v.engineMult = curIdx > 0 ? TRAIN_ENGINE_UPGRADES[curIdx - 1].facteur : 1;
    earnMoney(refund, 'rembours');
    syncTrainConfig(v);
    panelFloat('trainPanel', '+'+refund.toLocaleString('fr-FR')+' $ · 🚂 ×'+(v.engineMult), '#9fe89f');
    renderTrainPanel();
    renderInfo();
  };
  p.querySelectorAll('[data-train-wagon-resource]').forEach(btn => btn.onclick = ()=>{
    const idx = trainConfigSelectedWagonIndex;
    const wagon = v.wagons?.[idx];
    if(!wagon) return;
    wagon.resource = btn.dataset.trainWagonResource === '-1' ? null : btn.dataset.trainWagonResource;
    syncTrainConfig(v);
    renderTrainPanel();
    renderInfo();
  });
  p.querySelectorAll('[data-train-wagon-add]').forEach(btn => btn.onclick = ()=>{
    if(myWallet().money < TRAIN_WAGON_COST){ toast('⛔ Fonds insuffisants ('+TRAIN_WAGON_COST.toLocaleString('fr-FR')+' $).','err'); return; }
    v.wagons = trainNormalizeWagons(v);
    const wagon = trainCreateWagon(btn.dataset.trainWagonAdd);
    if(!wagon) return;
    spendMoney(TRAIN_WAGON_COST, 'construction');
    panelFloat('trainPanel', '−'+TRAIN_WAGON_COST.toLocaleString('fr-FR')+' $ · 🚃', '#ff6b6b');
    v.wagons.push(wagon);
    trainConfigSelectedWagonIndex = v.wagons.length - 1;
    syncTrainConfig(v);
    renderTrainPanel();
    renderInfo();
  });
  p.querySelectorAll('[data-train-wagon-del]').forEach(btn => btn.onclick = ()=>{
    const key = btn.dataset.trainWagonDel;
    v.wagons = trainNormalizeWagons(v);
    let idx = -1;
    for(let i = v.wagons.length - 1; i >= 0; i--){
      if(trainWagonTypeKey(v.wagons[i]) === key){ idx = i; break; }
    }
    if(idx >= 0){
      v.wagons.splice(idx, 1);
      const refund = Math.floor(TRAIN_WAGON_COST * 0.5);
      earnMoney(refund, 'rembours');
      panelFloat('trainPanel', '+'+refund.toLocaleString('fr-FR')+' $ · 🚃', '#9fe89f');
    }
    trainConfigSelectedWagonIndex = Math.min(trainConfigSelectedWagonIndex, Math.max(0, v.wagons.length - 1));
    syncTrainConfig(v);
    renderTrainPanel();
    renderInfo();
  });
  p.querySelectorAll('[data-train-order-del]').forEach(btn => btn.onclick = ()=>{
    const idx = +btn.dataset.trainOrderDel;
    v.orders.splice(idx, 1);
    if(v.orderModes) v.orderModes.splice(idx, 1);
    syncTrainOrders(v);
    resetTrainDepotDeparture(v);
    renderTrainPanel();
    renderInfo();
  });
  p.querySelectorAll('[data-train-order-mode]').forEach(btn => btn.onclick = ()=>{
    const idx = +btn.dataset.trainOrderMode;
    v.orderModes = v.orderModes || [];
    const modes = ['load', 'unload', 'load_unload'];
    const current = v.orderModes[idx] || 'load_unload';
    const currentIdx = modes.indexOf(current);
    v.orderModes[idx] = modes[(currentIdx + 1) % modes.length];
    renderTrainPanel();
  });
  $('tpAddStop').onclick = ()=>{
    vehicleRouteMode = { vehicle:v, step:'train_order_append' };
    setTool('select');
    renderTrainPanel();
  };
  $('tpClearStops').onclick = ()=>{
    v.orders = [];
    v.orderModes = [];
    v.source = null;
    v.dest = null;
    v.orderIndex = 0;
    v.vizRoute = null;
    resetTrainDepotDeparture(v);
    renderTrainPanel();
    renderInfo();
  };
  $('tpApplyRoute').onclick = ()=>{
    if((v.orders || []).length < 2){
      toast('⛔ Il faut au moins 2 arrêts pour un train.','err');
      return;
    }
    if(!trainPresentAtDepot(v)){
      toast('⛔ Le train doit être dans le dépôt pour appliquer une nouvelle route.','err');
      return;
    }
    v.orderIndex = 0;
    syncTrainOrders(v);
    v.state = 'idle';
    v.currentBuilding = v.garageRef;
    v.pts = [];
    v.pathTiles = [];
    v.railTrail = [];
    v.railContinueTile = null;
    v.railPreviousTile = null;
    v.waitTimer = 0;
    resetTrainDepotDeparture(v);
    if(MP.connected) netSend({
      type:'route_vehicle',
      id:v.id,
      orderIndex:v.orderIndex || 0,
      orders:(v.orders || []).map(b => ({ x:b.x, y:b.y })),
      orderModes:(v.orderModes || []).slice(),
    });
    toast('Route du train enregistrée. Appuie sur le drapeau pour autoriser le départ.','win');
    renderTrainPanel();
    renderInfo();
  };
  const tpTrainFlag = $('tpTrainFlag');
  if(tpTrainFlag) tpTrainFlag.onclick = ()=> handleTrainDepotFlagClick(v);
  $('tpSelectTrain').onclick = ()=>{
    selectedVehicle = v;
    selected = null;
    renderInfo();
  };
}

function statusOf(b){
  if(BUILD[b.type].resid){
    if(b.starterHome) return 'Maison de départ protégée (pas besoin de ravitaillement)';
    const req = residRequiredOf(b);
    const missingReq = req.filter(r => (b.storage[r]||0) <= 0);
    const fusionMissing = residFusionRequiredOf(b)
      .filter(r => !req.includes(r) && (b.storage[r]||0) <= 0);
    const bonusMissing = residBonusOf(b).filter(r => (b.storage[r]||0) <= 0);
    if(missingReq.length === 0){
      const txt = 'Consomme '+resNames(req)+'…';
      if(fusionMissing.length) return txt+' — manque '+resNames(fusionMissing)+' pour monter';
      if(bonusMissing.length) return txt+' — bonus demandé : '+resNames(bonusMissing);
      return txt;
    }
    if(b.pop > (b.protectedPop||0) && b.starve > 0)
      return '⚠️ Pénurie : manque '+resNames(missingReq)+' ! Dégradation dans '+Math.max(0,Math.ceil(STARVE_DELAY-b.starve))+' s';
    return 'Attend : '+resNames(missingReq);
  }
  if(b.type==='market') return 'Marché — vente aux autres joueurs';
  if(isVehicleDepot(b)){
    if(b.type === 'garage'){
      const active = (b.vehicles||[]).filter(v=>v.state!=='idle').length;
      return active > 0 ? active+' véhicule(s) en tournée' : 'Aucun véhicule en service';
    }
    return (BUILD[b.type]?.n || 'Dépôt')+' — point d’achat de moyens de transport';
  }
  if(isStorageDepot(b)) return 'Stocke et redistribue';
  if(b.type==='tank') return 'Stocke l’eau pour les boulangeries proches';
  if(b.type==='bus_stop'){
    const max = b.passengersMax || 0;
    const cur = Math.floor(b.passengers || 0);
    const pE = Math.floor(b.passengersEntrant || 0);
    const pS = Math.floor(b.passagersSortant || 0);
    const parts = [];
    if(max > 0) parts.push('↑ '+cur+'/'+max+' départ');
    if(pE > 0) parts.push(pE+' arrivant'+(pE>1?'s':''));
    if(pS > 0) parts.push('↓ '+pS+' retour');
    if(parts.length === 0) return 'Aucun habitant à portée (rayon '+BUS_STOP_RADIUS+' cases)';
    return parts.join(' · ');
  }
  if(isTrainStationPiece(b)){
    const main = trainStationGroupRepresentative(b.stationGroupId) || b;
    const depot = trainStationLinkedDepot(b);
    const pE = Math.floor(main.passengersEntrant || 0);
    const pEMax = main.passengersEntrantMax || 0;
    const pS = Math.floor(main.passagersSortant || 0);
    const parts = [];
    if(pEMax > 0) parts.push('↑ '+pE+'/'+pEMax);
    if(pS > 0) parts.push('↓ '+pS);
    const pasStr = parts.length ? 'Passagers : '+parts.join(' · ') : 'Gare ferroviaire';
    return pasStr + (depot ? ' · Entrepôt lié' : '');
  }
  if(b.type === 'plant') return 'Usine abandonnée — choisir une spécialisation';
  if(b.type === 'bakery' && !tankNear(b)) return '⚠️ Aucune citerne proche pour recevoir l’eau';
  if(b.paused) return 'En pause — ouvriers libérés';
  const r = recipeOf(b);
  if(!r) return '';
  for(const k in r.out) if((b.storage[k]||0) >= capOf(b,k)) return 'Stock de sortie plein';
  for(const k in r.in)  if((b.storage[k]||0) <  r.in[k]) return 'Manque : '+RES[k].n;
  const req = workersRequiredOf(b);
  if(req && workersAllocatedOf(b) < req)
    return "Production à "+Math.round(workersAllocatedOf(b)/req*100)+" % (manque d'ouvriers à portée)";
  if(req && (b.workersByBusStop||0) > 0){
    const byBus = b.workersByBusStop, total = workersAllocatedOf(b);
    const byHome = total - byBus;
    if(byHome === 0) return 'En production · '+byBus+'/'+req+' ouvriers via arrêt de bus 🚌';
    return 'En production · '+byBus+'/'+req+' ouvrier'+(byBus>1?'s':'')+' via arrêt de bus 🚌';
  }
  if(b.type === 'fisher'){
    const bonus = fisherFishBonus(b);
    if(bonus > 0) return 'En production · +'+bonus+' poisson'+(bonus>1?'s':'')+' (zones poissonneuses)';
  }
  return 'En production';
}

function _updVDyn(p, v){
  const el = p.querySelector('[data-v-state="'+v.id+'"]');
  if(!el) return;
  let lbl = v.state==='idle' ? 'En attente' : v.state==='returning' ? 'Retour dépôt' : v.state==='to_source' ? 'Vers source' : 'Vers destination';
  if(v.vtype === 'train' && trainPresentAtDepot(v) && (v.orders?.length || 0) >= 2)
    lbl = trainDepotDepartureArmed(v) ? 'Départ autorisé' : 'À l’arrêt au dépôt';
  const cargo = v.cargo > 0 ? ' · '+v.cargo+(v.res ? ' '+RES[v.res].n : '') : '';
  const flagState = v.vtype === 'train' ? trainDepotFlagState(v) : null;
  const flagLbl = flagState ? (flagState.armed ? ' · drapeau vert' : ' · drapeau rouge') : '';
  el.textContent = lbl + cargo + flagLbl;
}

function renderInfo(){
  const p = $('info');

  // --- Zone d'expansion sélectionnée ---
  if(selectedExpansion && !selected && !selectedVehicle){
    const exp = selectedExpansion;
    if(!expansions.includes(exp)){ selectedExpansion = null; }
    else {
      const dirLabels = { right:'droite', left:'gauche', bottom:'bas', top:'haut',
        'top-left':'coin haut-gauche','top-right':'coin haut-droite',
        'bottom-left':'coin bas-gauche','bottom-right':'coin bas-droite' };
      const dir = dirLabels[exp.side] || exp.side;
      const isCorner = !exp.strip;
      const n = EXP_N_PIECES;
      const bought = isCorner ? 0 : Array.from({length:n},(_,i)=>exp.side+'-'+i).filter(k=>purchasedPieces.has(k)).length;
      const canAfford = myWallet().money >= exp.cost;
      // Compter les zones de ressource dans la pièce
      const resCounts = {};
      for(let ey = exp.y0; ey < exp.y1; ey++)
        for(let ex2 = exp.x0; ex2 < exp.x1; ex2++){
          if(!exp.inPiece(ex2, ey)) continue;
          const tt = terrain[ey * N + ex2];
          if(tt !== T.GRASS) resCounts[tt] = (resCounts[tt] || 0) + 1;
        }
      const terrainResTypes = [
        { t:T.IRON,   ic:RES.iron.ic,   n:RES.iron.n   },
        { t:T.COAL,   ic:RES.coal.ic,   n:RES.coal.n   },
        { t:T.TREE,   ic:RES.wood.ic,   n:RES.wood.n   },
        { t:T.WHEAT,  ic:RES.wheat.ic,  n:RES.wheat.n  },
        { t:T.COTTON, ic:RES.cotton.ic, n:RES.cotton.n },
        { t:T.WATER,  ic:'💧',          n:'Eau'         },
      ];
      let h_ = '<div class="panel-head"><h3>🧩 Pièce de puzzle</h3><button class="tbtn" id="infoCloseBtn" aria-label="Fermer">✕</button></div>';
      h_ += '<div class="status">Vers : <b>'+dir+'</b>'+(isCorner?' (coin)':' — pièce '+(exp.pieceIndex+1)+'/'+n)+'</div>';
      if(!isCorner && bought>0)
        h_ += '<div class="row"><span>Pièces achetées</span><b>'+bought+'/'+n+'</b></div>';
      if(!isCorner)
        h_ += '<div class="row"><span>Achetez les '+n+' pièces pour débloquer la prochaine bande</span></div>';
      h_ += '<div class="row"><span>Prix pièce</span><b style="color:'+(canAfford?'#ffe9a0':'#ff9a8a')+'">'+exp.cost.toLocaleString()+' $</b></div>';
      if(!isCorner && (expansionLevels[exp.side]||0)>0)
        h_ += '<div class="row"><span>Bande n°</span><b>'+((expansionLevels[exp.side]||0)+1)+'</b></div>';
      const resRows = terrainResTypes.filter(r => resCounts[r.t] > 0);
      if(resRows.length > 0){
        h_ += '<div class="row" style="margin-top:4px;border-top:1px solid #334;padding-top:4px"><span style="font-weight:600">Ressources dans la pièce</span></div>';
        for(const r of resRows)
          h_ += '<div class="row"><span>'+r.ic+' '+r.n+'</span><b>'+resCounts[r.t]+'</b></div>';
      }
      h_ += '<button class="tbtn" style="margin-top:8px;width:100%;'+(canAfford?'':'opacity:0.5;cursor:not-allowed;')+'" '
          + 'onclick="buyExpansion(selectedExpansion)">'
          + (canAfford ? '🧩 Acheter cette pièce' : '💸 Fonds insuffisants')
          + '</button>';
      p.style.display = 'block';
      if(p._html === h_) return;
      p._html = h_; p._b = null;
      p.innerHTML = h_;
      ensurePanelDragHandle('info');
      return;
    }
  }

  // --- Véhicule sélectionné ---
  if(selectedVehicle){
    if(selectedVehicle.garageRef?.dead){ selectedVehicle = null; }
    else {
      const veh = selectedVehicle;
      const vt = VEHICLE_TYPES[veh.vtype];
      if(veh.vtype === 'train' && !veh.name) assignTrainVehicleName(veh);
      let stateLabel = { idle:'En attente 💤', to_source:'Vers source 🔵', to_dest:'Vers destination 🟠', returning:'Retour au dépôt 🏪' }[veh.state] || veh.state;
      if(veh.vtype === 'train' && trainPresentAtDepot(veh) && (veh.orders?.length || 0) >= 2)
        stateLabel = trainDepotDepartureArmed(veh) ? 'Départ autorisé 🚩' : 'À l’arrêt au dépôt 🟥';
      const srcName = veh.source && !veh.source.dead ? trainStopLabel(veh.source) : '—';
      const dstName = veh.dest   && !veh.dest.dead   ? trainStopLabel(veh.dest)  : '—';
      const isBusVeh = veh.vtype === 'bus';
      const srcNameDisplay = isBusVeh && veh.source && !veh.source.dead
        ? (veh.source.name || BUILD[veh.source.type].n) : srcName;
      const dstNameDisplay = isBusVeh && veh.dest && !veh.dest.dead
        ? (veh.dest.name || BUILD[veh.dest.type].n) : dstName;
      const cargoStr = isBusVeh
        ? (veh.cargo > 0 ? veh.cargo+' passager(s)' : 'Vide')
        : (veh.cargo > 0 ? veh.cargo+' '+(veh.res ? RES[veh.res].n : '') : 'Vide');
      const _vehPassCap = veh.vtype === 'train' ? trainPassengerCapacity(veh) : 0;
      const passengerStr = _vehPassCap > 0
        ? (veh.passengersOnBoard||0)+' / '+_vehPassCap+' voyageur(s) 🚃' : null;
      const orderSummary = veh.vtype === 'train' && veh.orders?.length
        ? veh.orders.map(b => trainStopLabel(b)).join(' → ')
        : null;
      const trainFlagState = veh.vtype === 'train' ? trainDepotFlagState(veh) : null;
      const vehLabel = veh.vtype === 'train' ? (veh.name || 'Train') : vt.nom;
      let h = '<h3><span style="font-size:22px">'+vt.icone+'</span> '+escHtml(vehLabel)+'<span style="margin-left:auto"></span><button class="tbtn" id="infoCloseBtn" aria-label="Fermer" style="width:auto;margin:0;padding:2px 8px">✕</button></h3>';
      h += '<div class="status">'+stateLabel+'</div>';
      h += '<div class="row"><span>Cargaison</span><b>'+cargoStr+'</b></div>';
      if(passengerStr) h += '<div class="row"><span>Voyageurs</span><b style="color:#c8e040">'+passengerStr+'</b></div>';
      h += '<div class="row"><span>Source</span><b style="color:#4dd9ff">'+srcNameDisplay+'</b></div>';
      h += '<div class="row"><span>Destination</span><b style="color:#ffaa44">'+dstNameDisplay+'</b></div>';
      if(trainFlagState)
        h += '<div class="row"><span>Drapeau</span><b style="color:'+(trainFlagState.armed ? '#7dda5a' : '#ff7474')+'">'+(trainFlagState.armed ? 'Vert' : 'Rouge')+'</b></div>';
      if(orderSummary) h += '<div style="margin-top:6px;color:#b9c8dc">'+escHtml(orderSummary)+'</div>';
      h += '<div class="row"><span>Capacité</span><b>'+(veh.vtype === 'train' ? trainTotalCapacity(veh) : vt.capacite)+'</b></div>';
      if(veh.boughtAtGtime != null)
        h += '<div class="row"><span>Acheté le</span><b style="color:#8fa3bf">'+formatGameDate(veh.boughtAtGtime)+'</b></div>';
      if((vt.maintenanceCost ?? 0) > 0){
        const _d = veh.maintenanceDaysPaid || 0;
        const _cm = Math.floor(_d / 30);
        const _c = Math.round(vt.maintenanceCost * Math.pow(1 + VEHICLE_MAINTENANCE_RATE, _cm));
        const _nextDue = veh.boughtAtGtime != null ? formatGameDate(veh.boughtAtGtime + VEHICLE_MAINTENANCE_DAY * (_d + 1)) : '—';
        h += '<div class="row"><span>Entretien journalier</span><b style="color:#ff9a8a">'+_c+' $'+(_cm > 0 ? ' <span style="color:#8fa3bf;font-size:11px">(mois '+(_cm+1)+')</span>' : '')+'</b></div>';
        h += '<div class="row"><span>Prochain paiement</span><b style="color:#8fa3bf">'+_nextDue+'</b></div>';
      }
      h += '<div class="row"><span>Vitesse</span><b>'+vt.speed+' cases/s</b></div>';
      // Section État des wagons pour les trains
      if(veh.vtype === 'train'){
        const wagons = trainNormalizeWagons(veh);
        const _totalFreightCap = wagons.reduce((s, w) => {
          const d = trainWagonDef(w);
          return s + ((!d?.passenger && veh.res && trainWagonAcceptedResources(w).includes(veh.res)) ? d.capacite : 0);
        }, 0);
        const _totalPassCap2 = wagons.reduce((s, w) => {
          const d = trainWagonDef(w); return s + (d?.passenger ? d.capacite : 0);
        }, 0);
        let _freightRemainder = veh.cargo || 0;
        let _passRemainder = veh.passengersOnBoard || 0;
        const _wagonLoad = wagons.map((wagon, idx) => {
          const d = trainWagonDef(wagon);
          if(d?.passenger && _totalPassCap2 > 0){
            const share = idx === wagons.length - 1
              ? _passRemainder
              : Math.round((veh.passengersOnBoard || 0) * d.capacite / _totalPassCap2);
            _passRemainder -= share;
            return { amt: share, res: null, passenger: true, cap: d.capacite };
          }
          if(!d?.passenger && veh.res && _totalFreightCap > 0 && trainWagonAcceptedResources(wagon).includes(veh.res)){
            const share = idx === wagons.length - 1
              ? Math.max(0, _freightRemainder)
              : Math.round((veh.cargo || 0) * d.capacite / _totalFreightCap);
            _freightRemainder -= share;
            return { amt: share, res: veh.res, passenger: false, cap: d.capacite };
          }
          return { amt: 0, res: null, passenger: d?.passenger || false, cap: d?.capacite || 0 };
        });
        h += '<div style="margin-top:8px;padding:6px;background:#0a0f18;border-radius:6px;border:1px solid #36465e">';
        h += '<div style="font-size:12px;font-weight:bold;color:#8fa3bf;margin-bottom:4px">État des wagons</div>';
        h += '<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">';
        h += '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid #36465e;border-radius:3px;background:#16202f;font-size:16px;padding:2px">🚂<div style="font-size:8px;color:#8fa3bf">loco</div></div>';
        for(let idx=0; idx<wagons.length; idx++){
          const wagon = wagons[idx];
          const def = trainWagonDef(wagon);
          const load = _wagonLoad[idx];
          const selectedRes = trainWagonSelectedResource(wagon);
          if(def){
            const icon = selectedRes ? (RES[selectedRes]?.ic || '📦') : def.icone;
            h += '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid #36465e;border-radius:3px;background:#16202f;padding:2px;font-size:14px;line-height:1.2">'
               + '<div>'+icon+'</div>'
               + '<div style="font-size:8px;color:#8fa3bf">'+load.amt+'/'+load.cap+'</div>'
               + '</div>';
          }
        }
        h += '</div>';
        h += '</div>';
      }
      const trainConfigDisabled = veh.vtype === 'train' && !trainPresentAtDepot(veh);
      h += '<div style="margin-top:8px;display:flex;gap:4px">'
         + '<button class="tbtn" style="flex:1'
         + (trainConfigDisabled ? ';opacity:.5;cursor:not-allowed' : '')
         + '" id="bVehRoute">'+(veh.vtype === 'train' ? '🧭 Configurer' : '🔁 Nouvelle route')+'</button>'
         + (trainFlagState ? trainDepotFlagButtonHtml(veh, ' id="bVehTrainFlag"') : '')
         + '</div>';
      if(veh.state !== 'idle' && veh.state !== 'returning')
        h += '<button class="tbtn" style="width:100%;margin-top:4px" id="bVehReturn">🏪 Retour au dépôt</button>';
      h += '<button class="tbtn" style="width:100%;margin-top:4px;color:#ff9a8a" id="bVehSell">🗑️ Vendre (+'
         + Math.floor(vt.cost*0.5)+' $)</button>';
      p.style.display = 'block';
      if(p._html === h) return;
      p._html = h; p._b = null;
      p.innerHTML = h;
      ensurePanelDragHandle('info');
      $('bVehRoute').onclick = ()=>{
        if(veh.vtype === 'train'){
          if(!trainPresentAtDepot(veh)){
            toast('⛔ La configuration du train n’est possible que dans le dépôt.','err');
            return;
          }
          openTrainPanel(veh);
          return;
        }
        vehicleRouteMode = { vehicle:veh, step:'source' };
        setTool('select');
        if(veh.vtype === 'bus')
          toast('🚌 Clique sur l\'arrêt de bus ou la gare de départ pour '+vt.nom+'.');
        else if(veh.vtype === 'train')
          toast('🚂 Clique sur la gare ou le dépôt ferroviaire de départ pour '+vt.nom+'.');
        else
          toast('🔁 Clique sur l\'entrepôt source pour '+vt.nom+'.');
        p._html = null;
      };
      const vehFlagBtn = $('bVehTrainFlag');
      if(vehFlagBtn) vehFlagBtn.onclick = ()=> handleTrainDepotFlagClick(veh);
      const retBtn = $('bVehReturn');
      if(retBtn) retBtn.onclick = ()=>{
        returnToGarage(veh);
        if(MP.connected) netSend({ type:'return_vehicle', id:veh.id });
        toast('🏪 '+vt.nom+' retourne au dépôt.');
        p._html = null;
      };
      $('bVehSell').onclick = ()=>{
        const refund = Math.floor(vt.cost * 0.5);
        earnMoney(refund, 'rembours');
        removePersistentVehicle(veh);
        if(MP.connected) netSend({ type:'sell_vehicle', id:veh.id });
        toast('🗑️ Véhicule vendu (+'+refund+' $)');
        p._html = null;
      };
      return;
    }
  }

  if(!selected || selected.dead){ p.style.display = 'none'; return; }
  const b = selected, d = BUILD[b.type];
  const canControl = !MP.connected || !b.owner || b.owner === MP.myId;
  const r2 = recipeOf(b);
  const _demolCost = Math.floor((d.cost||0)*0.3);
  let _hdrBtns = '<span style="margin-left:auto;display:flex;gap:3px;align-items:center">';
  if(d.ind && r2)
    _hdrBtns += '<button class="tbtn" id="bClearStock" title="Vider le stock" style="padding:2px 6px;font-size:13px;margin:0;width:auto">🗑️</button>';
  if(d.ind)
    _hdrBtns += '<button class="tbtn" id="bPauseBld" title="'+(b.paused?'Reprendre':'Mettre en pause')+'" style="padding:2px 6px;font-size:13px;margin:0;width:auto">'+(b.paused?'▶':'⏸')+'</button>';
  _hdrBtns += '<button class="tbtn" id="bDemol" title="Démolir (+'+_demolCost+' $)" style="padding:2px 6px;font-size:13px;margin:0;width:auto">🧨</button>';
  _hdrBtns += '<button class="tbtn" id="infoCloseBtn" title="Fermer" aria-label="Fermer" style="padding:2px 8px;font-size:13px;margin:0;width:auto">✕</button>';
  _hdrBtns += '</span>';
  let h = '<h3><span style="font-size:22px">'+d.ic+'</span>';
  if(d.ind || isVehicleDepot(b)){
    h += '<input id="bldNameInput" class="bld-name-edit" value="'+escHtml(b.name||'')+'" placeholder="'+escHtml(d.n)+'">';
  } else {
    h += '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
       + (b.name ? escHtml(b.name) : d.n) + '</span>';
  }
  h += _hdrBtns+'</h3>';
  h += '<div class="status">'+statusOf(b)+'</div>';
  if(isTrainStationPiece(b)){
    const stationPieces = buildings.filter(piece => isTrainStationPiece(piece) && piece.stationGroupId === b.stationGroupId);
    const stationTiles = stationPieces.filter(piece => piece.type === 'train_station').length;
    const platformTrackLengths = new Map();
    for(const piece of stationPieces){
      if(piece.type !== 'train_platform') continue;
      const [dx, dy] = String(piece.stationAxis || '0,0').split(',').map(Number);
      const trackKey = piece.stationAxis+'|'+((piece.x * dy) - (piece.y * dx));
      platformTrackLengths.set(trackKey, (platformTrackLengths.get(trackKey) || 0) + 1);
    }
    const platformTracks = [...platformTrackLengths.values()].filter(length => length === stationTiles).length;
    h += '<div style="margin-top:6px;color:#b9c8dc">Longueur '+stationTiles
      +' · Nombre de quai '+platformTracks+'</div>';
    const mainStation = trainStationGroupRepresentative(b.stationGroupId) || b;
    if(mainStation.passengersEntrant != null){
      const pE = Math.floor(mainStation.passengersEntrant || 0);
      const pEMax = mainStation.passengersEntrantMax || 0;
      const pS = Math.floor(mainStation.passagersSortant || 0);
      h += '<div class="row"><span>Passagers entrants</span><b style="color:#c8e040">🚶 '+pE+(pEMax>0?' / '+pEMax:'')+'</b></div>';
      h += '<div class="row"><span>Passagers sortants</span><b style="color:#9fd4f0">🚶 '+pS+'</b></div>';
      h += '<div class="row"><span>Rayon</span><b>'+TRAIN_STATION_RADIUS+' cases</b></div>';
      h += '<div class="row"><span>Tarif</span><b style="color:#ffe9a0">'+TRAIN_FARE_FACTOR+' $/passager/case</b></div>';
    }
    const linkedDepot = trainStationLinkedDepot(b);
    if(linkedDepot){
      const isOwner = !linkedDepot.owner || linkedDepot.owner === (MP.myId ?? null);
      const depotRadius = depotRadiusOf(linkedDepot);
      h += '<div style="margin-top:10px;color:#8fa3bf;font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">📦 Entrepôt fusionné</div>';
      h += '<div style="color:#8fa3bf;font-size:10px;margin-bottom:6px">Rayon d\'action : <b style="color:#ffd700">'+depotRadius+' cases</b></div>';
      if(isOwner){
        h += '<div style="margin-bottom:8px;padding:8px;background:rgba(91,147,232,.06);border-radius:6px;border-left:3px solid #5b93e8;font-size:11px;color:#8fa3bf">'
           + '<div style="margin-bottom:4px;font-weight:600;color:#e8eef7">Modes d\'acceptation :</div>'
           + '<div style="margin:4px 0">🔴 <span style="color:#999">Désactivé</span> — aucune livraison, pas de train</div>'
           + '<div style="margin:4px 0">🔵 <span style="color:#5b93e8">Accepte uniquement</span> — camions livrent, trains n\'en chargent pas</div>'
           + '<div style="margin:4px 0">🟢 <span style="color:#4db86a">Accepte & distribue</span> — camions livrent, trains chargent</div>'
           + '</div>';
        h += '<div class="depot-cols-3">';
        for(const k in RES){
          if(k === 'water') continue;
          const disabled = linkedDepot.allow?.[k] === false;
          const trainOn  = !disabled && linkedDepot.trainAllow?.[k] !== false;
          const stateClass = disabled ? '' : (trainOn ? ' train' : ' on');
          const val = linkedDepot.storage[k]||0, cap = capOf(linkedDepot,k);
          const pct = cap>0 ? Math.min(100,Math.round(100*val/cap)) : 0;
          const stateLabel = disabled ? '<span style="font-size:11px;color:#999">🔴</span>'
            : trainOn ? '<span style="font-size:11px;color:#4db86a">🟢</span>'
            : '<span style="font-size:11px;color:#5b93e8">🔵</span>';
          h += '<div class="depot-res-item'+stateClass+'" style="cursor:pointer;flex-direction:column;align-items:stretch;padding:5px 7px" data-station-depot-toggle-res="'+k+'">'
             + '<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px">'
             + '<span class="dot" style="background:'+RES[k].c+'"></span>'
             + '<span style="flex:1;font-size:11px;'+(disabled?'opacity:.4':'')+'">' + RES[k].n + '</span>'
             + (cap>0 ? '<span style="font-size:10px;color:#8fa3bf">'+val+'/'+cap+'</span>' : '')
             + '</div>'
             + (cap>0 ? '<div style="height:4px;border-radius:2px;background:#1a2535"><i style="display:block;height:100%;width:'+pct+'%;background:'+RES[k].c+';border-radius:2px;opacity:'+(disabled?'0.3':'1')+'"></i></div>' : '')
             + '</div>';
        }
        h += '</div>';
      } else {
        h += '<div style="color:#8fa3bf;font-size:12px;font-style:italic">Appartient à un autre joueur.</div>';
      }
    } else {
      h += '<div style="margin-top:8px;color:#8fa3bf;font-size:11px;font-style:italic">Aucun entrepôt adjacent — les trains ne peuvent pas charger de ressources.</div>';
    }
  }
  if(b.type === 'train_depot' || isTrainStationPiece(b)){
    if(!adjRailTiles(b).length)
      h += '<div class="warn">⚠️ Aucun rail adjacent — pas de trains !</div>';
  } else if(!adjRoadTiles(b).length){
    h += '<div class="warn">⚠️ Aucune route adjacente — pas de camions !</div>';
  }
  if(b.type === 'plant'){
    const canUpgrade = !MP.connected || !b.owner || b.owner === MP.myId;
    h += '<div style="margin-top:8px;color:#8fa3bf">Spécialisation</div>';
    h += '<div style="font-size:11px;color:#8fa3bf;margin-bottom:4px">Choisir une seule fois le type d\'usine.</div>';
    for(const key in PLANT_UPGRADES){
      const opt = PLANT_UPGRADES[key];
      const d2 = BUILD[opt.type];
      const err = plantUpgradeError(b, opt.type);
      if(err) continue; // masquer les types impossibles
      h += '<button class="tbtn" style="width:100%;text-align:left;margin-top:3px" data-plant-upgrade="'+opt.type+'"'
        + (!canUpgrade ? ' disabled' : '') + '>'
        + opt.icon+' '+opt.label+' <span style="color:#8fa3bf">— '+(d2.cost||0)+' $</span>'
        + '</button>';
    }
  }
  if(d.ind && b.name) h += '<div style="color:#8fa3bf;font-size:11px;margin-top:6px;margin-bottom:2px">'+d.n+'</div>';
  if(d.workers) h += '<div class="row"><span>Ouvriers</span><b>'+workersAllocatedOf(b)+' / '+workersRequiredOf(b)+'</b></div>';
  if(d.ind && b.w*b.h>1)
    h += '<div class="row"><span>Taille / production</span><b>'+b.w+'×'+b.h
       + ' — ×'+prodMult(b).toFixed(1)+'</b></div>';
  if(d.ind)
    h += '<div class="row"><span>Entretien</span><b>'+(Math.round(upkeepOf(b)*10)/10)
       + ' $ / '+IND_UPKEEP_INTERVAL+' s</b></div>';
  if(d.ind)
    h += '<div class="row"><span>Rayon d\'action</span><b style="color:#ff8c42">'+indRadiusOf(b)+' cases</b></div>';
  if(b.type === 'bakery')
    h += '<div class="row"><span>Citerne proche</span><b style="color:'+(tankNear(b) ? '#9fe8a0' : '#ff9a8a')+'">'
       + (tankNear(b) ? 'oui' : 'non') + ' / '+BAKERY_TANK_RADIUS+' cases</b></div>';
  if(d.resid)
    h += '<div class="row"><span>Habitants</span><b>'+b.pop+' / '+d.resid.popCap+'</b></div>';
  if(d.resid){
    const town = getTownOf(b);
    if(town) h += '<div class="row"><span>Village</span><b style="color:#e8d48b">🏘️ '+escHtml(town.name)
      +'</b></div>';
  }
  if(d.resid && !b.starterHome){
    const incomePerCycle = d.resid.income * Math.max(1, b.pop);
    const ratePerMin = b.pop > 0 ? Math.round(incomePerCycle / d.resid.interval * 60) : 0;
    h += '<div class="row"><span>Revenu / outil livré</span><b>'+incomePerCycle+' $</b></div>';
    h += '<div class="row"><span>Besoins indispensables</span><b>'+escHtml(resNames(residRequiredOf(b)))+'</b></div>';
    h += '<div class="row"><span>Besoins de fusion</span><b>'+escHtml(resNames(residFusionRequiredOf(b)))+'</b></div>';
    h += '<div class="row"><span>Bonus</span><b style="color:#c7e7e9">'+escHtml(resNames(residBonusOf(b)))+' (+20 % si disponible)</b></div>';
    h += '<div class="row"><span>Intervalle conso.</span><b>'+d.resid.interval+' s</b></div>';
    h += '<div class="row"><span>Revenu / min</span><b style="color:#9fe8a0">~'+ratePerMin+' $</b></div>';
  }
  if(d.resid)
    h += '<div class="row"><span>Rayon travail</span><b>'+workRadiusOf(b)+' cases</b></div>';
  // Stocks : pour les usines, séparer entrée / recette / sortie
  const inKeys  = d.ind && r2 ? Object.keys(r2.in||{})  : [];
  const outKeys = d.ind && r2 ? Object.keys(r2.out||{}) : [];
  const inSet   = new Set(inKeys), outSet = new Set(outKeys);
  const extraKeys = Object.keys(b.storage).filter(k => b.storage[k]>0 && !inSet.has(k) && !outSet.has(k));
  const showStock = (k) => {
    const cap = capOf(b,k), val = b.storage[k]||0;
    const ic = RES[k].ic ? '<span style="margin-right:4px">'+RES[k].ic+'</span>' : '';
    h += '<div class="row"><span>'+ic+RES[k].n+'</span><b>'+val+' / '+cap+'</b></div>';
    h += '<div class="bar"><i style="width:'+Math.min(100,100*val/cap)+'%;background:'+RES[k].c+'"></i></div>';
  };
  if(d.ind && r2){
    // entrées (toujours affichées)
    if(inKeys.length) h += '<div style="margin-top:8px"></div>';
    inKeys.forEach(showStock);
    // recette
    const fmtRes = obj => Object.entries(obj).map(([k,v]) =>
      (v>1 ? '<span style="color:#8fa3bf;font-weight:normal">'+v+'×</span>' : '')
      + '<span class="res-ic" title="'+escHtml(RES[k].n)+'">'+(RES[k].ic || RES[k].n)+'</span>'
    ).join('<span style="color:#8fa3bf;font-weight:normal"> + </span>');
    const lhs  = inKeys.length ? fmtRes(r2.in)+'<span style="color:#8fa3bf;font-weight:normal"> → </span>' : '';
    const time = Math.round(r2.time*10)/10;
    h += '<div class="row" style="margin:6px 0 2px"><span style="color:#8fa3bf">Recette</span>'
       + '<b style="color:#d4e8ff">'+lhs+fmtRes(r2.out)
       + ' <span style="color:#8fa3bf;font-weight:normal">/ '+time+'s</span></b></div>';
    if(b.type === 'fisher'){
      const bonus = fisherFishBonus(b);
      if(bonus > 0){
        const effLine = Object.entries(r2.out).map(([k,v]) => {
          const eff = v + bonus;
          return eff+' <span class="res-ic" title="'+escHtml(RES[k].n)+'">'+(RES[k].ic||RES[k].n)+'</span>';
        }).join(' + ');
        h += '<div class="row"><span style="color:#3bc4f5">Production effective</span>'
           + '<b style="color:#3bc4f5">'+effLine
           + ' <span style="color:#8fa3bf;font-weight:normal">/ '+time+'s (+'+bonus+')</span></b></div>';
      }
    }
    // sortie (toujours affichée)
    outKeys.forEach(showStock);
    // ressources hors recette (rare)
    if(extraKeys.length){
      extraKeys.forEach(showStock);
    }
  } else if(!isStorageDepot(b) && !isVehicleDepot(b)) {
    // bâtiments non-industriels (logements…)
    const allKeys = [...new Set([
      ...Object.keys(b.storage).filter(k=>b.storage[k]>0 || (b.inc[k]||0)>0),
    ])];
    if(allKeys.length){
      h += '<div style="margin-top:8px;color:#8fa3bf">Stocks</div>';
      allKeys.forEach(showStock);
    }
  }
  if(isStorageDepot(b) && b.type !== 'market'){
    const myOid = MP.myId;
    const isOwner = !b.owner || b.owner === myOid;
    const depotRadius = BUILD[b.type]?.radiusOf ? BUILD[b.type].radiusOf(b) : depotRadiusOf(b);
    h += '<div style="color:#8fa3bf;font-size:10px;margin-bottom:6px">Rayon d\'action : <b style="color:#ffd700">'+depotRadius+' cases</b>'+(b.w*b.h>1?' · Taille <b>'+b.w+'×'+b.h+'</b>':'')+'</div>';
    if(isOwner){
      h += '<div style="color:#8fa3bf;font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">📦 Ressources stockées</div>';
      h += '<div class="depot-cols-3">';
      for(const k in RES){
        if(k === 'water') continue;
        const on = b.allow?.[k] !== false;
        const val = b.storage[k]||0, cap = capOf(b,k);
        const pct = cap>0 ? Math.min(100,Math.round(100*val/cap)) : 0;
        h += '<div class="depot-res-item'+(on?' on':'')+'" style="cursor:pointer;flex-direction:column;align-items:stretch;padding:5px 7px" data-toggle-res="'+k+'">'
           + '<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px">'
           + '<span class="dot" style="background:'+RES[k].c+'"></span>'
           + '<span style="flex:1;font-size:11px;'+(on?'':'opacity:.4')+'">'+RES[k].n+'</span>'
           + (on ? '<span style="font-size:10px;color:#8fa3bf">'+val+'/'+cap+'</span>' : '<span style="font-size:10px;color:#555">off</span>')
           + '</div>'
           + (on && cap>0 ? '<div style="height:4px;border-radius:2px;background:#1a2535"><i style="display:block;height:100%;width:'+pct+'%;background:'+RES[k].c+';border-radius:2px"></i></div>' : '')
           + '</div>';
      }
      h += '</div>';
    } else {
      h += '<div style="color:#8fa3bf;font-size:12px;font-style:italic">Appartient à un autre joueur.</div>';
    }
  }
  if(b.type==='market'){
    const myOid = MP.myId;
    const isOwner = !b.owner || b.owner === myOid;
    h += '<div class="depot-cols">';

    // --- Colonne gauche : ressources stockées ---
    h += '<div>';
    h += '<div style="color:#8fa3bf;font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">📦 Ressources stockées</div>';
    h += '<div style="color:#8fa3bf;font-size:10px;margin-bottom:6px">Rayon : <b style="color:#ffd700">'+depotRadiusOf(b)+' cases</b>'+(b.w*b.h>1?' · <b>'+b.w+'×'+b.h+'</b>':'')+'</div>';
    h += '<div class="depot-cols-3">';
    for(const k in RES){
      if(k === 'water') continue;
      const on = b.allow?.[k] !== false;
      const val = b.storage[k]||0, cap = capOf(b,k);
      const pct = cap>0 ? Math.min(100,Math.round(100*val/cap)) : 0;
      h += '<div class="depot-res-item'+(on?' on':'')+'" style="cursor:pointer;flex-direction:column;align-items:stretch;padding:5px 7px" data-toggle-res="'+k+'">'
         + '<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px">'
         + '<span class="dot" style="background:'+RES[k].c+'"></span>'
         + '<span style="flex:1;font-size:11px;'+(on?'':'opacity:.4')+'">'+RES[k].n+'</span>'
         + (on ? '<span style="font-size:10px;color:#8fa3bf">'+val+'/'+cap+'</span>' : '<span style="font-size:10px;color:#555">off</span>')
         + '</div>'
         + (on && cap>0 ? '<div style="height:4px;border-radius:2px;background:#1a2535"><i style="display:block;height:100%;width:'+pct+'%;background:'+RES[k].c+';border-radius:2px"></i></div>' : '')
         + '</div>';
    }
    h += '</div>';
    h += '</div>';

    // --- Colonne droite : vente inter-joueurs ---
    h += '<div>';
    if(isOwner){
      h += '<div style="color:#f0c060;font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">🛒 Vente aux autres joueurs</div>';
      h += '<div style="font-size:10px;color:#8fa3bf;margin-bottom:6px">Cliquer pour activer · prix par unité</div>';
      for(const k in RES){
        if(k === 'water') continue;
        const on = !!b.sellTo?.[k];
        const price = TRADE_PRICES[k];
        const minStock = b.sellMin?.[k] || 0;
        h += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:3px">'
           + '<div class="depot-res-item'+(on?' on':'')+' sell-toggle" data-sell="'+k+'" style="flex:1;cursor:pointer;padding:3px 7px">'
           + '<span class="dot" style="background:'+RES[k].c+'"></span>'
           + '<span style="flex:1;font-size:11px">'+RES[k].n+'</span>'
           + '<span style="color:#f0c060;font-size:10px">'+price+' $</span>'
           + '</div>';
        if(on){
          h += '<button class="tbtn sell-min-dec" data-sell-min="'+k+'" style="padding:2px 5px;margin:0;width:auto">−</button>'
             + '<span style="min-width:20px;text-align:center;font-size:11px">'+minStock+'</span>'
             + '<button class="tbtn sell-min-inc" data-sell-min="'+k+'" style="padding:2px 5px;margin:0;width:auto">+</button>';
        }
        h += '</div>';
      }
    } else {
      h += '<div style="color:#8fa3bf;font-size:12px;font-style:italic">Appartient à un autre joueur.</div>';
    }
    h += '</div>';
    h += '</div>'; // fin depot-cols
  }
  if(b.type==='tank'){
    h += '<div class="row"><span>Rayon d\'action</span><b style="color:#64b7e8">'+tankRadiusOf(b)+' cases</b></div>';
    h += '<div class="row"><span>Stockage</span><b>Eau uniquement</b></div>';
  }
  if(b.type==='bus_stop'){
    const canRename = !b.owner || b.owner === (MP.myId ?? null);
    const town = getTownOf(b);
    if(town) h += '<div class="row"><span>Village</span><b style="color:#e8d48b">🏘️ '+escHtml(town.name)+'</b></div>';
    const pCur = Math.floor(b.passengers||0), pMax = b.passengersMax||0;
    h += '<div class="row"><span>Départs</span><b style="color:#7dd8ff">👥 '+pCur+(pMax>0?' / '+pMax:'')+'</b></div>';
    const pE = Math.floor(b.passengersEntrant||0);
    const pS = Math.floor(b.passagersSortant||0);
    if(pE > 0) h += '<div class="row"><span>Arrivants (travailleurs)</span><b style="color:#a0e890">👷 '+pE+'</b></div>';
    if(pS > 0) h += '<div class="row"><span>Retours (en attente bus)</span><b style="color:#f0c060">🔄 '+pS+'</b></div>';
    h += '<div class="row"><span>Rayon</span><b>'+BUS_STOP_RADIUS+' cases</b></div>';
    h += '<div class="row"><span>Tarif</span><b style="color:#ffe9a0">'+BUS_FARE_FACTOR+' $/passager/tuile</b></div>';
    h += '<div class="row"><span>Intra-ville</span><b style="color:#a0c8e8">÷'+BUS_INTRA_CITY_DIV+' du tarif</b></div>';
    if(canRename){
      const stopName = b.name || '';
      h += '<div style="margin-top:8px;color:#8fa3bf;font-size:11px">Nom de l\'arrêt</div>';
      h += '<div style="display:flex;gap:4px;margin-top:4px">'
         + '<input id="bsNameInput" type="text" value="'+escHtml(stopName)+'" placeholder="Arrêt sans nom" '
         + 'style="flex:1;padding:4px 6px;background:#1a2535;border:1px solid #2a3a50;color:#dde6f0;border-radius:4px;font-size:12px">'
         + '<button class="tbtn" id="bsNameSave" style="width:auto;padding:4px 10px">✓</button>'
         + '</div>';
    } else if(b.name){
      h += '<div class="row"><span>Nom</span><b style="color:#9fd4f0">'+escHtml(b.name)+'</b></div>';
    }
  }
  if(isVehicleDepot(b)){
    const bvehicles = b.vehicles || [];
    const shownVehicles = b.type === 'train_depot' ? bvehicles.filter(trainPresentAtDepot) : bvehicles;
    const buyCatalog = Array.isArray(BUILD[b.type]?.buyCatalog)
      ? BUILD[b.type].buyCatalog
      : (b.type === 'garage'
          ? Object.keys(VEHICLE_TYPES).filter(k => !VEHICLE_TYPES[k].buyDisabled && k !== 'train')
          : []);
    h += '<div class="row"><span>Véhicules</span><b>'+shownVehicles.length+'</b></div>';
    // Instruction mode assignation route
    if(vehicleRouteMode && bvehicles.some(v=>v===vehicleRouteMode.vehicle)){
      const step = vehicleRouteMode.step;
      const rmVeh = vehicleRouteMode.vehicle;
      const isBusRM = rmVeh?.vtype === 'bus';
      if(isBusRM){
        h += '<div class="warn" style="background:#0e1e30;border-color:#3a6f9c;color:#7dd8ff">'
           + (step==='source' ? '🚌 Clique sur l\'ARRÊT DE BUS ou la GARE de départ' : '🚌 Clique sur l\'ARRÊT DE BUS ou la GARE de destination')
           + '</div>';
      } else if(rmVeh?.vtype === 'train'){
        h += '<div class="warn" style="background:#241b12;border-color:#8b6a3b;color:#f0d29a">'
           + (step==='source' ? '🚂 Clique sur la GARE de départ' : '🚂 Clique sur la GARE de destination')
           + '</div>';
      } else {
        h += '<div class="warn" style="background:#1a2e1a;border-color:#3d8c3d;color:#9fe8a0">'
           + (step==='source' ? '🔁 Clique sur l\'ENTREPÔT source' : '🔁 Clique sur l\'ENTREPÔT destination')
           + '</div>';
      }
    }
    if(shownVehicles.length){
      h += '<div style="margin-top:8px;color:#8fa3bf">Véhicules assignés</div>';
      h += '<div style="max-height:600px;overflow-y:auto;padding:1px">';
      // Rendu d'un wagon/loco : icône + charge, sans cadre ni roues
      const trainCarHtml = (icon, sub, isLoco) =>
          '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:34px;flex:0 0 auto;line-height:1.1">'
        +   '<div style="font-size:15px">'+icon+'</div>'
        +   '<div style="font-size:8px;color:#8fa3bf">'+sub+'</div>'
        + '</div>';
      for(const v of shownVehicles){
        const vt = VEHICLE_TYPES[v.vtype];
        if(!vt) continue;
        if(v.vtype === 'train' && !v.name) assignTrainVehicleName(v);
        const srcName = v.source && !v.source.dead ? trainStopLabel(v.source) : '—';
        const dstName = v.dest   && !v.dest.dead   ? trainStopLabel(v.dest)  : '—';
        const canStart = v.vtype === 'train' && (v.orders?.length || 0) >= 2;
        const trainFlag = canStart ? trainDepotFlagButtonHtml(v) : '';
        const vehName = v.vtype === 'train' ? (v.name || 'Train') : vt.nom;

        h += '<div style="padding:5px 6px;margin-bottom:4px;border:1px solid #2a3a50;border-radius:4px;background:#0f1820;font-size:11px">';

        const cfgBtns =
            '<button class="tbtn" style="padding:2px 3px;margin:0;font-size:11px;width:auto;border:none;background:transparent;color:#8fa3bf;cursor:pointer" data-route-v="'+v.id+'" title="Configurer">'+(v.vtype === 'train' ? '🧭' : '🔁')+'</button>'
          + '<button class="tbtn" style="padding:2px 3px;margin:0;font-size:11px;width:auto;border:none;background:transparent;color:#ff9a8a;cursor:pointer" data-sell-v="'+v.id+'" title="Vendre">🗑️</button>';

        if(v.vtype === 'train'){
          const wagons = trainNormalizeWagons(v);
          // Calculer la distribution du cargo par wagon
          const _totalFreightCap = wagons.reduce((s, w) => {
            const d = trainWagonDef(w);
            return s + ((!d?.passenger && v.res && trainWagonAcceptedResources(w).includes(v.res)) ? d.capacite : 0);
          }, 0);
          let _freightRemainder = v.cargo || 0;
          const _wagonLoad = wagons.map((wagon, idx) => {
            const d = trainWagonDef(wagon);
            if(!d?.passenger && v.res && _totalFreightCap > 0 && trainWagonAcceptedResources(wagon).includes(v.res)){
              const share = idx === wagons.length - 1
                ? Math.max(0, _freightRemainder)
                : Math.round((v.cargo || 0) * d.capacite / _totalFreightCap);
              _freightRemainder -= share;
              return { amt: share, res: v.res, cap: d.capacite };
            }
            return { amt: 0, res: null, cap: d?.capacite || 0 };
          });

          // Ligne 1 : le train (loco + wagons) + nom + trajet + actions
          h += '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">';
          h += '<div style="display:flex;gap:1px;align-items:flex-end">';
          h += trainCarHtml('🚂', 'loco', true);
          for(let idx=0; idx<wagons.length; idx++){
            const def = trainWagonDef(wagons[idx]);
            if(!def) continue;
            const load = _wagonLoad[idx];
            const selectedRes = trainWagonSelectedResource(wagons[idx]);
            const icon = selectedRes ? (RES[selectedRes]?.ic || '📦') : def.icone;
            h += trainCarHtml(icon, load.amt+'/'+load.cap, false);
          }
          h += '</div>';
          h += '<div style="flex:1"></div>';
          h += '<input data-vehname-v="'+v.id+'" value="'+escHtml(vehName)+'" spellcheck="false" title="Renommer le train" style="font-weight:bold;flex:0 1 auto;width:120px;text-align:right;background:transparent;border:none;border-bottom:1px solid #2a3a50;color:#e6edf5;font-size:11px;padding:2px 2px">';
          h += cfgBtns;
          if(trainFlag) h += trainFlag.replace(/style="/g,'style="font-size:11px;padding:2px 3px;margin:0 0 0 4px;');
          h += '</div>';
        } else {
          // Véhicules routiers : icône, nom, trajet, actions sur une ligne
          h += '<div style="display:flex;gap:5px;align-items:center">'
             + '<span style="font-size:16px">'+vt.icone+'</span>'
             + '<span style="font-weight:bold;flex:0 0 auto">'+escHtml(vehName.substring(0,14))+'</span>'
             + '<span style="color:#8fa3bf;flex:1;text-align:right;font-size:10px">'+srcName.substring(0,7)+' → '+dstName.substring(0,7)+'</span>'
             + cfgBtns
             + '</div>';
        }

        h += '</div>';
      }
      h += '</div>';
    }
    if(buyCatalog.length){
      h += '<div style="margin-top:8px;color:#8fa3bf">Acheter un véhicule</div>';
      for(const vk of buyCatalog){
        const vt = VEHICLE_TYPES[vk];
        if(!vt || vt.buyDisabled) continue;
        const resLabel = vt.resources.length > 1
          ? '<span style="color:#8fa3bf;font-size:10px"> · '+ vt.resources.map(r=>RES[r]?.ic||r).join(' ') +'</span>'
          : '';
        const maintLabel = vt.maintenanceCost > 0 ? ' <span style="color:#ff9a8a;font-size:10px">'+vt.maintenanceCost+' $/j</span>' : '';
        h += '<button class="tbtn" style="width:100%;text-align:left;margin-top:2px" data-buy-v="'+vk+'">'
           + vt.icone+' '+vt.nom+resLabel+' <span style="color:#8fa3bf">— '+vt.cost+' $</span>'+maintLabel+'</button>';
      }
    } else if(b.type !== 'garage'){
      h += '<div style="margin-top:8px;color:#8fa3bf;font-style:italic">Catalogue de transport à venir pour ce dépôt.</div>';
    }
  }
  // Contrôles de production pour les usines industrielles (hors dépôts/citernes)
  if(d.ind && r2){
    const allOuts = Object.keys(r2.out);
    // Pour les mines on expose aussi 'dirt' comme sortie bloquable
    const blockableOuts = b.type === 'mine'
      ? [...allOuts, 'dirt']
      : allOuts;
    if(blockableOuts.length){
      h += '<div style="margin-top:8px;color:#8fa3bf;font-size:11px">Production</div>';
      for(const k of blockableOuts){
        const blocked = !!(b.blockedOut?.[k]);
        h += '<button class="tbtn bld-toggle-out'+(blocked?' bld-blocked':'')+'" data-out="'+k+'" '
           + 'style="width:100%;text-align:left;margin-top:3px;'
           + (blocked ? 'opacity:.5;text-decoration:line-through' : '') + '">'
           + (blocked ? '🚫' : '✅')+' '+(RES[k]?.n || k)
           + '</button>';
      }
    }
  }
  p.style.display = 'block';
  p.classList.toggle('depot-modal', isStorageDepot(b) || isVehicleDepot(b));
  if(p._html === h && p._b === b){
    if(isVehicleDepot(b)) for(const v of (b.vehicles||[])) _updVDyn(p, v);
    return;
  }
  p._html = h; p._b = b;
  p.innerHTML = h;
  ensurePanelDragHandle('info');
  if(isVehicleDepot(b)) for(const v of (b.vehicles||[])) _updVDyn(p, v);
  p.querySelectorAll('[data-plant-upgrade]').forEach(btn=>{
    btn.onclick = async ()=>{
      const targetType = btn.dataset.plantUpgrade;
      const err = plantUpgradeError(b, targetType);
      if(err){ toast('⛔ '+err, 'err'); return; }
      if(MP.connected && b.owner && b.owner !== MP.myId){
        toast('⛔ Ce bâtiment appartient à un autre joueur','err'); return;
      }
      const targetDef = BUILD[targetType];
      const cost = targetDef.cost || 0;
      if(myWallet().money < cost){ toast('Fonds insuffisants ('+cost+' $)','err'); return; }
      const label = (PLANT_UPGRADES[targetType]||{}).label || targetDef.n;
      if(!await confirmAction('Créer '+label+' pour '+cost+' $ ?\nCe choix sera définitif.', {
        title: 'Spécialiser l’usine',
        okText: 'Créer',
      })) return;
      spendMoney(cost, 'construction');
      const upgradeErr = applyPlantUpgrade(b, targetType);
      if(upgradeErr){ toast('⛔ '+upgradeErr, 'err'); return; }
      if(MP.connected) netSend({ type:'upgrade_plant', x:b.x, y:b.y, targetType });
      selected = b;
      p._html = null;
      renderInfo();
      toast('🏭 Usine créée : '+targetDef.n, 'win');
    };
  });
  p.querySelectorAll('[data-station-depot-toggle-res]').forEach(el=>{
    el.onclick = ()=>{
      const depot = isTrainStationPiece(b) ? trainStationLinkedDepot(b) : null;
      if(!depot || !depot.allow) return;
      if(!depot.trainAllow) depot.trainAllow = {};
      const k = el.dataset.stationDepotToggleRes;
      const disabled = depot.allow[k] === false;
      const trainOn  = !disabled && depot.trainAllow[k] !== false;
      if(disabled){           // état 1 → état 2 (activé, pas de train)
        depot.allow[k] = undefined;
        depot.trainAllow[k] = false;
      } else if(!trainOn){    // état 2 → état 3 (activé + train)
        depot.trainAllow[k] = undefined;
      } else {                // état 3 → état 1 (désactivé)
        depot.allow[k] = false;
      }
      p._html = null;
    };
  });
  p.querySelectorAll('[data-toggle-res]').forEach(el=>{
    el.onclick = ()=>{
      if(!b.allow) b.allow = {};
      b.allow[el.dataset.toggleRes] = b.allow[el.dataset.toggleRes] === false ? undefined : false;
      p._html = null;
    };
  });
  p.querySelectorAll('.sell-toggle').forEach(el=>{
    el.onclick = ()=>{
      if(!b.sellTo) b.sellTo = {};
      b.sellTo[el.dataset.sell] = !b.sellTo[el.dataset.sell];
      p._html = null;
    };
  });
  p.querySelectorAll('.sell-min-dec').forEach(btn=>{
    btn.onclick = ()=>{
      if(!b.sellMin) b.sellMin = {};
      const k = btn.dataset.sellMin;
      b.sellMin[k] = Math.max(0, (b.sellMin[k]||0) - 10);
      p._html = null;
    };
  });
  p.querySelectorAll('.sell-min-inc').forEach(btn=>{
    btn.onclick = ()=>{
      if(!b.sellMin) b.sellMin = {};
      const k = btn.dataset.sellMin;
      b.sellMin[k] = (b.sellMin[k]||0) + 10;
      p._html = null;
    };
  });
  if(isVehicleDepot(b)){
    p.querySelectorAll('[data-route-v]').forEach(btn=>{
      btn.onclick = ()=>{
        const vid = +btn.dataset.routeV;
        const v = vehicles.find(vv=>vv.id===vid);
        if(!v) return;
        if(v.vtype === 'train'){
          if(!trainPresentAtDepot(v)){
            toast('⛔ La configuration du train n’est possible que dans le dépôt.','err');
            return;
          }
          openTrainPanel(v);
          return;
        }
        vehicleRouteMode = { vehicle:v, step:'source' };
        setTool('select');
        if(v.vtype === 'bus')
          toast('🚌 Clique sur l\'arrêt de bus ou la gare de départ pour '+VEHICLE_TYPES[v.vtype].nom+'.');
        else if(v.vtype === 'train')
          toast('🚂 Clique sur la gare ou le dépôt ferroviaire de départ pour '+VEHICLE_TYPES[v.vtype].nom+'.');
        else
          toast('🔁 Clique sur l\'entrepôt source pour '+VEHICLE_TYPES[v.vtype].nom+'.');
        p._html = null;
      };
    });
    p.querySelectorAll('input[data-vehname-v]').forEach(inp=>{
      const vid = +inp.dataset.vehnameV;
      const v = vehicles.find(vv=>vv.id===vid);
      if(!v) return;
      const saveName = ()=>{
        const newName = inp.value.trim();
        if(newName === (v.name||'')) return;
        v.name = newName || null;
        if(!v.name && v.vtype === 'train') assignTrainVehicleName(v);
        p._html = null;
      };
      inp.onkeydown = e => { if(e.key === 'Enter') inp.blur(); };
      inp.onblur = saveName;
    });
    p.querySelectorAll('[data-sell-v]').forEach(btn=>{
      btn.onclick = ()=>{
        const vid = +btn.dataset.sellV;
        const v = vehicles.find(vv=>vv.id===vid);
        if(!v) return;
        const refund = Math.floor(VEHICLE_TYPES[v.vtype].cost * 0.5);
        earnMoney(refund, 'rembours');
        removePersistentVehicle(v);
        if(MP.connected) netSend({ type:'sell_vehicle', id:v.id });
        toast('🗑️ Véhicule vendu (+'+refund+' $)');
        p._html = null;
      };
    });
    p.querySelectorAll('[data-train-flag]').forEach(btn=>{
      btn.onclick = ()=>{
        const vid = +btn.dataset.trainFlag;
        const v = vehicles.find(vv=>vv.id===vid);
        if(!v || v.vtype !== 'train') return;
        handleTrainDepotFlagClick(v);
        p._html = null;
      };
    });
    p.querySelectorAll('select[data-pin-v]').forEach(sel=>{
      sel.onchange = ()=>{
        const vid = +sel.dataset.pinV;
        const v = vehicles.find(vv=>vv.id===vid);
        if(!v) return;
        v.pinnedRes = sel.value || null;
        p._html = null;
      };
    });
    p.querySelectorAll('[data-buy-v]').forEach(btn=>{
      btn.onclick = ()=>{
        const vtype = btn.dataset.buyV;
        const vt = VEHICLE_TYPES[vtype];
        if(!vt) return;
        if(myWallet().money < vt.cost){ toast('Fonds insuffisants ('+vt.cost+' $)','err'); return; }
        spendMoney(vt.cost, 'construction');
        const v = createPersistentVehicle(vtype, b);
        if(MP.connected) netSend({ type:'buy_vehicle', id:v.id, vtype, garageX:b.x, garageY:b.y });
        toast(vt.icone+' '+vt.nom+' acheté ! Définis sa route avec 🔁 Route.','win');
        p._html = null;
      };
    });
  }
  p.querySelectorAll('.bld-toggle-out').forEach(btn=>{
    btn.onclick = ()=>{
      if(MP.connected && b.owner && b.owner !== MP.myId){ toast('⛔ Bâtiment d\'un autre joueur','err'); return; }
      if(!b.blockedOut) b.blockedOut = {};
      const k = btn.dataset.out;
      b.blockedOut[k] = !b.blockedOut[k];
      if(MP.connected) netSend({ type:'toggle_out_block', x:b.x, y:b.y, res:k, blocked:b.blockedOut[k] });
      p._html = null;
    };
  });
  const clearBtn = $('bClearStock');
  if(clearBtn) clearBtn.onclick = async ()=>{
    if(MP.connected && b.owner && b.owner !== MP.myId){ toast('⛔ Bâtiment d\'un autre joueur','err'); return; }
    if(!await confirmAction('Vider tout le stock de ce bâtiment ?', {
      title: 'Vider le stock',
      okText: 'Vider',
      danger: true,
    })) return;
    b.storage = {};
    b.inc = {};
    if(MP.connected) netSend({ type:'clear_bld_stock', x:b.x, y:b.y });
    p._html = null;
    renderInfo();
  };
  const pauseBtn = $('bPauseBld');
  if(pauseBtn) pauseBtn.onclick = ()=>{
    if(MP.connected && b.owner && b.owner !== MP.myId){ toast('⛔ Bâtiment d\'un autre joueur','err'); return; }
    setBuildingPaused(b, !b.paused);
    p._html = null;
    renderInfo();
  };
  // Renommage bâtiment industriel (inline dans le h3)
  const bldNameInput = $('bldNameInput');
  if(bldNameInput){
    const saveBldName = () => {
      const newName = bldNameInput.value.trim();
      if(newName === (b.name||'')) return;
      if(MP.connected && b.owner && b.owner !== MP.myId){ bldNameInput.value = b.name||''; return; }
      b.name = newName || null;
      if(MP.connected) netSend({ type:'rename_bld', x:b.x, y:b.y, name: b.name });
      p._html = null;
    };
    bldNameInput.onkeydown = e => { if(e.key === 'Enter') bldNameInput.blur(); };
    bldNameInput.onblur = saveBldName;
  }
  // Renommage arrêt de bus
  const bsNameSave = $('bsNameSave');
  if(bsNameSave) bsNameSave.onclick = ()=>{
    const input = $('bsNameInput');
    if(!input) return;
    const newName = input.value.trim();
    b.name = newName || null;
    if(MP.connected) netSend({ type:'rename_bus_stop', x:b.x, y:b.y, name: b.name });
    p._html = null;
    toast('🚏 Arrêt renommé : '+(b.name || '(sans nom)'));
  };
  $('bDemol').onclick = ()=>{
    if(MP.connected && b.owner && b.owner !== MP.myId){
      toast('⛔ Ce bâtiment appartient à un autre joueur','err'); return;
    }
    if(depotHasStoredVehicles(b)){
      toast('⛔ Impossible de détruire ce dépôt tant que des véhicules sont à l’intérieur.','err');
      return;
    }
    if(MP.connected) netSend({ type:'bulldoze_bld', bx:b.x, by:b.y });
    demolishBuilding(b, b.owner);
    selected = null;
  };
}

// ---------- toasts ----------
function toast(msg, cls){
  const t = document.createElement('div');
  t.className = 'toast' + (cls ? ' '+cls : '');
  t.textContent = msg;
  const box = $('toasts');
  box.appendChild(t);
  while(box.children.length > 4) box.removeChild(box.firstChild);
  setTimeout(()=>{ t.style.transition = 'opacity .4s'; t.style.opacity = '0'; }, 2400);
  setTimeout(()=> t.remove(), 2900);
}

let confirmResolver = null;
function closeConfirmDialog(result){
  const overlay = $('confirmOverlay');
  if(!overlay || !confirmResolver) return;
  overlay.classList.remove('open');
  const resolve = confirmResolver;
  confirmResolver = null;
  resolve(result);
}
function confirmAction(message, options={}){
  const overlay = $('confirmOverlay');
  if(!overlay) return Promise.resolve(false);
  if(confirmResolver) closeConfirmDialog(false);
  $('confirmTitle').textContent = options.title || 'Confirmation';
  $('confirmMessage').textContent = message;
  const ok = $('confirmOk');
  const cancel = $('confirmCancel');
  ok.textContent = options.okText || 'Confirmer';
  cancel.textContent = options.cancelText || 'Annuler';
  ok.classList.toggle('danger', options.danger === true);
  ok.classList.toggle('primary', options.danger !== true);
  overlay.classList.add('open');
  return new Promise(resolve=>{
    confirmResolver = resolve;
    ok.onclick = () => closeConfirmDialog(true);
    cancel.onclick = () => closeConfirmDialog(false);
    overlay.onclick = e => { if(e.target === overlay) closeConfirmDialog(false); };
    setTimeout(()=>ok.focus(), 0);
  });
}

// ---------- barre d'outils ----------
let depotToolbarGroup = null;
let depotToolbarMenu = null;
let trainToolbarGroup = null;
let trainToolbarMenu = null;

function closeDepotToolbarMenu(){
  if(!depotToolbarGroup || !depotToolbarMenu) return;
  depotToolbarGroup.classList.remove('open');
  depotToolbarMenu.classList.remove('open');
  syncToolbarState();
}

function closeTrainToolbarMenu(){
  if(!trainToolbarGroup || !trainToolbarMenu) return;
  trainToolbarGroup.classList.remove('open');
  trainToolbarMenu.classList.remove('open');
  syncToolbarState();
}

function closeToolbarMenus(){
  closeDepotToolbarMenu();
  closeTrainToolbarMenu();
}

function syncToolbarState(){
  document.querySelectorAll('.tool').forEach(b=> b.classList.toggle('on', b.dataset.t === tool));
  // actions contextuelles tactiles
  const cCancel = $('ctxCancel');
  if(cCancel) cCancel.classList.toggle('show', tool !== 'select');
  const cShift = $('ctxShift');
  if(cShift) cShift.classList.toggle('show', tool === 'road');
  if(depotToolbarGroup){
    const active = (DEPOT_TOOLBAR_ITEMS || []).some(item => item.tool === tool);
    depotToolbarGroup.classList.toggle('on', active);
    const groupBtn = depotToolbarGroup.querySelector('.tool-group-btn');
    if(groupBtn) groupBtn.classList.toggle('on', active || depotToolbarGroup.classList.contains('open'));
  }
  if(depotToolbarMenu){
    depotToolbarMenu.querySelectorAll('[data-depot-tool]').forEach(b=>{
      b.classList.toggle('on', b.dataset.depotTool === tool);
    });
  }
  if(trainToolbarGroup){
    const active = ['rail','rail_signal','rail_signal2','train_station'].includes(tool);
    trainToolbarGroup.classList.toggle('on', active);
    const groupBtn = trainToolbarGroup.querySelector('.tool-group-btn');
    if(groupBtn) groupBtn.classList.toggle('on', active || trainToolbarGroup.classList.contains('open'));
  }
  if(trainToolbarMenu){
    trainToolbarMenu.querySelectorAll('[data-train-tool]').forEach(b=>{
      b.classList.toggle('on', b.dataset.trainTool === tool);
    });
  }
}

function buildToolbar(){
  const bar = $('toolbar');
  bar.innerHTML = '';
  depotToolbarGroup = null;
  depotToolbarMenu = null;
  trainToolbarGroup = null;
  trainToolbarMenu = null;
  const depotItems = (DEPOT_TOOLBAR_ITEMS && DEPOT_TOOLBAR_ITEMS.length)
    ? DEPOT_TOOLBAR_ITEMS
    : [
        { key:'vehicules', tool:'garage', label:'Véhicules', icon:'🚛' },
        { key:'train', tool:'train_depot', label:'Train', icon:'🚂' },
        { key:'bateau', tool:'boat_depot', label:'Bateau', icon:'🚢' },
        { key:'avion', tool:'plane_depot', label:'Avion', icon:'✈️' },
      ];
  for(const k of TOOL_ORDER){
    if(k === 'rail'){
      const group = document.createElement('div');
      group.className = 'tool-group';
      const btn = document.createElement('button');
      btn.className = 'tool tool-group-btn';
      btn.dataset.t = 'rail';
      btn.title = 'Construction ferroviaire';
      btn.innerHTML = '<span class="ic">🚂</span><span>Train</span><span class="hk">▾</span>';
      const menu = document.createElement('div');
      menu.className = 'tool-group-menu';
      for(const toolKey of ['rail','rail_signal','rail_signal2','train_station']){
        const d = BUILD[toolKey];
        const choice = document.createElement('button');
        choice.className = 'tool tool-group-item';
        choice.dataset.trainTool = toolKey;
        choice.title = d.desc || '';
        choice.innerHTML = '<span class="ic">'+d.ic+'</span><span>'+d.n+'</span>'
          + '<span class="cost">'+(d.cost ? d.cost+' $' : '&nbsp;')+'</span>';
        choice.onclick = e => { e.stopPropagation(); setTool(toolKey); };
        menu.appendChild(choice);
      }
      btn.onclick = e => {
        e.stopPropagation();
        const open = !group.classList.contains('open');
        closeToolbarMenus();
        group.classList.toggle('open', open);
        menu.classList.toggle('open', open);
        syncToolbarState();
      };
      group.appendChild(btn);
      group.appendChild(menu);
      bar.appendChild(group);
      trainToolbarGroup = group;
      trainToolbarMenu = menu;
      continue;
    }
    if(k === 'garage'){
      const group = document.createElement('div');
      group.className = 'tool-group';
      const btn = document.createElement('button');
      btn.className = 'tool tool-group-btn';
      btn.dataset.t = 'garage';
      btn.title = 'Choisir un type de dépôt';
      btn.innerHTML = '<span class="ic">🏗️</span><span>Dépôts</span><span class="hk">▾</span>';
      btn.onclick = e => {
        e.stopPropagation();
        const open = !group.classList.contains('open');
        if(open) closeToolbarMenus();
        group.classList.toggle('open', open);
        menu.classList.toggle('open', open);
        syncToolbarState();
      };
      group.appendChild(btn);

      const menu = document.createElement('div');
      menu.className = 'tool-group-menu';
      for(const item of depotItems){
        const d = BUILD[item.tool];
        const choice = document.createElement('button');
        choice.className = 'tool tool-group-item';
        choice.dataset.depotTool = item.tool;
        choice.title = item.desc || d?.desc || '';
        choice.innerHTML = '<span class="ic">'+(item.icon || d?.ic || '◻')+'</span><span>'+item.label+'</span>'
          + (d?.cost ? '<span class="cost">'+d.cost+' $</span>' : '<span class="cost">&nbsp;</span>');
        choice.onclick = e => {
          e.stopPropagation();
          setTool(item.tool);
        };
        menu.appendChild(choice);
      }
      group.appendChild(menu);
      bar.appendChild(group);
      depotToolbarGroup = group;
      depotToolbarMenu = menu;
      continue;
    }
    const d = BUILD[k];
    if(!d) continue;
    const btn = document.createElement('button');
    btn.className = 'tool' + (k===tool ? ' on' : '');
    btn.dataset.t = k;
    btn.title = d.desc || '';
    btn.innerHTML = '<span class="ic">'+d.ic+'</span><span>'+d.n+'</span>'
      + (d.cost ? '<span class="cost">'+d.cost+' $</span>' : '<span class="cost">&nbsp;</span>')
      + '<span class="hk">'+(d.hk ? '['+d.hk+']' : '&nbsp;')+'</span>';
    btn.onclick = ()=> setTool(k);
    bar.appendChild(btn);
  }

  syncToolbarState();
}
function setTool(k){
  tool = k;
  roadDragStart = null; roadPreviewTiles = [];
  shiftToggle = false;
  const cs = $('ctxShift'); if(cs) cs.classList.remove('on');
  closeToolbarMenus();
  syncToolbarState();
}

// ---------- souris / clavier ----------
const mouse = { x:0, y:0, tx:-1, ty:-1, lDown:false, rDown:false, rMoved:0, lastX:0, lastY:0 };
// Bascule tactile du mode "angle droit" pour les routes (équivalent de Maj au clavier).
let shiftToggle = false;

function updateMouseTileAt(x,y){
  mouse.x = x; mouse.y = y;
  const ix = cam.x + x/cam.z, iy = cam.y + y/cam.z;
  const u = (ix/TW2 + iy/TH2)/2, v = (iy/TH2 - ix/TW2)/2;
  const [tx,ty] = invRotF(u,v);
  mouse.tx = Math.floor(tx); mouse.ty = Math.floor(ty);
  hoveredExpansion = expansions.find(e=>e.inPiece(mouse.tx,mouse.ty)) || null;
}
function updateMouseTile(e){
  updateMouseTileAt(e.clientX, e.clientY);
}

function selectTownLabelAt(x,y){
  for(let i=townLabelHits.length-1; i>=0; i--){
    const h = townLabelHits[i];
    if(x >= h.x && x <= h.x+h.w && y >= h.y && y <= h.y+h.h){
      selectedTownId = h.id;
      hudTimer = 0;
      updateHUD(0);
      openTownPanel(h.id);
      return true;
    }
  }
  return false;
}

function selectTrainDepotFlagAt(x,y){
  for(let i=trainDepotFlagHits.length-1; i>=0; i--){
    const h = trainDepotFlagHits[i];
    if(x < h.x || x > h.x + h.w || y < h.y || y > h.y + h.h) continue;
    const depot = h.depot;
    if(!depot || depot.dead) return false;
    // Le drapeau regroupe tous les trains du dépôt : on bascule directement leur
    // autorisation de départ (rouge ↔ vert) et on sélectionne le dépôt, dont le
    // panneau liste chaque train avec son propre drapeau.
    handleTrainDepotFlagToggle(depot);
    selected = depot;
    selectedVehicle = null;
    selectedExpansion = null;
    renderInfo();
    return true;
  }
  return false;
}

// ---- Panel village ----
let townZoneSelectMode = null; // { townId } si mode sélection de zone actif
let townZoneDrag = null;       // { x0,y0,x1,y1 } en tiles pendant le drag
let townZonePending = null;    // { x1,y1,x2,y2, newName } en attente de confirmation

function openTownPanel(tid){
  const panel = $('townPanel');
  renderTownPanel(tid);
  panel.style.display = 'block';
}

function closeTownPanel(){
  $('townPanel').style.display = 'none';
  cancelTownZoneSelect();
}

function cancelTownZoneSelect(){
  if(townZoneSelectMode){ townZoneSelectMode = null; townZoneDrag = null; townZonePending = null; $('zoneOverlay').style.display='none'; }
}

function renderTownPanel(tid){
  const panel = $('townPanel');
  const t = towns.find(t=>t.id===tid);
  if(!t){ panel.style.display='none'; return; }
  const myOid = myOwner();
  const members = buildings.filter(b=>!b.dead && b.townId===t.id);
  const pop = townPopulation(t);
  const resCount = members.filter(b=>BUILD[b.type]?.resid).length;
  const indCount = members.filter(b=>BUILD[b.type]?.ind).length;
  const mergeable = mergeableTowns(t);
  const inZone = !!(townZoneSelectMode && townZoneSelectMode.townId===tid);

  let h = '<div class="panel-head">'
        + '<h3>🏘️ '+t.name+'</h3>'
        + '<button class="tbtn" id="tpClose" aria-label="Fermer">✕</button>'
        + '</div>';
  h += '<div class="row"><span style="color:#8fa3bf">Population</span><b>'+pop+'</b></div>';
  h += '<div class="row"><span style="color:#8fa3bf">Maisons</span><b>'+resCount+'</b></div>';
  h += '<div class="row"><span style="color:#8fa3bf">Industries</span><b>'+indCount+'</b></div>';

  // Confirmation création nouveau village
  if(townZonePending && townZoneSelectMode?.townId===tid){
    const p = townZonePending;
    const rx1=Math.min(p.x0,p.x1), ry1=Math.min(p.y0,p.y1);
    const rx2=Math.max(p.x0,p.x1), ry2=Math.max(p.y0,p.y1);
    const affected = buildings.filter(b=>{
      if(b.dead) return false;
      if(myOid!=null && b.owner!==myOid) return false;
      const bx2=b.x+(b.w||1)-1, by2=b.y+(b.h||1)-1;
      return b.x<=rx2 && bx2>=rx1 && b.y<=ry2 && by2>=ry1;
    });
    const resAff = affected.filter(b=>BUILD[b.type]?.resid).length;
    const indAff = affected.filter(b=>BUILD[b.type]?.ind).length;
    h += '<div class="tp-section" style="border:1px solid #d6a82f;border-radius:6px;padding:10px;margin-top:12px">';
    h += '<div class="tp-section-title" style="color:#ffe9a0">⚠️ Confirmer la création</div>';
    h += '<div style="font-size:12px;color:#8fa3bf;margin-bottom:8px">'
       + 'Nouveau village <b style="color:#ffe9a0">'+p.newName+'</b><br>'
       + affected.length+' bâtiment'+(affected.length>1?'s':'')+' concerné'+(affected.length>1?'s':'')+' ('
       + resAff+' maison'+(resAff>1?'s':'')+', '+indAff+' industrie'+(indAff>1?'s':'')+')'
       + '</div>';
    h += '<div style="display:flex;gap:8px">'
       + '<button class="tbtn" id="tpZoneConfirm" style="flex:1;background:rgba(214,168,47,.15);border-color:#d6a82f;color:#ffe9a0">✅ Créer</button>'
       + '<button class="tbtn" id="tpZoneCancel" style="flex:1;color:#ff9a8a">✕ Annuler</button>'
       + '</div>';
    h += '</div>';
  }

  // Fusion
  h += '<div class="tp-section">';
  h += '<div class="tp-section-title">🔀 Fusionner avec</div>';
  if(mergeable.length){
    for(const { town: other, gap } of mergeable){
      const otherPop = townPopulation(other);
      h += '<div class="tp-town-btn" data-merge-town="'+other.id+'">'
         + '<span>🏘️</span>'
         + '<span style="flex:1"><b>'+other.name+'</b> <span style="color:#8fa3bf;font-size:11px">— '+otherPop+' hab, écart '+gap+' tuile'+(gap>1?'s':'')+'</span></span>'
         + '<span style="color:#9fe8a0;font-size:12px">Fusionner →</span>'
         + '</div>';
    }
  } else {
    h += '<div style="color:#8fa3bf;font-size:12px;font-style:italic">Aucun village adjacent (écart ≤ '+MERGE_TOWN_GAP+' tuiles).</div>';
  }
  h += '</div>';

  // Nouveau village par zone
  h += '<div class="tp-section">';
  h += '<div class="tp-section-title">🆕 Créer un nouveau village</div>';
  h += '<div style="font-size:11px;color:#8fa3bf;margin-bottom:6px">Sélectionner un rectangle sur la carte — un nouveau village sera créé avec les bâtiments à vous dans cette zone.</div>';
  if(!inZone){
    h += '<button class="tbtn" id="tpZoneBtn" style="width:100%">📐 Sélectionner une zone</button>';
  } else if(!townZonePending){
    h += '<button class="tbtn zone-active" id="tpZoneBtn" style="width:100%">⏹️ Annuler la sélection</button>';
  }
  h += '</div>';

  panel.innerHTML = h;
  ensurePanelDragHandle('townPanel');

  panel.querySelector('#tpClose').onclick = () => closeTownPanel();

  panel.querySelectorAll('[data-merge-town]').forEach(el=>{
    el.onclick = () => {
      const srcId = parseInt(el.dataset.mergeTown);
      const srcTown = towns.find(t=>t.id===srcId);
      if(!srcTown) return;
      const srcBuildings = buildings.filter(b=>!b.dead && b.townId===srcId);
      const forbidden = srcBuildings.some(b=>b.owner!=null && b.owner!==myOid && myOid!=null);
      if(forbidden){ toast('⛔ Ce village contient des bâtiments d\'un autre joueur.','err'); return; }
      if(MP.connected) netSend({ type:'merge_towns', dstId:t.id, srcId });
      mergeTowns(t.id, srcId);
      hudTimer=0; updateHUD(0);
      renderTownPanel(t.id);
    };
  });

  const zoneBtn = panel.querySelector('#tpZoneBtn');
  if(zoneBtn) zoneBtn.onclick = () => {
    if(inZone){ cancelTownZoneSelect(); renderTownPanel(tid); }
    else {
      townZoneSelectMode = { townId: tid };
      townZoneDrag = null; townZonePending = null;
      $('townPanel').style.display = 'none'; // cacher pendant la sélection
      toast('📐 Glisse un rectangle sur la carte pour créer un nouveau village.','win');
    }
  };

  const confirmBtn = panel.querySelector('#tpZoneConfirm');
  if(confirmBtn) confirmBtn.onclick = () => {
    const p = townZonePending;
    if(!p) return;
    const oid = myOwner();
    const rx1=Math.min(p.x0,p.x1), ry1=Math.min(p.y0,p.y1);
    const rx2=Math.max(p.x0,p.x1), ry2=Math.max(p.y0,p.y1);
    const cx = (rx1+rx2)/2, cy = (ry1+ry2)/2;
    const newTown = { id: nextTownId++, name: p.newName, cx, cy };
    towns.push(newTown);
    if(MP.connected) netSend({ type:'zone_reassign', dstId:newTown.id,
      x1:rx1, y1:ry1, x2:rx2, y2:ry2, owner:oid, newTown:{ id:newTown.id, name:newTown.name, cx, cy } });
    reassignBuildingsInRect(newTown.id, rx1, ry1, rx2, ry2, oid);
    cancelTownZoneSelect();
    hudTimer=0; updateHUD(0);
    toast('🏘️ Nouveau village : '+newTown.name,'win');
    renderTownPanel(tid);
  };

  const cancelBtn = panel.querySelector('#tpZoneCancel');
  if(cancelBtn) cancelBtn.onclick = () => {
    townZonePending = null;
    $('zoneOverlay').style.display='none';
    renderTownPanel(tid);
  };
}


// ---- overlay du rectangle de sélection de zone village ----
function updateZoneOverlay(mouseX, mouseY){
  if(!townZoneDrag){ $('zoneOverlay').style.display='none'; return; }
  const { x0,y0,x1,y1 } = townZoneDrag;
  // Convertir les coins en pixels écran via iso
  const corners = [
    [Math.min(x0,x1), Math.min(y0,y1)],
    [Math.max(x0,x1)+1, Math.min(y0,y1)],
    [Math.min(x0,x1), Math.max(y0,y1)+1],
    [Math.max(x0,x1)+1, Math.max(y0,y1)+1],
  ].map(([tx,ty])=>{ const [ru,rv]=rotF(tx,ty); const [px,py]=iso(ru,rv); return [(px-cam.x)*cam.z,(py-cam.y)*cam.z]; });
  const minX = Math.min(...corners.map(c=>c[0]));
  const maxX = Math.max(...corners.map(c=>c[0]));
  const minY = Math.min(...corners.map(c=>c[1]));
  const maxY = Math.max(...corners.map(c=>c[1]));
  const ov = $('zoneOverlay');
  ov.style.display = 'block';
  ov.style.left   = minX + 'px'; ov.style.top    = minY + 'px';
  ov.style.width  = (maxX-minX) + 'px'; ov.style.height = (maxY-minY) + 'px';
}

// ---------- tracé de route deux-points ----------
let roadDragStart = null;   // {x,y} tuile de départ
let roadPreviewTiles = [];  // [{x,y}] tuiles de l'aperçu

// Trace une route entre deux tuiles en 8-directions (Bresenham octagonal).
// Shift forcé = segment à angle droit, sinon ligne droite 8-dir.
function computeRoadPreview(x0, y0, x1, y1, shiftMode){
  const dx = x1 - x0, dy = y1 - y0;
  const sx = dx >= 0 ? 1 : -1, sy = dy >= 0 ? 1 : -1;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  const tiles = [];
  let x = x0, y = y0;
  if(shiftMode){
    // Shift : angle droit sans diagonale.
    while(x !== x1){ tiles.push({x, y}); x += sx; }
    while(y !== y1){ tiles.push({x, y}); y += sy; }
  } else {
    // Tracé 8-directions : ligne droite Bresenham
    if(adx >= ady){
      let err = adx >> 1;
      for(let i = 0; i < adx; i++){
        tiles.push({x, y});
        x += sx; err -= ady;
        if(err < 0){ y += sy; err += adx; }
      }
    } else {
      let err = ady >> 1;
      for(let i = 0; i < ady; i++){
        tiles.push({x, y});
        y += sy; err -= adx;
        if(err < 0){ x += sx; err += ady; }
      }
    }
  }
  tiles.push({x, y});
  return tiles;
}

function computeRailPreview(x0, y0, x1, y1){
  if(x0 === x1 && y0 === y1) return [{ x:x0, y:y0 }];
  const dirs = RAIL_DIRS.map(def => [def.dx, def.dy]);
  const targetDx = Math.sign(x1 - x0), targetDy = Math.sign(y1 - y0);
  const targetMag = Math.max(1, Math.abs(x1 - x0) + Math.abs(y1 - y0));
  const keyOf = (x, y, dirIdx) => x+','+y+','+dirIdx;
  const heuristic = (x, y) => Math.max(Math.abs(x1 - x), Math.abs(y1 - y)) * 1000;
  const best = new Map();
  const open = [{
    x:x0, y:y0, prevDir:-1, prev:null,
    g:0, f:heuristic(x0, y0),
  }];
  best.set(keyOf(x0, y0, -1), 0);
  while(open.length){
    open.sort((a, b)=> a.f - b.f || a.g - b.g);
    const cur = open.shift();
    if(cur.x === x1 && cur.y === y1){
      const path = [];
      for(let n = cur; n; n = n.prev) path.push({ x:n.x, y:n.y });
      path.reverse();
      return path;
    }
    for(let dirIdx = 0; dirIdx < dirs.length; dirIdx++){
      const [dx, dy] = dirs[dirIdx];
      if(cur.prevDir >= 0){
        const [pdx, pdy] = dirs[cur.prevDir];
        if(pdx * dx + pdy * dy === 0) continue;
      }
      const nx = cur.x + dx, ny = cur.y + dy;
      if(!inMap(nx, ny)) continue;
      const turnPenalty = cur.prevDir >= 0 && cur.prevDir !== dirIdx ? 35 : 0;
      const alignPenalty = ((targetDx && dx !== targetDx) ? 8 : 0) + ((targetDy && dy !== targetDy) ? 8 : 0);
      const diagonalPenalty = (targetDx && targetDy && (dx === 0 || dy === 0)) ? 10 : 0;
      const stepCost = 1000 + turnPenalty + alignPenalty + diagonalPenalty;
      const g = cur.g + stepCost;
      const stateKey = keyOf(nx, ny, dirIdx);
      if(g >= (best.get(stateKey) ?? Infinity)) continue;
      best.set(stateKey, g);
      open.push({
        x:nx, y:ny, prevDir:dirIdx, prev:cur,
        g,
        f:g + heuristic(nx, ny),
      });
    }
  }
  return [{ x:x0, y:y0 }];
}

// ---- logique placement/pan (factorisée : souris + tactile) ----
function canvasLeftDown(x, y, shiftKey){
  mouse.lDown = true;
  if(selectTownLabelAt(x, y)){ mouse.lDown = false; return; }
  if(selectTrainDepotFlagAt(x, y)){ mouse.lDown = false; return; }
  if(townZoneSelectMode){
    townZoneDrag = { x0: mouse.tx, y0: mouse.ty, x1: mouse.tx, y1: mouse.ty };
    return;
  }
  if(tool === 'road' || tool === 'rail'){
    const anchor = { x: mouse.tx, y: mouse.ty };
    roadDragStart = { x: anchor.x, y: anchor.y };
    roadPreviewTiles = tool === 'rail'
      ? computeRailPreview(anchor.x, anchor.y, anchor.x, anchor.y)
      : computeRoadPreview(mouse.tx, mouse.ty, mouse.tx, mouse.ty, shiftKey);
  } else {
    clickFn(mouse.tx, mouse.ty);
  }
}
function canvasLeftMove(x, y, shiftKey, oldTx, oldTy){
  if(mouse.lDown && townZoneDrag){
    townZoneDrag.x1 = mouse.tx; townZoneDrag.y1 = mouse.ty;
    updateZoneOverlay(x, y);
    return;
  }
  if(mouse.lDown && (tool==='bulldoze'||tool==='terraform'||tool==='fill_water') && (mouse.tx!==oldTx || mouse.ty!==oldTy))
    clickFn(mouse.tx, mouse.ty);
  if(mouse.lDown && (tool==='road' || tool==='rail') && roadDragStart && (mouse.tx!==oldTx || mouse.ty!==oldTy))
    roadPreviewTiles = tool === 'rail'
      ? computeRailPreview(roadDragStart.x, roadDragStart.y, mouse.tx, mouse.ty)
      : computeRoadPreview(roadDragStart.x, roadDragStart.y, mouse.tx, mouse.ty, shiftKey);
}
function canvasLeftUp(){
  if(townZoneDrag && townZoneSelectMode && !townZonePending){
    const { x0,y0,x1,y1 } = townZoneDrag;
    const cx = (Math.min(x0,x1)+Math.max(x0,x1))/2;
    const cy = (Math.min(y0,y1)+Math.max(y0,y1))/2;
    townZonePending = { x0, y0, x1, y1, newName: generateTownName(Math.round(cx), Math.round(cy)) };
    townZoneDrag = null;
    const tid = townZoneSelectMode.townId;
    $('townPanel').style.display = 'block';
    renderTownPanel(tid);
    mouse.lDown = false;
    return;
  }
  if(tool === 'rail' && roadDragStart){
    const { updates, cost, msg } = collectRailUpdates(roadPreviewTiles);
    if(updates.length){
      if(MP.connected && !MP.username) toast('👤 Connecte-toi avec un compte joueur pour construire','err');
      else if(myWallet().money < cost) toast('Fonds insuffisants ('+cost+' $)','err');
      else if(MP.connected && MP.username) applyRailPathWithNetwork(roadPreviewTiles);
      else railApplyMaskUpdates(updates, cost);
    } else if(msg) toast(msg, 'err');
    roadDragStart = null; roadPreviewTiles = [];
  } else if(tool === 'road' && roadDragStart){
    for(const t of roadPreviewTiles)
      if(canPlace(tool, t.x, t.y).ok) clickFn(t.x, t.y);
    roadDragStart = null; roadPreviewTiles = [];
  }
  mouse.lDown = false;
}
function cancelPlacementInProgress(){
  mouse.lDown = false;
  roadDragStart = null;
  roadPreviewTiles = [];
  if(townZoneDrag){ townZoneDrag = null; const zo=$('zoneOverlay'); if(zo) zo.style.display='none'; }
}
function canvasPanStart(x, y){
  mouse.rDown = true; mouse.rMoved = 0;
  mouse.lastX = x; mouse.lastY = y;
}
function canvasPanMove(x, y){
  const dx = x-mouse.lastX, dy = y-mouse.lastY;
  mouse.rMoved += Math.abs(dx)+Math.abs(dy);
  cam.x -= dx/cam.z; cam.y -= dy/cam.z;
  clampCam();
  syncTargetCam();
  mouse.lastX = x; mouse.lastY = y;
}

// ---- handlers SOURIS (desktop) ----
cv.addEventListener('mousedown', e=>{
  updateMouseTile(e);
  if(e.button===0) canvasLeftDown(e.clientX, e.clientY, e.shiftKey || shiftToggle);
  else if(e.button===2 || e.button===1) canvasPanStart(e.clientX, e.clientY);
});
addEventListener('mousemove', e=>{
  const oldTx = mouse.tx, oldTy = mouse.ty;
  updateMouseTile(e);
  if(mouse.rDown) canvasPanMove(e.clientX, e.clientY);
  if(mouse.lDown) canvasLeftMove(e.clientX, e.clientY, e.shiftKey || shiftToggle, oldTx, oldTy);
});
addEventListener('mouseup', e=>{
  if(e.button===0) canvasLeftUp();
  if(e.button===2 || e.button===1){
    if(e.button===2 && mouse.rMoved < 6) setTool('select'); // clic droit simple = annuler
    mouse.rDown = false;
  }
});

// ---- handlers TACTILE (Pointer Events multi-touch) ----
// 1 doigt = placer / sélectionner / dessiner une route ; 2 doigts = zoom (pinch) + déplacer la carte.
const activePointers = new Map(); // pointerId -> {x,y}
let touchMode = null;             // 'place' | 'camera' | null
let pinchAnchor = null;           // {dist, WX, WY, tCamZ} pour pinch-zoom ancré
let panLast = null;               // dernière position du doigt pour le pan 1-doigt en mode caméra
function ptrDist2(a, b){ return Math.hypot(a.x-b.x, a.y-b.y); }
function initPinchAnchor(){
  const pts = [...activePointers.values()];
  const midX = (pts[0].x+pts[1].x)/2, midY = (pts[0].y+pts[1].y)/2;
  pinchAnchor = {
    dist: ptrDist2(pts[0], pts[1]),
    tCamZ: targetCam.z,
    WX: targetCam.x + midX/targetCam.z,
    WY: targetCam.y + midY/targetCam.z
  };
  panLast = { x: midX, y: midY };
}
cv.addEventListener('pointerdown', e=>{
  if(e.pointerType !== 'touch') return;       // la souris passe par les handlers mouse* ci-dessus
  e.preventDefault();
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { cv.setPointerCapture(e.pointerId); } catch(_){}

  if(activePointers.size === 1 && touchMode !== 'camera'){
    touchMode = 'place';
    zoomActiveUntil = performance.now() + 180;
    updateMouseTileAt(e.clientX, e.clientY);
    canvasLeftDown(e.clientX, e.clientY, shiftToggle);
  } else if(activePointers.size >= 2){
    if(touchMode === 'place') cancelPlacementInProgress();
    touchMode = 'camera';
    initPinchAnchor();
    zoomActiveUntil = performance.now() + 180;
  }
});
cv.addEventListener('pointermove', e=>{
  if(e.pointerType !== 'touch') return;
  if(!activePointers.has(e.pointerId)) return;
  e.preventDefault();
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if(touchMode === 'camera'){
    zoomActiveUntil = performance.now() + 180;
    if(activePointers.size >= 2 && pinchAnchor){
      const pts = [...activePointers.values()];
      const midX = (pts[0].x+pts[1].x)/2, midY = (pts[0].y+pts[1].y)/2;
      const dist = ptrDist2(pts[0], pts[1]);
      const factor = pinchAnchor.dist > 8 ? dist / pinchAnchor.dist : 1;
      const z2 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pinchAnchor.tCamZ * factor));
      // invariant : le point monde sous le midpoint initial reste sous le midpoint courant
      targetCam.x = pinchAnchor.WX - midX / z2;
      targetCam.y = pinchAnchor.WY - midY / z2;
      targetCam.z = z2;
      clampCamera(targetCam);
    } else if(activePointers.size === 1 && panLast){
      const [p] = [...activePointers.values()];
      const dx = p.x - panLast.x, dy = p.y - panLast.y;
      cam.x -= dx/cam.z; cam.y -= dy/cam.z;
      clampCam(); syncTargetCam();
      panLast = { x: p.x, y: p.y };
    }
  } else if(touchMode === 'place' && activePointers.size === 1){
    const oldTx = mouse.tx, oldTy = mouse.ty;
    updateMouseTileAt(e.clientX, e.clientY);
    if(mouse.lDown) canvasLeftMove(e.clientX, e.clientY, shiftToggle, oldTx, oldTy);
  }
});
function onPointerUpTouch(e){
  if(e.pointerType !== 'touch') return;
  if(!activePointers.has(e.pointerId)) return;
  e.preventDefault();
  activePointers.delete(e.pointerId);
  try { cv.releasePointerCapture(e.pointerId); } catch(_){}

  if(activePointers.size === 0){
    if(touchMode === 'place') canvasLeftUp();
    touchMode = null; pinchAnchor = null; panLast = null;
  } else if(activePointers.size === 1 && touchMode === 'camera'){
    const [p] = [...activePointers.values()];
    panLast = { x: p.x, y: p.y };
    pinchAnchor = null;
  } else if(activePointers.size >= 2 && touchMode === 'camera'){
    initPinchAnchor();
  }
}
cv.addEventListener('pointerup', onPointerUpTouch);
cv.addEventListener('pointercancel', onPointerUpTouch);

cv.addEventListener('wheel', e=>{
  e.preventDefault();
  zoomActiveUntil = performance.now() + 180;
  const unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? H : 1);
  const factor = Math.exp(-e.deltaY * unit * ZOOM_WHEEL_SENS);
  const z2 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, targetCam.z * factor));
  // garder le point sous le curseur fixe sur la caméra cible, puis lisser vers elle.
  targetCam.x += e.clientX/targetCam.z - e.clientX/z2;
  targetCam.y += e.clientY/targetCam.z - e.clientY/z2;
  targetCam.z = z2;
  clampCamera(targetCam);
},{ passive:false });
cv.addEventListener('contextmenu', e=> e.preventDefault());

function clampCamera(c){
  const m = TW*4;
  c.z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.z));
  // Bornes iso de la zone visible (zone jouable + EXP_DEPTH pour montrer les expansions)
  const bx0 = mapBounds.x0 - EXP_DEPTH, by0 = mapBounds.y0 - EXP_DEPTH;
  const bx1 = mapBounds.x1 + EXP_DEPTH, by1 = mapBounds.y1 + EXP_DEPTH;
  let minIX=Infinity, maxIX=-Infinity, minIY=Infinity, maxIY=-Infinity;
  for(const [wx,wy] of [[bx0,by0],[bx1,by0],[bx0,by1],[bx1,by1]]){
    const [u,v] = rotF(wx, wy);
    const [px,py] = iso(u, v);
    if(px<minIX) minIX=px; if(px>maxIX) maxIX=px;
    if(py<minIY) minIY=py; if(py>maxIY) maxIY=py;
  }
  c.x = Math.min(maxIX + m - W/c.z, Math.max(minIX - m, c.x));
  c.y = Math.min(maxIY + m - H/c.z, Math.max(minIY - m - 200, c.y));
}
function clampCam(){
  clampCamera(cam);
}
function syncTargetCam(){
  targetCam.x = cam.x;
  targetCam.y = cam.y;
  targetCam.z = cam.z;
}
function smoothCamera(dt){
  const a = 1 - Math.exp(-CAM_SMOOTH * dt);
  cam.x += (targetCam.x - cam.x) * a;
  cam.y += (targetCam.y - cam.y) * a;
  cam.z += (targetCam.z - cam.z) * a;
  if(Math.abs(targetCam.x-cam.x) < 0.01) cam.x = targetCam.x;
  if(Math.abs(targetCam.y-cam.y) < 0.01) cam.y = targetCam.y;
  if(Math.abs(targetCam.z-cam.z) < 0.0005) cam.z = targetCam.z;
  clampCam();
  updateMouseTileAt(mouse.x, mouse.y);
}

const keys = new Set();
addEventListener('keydown', e=>{
  if(e.target.tagName==='INPUT') return;
  if(e.code==='Escape' && confirmResolver){
    e.preventDefault();
    closeConfirmDialog(false);
    return;
  }
  if(e.code==='Escape' && depotToolbarMenu?.classList.contains('open')){
    e.preventDefault();
    closeDepotToolbarMenu();
    return;
  }
  if(e.code==='Escape' && trainToolbarMenu?.classList.contains('open')){
    e.preventDefault();
    closeTrainToolbarMenu();
    return;
  }
  keys.add(e.code);
  if(e.code==='Space'){ e.preventDefault(); togglePause(); }
  if(e.code==='Escape'){ setTool('select'); selected = null; selectedExpansion = null; vehicleRouteMode = null; selectedVehicle = null; closeTownPanel(); closeTrainPanel(); }
  if((e.code==='ShiftLeft'||e.code==='ShiftRight') && roadDragStart && mouse.lDown && tool==='road')
    roadPreviewTiles = computeRoadPreview(roadDragStart.x, roadDragStart.y, mouse.tx, mouse.ty, true);
  if(e.code==='KeyH') toggleHelp();
  if(e.code==='KeyR') rotate(e.shiftKey ? -1 : 1);
  if(e.code==='KeyB') setTool('bulldoze');
  if(e.code.startsWith('Digit')){
    const d = +e.code.slice(5);
    const key = String(d);
    const toolKey = TOOL_ORDER.find(k => BUILD[k]?.hk === key);
    if(toolKey) setTool(toolKey);
  }
});
addEventListener('click', e=>{
  if(depotToolbarGroup && !depotToolbarGroup.contains(e.target)) closeDepotToolbarMenu();
  if(trainToolbarGroup && !trainToolbarGroup.contains(e.target)) closeTrainToolbarMenu();
});
addEventListener('keyup', e=>{
  keys.delete(e.code);
  if((e.code==='ShiftLeft'||e.code==='ShiftRight') && roadDragStart && mouse.lDown && tool==='road')
    roadPreviewTiles = computeRoadPreview(roadDragStart.x, roadDragStart.y, mouse.tx, mouse.ty, false);
});

function panKeys(dt){
  const s = 520*dt/cam.z;
  let moved = false;
  if(keys.has('ArrowLeft') || keys.has('KeyA') || keys.has('KeyQ')){ cam.x -= s; moved = true; }
  if(keys.has('ArrowRight')|| keys.has('KeyD')){ cam.x += s; moved = true; }
  if(keys.has('ArrowUp')   || keys.has('KeyW') || keys.has('KeyZ')){ cam.y -= s; moved = true; }
  if(keys.has('ArrowDown') || keys.has('KeyS')){ cam.y += s; moved = true; }
  clampCam();
  if(moved) syncTargetCam();
}

// ---------- boutons du haut ----------
function togglePause(){
  paused = !paused;
  $('bPause').textContent = paused ? '▶' : '⏸';
  $('bPause').classList.toggle('on', paused);
}
$('bPause').onclick = togglePause;
document.querySelectorAll('.spd').forEach(b=>{
  b.onclick = ()=>{
    speed = +b.dataset.s;
    document.querySelectorAll('.spd').forEach(x=> x.classList.toggle('on', x===b));
    if(paused) togglePause();
  };
});
$('bRotL').onclick = ()=> rotate(-1);
$('bRotR').onclick = ()=> rotate(1);
// ---- actions contextuelles tactiles ----
$('ctxCancel').onclick = ()=> setTool('select');
$('ctxShift').onclick = ()=>{
  shiftToggle = !shiftToggle;
  $('ctxShift').classList.toggle('on', shiftToggle);
  // appliquer immédiatement à la preview de route en cours
  if(roadDragStart && tool === 'road' && mouse.lDown)
    roadPreviewTiles = computeRoadPreview(roadDragStart.x, roadDragStart.y, mouse.tx, mouse.ty, shiftToggle);
};
$('sMoney').onclick = toggleFinance;
// délégation : le ✕ survit aux reconstructions du panneau (rafraîchi 5×/s)
$('finance').onclick = e=>{ if(e.target.id==='bFinX') toggleFinance(); };
$('info').onclick = e=>{ if(e.target.id==='infoCloseBtn') closeInfoPanel(); };

let helpCurrentPage = 0;
const HELP_PAGES = 4;

function goHelpPage(p){
  helpCurrentPage = Math.max(0, Math.min(HELP_PAGES - 1, p));
  for(let i = 0; i < HELP_PAGES; i++){
    const el = $('hPage'+i);
    if(el) el.classList.toggle('active', i === helpCurrentPage);
  }
  document.querySelectorAll('#helpDots .dot').forEach((d,i)=>
    d.classList.toggle('on', i === helpCurrentPage));
  $('bHelpPrev').disabled = helpCurrentPage === 0;
  $('bHelpNext').disabled = helpCurrentPage === HELP_PAGES - 1;
}

function toggleHelp(){
  const h = $('help');
  const visible = h.style.display === 'block';
  h.style.display = visible ? 'none' : 'block';
  if(!visible) goHelpPage(helpCurrentPage);
}
$('bHelp').onclick = toggleHelp;
$('bHelpClose').onclick = ()=> $('help').style.display = 'none';
$('bGo').onclick = ()=> $('help').style.display = 'none';
$('bHelpPrev').onclick = ()=> goHelpPage(helpCurrentPage - 1);
$('bHelpNext').onclick = ()=> goHelpPage(helpCurrentPage + 1);
document.querySelectorAll('#helpDots .dot').forEach(d=>
  d.onclick = ()=> goHelpPage(+d.dataset.p));
goHelpPage(0);
$('sSplashGo').onclick = ()=> $('splash').style.display = 'none';

// ---------- dropdown options ----------
const optMenu = $('optMenu');
const layerMenu = $('layerMenu');
const graphicPackSelect = $('graphicPackSelect');
const languageSelect = $('languageSelect');

function buildLanguageSelect(){
  if(!languageSelect) return;
  languageSelect.innerHTML = '';
  for(const lang of (window.I18N_LANGS || ['fr'])){
    const opt = document.createElement('option');
    opt.value = lang;
    opt.textContent = t('language.' + lang);
    languageSelect.appendChild(opt);
  }
}

function buildGraphicPackSelect(){
  graphicPackSelect.innerHTML = '';
  for(const key in GRAPHIC_PACKS){
    const pack = GRAPHIC_PACKS[key];
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = pack.n;
    opt.title = pack.desc || '';
    graphicPackSelect.appendChild(opt);
  }
}
buildLanguageSelect();
buildGraphicPackSelect();
loadCommunityGraphicPacks().then(ids => {
  if(!ids.length) return;
  buildGraphicPackSelect();
  refreshOptMenu();
  if(ids.includes(UI_OPTIONS.graphicPack))
    toast(t('settings.graphicPackLoaded', { pack: GRAPHIC_PACKS[UI_OPTIONS.graphicPack].n }));
});

function refreshOptMenu(){
  if(languageSelect){
    for(const opt of languageSelect.options) opt.textContent = t('language.' + opt.value);
    languageSelect.value = UI_OPTIONS.language;
  }
  if(graphicPackSelect) graphicPackSelect.value = UI_OPTIONS.graphicPack;
  document.querySelectorAll('.opt-item[data-opt]').forEach(el => {
    const key = el.dataset.opt;
    const active = !!UI_OPTIONS[key];
    el.classList.toggle('active', active);
    el.querySelector('.chk').textContent = active ? '✓' : '';
  });
}
refreshOptMenu();
applyI18n();
addEventListener('factopolis:languagechange', () => {
  buildLanguageSelect();
  refreshOptMenu();
});

$('bOptions').onclick = e => {
  e.stopPropagation();
  layerMenu.classList.remove('open');
  optMenu.classList.toggle('open');
};

$('bLayer').onclick = e => {
  e.stopPropagation();
  optMenu.classList.remove('open');
  layerMenu.classList.toggle('open');
};

document.addEventListener('click', e => {
  if(!optMenu.contains(e.target) && e.target.id !== 'bOptions')
    optMenu.classList.remove('open');
  if(!layerMenu.contains(e.target) && e.target.id !== 'bLayer')
    layerMenu.classList.remove('open');
});

document.querySelectorAll('.opt-item[data-opt]').forEach(el => {
  el.onclick = e => {
    e.stopPropagation();
    const key = el.dataset.opt;
    UI_OPTIONS[key] = !UI_OPTIONS[key];
    saveUIOptions();
    refreshOptMenu();
  };
});

languageSelect.onchange = e => {
  e.stopPropagation();
  setLanguage(languageSelect.value);
  toast(t('settings.languageChanged', { language: t('language.' + UI_OPTIONS.language) }));
};

graphicPackSelect.onchange = e => {
  e.stopPropagation();
  UI_OPTIONS.graphicPack = graphicPackSelect.value;
  saveUIOptions();
  refreshOptMenu();
  toast(t('settings.graphicPackChanged', { pack: GRAPHIC_PACKS[UI_OPTIONS.graphicPack].n }));
};

// ---------- boucle principale ----------
// drawFn est une indirection pour permettre aux extensions (multijoueur) de surcharger draw
let drawFn = draw;

let last = performance.now();
function frame(now){
  const rdt = Math.min(0.05, (now-last)/1000);
  last = now;
  panKeys(rdt);
  smoothCamera(rdt);
  if(!paused) update(rdt*speed);
  drawFn();
  updateHUD(rdt);
  // Décompte sauvegarde auto (temps réel, pas affecté par speed/pause)
  autoSaveTimer -= rdt;
  if(autoSaveTimer <= 0){
    autoSaveTimer = AUTO_SAVE_INTERVAL;
    performAutoSave();
  }
  requestAnimationFrame(frame);
}
