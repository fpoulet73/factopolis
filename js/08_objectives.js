// ---------- panneau des objectifs ----------
// Objectifs du joueur (wallet.objDone, tenu par la simulation : js/06b_progression.js).
// Onglets : « En cours » (tous les objectifs ouverts, menés en parallèle, avec jauge et
// déblocages promis), « Réussis » et « À venir » (prérequis manquants). Chaque objectif
// atteint est annoncé avec sa prime et ce qu'il débloque. Masquable via le menu Panneaux.
const ObjectivesPanel = (function(){
  let panel = null, lastDone = null, lastHtml = '', tab = 'current';
  const MAX_CHIPS = 8;

  function ensureDom(){
    if(panel) return;
    panel = document.createElement('div');
    panel.id = 'objectivesPanel';
    panel.className = 'panel';
    panel.style.cssText = 'top:64px;left:12px;width:min(350px,calc(100vw - 24px));padding:8px 10px;font-size:12px;z-index:9;display:none';
    document.body.appendChild(panel);
  }

  const money = n => n.toLocaleString('fr-FR');
  // Puces des fonctionnalités débloquées par un objectif (got : déjà acquises)
  function chips(o, got){
    if(!progressionActive() || !o.unlocks.length) return '';
    const list = o.unlocks.slice(0, MAX_CHIPS).map(f => '<span class="obj-chip'+(got ? ' got' : '')+'">'+escHtml(featureLabel(f))+'</span>');
    if(o.unlocks.length > MAX_CHIPS) list.push('<span class="obj-chip'+(got ? ' got' : '')+'">+'+(o.unlocks.length - MAX_CHIPS)+'</span>');
    return '<div class="obj-unlocks"><span style="font-size:10px;color:#8fa3bf">'+(got ? '🔓' : '🎁 Débloque')+'</span>'+list.join('')+'</div>';
  }
  function card(o, w, mode){
    const ch = PROG_CHAPTERS[o.ch];
    let h = '<div class="obj-card'+(mode === 'locked' ? ' locked' : '')+'"><span class="obj-ic">'+(mode === 'locked' ? '🔒' : o.ic)+'</span><div class="obj-body">'
      + '<div style="display:flex;gap:6px;align-items:baseline"><span class="obj-ch" style="flex:1">'+(ch ? ch.ic+' '+ch.n : '')+'</span>'
      + '<span class="obj-reward">'+(mode === 'done' ? '<span style="color:#6fcf8f">✔</span> ' : '')+'+'+money(o.reward)+' $</span></div>'
      + '<b>'+escHtml(o.txt)+'</b>';
    if(mode === 'current' && o.prog){
      const [cur, target] = o.prog(walletOwnerOf(currentWalletOwner()), w);
      const pct = Math.max(0, Math.min(100, Math.round(cur / target * 100)));
      h += '<div style="display:flex;align-items:center;gap:6px"><div class="obj-bar" style="flex:1"><i style="width:'+pct+'%"></i></div>'
        + '<span style="font-size:10px;color:#9fb3c8;white-space:nowrap">'+money(Math.min(cur, target))+' / '+money(target)+'</span></div>';
    }
    if(mode === 'locked'){
      const miss = o.req.filter(r => !objectiveDone(w, r)).map(r => OBJECTIVE_BY_ID[r]);
      h += '<div style="font-size:10px;color:#9fb3c8;margin-top:2px">Après : '+miss.map(m => escHtml(m.ic+' '+m.txt)).join(' · ')+'</div>';
    }
    return h + chips(o, mode === 'done') + '</div></div>';
  }

  function announce(w){
    const done = w.objDone;
    if(!done) return;
    // Annonce des objectifs franchis depuis le dernier rendu (y compris côté invité), hors
    // chargement / synchronisation d'état à l'arrivée dans la partie.
    const settling = typeof objectivesSettleUntil !== 'undefined' && performance.now() < objectivesSettleUntil;
    if(lastDone && !settling){
      for(const id in done){
        if(lastDone.has(id)) continue;
        const o = OBJECTIVE_BY_ID[id];
        if(!o) continue;
        const unl = progressionActive() && o.unlocks.length ? ' · 🔓 '+o.unlocks.map(featureLabel).join(', ') : '';
        toast('🎯 Objectif atteint : '+o.txt+' — prime +'+money(o.reward)+' $'+unl, 'win');
      }
    }
    lastDone = new Set(Object.keys(done));
  }

  function render(){
    ensureDom();
    const visible = !!UI_OPTIONS.panelObjectives;
    panel.style.display = visible ? 'block' : 'none';
    const w = myWallet();
    announce(w);
    if(!visible) return;
    const ready = !!w.objDone;
    const done = ready ? OBJECTIVES.filter(o => objectiveDone(w, o.id)) : [];
    const open = ready ? OBJECTIVES.filter(o => objectiveOpen(w, o)) : [];
    const later = ready ? OBJECTIVES.filter(o => !objectiveDone(w, o.id) && !objectiveOpen(w, o)) : [];
    const tabBtn = (id, label) => '<button class="tbtn'+(tab === id ? ' on' : '')+'" data-objtab="'+id+'">'+label+'</button>';
    const pct = Math.round(done.length / OBJECTIVES.length * 100);
    let h = '<div class="obj-tabs">'
      + tabBtn('current', '🎯 En cours ('+open.length+')')
      + tabBtn('done', '✔ Réussis ('+done.length+')')
      + tabBtn('later', '🔒 À venir ('+later.length+')')
      + '<span style="flex:1"></span>'
      + '<button class="tbtn" id="objClose" title="Masquer (réactivable dans Panneaux)" style="padding:1px 7px;width:auto;margin:0">✕</button></div>'
      + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><div class="obj-bar" style="flex:1;margin:0"><i style="width:'+pct+'%;background:#6fcf8f"></i></div>'
      + '<span style="font-size:10px;color:#8fa3bf">'+done.length+' / '+OBJECTIVES.length+'</span></div>';
    let body;
    if(!ready){
      body = '<div style="color:#8fa3bf">🎯 Objectifs…</div>';
    } else if(tab === 'done'){
      body = done.length
        ? Object.keys(w.objDone).reverse().map(id => OBJECTIVE_BY_ID[id]).filter(Boolean).map(o => card(o, w, 'done')).join('')
        : '<div style="color:#8fa3bf">Aucun objectif réussi pour l\'instant.</div>';
    } else if(tab === 'later'){
      body = later.length
        ? later.map(o => card(o, w, 'locked')).join('')
        : '<div style="color:#8fa3bf">Plus rien en attente : tous les objectifs sont ouverts.</div>';
    } else if(!open.length){
      body = '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:18px">🏆</span>'
        + '<span style="flex:1"><b>Tous les objectifs sont atteints !</b><br><span style="color:#8fa3bf">Ta ville est un empire du transport.</span></span></div>';
    } else {
      body = open.map(o => card(o, w, 'current')).join('');
      if(!progressionActive()) body += '<div style="font-size:10px;color:#8fa3bf;margin-top:2px">Toutes les fonctionnalités sont accessibles dans ce monde.</div>';
    }
    h += '<div class="obj-list">'+body+'</div>';
    if(h === lastHtml) return;
    lastHtml = h;
    const list = panel.querySelector('.obj-list'), scroll = list ? list.scrollTop : 0;
    panel.innerHTML = h;
    const nl = panel.querySelector('.obj-list'); if(nl) nl.scrollTop = scroll;
    const close = document.getElementById('objClose');
    if(close) close.onclick = () => setPanelVisibility('panelObjectives', false);
    panel.querySelectorAll('[data-objtab]').forEach(btn => {
      btn.onclick = () => { tab = btn.dataset.objtab; render(); };
    });
  }

  // état reçu de l'hôte / partie chargée : on repart de l'avancement reçu sans rien annoncer
  function resync(){ lastDone = null; }
  return { render, resync };
})();
