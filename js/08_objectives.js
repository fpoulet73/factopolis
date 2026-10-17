// ---------- panneau des objectifs ----------
// Affiche l'objectif courant du joueur (wallet.objIndex, tenu par la simulation)
// et annonce chaque objectif atteint avec sa prime. Masquable via le menu Panneaux.
const ObjectivesPanel = (function(){
  let panel = null, lastIdx = null, lastHtml = '';

  function ensureDom(){
    if(panel) return;
    panel = document.createElement('div');
    panel.id = 'objectivesPanel';
    panel.className = 'panel';
    panel.style.cssText = 'top:64px;left:12px;width:min(330px,calc(100vw - 24px));padding:8px 10px;font-size:12px;z-index:9;display:none';
    document.body.appendChild(panel);
  }

  function render(){
    ensureDom();
    const visible = !!UI_OPTIONS.panelObjectives;
    panel.style.display = visible ? 'block' : 'none';
    const w = myWallet();
    const idx = w.objIndex;
    // Annonce des objectifs franchis depuis le dernier rendu (y compris côté invité).
    // Seul un objectif réellement accompli (un cran à la fois, hors chargement / synchronisation
    // d'état à l'arrivée dans la partie) est annoncé avec sa prime.
    const settling = typeof objectivesSettleUntil !== 'undefined' && performance.now() < objectivesSettleUntil;
    if(idx != null && lastIdx != null && idx === lastIdx + 1 && !settling){
      const o = OBJECTIVES[lastIdx];
      if(o) toast('🎯 Objectif atteint : '+o.txt+' — prime +'+o.reward.toLocaleString('fr-FR')+' $', 'win');
    }
    if(idx != null) lastIdx = idx;
    if(!visible) return;
    let h;
    if(idx == null){
      h = '<div style="color:#8fa3bf">🎯 Objectifs…</div>';
    } else if(idx >= OBJECTIVES.length){
      h = '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:18px">🏆</span>'
        + '<span style="flex:1"><b>Tous les objectifs sont atteints !</b><br><span style="color:#8fa3bf">Ta ville est un empire du transport.</span></span>'
        + '<button class="tbtn" id="objClose" title="Masquer" style="padding:1px 7px">✕</button></div>';
    } else {
      const o = OBJECTIVES[idx];
      const pct = Math.round(idx / OBJECTIVES.length * 100);
      h = '<div style="display:flex;align-items:center;gap:8px">'
        + '<span style="font-size:20px">'+o.ic+'</span>'
        + '<span style="flex:1;line-height:1.3"><span style="color:#8fa3bf;font-size:10px;text-transform:uppercase;letter-spacing:.06em">Objectif '+(idx + 1)+' / '+OBJECTIVES.length+'</span><br>'
        + '<b>'+escHtml(o.txt)+'</b><br><span style="color:#ffd87a">Prime : '+o.reward.toLocaleString('fr-FR')+' $</span></span>'
        + '<button class="tbtn" id="objClose" title="Masquer (réactivable dans Panneaux)" style="padding:1px 7px;align-self:flex-start">✕</button></div>'
        + '<div style="height:4px;border-radius:2px;background:#1a2535;margin-top:6px"><i style="display:block;height:100%;width:'+pct+'%;background:#5b93e8;border-radius:2px"></i></div>';
    }
    if(h === lastHtml) return;
    lastHtml = h;
    panel.innerHTML = h;
    const close = document.getElementById('objClose');
    if(close) close.onclick = () => setPanelVisibility('panelObjectives', false);
  }

  // état reçu de l'hôte / partie chargée : on repart de l'avancement reçu sans rien annoncer
  function resync(){ lastIdx = null; }
  return { render, resync };
})();
