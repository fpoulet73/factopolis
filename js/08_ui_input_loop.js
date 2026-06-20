// ---------- HUD ----------
const $ = id => document.getElementById(id);
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
    '<h3>💰 Finances <button class="tbtn" id="bFinX">✕</button></h3>'
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
    if(max === 0) return 'Aucun habitant à portée (rayon '+BUS_STOP_RADIUS+' cases)';
    const cur = Math.floor(b.passengers || 0);
    if(cur < max) return 'En remplissage : '+cur+' / '+max+' passagers';
    return 'Complet : '+max+' passager'+(max>1?'s':'')+' en attente';
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
  if(b.type === 'fisher'){
    const bonus = fisherFishBonus(b);
    if(bonus > 0) return 'En production · +'+bonus+' poisson'+(bonus>1?'s':'')+' (zones poissonneuses)';
  }
  return 'En production';
}

function _updVDyn(p, v){
  const el = p.querySelector('[data-v-state="'+v.id+'"]');
  if(!el) return;
  const lbl = v.state==='idle' ? 'En attente' : v.state==='to_source' ? 'Vers source' : 'Vers destination';
  const cargo = v.cargo > 0 ? ' · '+v.cargo+(v.res ? ' '+RES[v.res].n : '') : '';
  el.textContent = lbl + cargo;
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
      let h_ = '<h3>🧩 Pièce de puzzle</h3>';
      h_ += '<div class="status">Vers : <b>'+dir+'</b>'+(isCorner?' (coin)':' — pièce '+(exp.pieceIndex+1)+'/'+n)+'</div>';
      if(!isCorner && bought>0)
        h_ += '<div class="row"><span>Pièces achetées</span><b>'+bought+'/'+n+'</b></div>';
      if(!isCorner)
        h_ += '<div class="row"><span>Achetez les '+n+' pièces pour débloquer la prochaine bande</span></div>';
      h_ += '<div class="row"><span>Prix pièce</span><b style="color:'+(canAfford?'#ffe9a0':'#ff9a8a')+'">'+exp.cost.toLocaleString()+' $</b></div>';
      if(!isCorner && (expansionLevels[exp.side]||0)>0)
        h_ += '<div class="row"><span>Bande n°</span><b>'+((expansionLevels[exp.side]||0)+1)+'</b></div>';
      h_ += '<button class="tbtn" style="margin-top:8px;width:100%;'+(canAfford?'':'opacity:0.5;cursor:not-allowed;')+'" '
          + 'onclick="buyExpansion(selectedExpansion)">'
          + (canAfford ? '🧩 Acheter cette pièce' : '💸 Fonds insuffisants')
          + '</button>';
      p.style.display = 'block';
      if(p._html === h_) return;
      p._html = h_; p._b = null;
      p.innerHTML = h_;
      return;
    }
  }

  // --- Véhicule sélectionné ---
  if(selectedVehicle){
    if(selectedVehicle.garageRef?.dead){ selectedVehicle = null; }
    else {
      const veh = selectedVehicle;
      const vt = VEHICLE_TYPES[veh.vtype];
      const stateLabel = { idle:'En attente 💤', to_source:'Vers source 🔵', to_dest:'Vers destination 🟠', returning:'Retour au dépôt 🏪' }[veh.state] || veh.state;
      const srcName = veh.source && !veh.source.dead ? BUILD[veh.source.type].n : '—';
      const dstName = veh.dest   && !veh.dest.dead   ? BUILD[veh.dest.type].n  : '—';
      const isBusVeh = veh.vtype === 'bus';
      const srcNameDisplay = isBusVeh && veh.source && !veh.source.dead
        ? (veh.source.name || BUILD[veh.source.type].n) : srcName;
      const dstNameDisplay = isBusVeh && veh.dest && !veh.dest.dead
        ? (veh.dest.name || BUILD[veh.dest.type].n) : dstName;
      const cargoStr = isBusVeh
        ? (veh.cargo > 0 ? veh.cargo+' passager(s)' : 'Vide')
        : (veh.cargo > 0 ? veh.cargo+' '+(veh.res ? RES[veh.res].n : '') : 'Vide');
      let h = '<h3><span style="font-size:22px">'+vt.icone+'</span> '+vt.nom+'</h3>';
      h += '<div class="status">'+stateLabel+'</div>';
      h += '<div class="row"><span>Cargaison</span><b>'+cargoStr+'</b></div>';
      h += '<div class="row"><span>Source</span><b style="color:#4dd9ff">'+srcNameDisplay+'</b></div>';
      h += '<div class="row"><span>Destination</span><b style="color:#ffaa44">'+dstNameDisplay+'</b></div>';
      h += '<div class="row"><span>Capacité</span><b>'+vt.capacite+'</b></div>';
      h += '<div class="row"><span>Vitesse</span><b>'+vt.speed+' cases/s</b></div>';
      h += '<div style="margin-top:8px;display:flex;gap:4px">'
         + '<button class="tbtn" style="flex:1" id="bVehRoute">🔁 Nouvelle route</button>'
         + '</div>';
      if(veh.state !== 'idle' && veh.state !== 'returning')
        h += '<button class="tbtn" style="width:100%;margin-top:4px" id="bVehReturn">🏪 Retour au dépôt</button>';
      h += '<button class="tbtn" style="width:100%;margin-top:4px;color:#ff9a8a" id="bVehSell">🗑️ Vendre (+'
         + Math.floor(vt.cost*0.5)+' $)</button>';
      p.style.display = 'block';
      if(p._html === h) return;
      p._html = h; p._b = null;
      p.innerHTML = h;
      $('bVehRoute').onclick = ()=>{
        vehicleRouteMode = { vehicle:veh, step:'source' };
        setTool('select');
        if(veh.vtype === 'bus')
          toast('🚌 Clique sur l\'arrêt de bus de départ pour '+vt.nom+'.');
        else
          toast('🔁 Clique sur l\'entrepôt source pour '+vt.nom+'.');
        p._html = null;
      };
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
  _hdrBtns += '</span>';
  let h = '<h3><span style="font-size:22px">'+d.ic+'</span>';
  if(d.ind){
    h += '<input id="bldNameInput" class="bld-name-edit" value="'+escHtml(b.name||'')+'" placeholder="'+escHtml(d.n)+'">';
  } else {
    h += '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
       + (b.name ? escHtml(b.name) : d.n) + '</span>';
  }
  h += _hdrBtns+'</h3>';
  h += '<div class="status">'+statusOf(b)+'</div>';
  if(!adjRoadTiles(b).length)
    h += '<div class="warn">⚠️ Aucune route adjacente — pas de camions !</div>';
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
    h += '<div class="row"><span>Passagers en attente</span><b style="color:#7dd8ff">👥 '+pCur+(pMax>0?' / '+pMax:'')+'</b></div>';
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
    const buyCatalog = Array.isArray(BUILD[b.type]?.buyCatalog)
      ? BUILD[b.type].buyCatalog
      : (b.type === 'garage'
          ? Object.keys(VEHICLE_TYPES).filter(k => !VEHICLE_TYPES[k].buyDisabled)
          : []);
    h += '<div class="row"><span>Véhicules</span><b>'+bvehicles.length+'</b></div>';
    // Instruction mode assignation route
    if(vehicleRouteMode && bvehicles.some(v=>v===vehicleRouteMode.vehicle)){
      const step = vehicleRouteMode.step;
      const rmVeh = vehicleRouteMode.vehicle;
      const isBusRM = rmVeh?.vtype === 'bus';
      if(isBusRM){
        h += '<div class="warn" style="background:#0e1e30;border-color:#3a6f9c;color:#7dd8ff">'
           + (step==='source' ? '🚌 Clique sur l\'ARRÊT DE BUS de départ' : '🚌 Clique sur l\'ARRÊT DE BUS de destination')
           + '</div>';
      } else {
        h += '<div class="warn" style="background:#1a2e1a;border-color:#3d8c3d;color:#9fe8a0">'
           + (step==='source' ? '🔁 Clique sur l\'ENTREPÔT source' : '🔁 Clique sur l\'ENTREPÔT destination')
           + '</div>';
      }
    }
    if(bvehicles.length){
      h += '<div style="margin-top:8px;color:#8fa3bf">Véhicules assignés</div>';
      for(const v of bvehicles){
        const vt = VEHICLE_TYPES[v.vtype];
        if(!vt) continue;
        const srcName = v.source && !v.source.dead ? BUILD[v.source.type].n : '—';
        const dstName = v.dest   && !v.dest.dead   ? BUILD[v.dest.type].n  : '—';
        let resSel = '';
        if(vt.resources.length > 1){
          resSel = '<select style="display:block;width:100%;margin-top:4px;background:#16202f;border:1px solid #36465e;color:#e8eef7;border-radius:7px;padding:4px 6px;font-size:12px;box-sizing:border-box" data-pin-v="'+v.id+'">'
            + '<option value="">— Toutes les ressources —</option>';
          for(const r of vt.resources)
            resSel += '<option value="'+r+'"'+(v.pinnedRes===r?' selected':'')+'>'+( RES[r]?.ic||'')+' '+(RES[r]?.n||r)+'</option>';
          resSel += '</select>';
        }
        h += '<div style="padding:5px 0;border-bottom:1px solid #2a3a50">'
           + '<div>'+vt.icone+' <b>'+vt.nom+'</b></div>'
           + '<div style="font-size:11px;color:#8fa3bf" data-v-state="'+v.id+'"></div>'
           + '<div style="font-size:11px;color:#8fa3bf">'+srcName+' → '+dstName+'</div>'
           + resSel
           + '<div style="display:flex;gap:4px;margin-top:3px">'
           + '<button class="tbtn" style="flex:1;font-size:11px" data-route-v="'+v.id+'">🔁 Route</button>'
           + '<button class="tbtn" style="font-size:11px;color:#ff9a8a" data-sell-v="'+v.id+'">🗑️ Vendre</button>'
           + '</div></div>';
      }
    }
    if(buyCatalog.length){
      h += '<div style="margin-top:8px;color:#8fa3bf">Acheter un véhicule</div>';
      for(const vk of buyCatalog){
        const vt = VEHICLE_TYPES[vk];
        if(!vt || vt.buyDisabled) continue;
        const resLabel = vt.resources.length > 1
          ? '<span style="color:#8fa3bf;font-size:10px"> · '+ vt.resources.map(r=>RES[r]?.ic||r).join(' ') +'</span>'
          : '';
        h += '<button class="tbtn" style="width:100%;text-align:left;margin-top:2px" data-buy-v="'+vk+'">'
           + vt.icone+' '+vt.nom+resLabel+' <span style="color:#8fa3bf">— '+vt.cost+' $</span></button>';
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
        vehicleRouteMode = { vehicle:v, step:'source' };
        setTool('select');
        if(v.vtype === 'bus')
          toast('🚌 Clique sur l\'arrêt de bus de départ pour '+VEHICLE_TYPES[v.vtype].nom+'.');
        else
          toast('🔁 Clique sur l\'entrepôt source pour '+VEHICLE_TYPES[v.vtype].nom+'.');
        p._html = null;
      };
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

function closeDepotToolbarMenu(){
  if(!depotToolbarGroup || !depotToolbarMenu) return;
  depotToolbarGroup.classList.remove('open');
  depotToolbarMenu.classList.remove('open');
  syncToolbarState();
}

function syncToolbarState(){
  document.querySelectorAll('.tool').forEach(b=> b.classList.toggle('on', b.dataset.t === tool));
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
}

function buildToolbar(){
  const bar = $('toolbar');
  bar.innerHTML = '';
  depotToolbarGroup = null;
  depotToolbarMenu = null;
  const depotItems = (DEPOT_TOOLBAR_ITEMS && DEPOT_TOOLBAR_ITEMS.length)
    ? DEPOT_TOOLBAR_ITEMS
    : [
        { key:'vehicules', tool:'garage', label:'Véhicules', icon:'🚛' },
        { key:'train', tool:'train_depot', label:'Train', icon:'🚂' },
        { key:'bateau', tool:'boat_depot', label:'Bateau', icon:'🚢' },
        { key:'avion', tool:'plane_depot', label:'Avion', icon:'✈️' },
      ];
  for(const k of TOOL_ORDER){
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
        if(open) closeDepotToolbarMenu();
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
  closeDepotToolbarMenu();
  syncToolbarState();
}

// ---------- souris / clavier ----------
const mouse = { x:0, y:0, tx:-1, ty:-1, lDown:false, rDown:false, rMoved:0, lastX:0, lastY:0 };

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

  let h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
        + '<h3>🏘️ '+t.name+'</h3>'
        + '<button class="tbtn" id="tpClose" style="width:auto;padding:2px 8px;margin:0">✕</button>'
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

cv.addEventListener('mousedown', e=>{
  updateMouseTile(e);
  if(e.button===0){
    mouse.lDown = true;
    if(selectTownLabelAt(e.clientX, e.clientY)){ mouse.lDown = false; return; }
    // Mode sélection de zone pour village
    if(townZoneSelectMode){
      townZoneDrag = { x0: mouse.tx, y0: mouse.ty, x1: mouse.tx, y1: mouse.ty };
      return;
    }
    if(tool === 'road' || tool === 'rail'){
      roadDragStart = { x: mouse.tx, y: mouse.ty };
      roadPreviewTiles = computeRoadPreview(mouse.tx, mouse.ty, mouse.tx, mouse.ty, e.shiftKey);
    } else {
      clickFn(mouse.tx, mouse.ty);
    }
  } else if(e.button===2 || e.button===1){
    mouse.rDown = true; mouse.rMoved = 0;
    mouse.lastX = e.clientX; mouse.lastY = e.clientY;
  }
});
addEventListener('mousemove', e=>{
  const ptx = mouse.tx, pty = mouse.ty;
  updateMouseTile(e);
  if(mouse.rDown){
    const dx = e.clientX-mouse.lastX, dy = e.clientY-mouse.lastY;
    mouse.rMoved += Math.abs(dx)+Math.abs(dy);
    cam.x -= dx/cam.z; cam.y -= dy/cam.z;
    clampCam();
    syncTargetCam();
    mouse.lastX = e.clientX; mouse.lastY = e.clientY;
  }
  if(mouse.lDown && townZoneDrag){
    townZoneDrag.x1 = mouse.tx; townZoneDrag.y1 = mouse.ty;
    updateZoneOverlay(e.clientX, e.clientY);
    return;
  }
  if(mouse.lDown && (tool==='bulldoze'||tool==='terraform'||tool==='fill_water') && (mouse.tx!==ptx || mouse.ty!==pty))
    clickFn(mouse.tx, mouse.ty);
  if(mouse.lDown && (tool==='road' || tool==='rail') && roadDragStart && (mouse.tx!==ptx || mouse.ty!==pty))
    roadPreviewTiles = computeRoadPreview(roadDragStart.x, roadDragStart.y, mouse.tx, mouse.ty, e.shiftKey);
});
addEventListener('mouseup', e=>{
  if(e.button===0){
    if(townZoneDrag && townZoneSelectMode && !townZonePending){
      const { x0,y0,x1,y1 } = townZoneDrag;
      const cx = (Math.min(x0,x1)+Math.max(x0,x1))/2;
      const cy = (Math.min(y0,y1)+Math.max(y0,y1))/2;
      townZonePending = { x0, y0, x1, y1, newName: generateTownName(Math.round(cx), Math.round(cy)) };
      townZoneDrag = null;
      // Réafficher le panel avec la confirmation
      const tid = townZoneSelectMode.townId;
      $('townPanel').style.display = 'block';
      renderTownPanel(tid);
      mouse.lDown = false;
      return;
    }
    if(tool === 'rail' && roadDragStart){
      const { updates, cost } = collectRailUpdates(roadPreviewTiles);
      if(updates.length){
        if(MP.connected && !MP.username) toast('👤 Connecte-toi avec un compte joueur pour construire','err');
        else if(myWallet().money < cost) toast('Fonds insuffisants ('+cost+' $)','err');
        else if(MP.connected && MP.username) applyRailPathWithNetwork(roadPreviewTiles);
        else railApplyMaskUpdates(updates, cost);
      }
      roadDragStart = null; roadPreviewTiles = [];
    } else if(tool === 'road' && roadDragStart){
      for(const t of roadPreviewTiles)
        if(canPlace(tool, t.x, t.y).ok) clickFn(t.x, t.y);
      roadDragStart = null; roadPreviewTiles = [];
    }
    mouse.lDown = false;
  }
  if(e.button===2 || e.button===1){
    if(e.button===2 && mouse.rMoved < 6) setTool('select'); // clic droit simple = annuler
    mouse.rDown = false;
  }
});
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
  keys.add(e.code);
  if(e.code==='Space'){ e.preventDefault(); togglePause(); }
  if(e.code==='Escape'){ setTool('select'); selected = null; selectedExpansion = null; vehicleRouteMode = null; selectedVehicle = null; closeTownPanel(); }
  if((e.code==='ShiftLeft'||e.code==='ShiftRight') && roadDragStart && mouse.lDown && (tool==='road' || tool==='rail'))
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
});
addEventListener('keyup', e=>{
  keys.delete(e.code);
  if((e.code==='ShiftLeft'||e.code==='ShiftRight') && roadDragStart && mouse.lDown && (tool==='road' || tool==='rail'))
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
$('sMoney').onclick = toggleFinance;
// délégation : le ✕ survit aux reconstructions du panneau (rafraîchi 5×/s)
$('finance').onclick = e=>{ if(e.target.id==='bFinX') toggleFinance(); };

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
