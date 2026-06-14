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
  if(b.type==='depot') return 'Stocke et redistribue';
  if(b.type==='tank') return 'Stocke l’eau pour les boulangeries proches';
  if(b.type==='garage'){
    const active = (b.vehicles||[]).filter(v=>v.state!=='idle').length;
    return active > 0 ? active+' véhicule(s) en tournée' : 'Aucun véhicule en service';
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
  return 'En production';
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
      let h = '<h3><span style="font-size:22px">'+vt.icone+'</span> '+vt.nom+'</h3>';
      h += '<div class="status">'+stateLabel+'</div>';
      h += '<div class="row"><span>Cargaison</span><b>'+(veh.cargo > 0 ? veh.cargo+' '+(veh.res ? RES[veh.res].n : '') : 'Vide')+'</b></div>';
      h += '<div class="row"><span>Source</span><b style="color:#4dd9ff">'+srcName+'</b></div>';
      h += '<div class="row"><span>Destination</span><b style="color:#ffaa44">'+dstName+'</b></div>';
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
  let h = '<h3><span style="font-size:22px">'+d.ic+'</span>'+d.n+'</h3>';
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
  if(d.workers) h += '<div class="row"><span>Ouvriers</span><b>'+workersAllocatedOf(b)+' / '+workersRequiredOf(b)+'</b></div>';
  if(d.ind && b.w*b.h>1)
    h += '<div class="row"><span>Taille / production</span><b>'+b.w+'×'+b.h
       + ' — ×'+prodMult(b).toFixed(1)+'</b></div>';
  if(d.ind)
    h += '<div class="row"><span>Entretien</span><b>'+(Math.round(upkeepOf(b)*10)/10)
       + ' $ / '+IND_UPKEEP_INTERVAL+' s</b></div>';
  if(d.ind && b.name)
    h += '<div class="row"><span>Nom</span><b style="color:#9fd4f0">🏭 '+escHtml(b.name)+'</b></div>';
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
  const r2 = recipeOf(b);
  const inKeys  = d.ind && r2 ? Object.keys(r2.in||{})  : [];
  const outKeys = d.ind && r2 ? Object.keys(r2.out||{}) : [];
  const inSet   = new Set(inKeys), outSet = new Set(outKeys);
  const extraKeys = Object.keys(b.storage).filter(k => b.storage[k]>0 && !inSet.has(k) && !outSet.has(k));
  const showStock = (k) => {
    const cap = capOf(b,k), val = b.storage[k]||0;
    h += '<div class="row"><span>'+RES[k].n+'</span><b>'+val+' / '+cap+'</b></div>';
    h += '<div class="bar"><i style="width:'+Math.min(100,100*val/cap)+'%;background:'+RES[k].c+'"></i></div>';
  };
  if(d.ind && r2){
    // entrées (toujours affichées)
    if(inKeys.length) h += '<div style="margin-top:8px"></div>';
    inKeys.forEach(showStock);
    // recette
    const fmt = obj => Object.entries(obj).map(([k,v]) => (v>1?v+'×':'')+RES[k].n).join(' + ');
    const lhs  = inKeys.length ? fmt(r2.in)+' → ' : '';
    const time = Math.round(r2.time*10)/10;
    h += '<div class="row" style="margin:6px 0 2px"><span style="color:#8fa3bf">Recette</span>'
       + '<b style="color:#d4e8ff">'+lhs+fmt(r2.out)
       + ' <span style="color:#8fa3bf;font-weight:normal">/ '+time+'s</span></b></div>';
    // sortie (toujours affichée)
    outKeys.forEach(showStock);
    // ressources hors recette (rare)
    if(extraKeys.length){
      extraKeys.forEach(showStock);
    }
  } else {
    // bâtiments non-industriels (logements, entrepôts…)
    const allKeys = [...new Set([
      ...Object.keys(b.storage).filter(k=>b.storage[k]>0 || (b.inc[k]||0)>0),
    ])];
    if(allKeys.length){
      h += '<div style="margin-top:8px;color:#8fa3bf">Stocks</div>';
      allKeys.forEach(showStock);
    }
  }
  if(b.type==='depot'){
    h += '<div class="row"><span>Rayon d\'action</span><b style="color:#ffd700">'+depotRadiusOf(b)+' cases</b></div>';
    if(b.w*b.h > 1)
      h += '<div class="row"><span>Taille</span><b>'+b.w+'×'+b.h+'</b></div>';
    h += '<div style="margin-top:8px;color:#8fa3bf">Ressources acceptées</div><div>';
    for(const k in RES){
      if(k === 'water') continue;
      const on = b.allow?.[k] !== false;
      h += '<button class="tbtn flt'+(on?' on':'')+'" data-r="'+k+'">'
         + '<span class="dot" style="background:'+RES[k].c+'"></span>'+RES[k].n+'</button>';
    }
    h += '</div>';
    // Section vente inter-joueurs (toujours visible pour permettre l'accès solo aussi)
    const myOid = MP.myId;
    const isOwner = !b.owner || b.owner === myOid;
    if(isOwner){
      h += '<div style="margin-top:8px;color:#f0c060;font-size:11px">🛒 Vente aux autres joueurs</div>';
      h += '<div style="font-size:10px;color:#8fa3bf;margin-bottom:3px">Prix par unité · cliquer pour activer/désactiver</div>';
      for(const k in RES){
        if(k === 'water') continue;
        const on = !!b.sellTo?.[k];
        const price = TRADE_PRICES[k];
        const minStock = b.sellMin?.[k] || 0;
        h += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">'
           + '<button class="tbtn sell-toggle'+(on?' on':'')+'" data-sell="'+k+'" style="flex:1;'
           + (on ? 'border-color:#f0c060;color:#f0c060' : '')+'">'
           + '<span class="dot" style="background:'+RES[k].c+'"></span>'
           + RES[k].n+' <span style="color:#8fa3bf">'+price+' $</span></button>';
        if(on){
          h += '<span style="color:#8fa3bf;font-size:10px;white-space:nowrap">Min stock</span>'
             + '<button class="tbtn sell-min-dec" data-sell-min="'+k+'" style="padding:2px 6px">−</button>'
             + '<span style="min-width:24px;text-align:center;font-size:11px">'+minStock+'</span>'
             + '<button class="tbtn sell-min-inc" data-sell-min="'+k+'" style="padding:2px 6px">+</button>';
        }
        h += '</div>';
      }
    }
  }
  if(b.type==='tank'){
    h += '<div class="row"><span>Rayon d\'action</span><b style="color:#64b7e8">'+tankRadiusOf(b)+' cases</b></div>';
    h += '<div class="row"><span>Stockage</span><b>Eau uniquement</b></div>';
  }
  if(b.type==='garage'){
    const bvehicles = b.vehicles || [];
    h += '<div class="row"><span>Véhicules</span><b>'+bvehicles.length+'</b></div>';
    // Instruction mode assignation route
    if(vehicleRouteMode && bvehicles.some(v=>v===vehicleRouteMode.vehicle)){
      const step = vehicleRouteMode.step;
      h += '<div class="warn" style="background:#1a2e1a;border-color:#3d8c3d;color:#9fe8a0">'
         + (step==='source' ? '🔁 Clique sur l\'ENTREPÔT source' : '🔁 Clique sur l\'ENTREPÔT destination')
         + '</div>';
    }
    if(bvehicles.length){
      h += '<div style="margin-top:8px;color:#8fa3bf">Véhicules assignés</div>';
      for(const v of bvehicles){
        const vt = VEHICLE_TYPES[v.vtype];
        const srcName = v.source && !v.source.dead ? BUILD[v.source.type].n : '—';
        const dstName = v.dest   && !v.dest.dead   ? BUILD[v.dest.type].n  : '—';
        const stateLabel = v.state==='idle' ? 'En attente'
          : v.state==='to_source' ? 'Vers source' : 'Vers destination';
        const cargoStr = v.cargo > 0 ? ' · '+v.cargo+(v.res ? ' '+RES[v.res].n : '') : '';
        h += '<div style="padding:5px 0;border-bottom:1px solid #2a3a50">'
           + '<div>'+vt.icone+' <b>'+vt.nom+'</b></div>'
           + '<div style="font-size:11px;color:#8fa3bf">'+stateLabel+cargoStr+'</div>'
           + '<div style="font-size:11px;color:#8fa3bf">'+srcName+' → '+dstName+'</div>'
           + '<div style="display:flex;gap:4px;margin-top:3px">'
           + '<button class="tbtn" style="flex:1;font-size:11px" data-route-v="'+v.id+'">🔁 Route</button>'
           + '<button class="tbtn" style="font-size:11px;color:#ff9a8a" data-sell-v="'+v.id+'">🗑️ Vendre</button>'
           + '</div></div>';
      }
    }
    h += '<div style="margin-top:8px;color:#8fa3bf">Acheter un véhicule</div>';
    for(const vk in VEHICLE_TYPES){
      const vt = VEHICLE_TYPES[vk];
      h += '<button class="tbtn" style="width:100%;text-align:left;margin-top:2px" data-buy-v="'+vk+'">'
         + vt.icone+' '+vt.nom+' <span style="color:#8fa3bf">— '+vt.cost+' $</span></button>';
    }
  }
  const canControl = !b.owner || b.owner === MP.myId;
  // Contrôles de production pour les usines industrielles (hors dépôts/citernes)
  if(d.ind && r2 && canControl){
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
    h += '<button class="tbtn" id="bClearStock" style="margin-top:6px;color:#ff9a8a">🗑️ Vider le stock</button>';
  }
  if(d.ind && canControl)
    h += '<button class="tbtn" id="bPauseBld">'+(b.paused ? '▶ Reprendre' : '⏸ Mettre en pause')+'</button>';
  h += '<button class="tbtn" id="bDemol">🧨 Démolir (+'+Math.floor((d.cost||0)*0.3)+' $)</button>';
  p.style.display = 'block';
  if(p._html === h && p._b === b) return; // ne pas reconstruire le DOM sous la souris
  p._html = h; p._b = b;
  p.innerHTML = h;
  p.querySelectorAll('[data-plant-upgrade]').forEach(btn=>{
    btn.onclick = ()=>{
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
      if(!confirm('Créer '+label+' pour '+cost+' $ ? Ce choix sera définitif.')) return;
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
  p.querySelectorAll('.flt').forEach(btn=>{
    btn.onclick = ()=>{
      b.allow[btn.dataset.r] = b.allow[btn.dataset.r] === false;
      p._html = null; // forcer le rafraîchissement
    };
  });
  p.querySelectorAll('.sell-toggle').forEach(btn=>{
    btn.onclick = ()=>{
      if(!b.sellTo) b.sellTo = {};
      b.sellTo[btn.dataset.sell] = !b.sellTo[btn.dataset.sell];
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
  if(b.type === 'garage'){
    p.querySelectorAll('[data-route-v]').forEach(btn=>{
      btn.onclick = ()=>{
        const vid = +btn.dataset.routeV;
        const v = vehicles.find(vv=>vv.id===vid);
        if(!v) return;
        vehicleRouteMode = { vehicle:v, step:'source' };
        setTool('select');
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
      if(!b.blockedOut) b.blockedOut = {};
      const k = btn.dataset.out;
      b.blockedOut[k] = !b.blockedOut[k];
      if(MP.connected) netSend({ type:'toggle_out_block', x:b.x, y:b.y, res:k, blocked:b.blockedOut[k] });
      p._html = null;
    };
  });
  const clearBtn = $('bClearStock');
  if(clearBtn) clearBtn.onclick = ()=>{
    if(!confirm('Vider tout le stock de ce bâtiment ?')) return;
    b.storage = {};
    b.inc = {};
    if(MP.connected) netSend({ type:'clear_bld_stock', x:b.x, y:b.y });
    p._html = null;
    renderInfo();
  };
  const pauseBtn = $('bPauseBld');
  if(pauseBtn) pauseBtn.onclick = ()=>{
    setBuildingPaused(b, !b.paused);
    p._html = null;
    renderInfo();
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

// ---------- barre d'outils ----------
function buildToolbar(){
  const bar = $('toolbar');
  for(const k of TOOL_ORDER){
    if(k === 'garage'){
      const sep = document.createElement('div');
      sep.style.cssText = 'padding:4px 6px 2px;font-size:10px;color:#8fa3bf;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap';
      sep.textContent = '🚛 Logistique';
      bar.appendChild(sep);
    }
    const d = BUILD[k];
    const btn = document.createElement('button');
    btn.className = 'tool' + (k===tool ? ' on' : '');
    btn.dataset.t = k;
    btn.title = d.desc || '';
    btn.innerHTML = '<span class="ic">'+d.ic+'</span><span>'+d.n+'</span>'
      + (d.cost ? '<span class="cost">'+d.cost+' $</span>' : '<span class="cost">&nbsp;</span>')
      + '<span class="hk">['+d.hk+']</span>';
    btn.onclick = ()=> setTool(k);
    bar.appendChild(btn);
  }
}
function setTool(k){
  tool = k;
  roadDragStart = null; roadPreviewTiles = [];
  document.querySelectorAll('.tool').forEach(b=> b.classList.toggle('on', b.dataset.t===k));
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
      const t = towns.find(t=>t.id === h.id);
      if(t) toast('🏘️ Village sélectionné : ' + t.name);
      hudTimer = 0;
      updateHUD(0);
      return true;
    }
  }
  return false;
}

// clickFn : indirection pour permettre au module multijoueur d'intercepter les clics
let clickFn = clickAt;

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
    if(tool === 'road'){
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
  if(mouse.lDown && (tool==='bulldoze'||tool==='terraform'||tool==='fill_water') && (mouse.tx!==ptx || mouse.ty!==pty))
    clickFn(mouse.tx, mouse.ty);
  if(mouse.lDown && tool==='road' && roadDragStart && (mouse.tx!==ptx || mouse.ty!==pty))
    roadPreviewTiles = computeRoadPreview(roadDragStart.x, roadDragStart.y, mouse.tx, mouse.ty, e.shiftKey);
});
addEventListener('mouseup', e=>{
  if(e.button===0){
    if(tool === 'road' && roadDragStart){
      for(const t of roadPreviewTiles)
        if(canPlace('road', t.x, t.y).ok) clickFn(t.x, t.y);
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
  keys.add(e.code);
  if(e.code==='Space'){ e.preventDefault(); togglePause(); }
  if(e.code==='Escape'){ setTool('select'); selected = null; selectedExpansion = null; vehicleRouteMode = null; selectedVehicle = null; }
  if((e.code==='ShiftLeft'||e.code==='ShiftRight') && roadDragStart && mouse.lDown)
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
addEventListener('keyup', e=>{
  keys.delete(e.code);
  if((e.code==='ShiftLeft'||e.code==='ShiftRight') && roadDragStart && mouse.lDown)
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

function toggleHelp(){
  const h = $('help');
  h.style.display = h.style.display==='block' ? 'none' : 'block';
}
$('bHelp').onclick = toggleHelp;
$('bGo').onclick = ()=> $('help').style.display = 'none';
$('sSplashGo').onclick = ()=> $('splash').style.display = 'none';

// ---------- dropdown options ----------
const optMenu = $('optMenu');
const graphicPackMenu = $('graphicPackMenu');

function buildGraphicPackMenu(){
  graphicPackMenu.innerHTML = '';
  for(const key in GRAPHIC_PACKS){
    const pack = GRAPHIC_PACKS[key];
    const el = document.createElement('div');
    el.className = 'opt-item';
    el.dataset.pack = key;
    el.title = pack.desc || '';
    el.innerHTML = '<span class="chk"></span>' + pack.n;
    graphicPackMenu.appendChild(el);
  }
}
buildGraphicPackMenu();
loadCommunityGraphicPacks().then(ids => {
  if(!ids.length) return;
  buildGraphicPackMenu();
  refreshOptMenu();
  if(ids.includes(UI_OPTIONS.graphicPack))
    toast('Pack graphique chargé : ' + GRAPHIC_PACKS[UI_OPTIONS.graphicPack].n);
});

function refreshOptMenu(){
  document.querySelectorAll('.opt-item[data-opt]').forEach(el => {
    const key = el.dataset.opt;
    const active = !!UI_OPTIONS[key];
    el.classList.toggle('active', active);
    el.querySelector('.chk').textContent = active ? '✓' : '';
  });
  document.querySelectorAll('.opt-item[data-pack]').forEach(el => {
    const active = UI_OPTIONS.graphicPack === el.dataset.pack;
    el.classList.toggle('active', active);
    el.querySelector('.chk').textContent = active ? '✓' : '';
  });
}
refreshOptMenu();

$('bOptions').onclick = e => {
  e.stopPropagation();
  optMenu.classList.toggle('open');
};

document.addEventListener('click', e => {
  if(!optMenu.contains(e.target) && e.target.id !== 'bOptions')
    optMenu.classList.remove('open');
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

graphicPackMenu.onclick = e => {
  const el = e.target.closest('.opt-item[data-pack]');
  if(!el) return;
  e.stopPropagation();
  UI_OPTIONS.graphicPack = el.dataset.pack;
  saveUIOptions();
  refreshOptMenu();
  toast('Pack graphique : ' + GRAPHIC_PACKS[UI_OPTIONS.graphicPack].n);
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
