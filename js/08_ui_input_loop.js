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
  const countMode = m => vehicles.filter(v => vehicleMode(v) === m && isMyVehicle(v)).length;
  $('hVehicles').textContent = countMode('road');
  $('hTrains').textContent = countMode('rail');
  $('hShips').textContent = countMode('water');
  $('hPlanes').textContent = countMode('air');
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
    gdEl.textContent = `📅 ${day}/${mon}/${yr} 🕐 ${hr}:${min}`;
  }
  syncLuxeToolbar();
  renderInfo();
  renderPopPanel();
  renderFinance();
  renderVehicleListPanel();
  renderEventsPanel();
  if(typeof ObjectivesPanel !== 'undefined') ObjectivesPanel.render();
  if(trainConfigVehicle) renderTrainPanel();
}

// Panneau « Entrepôt fusionné » commun aux gares, ports et aéroports.
function fusedDepotHtml(linkedDepot){
  let h = '';
  const isOwner = !linkedDepot.owner || linkedDepot.owner === (MP.myId ?? null);
  const depotRadius = depotRadiusOf(linkedDepot);
  h += '<div style="margin-top:10px;color:#8fa3bf;font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">📦 Entrepôt fusionné</div>';
  h += '<div style="color:#8fa3bf;font-size:10px;margin-bottom:6px">Rayon d\'action : <b style="color:#ffd700">'+depotRadius+' cases</b></div>';
  if(isOwner){
    h += depotResPanel(linkedDepot, 'station');
  } else {
    // Gare d'un autre joueur : contenu ressource visible en lecture seule
    // (les trains peuvent s'y arrêter pour le commerce inter-joueurs).
    const _hubOwner = linkedDepot.owner ?? null;
    h += '<div style="color:#8fa3bf;font-size:11px;margin-bottom:6px">Propriétaire : <b style="color:'+playerColor(_hubOwner)+'">'+escHtml(playerName(_hubOwner))+'</b> · commerce au tarif <b style="color:#f0c060">marchand</b></div>';
    h += depotResPanel(linkedDepot, 'readonly');
  }
      return h;
}

// ---------- grille compacte des ressources d'un entrepôt ----------
// Une tuile carrée par ressource (icône, quantité, jauge de remplissage en fond,
// bordure selon l'état), une ligne par famille avec sa pastille à gauche (clic :
// toute la famille d'un coup) et un filtre « Toutes / Actives » mémorisé.
// Modes : 'allow' (entrepôt : accepter / refuser), 'station' (entrepôt lié à une
// gare ou un port : refusée → acceptée → + chargée par les trains), 'readonly'
// (entrepôt d'un autre joueur) et 'sell' (vente au marché).
let depotResView = (()=>{ try { return localStorage.getItem('factopolis_depot_view') === 'active' ? 'active' : 'all'; } catch(e){ return 'all'; } })();
let marketTab = 'stock';
function setDepotResView(v){
  depotResView = v === 'active' ? 'active' : 'all';
  try { localStorage.setItem('factopolis_depot_view', depotResView); } catch(e){}
  const p = $('info');
  if(p){ p._html = null; renderInfo(); }
}
// 0 refusée, 1 acceptée, 2 acceptée + chargée par les trains (withTrain)
function depotResState(depot, k, withTrain){
  if(depot.allow?.[k] === false) return 0;
  return withTrain && depot.trainAllow?.[k] !== false ? 2 : 1;
}
const compactQty = n => n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (Math.round(n / 100) / 10) + 'k' : String(Math.floor(n));

// Origine et usages d'une ressource (infobulles) : quelle usine la fabrique et avec
// quoi, qui la consomme, quels chantiers l'exigent. Catalogue statique : calculé
// une fois par ressource (les dépôts de 05_depots sont déjà enregistrés).
const _resInfoCache = {};
const RES_SOURCE_HINTS = { lumber:'près des arbres', farm:'près d’un champ de blé', cotton_farm:'près d’un champ de coton',
  fisher:'au bord de l’eau', pump:'au bord de l’eau', oil_well:'sur une nappe de pétrole' };
function resProductionInfo(k){
  if(_resInfoCache[k]) return _resInfoCache[k];
  const label = t => BUILD[t].ic + ' ' + BUILD[t].n;
  const make = [];
  const resLbl = r => RES[r].ic + ' ' + RES[r].n.toLowerCase();
  if(Object.values(DEPOSIT_ORES).includes(k)) make.push('⛏️ Mine posée sur un gisement (' + resLbl(k) + ')');
  for(const t in BUILD){
    const r = BUILD[t].recipe;
    if(!r || !(k in (r.out || {}))) continue;
    const how = Object.keys(r.in || {}).length ? recipeText(r, 'full')
      : 'extraction ' + (RES_SOURCE_HINTS[t] ? RES_SOURCE_HINTS[t] + ' ' : '') + '→ ' + recipeText({ out:r.out }, 'full');
    make.push(label(t) + (PLANT_UPGRADES[t] ? ' (usine abandonnée à spécialiser)' : '') + ' : ' + how);
  }
  if(k in SPACE_CARGO) make.push('🚀 Centre spatial : rapporté par la capsule (' + SPACE_CARGO[k] + ' ' + resLbl(k) + ' par mission, fusée : ' + resAmountsIcons(SPACE_ROCKET_PARTS) + ')');
  if(k === 'dirt') make.push('⛏️ Mine : sous-produit occasionnel');
  const users = [];
  for(const t in BUILD) if(BUILD[t].recipe?.in && k in BUILD[t].recipe.in) users.push(label(t));
  if(k in SPACE_ROCKET_PARTS) users.push('🚀 Centre spatial (fusée)');
  // logements : « tous » plutôt que la liste complète des niveaux
  // (indispensable : sans précision ; sinon « bonus » et/ou « pour fusionner / s'agrandir »)
  const homeGroup = (levels, allTxt, lux) => {
    const why = L => {
      const rc = BUILD[L.key]?.resid;
      if(!rc) return null;
      if(rc.required.includes(k)) return '';
      const parts = [];
      if(rc.bonus.includes(k)) parts.push('bonus');
      if(rc.upgradeTargets[k]) parts.push(lux ? 'pour s’agrandir' : 'pour fusionner');
      return parts.length ? ' (' + parts.join(', ') + ')' : null;
    };
    const hit = levels.filter(L => why(L) != null);
    if(!hit.length) return null;
    if(hit.length === levels.length && hit.every(L => why(L) === '')) return allTxt;
    return hit.map(L => L.ic + ' ' + L.n + why(L)).join(', ');
  };
  const homes = [homeGroup(LEVELS, '🏠 tous les logements', false), homeGroup(LUX_LEVELS, '💎 toutes les maisons de luxe', true)].filter(Boolean);
  const sites = Object.keys(BUILD_MATERIALS).filter(t => BUILD_MATERIALS[t][k] && BUILD[t]).map(t => BUILD[t].ic + ' ' + BUILD[t].n + ' ×' + BUILD_MATERIALS[t][k]);
  const lines = ['Fabrication :' + (make.length ? '\n  • ' + make.join('\n  • ') : ' —')];
  if(users.length) lines.push('Utilisé par : ' + users.join(', '));
  if(homes.length) lines.push('Logements : ' + homes.join(' ; '));
  if(sites.length) lines.push('🏗️ Chantiers : ' + sites.join(', '));
  return (_resInfoCache[k] = lines.join('\n'));
}
function depotResPanel(depot, mode){
  const ro = mode === 'readonly';
  const stateOf = k => mode === 'sell' ? (depot.sellTo?.[k] ? 1 : 0) : ro ? 1 : depotResState(depot, k, mode === 'station');
  const stock = k => Math.floor(depot.storage[k] || 0);
  const active = k => stateOf(k) > 0 && !ro || stock(k) > 0;
  const cats = resKeysByCategory(k => k !== 'water');
  const all = cats.reduce((n, c) => n + c.keys.length, 0);
  const nActive = cats.reduce((n, c) => n + c.keys.filter(active).length, 0);
  const view = ro ? 'active' : depotResView;
  const legend = mode === 'station' ? '<span style="color:#5b93e8">■</span> acceptée · <span style="color:#4db86a">■</span> + trains'
    : mode === 'sell' ? 'clic : mettre en vente' : ro ? 'tarif marchand au survol' : 'clic : accepter / refuser';
  let h = '<div class="rbar">';
  if(!ro){
    h += '<span class="rchip'+(view === 'all' ? ' on' : '')+'" data-res-view="all">Toutes '+all+'</span>'
       + '<span class="rchip'+(view === 'active' ? ' on' : '')+'" data-res-view="active">'+(mode === 'sell' ? 'En vente / stock ' : 'Actives ')+nActive+'</span>';
  }
  h += '<span class="rlegend">'+legend+'</span></div><div class="rgrid">';
  let shown = 0;
  for(const cat of cats){
    const keys = view === 'active' ? cat.keys.filter(active) : cat.keys;
    if(!keys.length) continue;
    shown += keys.length;
    const on = cat.keys.filter(k => stateOf(k) > 0).length;
    const tip = cat.n + (ro ? '' : ' — ' + on + '/' + cat.keys.length + (mode === 'sell' ? ' en vente' : ' acceptées')
      + ' · clic : ' + (mode === 'station' ? 'faire passer toute la famille à l’état suivant' : on === cat.keys.length ? 'tout retirer' : 'tout ' + (mode === 'sell' ? 'vendre' : 'accepter')));
    h += '<div class="rfam"><div class="rfam-h'+(ro ? ' ro' : '')+'" title="'+escHtml(tip)+'"'
       + (ro ? '' : ' data-res-bulk="'+cat.key+'" data-bulk-mode="'+mode+'"') + '>'+cat.ic+(ro ? '' : '<small>'+on+'/'+cat.keys.length+'</small>')+'</div><div class="rtiles">';
    for(const k of keys){
      const st = stateOf(k), val = stock(k), cap = capOf(depot, k);
      const pct = cap > 0 ? Math.min(100, Math.round(100 * val / cap)) : 0;
      const cls = ro ? ' ro' : mode === 'sell' ? (st ? ' sell' : ' off') : st === 2 ? ' train' : st === 1 ? ' on' : ' off';
      const attr = mode === 'allow' ? ' data-toggle-res="'+k+'"' : mode === 'station' ? ' data-station-depot-toggle-res="'+k+'"' : mode === 'sell' ? ' data-sell="'+k+'"' : '';
      const stateTxt = mode === 'sell' ? (st ? 'en vente' : 'pas en vente') : ro ? (TRADE_PRICES[k] || 0) + ' $/u'
        : ['refusée', 'acceptée', 'acceptée · chargée par les trains'][st];
      const title = RES[k].ic + ' ' + RES[k].n + ' — ' + val + '/' + cap + ' · ' + stateTxt + (mode === 'sell' ? ' · ' + (TRADE_PRICES[k] || 0) + ' $/u' : '')
        + '\n\n' + resProductionInfo(k);
      // quantité (ou prix de vente) en pastille dans le coin, nom court sous l'icône
      const badge = mode === 'sell' ? (TRADE_PRICES[k] || 0) + '$' : val > 0 ? compactQty(val) : '';
      h += '<div class="rtile'+cls+(mode === 'sell' ? ' rs sell-toggle' : '')+'"'+attr+' title="'+escHtml(title)+'">'
         + '<i class="rf" style="height:'+pct+'%;background:'+RES[k].c+'"></i>'
         + '<span class="ri">'+RES[k].ic+'</span>'
         + '<span class="rn">'+escHtml(RES[k].s)+'</span>'
         + (badge ? '<span class="rq">'+badge+'</span>' : '')
         + '</div>';
    }
    h += '</div></div>';
  }
  if(!shown) h += '<div class="rempty">'+(ro ? 'Entrepôt vide.' : 'Aucune ressource active : passe en vue « Toutes » pour en accepter.')+'</div>';
  return h + '</div>';
}

// Habitants d'une maison : « Habitants » (total) et « Présents à la maison », chacun avec
// un détail par joueur au clic (une ligne par joueur ayant des habitants, jamais à 0).
// Les habitants d'une maison appartiennent tous à son propriétaire.
const homeDetailOpen = { pop:false, present:false };
function toggleHomeDetail(kind){ homeDetailOpen[kind] = !homeDetailOpen[kind]; if(typeof renderInfo === 'function') renderInfo(); }
// Lignes du détail « Habitants » : habitants du propriétaire, puis locataires Airbnb par joueur
// d'origine ; un joueur à 0 n'est jamais listé.
function homePopRows(home, pop, ownerName){
  const byOwner = new Map();
  for(const g of (home.guests || []).slice(0, pop)){
    const o = typeof g === 'number' ? null : (g.o ?? null);
    byOwner.set(o, (byOwner.get(o) || 0) + 1);
  }
  let airbnb = 0;
  for(const n of byOwner.values()) airbnb += n;
  const rows = [];
  if(pop - airbnb > 0) rows.push(ownerName+' : <b>'+(pop - airbnb)+'</b>');
  for(const [o, n] of byOwner)
    rows.push(escHtml(o == null ? 'Visiteurs' : playerName(o))+' : <b>'+n+'</b> 🏨 Airbnb');
  return rows;
}
// Réglage « Airbnb uniquement » : plus aucun habitant du propriétaire ne rejoint la maison
// (les habitants déjà présents restent) ; seuls les voyageurs d'autres joueurs peuvent s'y installer.
function toggleAirbnbOnly(x, y){
  const b = bgrid[y*N+x];
  if(!b || b.dead || !BUILD[b.type]?.resid || b.starterHome) return;
  if(MP.connected && b.owner && b.owner !== MP.myId){ toast('⛔ Bâtiment d\'un autre joueur','err'); return; }
  const on = !b.airbnbOnly;
  if(!MP.connected || MP.role !== 'guest') setAirbnbOnly(b, on); // un invité attend l'état de l'hôte
  else b.airbnbOnly = on ? true : undefined;
  if(MP.connected) netSend({ type:'toggle_airbnb_only', x:b.x, y:b.y, on:!!b.airbnbOnly });
  const p = $('info'); if(p) p._html = null;
  if(typeof renderInfo === 'function') renderInfo();
}
// Rayon d'attractivité d'un lieu de loisirs : +/− en cases (bornes de la config).
function adjustLeisureRadius(x, y, delta){
  const b = bgrid[y*N+x];
  if(!isLeisure(b) || b.dead) return;
  if(MP.connected && b.owner && b.owner !== MP.myId){ toast('⛔ Bâtiment d\'un autre joueur','err'); return; }
  setLeisureRadius(b, leisureRadiusOf(b) + delta);
  if(MP.connected) netSend({ type:'set_leisure_radius', x:b.x, y:b.y, r:leisureRadiusOf(b) });
  const p = $('info'); if(p) p._html = null;
  if(typeof renderInfo === 'function') renderInfo();
}
// Détail des voyageurs par joueur (panneau d'un bus ou d'un lieu de loisirs) : déplié par défaut,
// replié par un clic sur la ligne « Voyageurs » / « Visiteurs ».
const voyageursClosed = new Set();
// Délégation sur pointerdown : le panneau est reconstruit en continu, un clic (down + up) pouvait se perdre.
$('info').addEventListener('pointerdown', e => {
  const row = e.target.closest && e.target.closest('[data-voy-toggle]');
  if(!row) return;
  e.preventDefault();
  toggleVoyageurs(row.dataset.voyToggle);
});
function toggleVoyageurs(key){
  if(!voyageursClosed.delete(key)) voyageursClosed.add(key);
  const p = $('info'); if(p) p._html = null;
  if(typeof renderInfo === 'function') renderInfo();
}
// Lignes « ● joueur : n voyageurs » ; lines = [{ owner, n }].
function voyageursLinesHtml(lines, unit){
  return lines.map(l => '<div class="row" style="padding-left:14px"><span><span style="color:'+playerColor(l.owner)+'">●</span> '
    + escHtml(l.owner == null ? 'Voyageurs' : playerName(l.owner))+'</span><b>'+l.n+' '+unit+(l.n > 1 ? 's' : '')+'</b></div>').join('');
}
// Visiteurs d'un lieu de loisirs regroupés par joueur d'origine.
function leisureVisitorLines(b){
  const m = new Map();
  for(const g of (b.visitors || [])) m.set(g.o ?? null, (m.get(g.o ?? null) || 0) + g.n);
  return [...m].filter(([, n]) => n >= 1).map(([owner, n]) => ({ owner, n })).sort((a, c) => c.n - a.n);
}
function homeOccupancyHtml(home){
  const key = home.x + ',' + home.y;
  const pop = Math.floor(home.pop || 0);
  let working = 0, walking = 0;
  for(const j of buildings){
    const n = j.homeCommuters?.[key];
    if(n > 0 && !j.dead) working += n;
  }
  for(const wk of walkers) if(wk.cj && wk.cj.field === 'home' && wk.cj.key === key) walking += wk.cj.n;
  working = Math.min(pop, Math.floor(working));
  walking = Math.min(pop - working, Math.floor(walking));
  const present = Math.max(0, pop - working - walking);
  const box = rows => rows.length ? '<div style="margin:2px 0 6px;padding:4px 6px;background:#101826;border-radius:6px;font-size:12px;color:#b8d4f0">'+rows.map(r => '<div>'+r+'</div>').join('')+'</div>' : '';
  const name = escHtml(playerName(home.owner));
  let h = '';
  h += '<div class="row" style="cursor:pointer" onclick="toggleHomeDetail(\'pop\')" title="Cliquer : détail par joueur"><span>Habitants</span><b>'+pop+' / '+(BUILD[home.type]?.resid?.popCap ?? pop)+'</b></div>'
    + (homeDetailOpen.pop && pop > 0 ? box(homePopRows(home, pop, name)) : '');
  h += '<div class="row" style="cursor:pointer" onclick="toggleHomeDetail(\'present\')" title="Cliquer : détail par joueur"><span>Présents à la maison</span><b>🏠 '+present+' / '+pop+'</b></div>';
  if(homeDetailOpen.present && pop > 0)
    h += box([name+' : <b>'+present+'</b> présents · <b>'+working+'</b> au travail · <b>'+walking+'</b> passagers']);
  if(!home.starterHome)
    h += '<div class="row" style="cursor:pointer" onclick="toggleAirbnbOnly('+home.x+','+home.y+')" title="Les habitants de ton joueur ne rejoindront plus cette maison ; seuls des voyageurs des autres joueurs pourront y loger">'
      + '<span>🏨 Airbnb uniquement</span><b style="color:'+(home.airbnbOnly ? '#7dffb0' : '#8aa0b8')+'">'+(home.airbnbOnly ? 'OUI' : 'non')+'</b></div>';
  return h;
}

// Clic sur le compteur d'habitants : répartition au travail / en passager / à la maison.
function popBreakdown(){
  const town = ensureSelectedTown();
  const pop = town ? townPopTotal(town.id) : popTotal();
  const jobs = town ? townReachableJobs(town.id) : jobsTotal();
  const working = Math.min(pop, town ? townAllocatedWorkers(town.id) : Math.min(popTotal(), jobs));
  let riding = 0, onboard = 0, leisure = 0;
  for(const r of transitByOwner(town ? town.id : null).values()){ riding += r.passengers; onboard += r.onboard; leisure += r.visiting; }
  riding = Math.min(Math.round(riding), Math.max(0, pop - working));
  onboard = Math.min(Math.round(onboard), riding);
  leisure = Math.min(Math.round(leisure), riding - onboard);
  // Airbnb : voyageurs installés pour une semaine chez un autre joueur (comptés dans la pop de la maison)
  let airbnb = 0;
  for(const b of buildings){
    if(b.dead || !b.guests || (town && b.townId !== town.id)) continue;
    airbnb += Math.min(b.guests.length, b.pop || 0);
  }
  airbnb = Math.min(airbnb, Math.max(0, pop - working - riding));
  return { pop, working, riding, onboard, leisure, waiting: riding - onboard - leisure, airbnb, home: Math.max(0, pop - working - riding - airbnb) };
}
// Répartition des passagers par joueur (propriétaire des arrêts/gares/véhicules).
let passengerOwnersOpen = false;
function togglePassengerOwners(){ passengerOwnersOpen = !passengerOwnersOpen; renderPopPanel(); if(typeof renderInfo === 'function') renderInfo(); }
// Détail d'une gare / d'un arrêt : un bloc sous « entrants » et un sous « sortants »,
// par joueur (les passagers sont comptés par bâtiment : joueur = propriétaire).
let workersDetailOpen = false;
function toggleWorkersDetail(){ workersDetailOpen = !workersDetailOpen; if(typeof renderInfo === 'function') renderInfo(); }
// Catégories dépliées dans le panneau de l'usine abandonnée (clés de PLANT_UPGRADE_CATEGORIES) ; repliées par défaut
// Recette compacte : entrées en icônes, produits avec leur nom à droite de l'icône
function plantRecipeLine(rec){
  const side = (m, named) => Object.keys(m || {}).filter(r => RES[r])
    .map(r => m[r] + ' ' + RES[r].ic + (named ? ' ' + RES[r].n : '')).join(' + ');
  const lhs = side(rec?.in, false);
  return (lhs ? lhs + ' → ' : '') + side(rec?.out, true);
}
const plantCatExpanded = new Set();
function togglePlantCat(key){ if(plantCatExpanded.has(key)) plantCatExpanded.delete(key); else plantCatExpanded.add(key); if(typeof renderInfo === 'function') renderInfo(); }
const passengerDetailOpen = { in:false, out:false };
function togglePassengerDetail(kind){ passengerDetailOpen[kind] = !passengerDetailOpen[kind]; if(typeof renderInfo === 'function') renderInfo(); }
function passengerDetailBlock(kind, b, inKey = 'passengersEntrant'){
  if(!passengerDetailOpen[kind]) return '';
  const n = Math.floor(kind === 'in' ? (b[inKey] || 0) : (b.passagersSortant || 0));
  if(n <= 0) return '';
  return '<div style="margin:2px 0 6px;padding:4px 6px;background:#101826;border-radius:6px;font-size:12px;color:#b8d4f0">'
    + '<div>'+escHtml(playerName(b.owner))+' : <b>'+n+'</b></div></div>';
}
function passengerOwnersHtml(){
  let h = '';
  const town = ensureSelectedTown();
  for(const r of transitByOwner(town ? town.id : null).values()){
    if(r.passengers < 0.5) continue;
    h += '<div style="padding-left:14px;font-size:12px;color:#b8d4f0">• '+escHtml(playerName(r.owner))+' : <b>'+Math.round(r.passengers)+'</b>'
      + ' <span style="opacity:.75">(attente '+Math.round(r.waiting)+' · arrivés '+Math.round(r.sortants)+' · à bord '+Math.round(r.onboard)+')</span>'
      + ' <span style="opacity:.75">/ '+Math.round(r.allowed)+' sans travail</span></div>';
  }
  return h || '<div style="padding-left:14px;font-size:12px;opacity:.7">Aucun passager</div>';
}
// Clic sur un compteur de passagers (gare, arrêt) : répartition par joueur.
function showPassengerOwnersToast(){
  const rows = [...transitByOwner().values()].filter(r => r.pop > 0 || r.passengers >= 0.5)
    .map(r => escHtml(playerName(r.owner))+' : '+Math.round(r.passengers)+' passagers / '+Math.round(r.allowed)+' habitants sans travail');
  toast('🚌 Passagers par joueur — '+(rows.join(' · ') || 'aucun'), 'info');
}

// Panneau déroulant sous le compteur d'habitants ; un nouveau clic le replie.
let popPanelOpen = false;
function togglePopPanel(){
  popPanelOpen = !popPanelOpen;
  renderPopPanel();
}
function renderPopPanel(){
  const el = $('popPanel'), anchor = $('sPop');
  if(!el || !anchor) return;
  if(!popPanelOpen){ el.style.display = 'none'; return; }
  const p = popBreakdown();
  el.innerHTML = '<div>🏭 Au travail : <b>'+p.working+'</b></div>'
    + '<div>🚌 Voyageurs : <b>'+p.riding+'</b> <span style="opacity:.75">(attente '+p.waiting+' · à bord '+p.onboard+(p.leisure ? ' · en sortie '+p.leisure : '')+')</span></div>'
    + '<div>🏨 Airbnb (chez un autre joueur) : <b>'+p.airbnb+'</b></div>'
    + '<div>🏠 À la maison : <b>'+p.home+'</b></div>'
    + '<div style="border-top:1px solid #36465e;margin-top:3px;padding-top:3px">👥 Total : <b>'+p.pop+'</b></div>';
  el.style.display = 'block';
  const r = anchor.getBoundingClientRect();
  el.style.left = Math.max(6, Math.min(r.left, innerWidth - el.offsetWidth - 6)) + 'px';
  el.style.top = (r.bottom + 14) + 'px';
}

// ---------- panneau finances ----------
let financeVentesExpanded = false;
let financeVehiculesExpanded = false;
function toggleFinance(){
  const p = $('finance');
  p.style.display = p.style.display==='block' ? 'none' : 'block';
  renderFinance();
}
function renderFinance(){
  const p = $('finance');
  if(p.style.display !== 'block') return;
  const wt = myWallet();
  const fin = wt.fin;
  const ventesDetail = wt.ventesDetail || { res:{}, veh:{} };
  const peageDetail  = wt.peageDetail  || { recv:{}, paid:{} };

  // Découpage par mois de jeu : instantanés de cumul pris au début de chaque mois.
  // On affiche les 3 mois précédents complets + le mois en cours (cumul live).
  const snaps = wt.finMonthSnaps || [];
  const months = []; // bornes terminées = toutes sauf la dernière (= début du mois en cours)
  for(let i = Math.max(0, snaps.length - 1 - 3); i < snaps.length - 1; i++)
    months.push({ ym: snaps[i].ym, start: snaps[i], end: snaps[i+1] });
  // Mois en cours : commence à la dernière borne, se termine « maintenant » (cumul live).
  const curStart = snaps[snaps.length-1] || { fin:{}, vres:{}, vveh:{}, precv:{}, ppaid:{} };
  months.push({ ym: curStart.ym || null, start: curStart, end: null });

  const fmt = n => Math.round(Math.abs(n)).toLocaleString('fr-FR');
  const sgn = n => n>=0 ? '+' : '−';
  const monthLabel = ym => {
    if(!ym) return '—';
    const [y,mo] = ym.split('-').map(Number);
    return new Date(Date.UTC(y, mo-1, 1)).toLocaleDateString('fr-FR',{ month:'short' });
  };
  const valCell = (v,sign)=> '<td class="r">'+(Math.round(v)===0 ? '—'
    : (sign==='auto'?sgn(v):sign)+fmt(v)+' $')+'</td>';
  // acc(snap) lit une valeur cumulée dans un instantané ; live = valeur cumulée actuelle.
  // Le mois en cours (end===null) utilise le cumul live au lieu d'un instantané de fin.
  const monthDeltas = (acc, live)=> months.map(m => (m.end ? acc(m.end) : live) - acc(m.start));
  const cells = (deltas, sign)=> deltas.map(v => valCell(v, sign)).join('');

  const catAcc = c => (s => s?.fin?.[c]||0);
  const finDeltas = c => monthDeltas(catAcc(c), fin[c]||0);
  const row = (lbl,c,sign,cls)=>
    '<tr class="'+cls+'"><td>'+lbl+'</td>' + cells(finDeltas(c), sign) + '</tr>';

  // Sous-lignes détail par clé d'un bucket (ressources vendues / types de véhicule).
  const bucketSubRows = (liveBucket, field, labelFn, cls)=>{
    const keys = new Set(Object.keys(liveBucket||{}));
    for(const m of months){ for(const k in (m.start?.[field]||{})) keys.add(k);
                            for(const k in (m.end?.[field]||{})) keys.add(k); }
    const rows = [];
    for(const k of keys){
      const deltas = monthDeltas(s=>s?.[field]?.[k]||0, liveBucket?.[k]||0);
      if(!deltas.some(v=>v!==0)) continue;
      rows.push({ total: deltas.reduce((a,b)=>a+b,0),
        html:'<tr class="'+cls+' sub"><td>↳ '+labelFn(k)+'</td>'+cells(deltas,'+')+'</tr>' });
    }
    return rows.sort((a,b)=>b.total-a.total).map(r=>r.html).join('');
  };
  // Sous-lignes péages par joueur.
  const playerSubRows = (liveBucket, field, prep, cls)=>{
    const keys = new Set(Object.keys(liveBucket||{}));
    for(const m of months){ for(const id in (m.start?.[field]||{})) keys.add(id);
                            for(const id in (m.end?.[field]||{})) keys.add(id); }
    let h='';
    for(const id of keys){
      const deltas = monthDeltas(s=>s?.[field]?.[id]||0, liveBucket?.[id]||0);
      if(!deltas.some(v=>v!==0)) continue;
      h += '<tr class="'+cls+' sub"><td>↳ '+prep+' '+playerName(+id)+'</td>'+cells(deltas,'+')+'</tr>';
    }
    return h;
  };

  const VEH_LABELS = { bus:'🚌 Bus', train:'🚃 Train', camion:'🚛 Camion', cargo_ship:'🚢 Cargo', ferry:'⛴️ Ferry', plane:'✈️ Avion', cargo_plane:'🛩️ Avion cargo' };
  const resLabel = k => (RES[k]?.ic ? RES[k].ic+' ' : '') + (RES[k]?.n || k);
  const expandRow = (toggleId, expanded, label, cat, subRows)=>{
    const arrow = expanded ? '▾' : '▸';
    let h = '<tr class="in"><td><span id="'+toggleId+'" style="cursor:pointer">'+arrow+' '+label+'</span></td>'
      + cells(finDeltas(cat), '+') + '</tr>';
    if(expanded) h += subRows();
    return h;
  };

  const hasRow = c => finDeltas(c).some(v=>v!==0);
  const hasRecu = hasRow('peageRecu');
  const hasPaye = hasRow('peagePaye');
  const hasVeh  = hasRow('vehicules') || financeVehiculesExpanded;
  const hasExp  = hasRow('expansion');

  const incCats = ['ventes','vehicules','taxes','rembours','primes','peageRecu','airbnb','loisirs'];
  const outCats = ['construction','entretien','entretienVehicules','peagePaye','expansion'];
  const netVal = read => incCats.reduce((a,c)=>a+read(c),0) - outCats.reduce((a,c)=>a+read(c),0);
  const netDeltas = months.map(m => netVal(c => (m.end ? (m.end.fin?.[c]||0) : (fin[c]||0)) - (m.start.fin?.[c]||0)));
  const hdrCells = months.map(m=>'<td class="r">'+monthLabel(m.ym)+'</td>').join('');

  p.innerHTML =
    '<div class="panel-head"><h3>💰 Finances</h3><button class="tbtn" id="bFinX" aria-label="Fermer">✕</button></div>'
    + '<table>'
    + '<tr class="hdr"><td></td>'+hdrCells+'</tr>'
    + expandRow('venteToggle', financeVentesExpanded, 'Ventes', 'ventes',
        ()=> bucketSubRows(ventesDetail.res, 'vres', resLabel, 'in'))
    + (hasVeh ? expandRow('vehToggle', financeVehiculesExpanded, 'Véhicules', 'vehicules',
        ()=> bucketSubRows(ventesDetail.veh, 'vveh', k=>VEH_LABELS[k]||k, 'in')) : '')
    + row('Taxes des habitants','taxes','+','in')
    + row('Remboursements','rembours','+','in')
    + (hasRow('airbnb') ? row('Airbnb (voyageurs hébergés)','airbnb','+','in') : '')
    + (hasRow('loisirs') ? row('Loisirs (entrées des visiteurs)','loisirs','+','in') : '')
    + (hasRow('primes') ? row('Primes d’objectifs','primes','+','in') : '')
    + (hasRecu ? row('Péages rails reçus','peageRecu','+','in') + playerSubRows(peageDetail.recv,'precv','de','in') : '')
    + row('Construction','construction','−','out')
    + row('Entretien industriel','entretien','−','out')
    + row('Entretien véhicules','entretienVehicules','−','out')
    + (hasPaye ? row('Péages rails payés','peagePaye','−','out') + playerSubRows(peageDetail.paid,'ppaid','à','out') : '')
    + (hasExp ? row('Expansions carte','expansion','−','out') : '')
    + '<tr class="net"><td>Bilan</td>'+cells(netDeltas,'auto')+'</tr>'
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
makePanelDraggable('vehicleListPanel');
makePanelDraggable('eventsPanel');

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
  // Brouillon non enregistré abandonné : l'hôte redevient autoritatif au prochain sync.
  if(trainConfigVehicle) trainConfigVehicle.ordersDraft = false;
  trainConfigVehicle = null;
  trainConfigSelectedWagonIndex = -1;
  trainConfigLocoSelected = false;
}

// ---------- panneau liste véhicules / trains ----------
function openVehicleListPanel(mode){
  vehicleListMode = ['train', 'water', 'air'].includes(mode) ? mode : 'road';
  const p = $('vehicleListPanel');
  if(!p) return;
  p.style.display = 'block';
  p._html = null; // forcer le re-rendu
  renderVehicleListPanel();
}
function closeVehicleListPanel(){
  const p = $('vehicleListPanel');
  if(p){ p.style.display = 'none'; p._html = null; }
  vehicleListMode = null;
  focusVehicle = null;
  camTracking = false;
}

const GAME_EVENT_MAX = 200;

function eventTargetForBuilding(b){
  if(!b || b.dead) return null;
  const ref = typeof trainStationSelectionRepresentative === 'function'
    ? trainStationSelectionRepresentative(b) || b
    : b;
  const center = centerOfBuilding(ref);
  return {
    kind: 'building',
    label: ref.name || BUILD[ref.type]?.n || ref.type || 'Bâtiment',
    x: ref.x,
    y: ref.y,
    mapX: center.x,
    mapY: center.y,
    stationGroupId: (typeof isTrainStationPiece === 'function' && isTrainStationPiece(ref)) ? ref.stationGroupId : null,
  };
}

function eventTargetForVehicle(v){
  if(!v) return null;
  const pos = typeof vehicleWorldPos === 'function' ? vehicleWorldPos(v) : null;
  const vt = VEHICLE_TYPES[v.vtype] || {};
  return {
    kind: 'vehicle',
    label: v.vtype === 'train' ? (v.name || 'Train') : (vt.nom || v.vtype || 'Véhicule'),
    id: String(v.id),
    mapX: pos ? pos.x / TILE : ((v.garageRef?.x ?? 0) + ((v.garageRef?.w || 1) / 2) - 0.5),
    mapY: pos ? pos.y / TILE : ((v.garageRef?.y ?? 0) + ((v.garageRef?.h || 1) / 2) - 0.5),
  };
}

function eventTargetForTown(t){
  if(!t) return null;
  return {
    kind: 'town',
    label: t.name || 'Village',
    id: t.id,
    mapX: t.cx,
    mapY: t.cy,
  };
}

function eventTargetForTile(x, y, label){
  return {
    kind: 'tile',
    label: label || 'Carte',
    mapX: x + 0.5,
    mapY: y + 0.5,
  };
}

function escUiHtml(s){
  if(typeof escHtml === 'function') return escHtml(s);
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pushGameEvent(msg, target, cls){
  if(!target || !Array.isArray(gameEvents)) return;
  gameEvents.unshift({
    id: nextGameEventId++,
    gtime: gtime || 0,
    text: String(msg || ''),
    cls: cls || '',
    target,
  });
  if(gameEvents.length > GAME_EVENT_MAX) gameEvents.length = GAME_EVENT_MAX;
  if(UI_OPTIONS.panelEvents) renderEventsPanel();
}

// ---------- la Gazette ----------
// Les grands moments (premier train en gare, premier navire, premier vol,
// paliers de population, premier gratte-ciel…) font la une, une seule fois par
// partie. Seule la simulation autoritative (hôte) publie ; les invités
// reçoivent les nouvelles via le flux monde (state.news) et les affichent.
const NEWS_LOG_MAX = 12;
function publishNews(key, icon, title, text, target){
  if(!key || newsFlags[key]) return false;
  if(typeof MP !== 'undefined' && MP.connected && MP.role === 'guest') return false;
  newsFlags[key] = 1;
  const n = { id: nextNewsId++, gtime: gtime || 0, icon: icon || '📰', title: String(title || ''), text: String(text || ''), target: target || null };
  newsLog.push(n);
  if(newsLog.length > NEWS_LOG_MAX) newsLog.shift();
  showNewsCard(n);
  return true;
}
// Invité / chargement : affiche les nouvelles pas encore vues.
function receiveNews(list, silent){
  if(!Array.isArray(list)) return;
  for(const n of list){
    if(!n || !(n.id > newsSeenId)) continue;
    if(!silent) showNewsCard(n); else newsSeenId = n.id;
  }
}
const _newsQueue = [];
let _newsShowing = null, _newsTimer = null;
function showNewsCard(n){
  newsSeenId = Math.max(newsSeenId, n.id || 0);
  if(n.target) pushGameEvent(n.icon + ' ' + n.title, n.target, 'win');
  _newsQueue.push(n);
  if(_newsQueue.length > 3) _newsQueue.splice(0, _newsQueue.length - 3);
  if(!_newsShowing) nextNewsCard();
}
function nextNewsCard(){
  let el = $('newsCard');
  const n = _newsQueue.shift();
  _newsShowing = n || null;
  if(!n){ if(el) el.style.display = 'none'; return; }
  if(!el){
    el = document.createElement('div');
    el.id = 'newsCard';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  const town = n.target?.label ? escUiHtml(n.target.label) : '';
  el.innerHTML = '<div class="nw-mast"><b>📰 La Gazette de Factopolis</b><span>' + escUiHtml(formatGameDate(n.gtime)) + '</span></div>'
    + '<div class="nw-head">' + escUiHtml(n.icon + ' ' + n.title) + '</div>'
    + '<div class="nw-text">' + escUiHtml(n.text) + '</div>'
    + '<div class="nw-btns">' + (n.target ? '<button data-nw="go">📍 Voir' + (town ? ' — ' + town : '') + '</button>' : '')
    + '<button data-nw="close">Fermer</button></div>';
  el.style.display = 'block';
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  const done = () => { clearTimeout(_newsTimer); nextNewsCard(); };
  el.querySelector('[data-nw="close"]').onclick = done;
  const go = el.querySelector('[data-nw="go"]');
  if(go) go.onclick = () => { focusGameEventTarget(n.target); done(); };
  clearTimeout(_newsTimer);
  _newsTimer = setTimeout(done, 9000);
  if(typeof playSound === 'function') try { playSound('news'); } catch(e){}
}
// Nom de ville le plus proche d'un bâtiment (pour les titres).
function newsTownName(b){
  if(!b) return '';
  const own = towns.find(t => t.id === b.townId);
  if(own) return own.name;
  let best = null, bd = Infinity;
  for(const t of towns){ const d = Math.hypot(t.cx - b.x, t.cy - b.y); if(d < bd){ bd = d; best = t; } }
  return best && bd < 30 ? best.name : '';
}
// « la gare de X » à partir du nom du lieu : nom déjà préfixé (« Gare de X »)
// ou nom libre (« la gare « Centrale » »), à défaut la ville proche.
function newsPlaceLabel(b, kind, art){
  const name = (b && b.name) ? String(b.name) : '';
  if(name && name.toLowerCase().startsWith(kind)) return art + ' ' + name.charAt(0).toLowerCase() + name.slice(1);
  if(name) return art + ' ' + kind + ' « ' + name + ' »';
  const town = newsTownName(b);
  return art + ' ' + kind + (town ? ' ' + deNom(town) : '');
}
// Arrivée d'un véhicule à une escale : premier train en gare, premier navire au
// port, premier vol (appelé par la simulation).
function newsOnArrival(v, stopB){
  if(!v || !stopB || stopB.dead) return;
  const mode = typeof vehicleMode === 'function' ? vehicleMode(v) : 'road';
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  if(v.vtype === 'train' && isTrainStationPiece(stopB)){
    const rep = trainStationGroupRepresentative(stopB.stationGroupId) || stopB;
    const town = newsTownName(rep);
    publishNews('gare:' + stopB.stationGroupId, '🚂', cap(newsPlaceLabel(rep, 'gare', 'la')) + ' accueille son premier train !',
      (town ? 'Les habitants ' + deNom(town) : 'La foule') + ' acclament le premier convoi sur le quai.'
      + ' Le chemin de fer promet prospérité et voyages à toute la région.', eventTargetForBuilding(rep));
  } else if(mode === 'water' && stopB.type === 'boat_depot'){
    publishNews('port:' + stopB.x + ',' + stopB.y, '⚓', 'Premier navire à quai : ' + newsPlaceLabel(stopB, 'port', 'le') + ' est ouvert !',
      'Sirènes et cornes de brume : le port est officiellement ouvert au trafic maritime.', eventTargetForBuilding(stopB));
  } else if(mode === 'air' && stopB.type === 'air_terminal'){
    publishNews('aero:' + stopB.x + ',' + stopB.y, '✈️', 'Premier atterrissage : ' + newsPlaceLabel(stopB, 'aéroport', 'l’').replace('l’ ', 'l’') + ' est en service !',
      'Les curieux se pressent le long des pistes : l’ère de l’aviation commerciale commence.', eventTargetForBuilding(stopB));
  }
}
// Partie chargée sans Gazette (ancienne sauvegarde) : tout ce qui existe déjà est
// considéré comme annoncé, sinon chaque gare/ville déclencherait sa une d'un coup.
function primeNewsFlags(){
  for(const b of buildings){
    if(b.dead) continue;
    if(isTrainStationPiece(b) && b.stationGroupId != null) newsFlags['gare:' + b.stationGroupId] = 1;
    else if(b.type === 'boat_depot') newsFlags['port:' + b.x + ',' + b.y] = 1;
    else if(b.type === 'air_terminal') newsFlags['aero:' + b.x + ',' + b.y] = 1;
    if(b.type === 'tower' || b.type === 'tower3' || b.type === 'sky') newsFlags['niveau:' + b.type] = 1;
    if(b.type === 'space_center' && (b.launches || 0) > 0){ newsFlags['fusee:' + b.x + ',' + b.y] = 1; newsFlags['capsule:' + b.x + ',' + b.y] = 1; }
  }
  for(const t of towns){
    const pop = townPopulation(t);
    for(const step of NEWS_TOWN_STEPS) if(pop >= step) newsFlags['ville:' + t.id + ':' + step] = 1;
  }
}
// Paliers de population des villes et grands logements (toutes les secondes).
// (les petits paliers du joueur ont déjà leurs toasts : la Gazette commence à 250)
const NEWS_TOWN_STEPS = [250, 500, 1000, 2500, 5000, 10000];
function updateNews(){
  if(typeof MP !== 'undefined' && MP.connected && MP.role === 'guest') return;
  // population de toutes les villes en UN passage (townPopulation par ville parcourait
  // tous les bâtiments pour chacune : ~20 ms par seconde sur une grande carte)
  const popByTown = new Map();
  for(const b of buildings){
    if(b.dead || b.townId == null || !BUILD[b.type]?.resid) continue;
    popByTown.set(b.townId, (popByTown.get(b.townId) || 0) + (b.pop || 0));
  }
  for(const t of towns){
    const pop = popByTown.get(t.id) || 0;
    for(const step of NEWS_TOWN_STEPS){
      if(pop < step) break;
      if(newsFlags['ville:' + t.id + ':' + step]) continue;
      const big = step >= 1000;
      publishNews('ville:' + t.id + ':' + step, big ? '🏙️' : '🏘️',
        t.name + ' dépasse les ' + step.toLocaleString('fr-FR') + ' habitants !',
        big ? 'Embouteillages, chantiers, théâtres : ' + t.name + ' est devenue une vraie métropole.'
            : 'Le maire inaugure une place du marché : ' + t.name + ' grandit à vue d’œil.',
        eventTargetForTown(t));
      break; // un palier par ville et par seconde
    }
  }
}

function focusGameEventTarget(target){
  if(!target) return;
  setTool('select');
  selectedExpansion = null;
  vehicleRouteMode = null;

  if(target.kind === 'vehicle'){
    const v = vehicles.find(veh => String(veh.id) === String(target.id));
    selected = null;
    closeTownPanel();
    if(v){
      selectedVehicle = v;
      focusVehicle = v;
      camTracking = false;
      const pos = vehicleWorldPos(v);
      if(pos) centerOn(pos.x, pos.y);
      renderInfo();
      renderVehicleListPanel();
      return;
    }
  } else if(target.kind === 'town'){
    const town = towns.find(t => t.id === target.id);
    selected = null;
    selectedVehicle = null;
    focusVehicle = null;
    camTracking = false;
    if(town){
      selectedTownId = town.id;
      centerOn(town.cx * TILE, town.cy * TILE);
      openTownPanel(town.id);
      return;
    }
  } else if(target.kind === 'building'){
    let b = null;
    if(target.stationGroupId != null && typeof trainStationGroupRepresentative === 'function'){
      b = trainStationGroupRepresentative(target.stationGroupId) || null;
    }
    if(!b && bgrid){
      const tx = Math.max(0, Math.min(N - 1, Math.round(target.x)));
      const ty = Math.max(0, Math.min(N - 1, Math.round(target.y)));
      b = bgrid[ty * N + tx];
    }
    if(b && !b.dead){
      selected = typeof trainStationSelectionRepresentative === 'function'
        ? trainStationSelectionRepresentative(b) || b
        : b;
      selectedVehicle = null;
      focusVehicle = null;
      camTracking = false;
      closeTownPanel();
      const center = centerOfBuilding(selected);
      centerOn(center.x * TILE, center.y * TILE);
      renderInfo();
      return;
    }
  }

  selected = null;
  selectedVehicle = null;
  focusVehicle = null;
  camTracking = false;
  closeTownPanel();
  if(target.mapX != null && target.mapY != null){
    centerOn(target.mapX * TILE, target.mapY * TILE);
  }
}

function setPanelVisibility(optKey, visible){
  if(UI_OPTIONS[optKey] === !!visible){
    if(optKey === 'panelEvents') renderEventsPanel();
    return;
  }
  UI_OPTIONS[optKey] = !!visible;
  saveUIOptions();
  refreshPanelMenu();
  if(optKey === 'panelEvents') renderEventsPanel();
  if(optKey === 'panelMinimap' && typeof Minimap !== 'undefined') Minimap.setVisible(!!visible);
  if(optKey === 'panelObjectives' && typeof ObjectivesPanel !== 'undefined') ObjectivesPanel.render();
}

function closeEventsPanel(){
  const p = $('eventsPanel');
  if(p){
    p.style.display = 'none';
    p._html = null;
  }
  setPanelVisibility('panelEvents', false);
}

function renderEventsPanel(){
  const p = $('eventsPanel');
  if(!p) return;
  if(!UI_OPTIONS.panelEvents){
    p.style.display = 'none';
    p._html = null;
    return;
  }
  p.style.display = 'block';
  const list = Array.isArray(gameEvents) ? gameEvents : [];
  const parts = [
    '<div class="panel-head"><h3>📝 ' + t('events.title') + ' <span class="events-count">(' + list.length + ')</span></h3>',
    '<button class="tbtn" id="bEventsX" aria-label="Fermer" title="' + t('vehlist.close') + '">✕</button></div>'
  ];
  if(!list.length){
    parts.push('<div class="events-empty">' + t('events.empty') + '</div>');
  } else {
    parts.push('<div class="events-hint">' + t('events.hint') + '</div>');
    parts.push('<div class="events-list">');
    for(const ev of list){
      parts.push(
        '<div class="event-item" data-event-id="' + ev.id + '">'
        + '<div class="event-head">'
        + '<span class="event-target">' + escUiHtml(ev.target?.label || '—') + '</span>'
        + '<span class="event-time">' + escUiHtml(formatGameDate(ev.gtime)) + '</span>'
        + '</div>'
        + '<div class="event-text">' + escUiHtml(ev.text) + '</div>'
        + '</div>'
      );
    }
    parts.push('</div>');
  }
  const html = parts.join('');
  if(p._html === html) return;
  p._html = html;
  p.innerHTML = html;
  ensurePanelDragHandle('eventsPanel');
  const closeBtn = $('bEventsX');
  if(closeBtn) closeBtn.onclick = ()=> closeEventsPanel();
  p.querySelectorAll('[data-event-id]').forEach(el => {
    el.onclick = () => {
      const id = +el.dataset.eventId;
      const ev = gameEvents.find(entry => entry.id === id);
      if(ev) focusGameEventTarget(ev.target);
    };
  });
}

function refreshPanelMenu(){
  document.querySelectorAll('[data-panel-opt]').forEach(el => {
    const key = el.dataset.panelOpt;
    const active = !!UI_OPTIONS[key];
    el.classList.toggle('active', active);
    const chk = el.querySelector('.chk');
    if(chk) chk.textContent = active ? '✓' : '';
  });
}
// Libellé de la ressource configurée pour un véhicule (épinglée, unique, ou « Auto »).
function vehicleConfiguredResLabel(v){
  const vt = VEHICLE_TYPES[v.vtype] || {};
  if(v.vtype === 'bus') return '👤 ' + t('vehlist.passengers');
  if(v.vtype === 'train')
    return v.res ? ((RES[v.res]?.ic ? RES[v.res].ic + ' ' : '') + (RES[v.res]?.n || v.res)) : '—';
  const r = v.pinnedRes || (vt.resources && vt.resources.length === 1 ? vt.resources[0] : null);
  if(r) return (RES[r]?.ic ? RES[r].ic + ' ' : '') + (RES[r]?.n || r);
  return t('vehlist.resAuto');
}
// Ancienneté d'un véhicule en mois de jeu (30 jours = 1 mois, comme l'entretien).
function vehicleAgeMonths(v){
  if(v.boughtAtGtime == null) return null;
  return Math.max(0, Math.floor((gtime - v.boughtAtGtime) / (VEHICLE_MAINTENANCE_DAY * 30)));
}
function renderVehicleListPanel(){
  const p = $('vehicleListPanel');
  if(!p || p.style.display !== 'block') return;
  const listMode = { train:'rail', water:'water', air:'air' }[vehicleListMode] || 'road';
  const list = vehicles
    .filter(v => vehicleMode(v) === listMode && isMyVehicle(v))
    .slice()
    .sort((a, b) => (a.boughtAtGtime || 0) - (b.boughtAtGtime || 0));
  const titleKey = { train:'vehlist.titleTrain', water:'vehlist.titleWater', air:'vehlist.titleAir' }[vehicleListMode] || 'vehlist.titleRoad';
  const parts = [
    '<div class="panel-head"><h3>' + t(titleKey) + ' <span class="vehlist-count">(' + list.length + ')</span></h3>',
    '<button class="tbtn" id="bVehListX" aria-label="Fermer" title="' + t('vehlist.close') + '">✕</button></div>'
  ];
  if(!list.length){
    parts.push('<div class="vehlist-empty">' + t('vehlist.empty') + '</div>');
  } else {
    parts.push('<div class="vehlist-hint">' + t('vehlist.hint') + '</div>');
    parts.push('<div class="vehlist">');
    for(const v of list){
      const vt = VEHICLE_TYPES[v.vtype] || {};
      const sel = (selectedVehicle === v || focusVehicle === v) ? ' sel' : '';
      const nom = vt.nom || v.vtype;
      const resLabel = vehicleConfiguredResLabel(v);
      const ageM = vehicleAgeMonths(v);
      const ageLabel = ageM != null ? t('vehlist.months', { n: ageM }) : '—';
      parts.push(
        '<div class="vehlist-row' + sel + '" data-vid="' + v.id + '">'
        + '<span class="vehlist-icon">' + (vt.icone || '🚗') + '</span>'
        + '<span class="vehlist-info"><span class="vehlist-name"><b>' + nom + '</b><span class="vehlist-res">' + resLabel + '</span></span>'
        + '<span class="vehlist-date">#' + v.id + ' · ' + ageLabel + '</span>'
        + '</span><span class="vehlist-net" title="Gain net du mois en cours (entretien déduit)">' + vehicleMonthNetHtml(v) + '</span></div>'
      );
    }
    parts.push('</div>');
  }
  const h = parts.join('');
  if(p._html === h) return; // mémo : rien n'a changé
  p._html = h; p._b = null;
  p.innerHTML = h;
  ensurePanelDragHandle('vehicleListPanel');
}
// Délégation d'événements sur le panneau liste (survit aux reconstructions ~5×/s).
(function(){
  const p = $('vehicleListPanel');
  if(!p) return;
  let lastClickVid = null, lastClickTime = 0;
  p.addEventListener('click', e => {
    if(e.target.closest('#bVehListX')){ closeVehicleListPanel(); return; }
    const row = e.target.closest('.vehlist-row');
    if(!row) return;
    const v = vehicles.find(vv => String(vv.id) === row.dataset.vid);
    if(!v) return;
    const now = performance.now();
    if(lastClickVid === row.dataset.vid && (now - lastClickTime) < 350){
      lastClickVid = null;
      focusOnVehicle(v);
      selectedVehicle = v;
      selected = null;
      selectedExpansion = null;
      renderInfo();
    } else {
      lastClickVid = row.dataset.vid;
      lastClickTime = now;
      focusOnVehicle(v);
    }
  });
})();

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
  const state = vehicleDepotFlagState(v);
  if(!state) return '';
  const color = state.armed ? '#7dda5a' : '#ff7474';
  const icon = state.armed ? '🚩' : '🟥';
  const label = state.armed ? 'Drapeau vert' : 'Drapeau rouge';
  return '<button class="tbtn" data-train-flag="'+v.id+'" style="width:auto;margin:0;color:'+color+';font-weight:bold"'
    + attrs + '>'+icon+' '+label+'</button>';
}

function handleTrainDepotFlagClick(v){
  if(!v) return;
  if(MP.connected && v.garageRef?.owner && v.garageRef.owner !== MP.myId){
    toast('⛔ Ce véhicule appartient à un autre joueur.','err');
    return;
  }
  if(!vehiclePresentAtDepot(v)){
    toast('⛔ Le véhicule doit être dans le dépôt.','err');
    return;
  }
  const nextArmed = !vehicleDepotDepartureArmed(v);
  const res = setVehicleDepotDeparture(v, nextArmed);
  if(!res.ok){
    if(res.reason === 'route_missing') toast(v.vtype === 'train'
      ? '⛔ Il faut d’abord une route valide avec au moins 2 arrêts.'
      : '⛔ Il faut d’abord une route valide.','err');
    else if(res.reason === 'no_path') toast(v.vtype === 'train'
      ? '⛔ Aucun chemin ferroviaire continu depuis le dépôt.'
      : '⛔ Aucun chemin routier continu depuis le dépôt.','err');
    else toast('⛔ Départ impossible depuis ce dépôt.','err');
    return;
  }
  if(MP.connected) netSend({ type:'depot_departure_flag', id:v.id, armed:nextArmed });
  if(nextArmed){
    if(v.vtype === 'train'){
      if(res.waiting) toast('🚩 Drapeau vert. Le train partira dès que la voie de sortie sera libre.','win');
      else toast('🚩 Drapeau vert. Départ autorisé.','win');
    } else {
      toast('🚩 Drapeau vert. Le véhicule va tenter de sortir du dépôt.','win');
    }
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
  const depotVehicles = (depot.vehicles || []).filter(v =>
    depot.type === 'train_depot'
      ? trainPresentAtDepot(v) && (v.orders?.length || 0) >= 2
      : v.vtype !== 'train' && vehiclePresentAtDepot(v) && v.source && v.dest
  );
  if(!depotVehicles.length) return;
  // Si tous les trains armables sont déjà verts, on les remet au rouge ; sinon on
  // arme tous ceux qui peuvent l'être.
  const target = !depotVehicles.every(v => vehicleDepotDepartureArmed(v));
  let changed = 0, waiting = 0, failReason = null;
  for(const v of depotVehicles){
    if(MP.connected && v.garageRef?.owner && v.garageRef.owner !== MP.myId) continue;
    if(vehicleDepotDepartureArmed(v) === target) continue;
    const res = setVehicleDepotDeparture(v, target);
    if(!res.ok){ failReason = res.reason || 'route_missing'; continue; }
    changed++;
    if(res.waiting) waiting++;
    if(MP.connected) netSend({ type:'depot_departure_flag', id:v.id, armed:target });
  }
  if(changed){
    if(!target) toast('🟥 Drapeau rouge. Départ annulé.','win');
    else if(depot.type === 'train_depot' && waiting) toast('🚩 Drapeau vert. Le train partira dès que la voie de sortie sera libre.','win');
    else if(depot.type === 'train_depot') toast('🚩 Drapeau vert. Départ autorisé.','win');
    else toast('🚩 Drapeau vert. Les véhicules vont tenter de sortir du dépôt.','win');
  } else if(failReason === 'no_path'){
    toast(depot.type === 'train_depot'
      ? '⛔ Aucun chemin ferroviaire continu depuis le dépôt.'
      : '⛔ Aucun chemin routier continu depuis le dépôt.','err');
  } else if(failReason){
    toast(depot.type === 'train_depot'
      ? '⛔ Il faut d’abord une route valide avec au moins 2 arrêts.'
      : '⛔ Il faut d’abord une route valide.','err');
  }
  if(trainConfigVehicle && depotVehicles.includes(trainConfigVehicle)) renderTrainPanel();
}

// Le panneau s'ouvre partout : les ORDRES se modifient même en circulation ; la
// COMPOSITION (wagons, moteur) exige que le train soit au dépôt.
function openTrainPanel(v){
  if(!v || v.vtype !== 'train') return;
  trainConfigVehicle = v;
  v.ordersDraft = false; // part d'un état propre : l'hôte reste autoritatif tant qu'on n'édite pas
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
  h += ownerRowHtml(v.garageRef?.owner ?? null);
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
  h += '<div class="row"><span>Gain net du mois (entretien déduit)</span>'+vehicleMonthNetHtml(v)+'</div>';
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
  const _inDepot = trainPresentAtDepot(v);
  h += '<div class="tp-section"><div class="tp-section-title">Wagons <span style="font-size:11px;color:#8fa3bf;font-weight:normal">('+TRAIN_WAGON_COST.toLocaleString('fr-FR')+' $ / wagon)</span></div>';
  if(!_inDepot) h += '<div style="color:#e8d48b;font-size:11px;margin-bottom:6px">🔧 La composition ne se modifie qu’au dépôt (rappelle le train avec 🏪).</div>';
  h += '<div class="tp-wagon-grid"'+(_inDepot ? '' : ' style="opacity:.5;pointer-events:none"')+'>';
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
      const _foreign = b.owner != null && b.owner !== (MP.myId ?? null);
      const ownerTag = _foreign
        ? ' <span style="font-size:10px;color:'+playerColor(b.owner)+';margin-left:6px">🌐 '+escHtml(playerName(b.owner))+'</span>' : '';
      h += '<div class="tp-order"><div><b>'+(idx + 1)+'.</b> '+escHtml(trainStopLabel(b))
         + ownerTag + ' <span style="font-size:10px;color:#8fa3bf;margin-left:8px">'+modeLabel+'</span></div>'
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
    if(!trainPresentAtDepot(v)){ toast('⛔ Le train doit être au dépôt pour changer de moteur.','err'); return; }
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
    if(!trainPresentAtDepot(v)){ toast('⛔ Le train doit être au dépôt pour changer de moteur.','err'); return; }
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
    if(!trainPresentAtDepot(v)){ toast('⛔ Le train doit être au dépôt pour changer sa composition.','err'); return; }
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
    if(!trainPresentAtDepot(v)){ toast('⛔ Le train doit être au dépôt pour changer sa composition.','err'); return; }
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
    v.ordersDraft = true; // édition locale non enregistrée : la synchro ne doit pas l'écraser
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
    v.ordersDraft = true; // édition locale non enregistrée
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
    v.ordersDraft = true; // édition locale non enregistrée
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
      // En circulation : nouveaux ordres appliqués à la volée, le train rejoint le
      // 1er arrêt depuis sa position (sans repasser par le dépôt).
      v.ordersDraft = false;
      if(!trainApplyOrdersLive(v)){ toast('⛔ Ordres invalides pour ce train.','err'); return; }
      if(MP.connected) netSend({
        type:'route_vehicle', id:v.id, orderIndex:v.orderIndex || 0,
        orders:(v.orders || []).map(b => ({ x:b.x, y:b.y })),
        orderModes:(v.orderModes || []).slice(),
      });
      toast('🚂 Nouveaux ordres appliqués : le train rejoint '+trainStopLabel(v.source)+'.','win', eventTargetForVehicle(v));
      renderTrainPanel();
      renderInfo();
      return;
    }
    v.orderIndex = 0;
    syncTrainOrders(v);
    v.ordersDraft = false; // route enregistrée et envoyée : l'hôte redevient autoritatif
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

// Un producteur de `res` ou un entrepôt couvre-t-il ce logement de son rayon de
// livraison directe ? (les tournées de camions configurées ne sont pas comptées)
function residSupplierInReach(b, res){
  const bc = centerOfBuilding(b);
  for(const c of buildings){
    if(c.dead || c === b) continue;
    let radius;
    if(BUILD[c.type]?.ind){
      if(!recipeOf(c)?.out?.[res]) continue;
      radius = indRadiusOf(c);
    } else if(isStorageHub(c) && c.type !== 'tank' && c.allow?.[res] !== false){
      radius = depotRadiusOf(c);
    } else continue;
    const cc = centerOfBuilding(c);
    if(Math.max(Math.abs(cc.x - bc.x), Math.abs(cc.y - bc.y)) <= radius) return true;
  }
  return false;
}
function statusOf(b){
  if(BUILD[b.type].resid){
    if(b.starterHome) return 'Maison de départ protégée (pas besoin de ravitaillement)';
    const req = residRequiredOf(b);
    const missingReq = req.filter(r => (b.storage[r]||0) <= 0);
    const upgradePending = residUpgradeResourcesOf(b)
      .filter(r => residUpgradeRemainingOf(b, r) > 0)
      .map(r => residUpgradeProgressOf(b, r)+'/'+residUpgradeTargetOf(b, r)+' '+RES[r].n.toLowerCase()
        + (residUpgradePaused(b, r) ? ' (pause)' : ''));
    const bonusMissing = residBonusOf(b).filter(r => (b.storage[r]||0) <= 0);
    if(missingReq.length === 0){
      const txt = 'Consomme '+resNames(req)+'…';
      if(BUILD[b.type].lux && luxNextLevelOf(b)){
        if(upgradePending.length) return txt+' — agrandissement : '+upgradePending.join(' · ');
        if(b.pop < BUILD[b.type].resid.popCap) return txt+' — agrandissement prêt (logement à remplir)';
        return txt + (luxExpansionRect(b)
          ? ' — agrandissement imminent'
          : ' — ⚠️ agrandissement bloqué : pose des maisons de luxe collées à celle-ci');
      }
      if(upgradePending.length) return txt+' — upgrade : '+upgradePending.join(' · ');
      if(residUpgradeResourcesOf(b).length) return txt + (b.pop >= BUILD[b.type].resid.popCap
        ? ' — prêt pour fusionner'
        : ' — upgrade prêt');
      if(bonusMissing.length) return txt+' — bonus demandé : '+resNames(bonusMissing);
      return txt;
    }
    if(b.pop > (b.protectedPop||0) && b.starve > 0)
      return '⚠️ Pénurie : manque '+resNames(missingReq)+' ! Dégradation dans '+Math.max(0,Math.ceil(STARVE_DELAY-b.starve))+' s';
    const unreachable = missingReq.filter(r => !residSupplierInReach(b, r));
    if(unreachable.length)
      return 'Attend : '+resNames(missingReq)+' — aucun fournisseur à portée de livraison pour '
        +resNames(unreachable)+' (rapprochez la production, un entrepôt, ou livrez par camion)';
    return 'Attend : '+resNames(missingReq);
  }
  if(b.type==='market') return 'Marché — vente aux autres joueurs';
  if(BUILD[b.type].leisure){
    const n = leisureVisitorsOf(b);
    if(n <= 0 && WORLD?.mode === 'creative') return '🎨 Animation permanente (mode créatif)';
    return n > 0 ? '🎟️ '+n+' visiteur'+(n > 1 ? 's' : '')+' sur place' : 'En attente de visiteurs';
  }
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
    const pS = Math.floor(b.passagersSortant || 0);
    const parts = [];
    const linked = transitHubLinkedRepresentative(b);
    if(linked){
      const inn = Math.floor((linked.passengersEntrant || 0) + (linked.passengersEntrantPending || 0));
      const out = Math.floor(linked.passagersSortant || 0);
      return '🚉 Lié · 🚶 '+inn+' entrant'+(inn>1?'s':'')+' · 🚶 '+out+' sortant'+(out>1?'s':'');
    }
    if(cur > 0) parts.push('🚶 '+cur+' entrant'+(cur>1?'s':''));
    if(pS > 0) parts.push('🚶 '+pS+' sortant'+(pS>1?'s':''));
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
    if(pEMax > 0 || pE > 0) parts.push('↑ '+pE);
    if(pS > 0) parts.push('↓ '+pS);
    const pasStr = parts.length ? 'Passagers : '+parts.join(' · ') : 'Gare ferroviaire';
    return pasStr + (depot ? ' · Entrepôt lié' : '');
  }
  if(b.type === 'plant') return 'Usine abandonnée — choisir une spécialisation';
  if(usesWater(b) && !tankNear(b)) return '⚠️ Aucune citerne proche pour recevoir l’eau';
  if(b.type === 'space_center'){
    if(b.spacePhase === 'flight') return '🛰️ Fusée en mission — la capsule rapportera '+resAmountsIcons(SPACE_CARGO);
    if(b.paused) return 'En pause — ouvriers libérés';
    const miss = Object.keys(SPACE_ROCKET_PARTS).filter(k => (b.storage[k] || 0) < SPACE_ROCKET_PARTS[k]);
    if(miss.length) return 'Pièces de fusée manquantes : '+resNames(miss);
    if(workersRequiredOf(b) && workersAllocatedOf(b) === 0) return '👷 Aucun ouvrier à portée pour assembler la fusée';
    return '🔧 Assemblage de la fusée sur le pas de tir';
  }
  if(b.paused) return 'En pause — ouvriers libérés';
  const r = recipeOf(b);
  if(!r) return '';
  const req = workersRequiredOf(b);
  if(req && workersAllocatedOf(b) === 0)
    return "👷 Aucun ouvrier à portée — construisez des logements à côté ou un arrêt de bus relié à une ville";
  // la production ne s'arrête que si toutes les sorties sont pleines (sous-produit sans débouché toléré)
  const outs = Object.keys(r.out);
  if(outs.length && outs.every(k => (b.storage[k]||0) >= capOf(b,k))) return 'Stock de sortie plein';
  for(const k in r.in)  if((b.storage[k]||0) <  r.in[k]) return 'Manque : '+RES[k].n;
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
  let lbl = v.state==='idle' ? 'En attente' : v.state==='returning' ? 'Retour dépôt' : v.state==='to_source' ? 'Vers source' : 'Vers destination';
  if(v.vtype === 'train' && trainPresentAtDepot(v) && (v.orders?.length || 0) >= 2)
    lbl = trainDepotDepartureArmed(v) ? 'Départ autorisé' : 'À l’arrêt au dépôt';
  const cargo = v.cargo > 0 ? ' · '+v.cargo+(v.res ? ' '+RES[v.res].n : '') : '';
  const flagState = v.vtype === 'train' ? trainDepotFlagState(v) : null;
  const flagLbl = flagState ? (flagState.armed ? ' · drapeau vert' : ' · drapeau rouge') : '';
  el.textContent = lbl + cargo + flagLbl;
}

// Ligne « Propriétaire » des panneaux de détail (bâtiments et véhicules).
function ownerRowHtml(owner){
  const name = owner == null ? (MP.username || 'Joueur') : playerName(owner);
  const col = owner == null ? '#e0e0e0' : playerColor(owner);
  return '<div class="row"><span>Propriétaire</span><b style="color:'+col+'">'+escHtml(name)+'</b></div>';
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
        { t:T.SAND,   ic:'🏖️',          n:'Sable'       },
        { t:T.CLAY,   ic:'🧱',          n:'Argile'      },
        { t:T.COPPER, ic:RES.copper_ore.ic, n:RES.copper_ore.n },
        { t:T.GOLD,   ic:RES.gold_ore.ic,   n:RES.gold_ore.n },
        { t:T.LIMESTONE, ic:RES.limestone.ic, n:RES.limestone.n },
        { t:T.OIL,    ic:'🛢️',          n:'Nappe de pétrole' },
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
      // Biomes de la pièce (le climat oriente les gisements qu'on y trouve)
      const biomeRows = biomesActive() ? biomeComposition(exp.x0, exp.y0, exp.x1, exp.y1, exp.inPiece).filter(e => e.pct >= 5) : [];
      if(biomeRows.length){
        h_ += '<div class="row" style="margin-top:4px;border-top:1px solid #334;padding-top:4px"><span style="font-weight:600">Biomes</span></div>';
        for(const e of biomeRows){
          const B = BIOMES[e.b];
          h_ += '<div class="row" title="Riche en '+B.atout+'"><span>'+B.ic+' '+B.n+' <small style="opacity:.7">('+B.atout+')</small></span><b>'+e.pct+' %</b></div>';
        }
      }
      const resRows = terrainResTypes.filter(r => resCounts[r.t] > 0);
      if(resRows.length > 0){
        h_ += '<div class="row" style="margin-top:4px;border-top:1px solid #334;padding-top:4px"><span style="font-weight:600">Ressources dans la pièce</span></div>';
        for(const r of resRows)
          h_ += '<div class="row"><span>'+r.ic+' '+r.n+'</span><b>'+resCounts[r.t]+'</b></div>';
      }
      h_ += '<button class="tbtn" style="margin-top:8px;width:100%;'+(canAfford?'':'opacity:0.5;cursor:not-allowed;')+'" '
          + 'onclick="buyExpansionAction(selectedExpansion)">'
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
  if(focusVehicle?.garageRef?.dead){ focusVehicle = null; camTracking = false; }
  if(selectedVehicle){
    if(selectedVehicle.garageRef?.dead){ selectedVehicle = null; }
    else {
      const veh = selectedVehicle;
      const vt = VEHICLE_TYPES[veh.vtype];
      if(veh.vtype === 'train' && !veh.name) assignTrainVehicleName(veh);
      let stateLabel = { idle:'En attente 💤', to_source:'Vers source 🔵', to_dest:'Vers destination 🟠', returning:'Retour au dépôt 🏪' }[veh.state] || veh.state;
      if(veh.vtype === 'train' && trainPresentAtDepot(veh) && (veh.orders?.length || 0) >= 2)
        stateLabel = trainDepotDepartureArmed(veh) ? 'Départ autorisé 🚩' : 'À l’arrêt au dépôt 🟥';
      else if(veh.vtype !== 'train' && vehiclePresentAtDepot(veh) && veh.source && veh.dest)
        stateLabel = vehicleDepotDepartureArmed(veh) ? 'Départ autorisé 🚩' : 'À l’arrêt au dépôt 🟥';
      const srcName = veh.source && !veh.source.dead ? trainStopLabel(veh.source) : '—';
      const dstName = veh.dest   && !veh.dest.dead   ? trainStopLabel(veh.dest)  : '—';
      const isBusVeh = veh.vtype === 'bus';
      const srcNameDisplay = isBusVeh && veh.source && !veh.source.dead
        ? (veh.source.name || BUILD[veh.source.type].n) : srcName;
      const dstNameDisplay = isBusVeh && veh.dest && !veh.dest.dead
        ? (veh.dest.name || BUILD[veh.dest.type].n) : dstName;
      const cargoStr = isBusVeh
        ? (veh.cargo > 0 ? veh.cargo+' voyageur(s)' : 'Vide')
        : (veh.cargo > 0 ? veh.cargo+' '+(veh.res ? RES[veh.res].n : '') : 'Vide');
      const _vehPassCap = veh.vtype === 'train' ? trainPassengerCapacity(veh) : 0;
      const passengerStr = _vehPassCap > 0
        ? (veh.passengersOnBoard||0)+' / '+_vehPassCap+' voyageur(s) 🚃' : null;
      const orderSummary = veh.vtype === 'train' && veh.orders?.length
        ? veh.orders.map(b => trainStopLabel(b)).join(' → ')
        : null;
      const trainFlagState = vehicleDepotFlagState(veh);
      const vehLabel = veh.vtype === 'train' ? (veh.name || 'Train') : vt.nom;
      let h = '<h3><span style="font-size:22px">'+vt.icone+'</span> '+escHtml(vehLabel)+'<span style="margin-left:auto"></span><button class="tbtn" id="infoCloseBtn" aria-label="Fermer" style="width:auto;margin:0;padding:2px 8px">✕</button></h3>';
      h += '<div class="status">'+stateLabel+'</div>';
      h += ownerRowHtml(veh.garageRef?.owner ?? null);
      if(isBusVeh && veh.cargo > 0){
        // clic sur « Voyageurs » : une ligne par joueur ayant au moins 1 voyageur dans le bus
        const open = !voyageursClosed.has('bus'+veh.id);
        h += '<div class="row" data-voy-toggle="bus'+veh.id+'" style="cursor:pointer" title="Voir le détail des voyageurs"><span>Voyageurs '+(open ? '▾' : '▸')+'</span><b>'+cargoStr+'</b></div>';
        if(open) h += voyageursLinesHtml(busCargoLines(veh), 'voyageur');
      } else h += '<div class="row"><span>'+(isBusVeh ? 'Voyageurs' : 'Cargaison')+'</span><b>'+cargoStr+'</b></div>';
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
      h += '<div class="row"><span>Gain net du mois (entretien déduit)</span>'+vehicleMonthNetHtml(veh)+'</div>';
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
      const ownsVeh = isMyVehicle(veh);
      const trainConfigDisabled = veh.vtype === 'train' && !trainPresentAtDepot(veh);
      if(ownsVeh){
        h += '<div style="margin-top:8px;display:flex;gap:4px">'
           + '<button class="tbtn" style="flex:1'
           + (trainConfigDisabled ? ';opacity:.5;cursor:not-allowed' : '')
           + '" id="bVehRoute">'+(veh.vtype === 'train' ? '🧭 Configurer' : '🔁 Nouvelle route')+'</button>'
           + (trainFlagState ? trainDepotFlagButtonHtml(veh, ' id="bVehTrainFlag"') : '')
           + '</div>';
        if(vt.mode === 'air')
          h += '<button class="tbtn" style="width:100%;margin-top:4px" id="bVehPause">'+(veh.paused ? '▶️ Reprendre le service' : '⏸️ Mettre en pause (rejoint un parking)')+'</button>';
        if(veh.state !== 'idle' && veh.state !== 'returning')
          h += '<button class="tbtn" style="width:100%;margin-top:4px" id="bVehReturn">🏪 Retour au dépôt</button>';
        h += '<button class="tbtn" style="width:100%;margin-top:4px;color:#ff9a8a" id="bVehSell">🗑️ Vendre (+'
           + Math.floor(vt.cost*0.5)+' $)</button>';
      }
      p.style.display = 'block';
      if(p._html === h) return;
      p._html = h; p._b = null;
      p.innerHTML = h;
      ensurePanelDragHandle('info');
      if(!ownsVeh) return;
      $('bVehRoute').onclick = ()=>{
        if(veh.vtype === 'train'){
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
      const pauseBtn = $('bVehPause');
      if(pauseBtn) pauseBtn.onclick = ()=>{
        const paused = !veh.paused;
        setPlanePaused(veh, paused);
        if(MP.connected) netSend({ type:'pause_vehicle', id:veh.id, paused });
        toast(paused ? '⏸️ '+vt.nom+' en pause : il rejoint une place de parking de son aéroport.' : '▶️ '+vt.nom+' reprend sa route.');
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
        const refund = vehicleResaleValue(veh);
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
    _hdrBtns += '<button class="tbtn" id="bClearStock" title="Vider le stock" style="padding:2px 6px;font-size:13px;margin:0;width:auto"'+(canControl?'':' disabled')+'>🗑️</button>';
  if(d.ind)
    _hdrBtns += '<button class="tbtn" id="bPauseBld" title="'+(b.paused?'Reprendre':'Mettre en pause')+'" style="padding:2px 6px;font-size:13px;margin:0;width:auto"'+(canControl?'':' disabled')+'>'+(b.paused?'▶':'⏸')+'</button>';
  _hdrBtns += '<button class="tbtn" id="bDemol" title="Démolir (+'+_demolCost+' $)" style="padding:2px 6px;font-size:13px;margin:0;width:auto"'+(canControl?'':' disabled')+'>🧨</button>';
  _hdrBtns += '<button class="tbtn" id="infoCloseBtn" title="Fermer" aria-label="Fermer" style="padding:2px 8px;font-size:13px;margin:0;width:auto">✕</button>';
  _hdrBtns += '</span>';
  let h = '<h3><span style="font-size:22px">'+d.ic+'</span>';
  if(d.ind || isVehicleDepot(b)){
    h += '<input id="bldNameInput" class="bld-name-edit" value="'+escHtml(b.name||'')+'" placeholder="'+escHtml(d.n)+'"'
      + (canControl ? '' : ' readonly disabled') + '>';
  } else {
    h += '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
       + (b.name ? escHtml(b.name) : d.n) + '</span>';
  }
  h += _hdrBtns+'</h3>';
  h += '<div class="status">'+statusOf(b)+'</div>';
  h += ownerRowHtml(b.owner ?? null);
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
      h += '<div class="row" style="cursor:pointer" onclick="togglePassengerDetail(\'in\')" title="Cliquer : détail par joueur"><span>Passagers entrants</span><b style="color:#c8e040">🚶 '+pE+'</b></div>';
      h += passengerDetailBlock('in', mainStation);
      h += '<div class="row" style="cursor:pointer" onclick="togglePassengerDetail(\'out\')" title="Cliquer : détail par joueur"><span>Passagers sortants</span><b style="color:#9fd4f0">🚶 '+pS+'</b></div>';
      h += passengerDetailBlock('out', mainStation);
      h += '<div class="row"><span>Rayon</span><b>'+TRAIN_STATION_RADIUS+' cases</b></div>';
      h += '<div class="row"><span>Tarif</span><b style="color:#ffe9a0">'+TRAIN_FARE_FACTOR+' $/passager/case</b></div>';
    }
    const linkedDepot = trainStationLinkedDepot(b);
    if(linkedDepot){
      h += fusedDepotHtml(linkedDepot);
    } else {
      h += '<div style="margin-top:8px;color:#8fa3bf;font-size:11px;font-style:italic">Aucun entrepôt adjacent — les trains ne peuvent pas charger de ressources.</div>';
    }
  }
  if(b.type === 'train_depot' || isTrainStationPiece(b)){
    if(!adjRailTiles(b).length)
      h += '<div class="warn">⚠️ Aucun rail adjacent — pas de trains !</div>';
  } else if(b.type === 'plane_depot'){
    if(!planeDepotAirport(b))
      h += '<div class="warn">⚠️ Le dépôt (hangar) doit être collé à une voie de taxi d\'un aéroport fonctionnel — pas d\'avions !</div>';
  } else if(b.type === 'air_terminal' ? !airportHasRoadAccess(b)
            : (!AIR_TYPES.includes(b.type) && !adjRoadTiles(b).length)){
    h += '<div class="warn">⚠️ Aucune route adjacente — pas de camions !</div>';
  }
  if(b.type === 'plant'){
    const canUpgrade = !MP.connected || !b.owner || b.owner === MP.myId;
    h += '<div style="margin-top:8px;color:#8fa3bf">Spécialisation</div>';
    h += '<div style="font-size:11px;color:#8fa3bf;margin-bottom:4px">Choisir une seule fois le type d\'usine. 🏗️ : matériaux de chantier pris dans un entrepôt proche.</div>';
    for(const cat of PLANT_UPGRADE_CATEGORIES){
      const opts = Object.values(PLANT_UPGRADES).filter(o => (o.cat || 'build') === cat.key && !plantUpgradeError(b, o.type, false));
      if(!opts.length) continue; // types impossibles ici (terrain) masqués
      const collapsed = !plantCatExpanded.has(cat.key);
      h += '<div style="margin-top:6px;font-size:10px;color:#6e8aa0;text-transform:uppercase;letter-spacing:.06em;cursor:pointer;user-select:none" onclick="togglePlantCat(\''+cat.key+'\')" title="Cliquer pour '+(collapsed ? 'déplier' : 'replier')+'">'
        + (collapsed ? '▸' : '▾')+' '+cat.n+' <span style="color:#4f667a">('+opts.length+')</span></div>';
      if(collapsed) continue;
      for(const opt of opts){
        const d2 = BUILD[opt.type];
        const mats = buildMaterialsFor(opt.type);
        const miss = mats ? buildMaterialsMissing(opt.type, b.x, b.y, b.w, b.h, b.owner ?? null) : null;
        const tip = recipeText(d2.recipe, 'full') + (mats ? '\n🏗️ Matériaux : ' + resAmountsText(mats) + (miss ? '\n⛔ Manque : ' + resAmountsText(miss) : '') : '');
        h += '<button class="tbtn" style="width:100%;text-align:left;margin-top:3px'+(miss ? ';opacity:.6' : '')+'" data-plant-upgrade="'+opt.type+'"'
          + ' title="'+escHtml(tip)+'"' + (!canUpgrade ? ' disabled' : '') + '>'
          + opt.icon+' '+opt.label+' <span style="color:#8fa3bf">— '+(d2.cost||0)+' $'+(mats ? ' 🏗️' : '')+'</span>'
          + '<br><span style="font-size:10px;color:#9fb3c8">'+escHtml(plantRecipeLine(d2.recipe))+'</span>'
          + (miss ? '<br><span style="font-size:10px;color:#ff9a8a">Manque : '+escHtml(resAmountsIcons(miss))+'</span>' : '')
          + '</button>';
      }
    }
  }
  if(d.ind && b.name) h += '<div style="color:#8fa3bf;font-size:11px;margin-top:6px;margin-bottom:2px">'+d.n+'</div>';
  if(d.workers){
    h += '<div class="row" style="cursor:pointer" onclick="toggleWorkersDetail()" title="Cliquer : ouvriers par joueur"><span>Ouvriers</span><b>'+workersAllocatedOf(b)+' / '+workersRequiredOf(b)+'</b></div>';
    if(workersDetailOpen){
      const rows = Object.entries(b.workersByOwner || {}).filter(([, n]) => Math.floor(n) > 0)
        .map(([o, n]) => '<div>'+escHtml(playerName(o === 'null' ? null : (isNaN(+o) ? o : +o)))+' : <b>'+Math.floor(n)+'</b></div>');
      if(rows.length) h += '<div style="margin:2px 0 6px;padding:4px 6px;background:#101826;border-radius:6px;font-size:12px;color:#b8d4f0">'+rows.join('')+'</div>';
    }
  }
  if(d.ind && b.w*b.h>1 && !d.noMerge)
    h += '<div class="row"><span>Taille / production</span><b>'+b.w+'×'+b.h
       + ' — ×'+prodMult(b).toFixed(1)+'</b></div>';
  if(d.ind)
    h += '<div class="row"><span>Entretien</span><b>'+(Math.round(upkeepOf(b)*10)/10)
       + ' $ / '+IND_UPKEEP_INTERVAL+' s</b></div>';
  if(d.ind)
    h += '<div class="row"><span>Rayon d\'action</span><b style="color:#ff8c42">'+indRadiusOf(b)+' cases</b></div>';
  if(usesWater(b))
    h += '<div class="row"><span>Citerne proche</span><b style="color:'+(tankNear(b) ? '#9fe8a0' : '#ff9a8a')+'">'
       + (tankNear(b) ? 'oui' : 'non') + ' / '+BAKERY_TANK_RADIUS+' cases</b></div>';
  if(b.type === 'space_center'){
    const flight = b.spacePhase === 'flight';
    const pct = Math.min(100, Math.round(100 * (b.prog || 0) / (flight ? SPACE_MISSION_TIME : SPACE_ASSEMBLY_TIME)));
    h += '<div class="row"><span>Fusée</span><b style="color:'+(flight ? '#9fe6ff' : '#ffd27a')+'">'
       + (flight ? '🛰️ En mission — retour dans '+Math.max(0, Math.ceil(SPACE_MISSION_TIME - (b.prog || 0)))+' s'
                 : (b.prog > 0 ? '🔧 Assemblage '+pct+' %' : '⏳ En attente des pièces')) + '</b></div>';
    h += '<div class="row"><span>Lancements</span><b>'+(b.launches || 0)+'</b></div>';
    h += '<div class="row"><span>Durée de mission</span><b>'+SPACE_MISSION_TIME+' s</b></div>';
  }
  if(d.leisure){
    const L = d.leisure, cap = leisureCapacityOf(b), inside = leisureVisitorsOf(b);
    const vOpen = inside > 0 && !voyageursClosed.has('lieu'+b.x+','+b.y);
    h += '<div class="row"'+(inside > 0 ? ' data-voy-toggle="lieu'+b.x+','+b.y+'" style="cursor:pointer" title="Voir le détail des visiteurs par joueur"' : '')+'><span>Visiteurs'+(inside > 0 ? ' '+(vOpen ? '▾' : '▸') : '')+'</span><b style="color:#ffc2ea">🎟️ '+inside+' / '+cap
       + (cap < L.capacity ? ' <span style="opacity:.7">(max '+L.capacity+')</span>' : '')+'</b></div>';
    if(vOpen) h += voyageursLinesHtml(leisureVisitorLines(b), 'visiteur');
    if(cap < L.capacity)
      h += '<div class="warn">⚠️ Personnel incomplet : la capacité baisse au prorata des employés en poste.</div>';
    h += '<div class="row"><span>Entrée</span><b style="color:#ffe9a0">'+L.fee+' $ / visiteur</b></div>';
    h += '<div class="row"><span>Durée de visite</span><b>'+leisureDaysText(L.days)+' de jeu</b></div>';
    h += '<div class="row"><span>Visites / recettes</span><b>'+(b.visitsTotal || 0).toLocaleString('fr-FR')+' · '
       + Math.round(b.leisureIncome || 0).toLocaleString('fr-FR')+' $</b></div>';
    if(d.upkeep) h += '<div class="row"><span>Entretien</span><b>'+(Math.round(upkeepOf(b)*10)/10)+' $ / '+IND_UPKEEP_INTERVAL+' s</b></div>';
    const radius = leisureRadiusOf(b);
    const canEdit = !MP.connected || !b.owner || b.owner === MP.myId;
    h += '<div class="row"><span title="Les voyageurs sortant d\'un arrêt, d\'une gare, d\'un port ou d\'un aéroport situé dans ce rayon viennent ici">Rayon d\'attractivité</span>'
       + '<b style="color:#ff7ad9;display:flex;align-items:center;gap:6px">'
       + (canEdit ? '<button class="tbtn" style="padding:0 7px" onclick="adjustLeisureRadius('+b.x+','+b.y+',-2)" '+(radius <= LEISURE_RADIUS_MIN ? 'disabled' : '')+'>−</button>' : '')
       + radius + ' cases'
       + (canEdit ? '<button class="tbtn" style="padding:0 7px" onclick="adjustLeisureRadius('+b.x+','+b.y+',2)" '+(radius >= LEISURE_RADIUS_MAX ? 'disabled' : '')+'>+</button>' : '')
       + '</b></div>';
    if(!buildings.some(s => isTransitHub(s) && buildingDistance(s, b) <= radius))
      h += '<div class="warn">⚠️ Aucun arrêt de bus, gare, port ou aéroport dans le rayon d\'attractivité : aucun visiteur ne viendra.</div>';
    else
      h += '<div class="status" style="opacity:.8">Les voyageurs arrivés aux points de transit dans le rayon viennent ici avant de chercher un logement.</div>';
  }
  if(d.resid)
    h += homeOccupancyHtml(b);
  if(d.resid){
    const cls = residClassDef(b);
    h += '<div class="row"><span>Classe</span><b style="color:#f0d890">'+cls.icone+' '+escHtml(cls.pluriel)+'</b></div>';
  }
  if(d.lux){
    // palier suivant de la maison de luxe (agrandissement par absorption de maisons de luxe voisines)
    const next = luxNextLevelOf(b);
    if(next){
      const nc = RESIDENT_CLASSES[next.classe];
      h += '<div class="row"><span>Agrandissement</span><b>'+next.ic+' '+escHtml(next.n)+' — '
        + next.shapes[0][0]*next.shapes[0][1]+' cases, '+nc.icone+' '+escHtml(nc.pluriel.toLowerCase())+'</b></div>';
      if(!b.starterHome && luxReadyToExpand(b) && !luxExpansionRect(b))
        h += '<div class="warn">⚠️ Pour s\'agrandir, il faut poser des maisons de luxe collées à celle-ci : elle les absorbe et ne s\'étend jamais seule.</div>';
    } else {
      h += '<div class="row"><span>Agrandissement</span><b style="color:#9fe8a0">taille maximale atteinte</b></div>';
    }
  }
  if(d.resid){
    const town = getTownOf(b);
    if(town) h += '<div class="row"><span>Village</span><b style="color:#e8d48b">🏘️ '+escHtml(town.name)
      +'</b></div>';
  }
  if(d.resid && !b.starterHome){
    const pop = Math.max(1, b.pop);
    const priceSum = list => list.reduce((a,r)=>a+(RESID_PRICES[r]||0),0);
    const classMult = residClassDef(b).revenu;
    const reqIncome = Math.round(priceSum(residRequiredOf(b)) * pop * classMult);
    const maxIncome = Math.round((priceSum(residRequiredOf(b)) + priceSum(residBonusOf(b))) * pop * classMult);
    const ratePerMin = b.pop > 0 ? Math.round(reqIncome / d.resid.interval * 60) : 0;
    h += '<div class="row"><span>Revenu / cycle</span><b>'+reqIncome+(maxIncome>reqIncome ? ' à '+maxIncome : '')+' $</b></div>';
    h += '<div class="row"><span>Besoins indispensables</span><b>'+escHtml(resNames(residRequiredOf(b)))+'</b></div>';
    if(residBonusOf(b).length)
      h += '<div class="row"><span>Bonus</span><b style="color:#c7e7e9">'+escHtml(resNames(residBonusOf(b)))+' (revenu en plus si livré)</b></div>';
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
  const showStock = (k, opts={}) => {
    const hideQuant = !!opts.hideQuant;
    const cap = capOf(b,k), val = b.storage[k]||0;
    const ic = RES[k].ic ? '<span style="margin-right:4px">'+RES[k].ic+'</span>' : '';
    h += '<div class="row"><span>'+ic+RES[k].n+'</span><b>'+(hideQuant ? '' : (val+' / '+cap))+'</b></div>';
    h += '<div class="bar"><i style="width:'+Math.min(100,100*val/cap)+'%;background:'+RES[k].c+'"></i></div>';
  };
  if(d.ind && r2){
    // entrées (toujours affichées)
    if(inKeys.length) h += '<div style="margin-top:8px"></div>';
    inKeys.forEach(showStock);
    // recette
    const fmtRes = obj => Object.entries(obj).map(([k,v]) =>
      (v>1 ? '<span style="color:#8fa3bf;font-weight:normal">'+v+'×</span>' : '')
      + '<span class="res-ic" title="'+escHtml(RES[k].n + '\n\n' + resProductionInfo(k))+'">'+(RES[k].ic || RES[k].n)+'</span>'
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
    if(d.resid && !b.starterHome){
      const upgradeResources = residUpgradeResourcesOf(b);
      if(upgradeResources.length){
        h += '<div style="margin-top:8px;color:#8fa3bf">'+(d.lux ? 'Demande pour agrandissement' : 'Demande pour fusion')+'</div>';
        for(const r of upgradeResources){
          const paused = residUpgradePaused(b, r);
          h += '<div class="row"><span>'+(RES[r].ic ? RES[r].ic+' ' : '')+RES[r].n+'</span><b style="display:flex;align-items:center;gap:6px">'
            + '<span>'+residUpgradeProgressOf(b, r)+'/'+residUpgradeTargetOf(b, r)+'</span>'
            + (canControl && residUpgradeRemainingOf(b, r) > 0
              ? '<button class="tbtn" style="width:auto;min-width:30px;margin:0;padding:1px 8px;line-height:1.2'
                + (paused ? ';opacity:.7' : '')
                + '" data-upgrade-toggle="'+r+'" title="'+(paused ? 'Reprendre la demande' : 'Mettre en pause la demande')+'">'
                + (paused ? '▶' : '⏸')
                + '</button>'
              : (paused ? '<span style="color:#8fa3bf">pause</span>' : ''))
            + '</b></div>';
          h += '<div class="bar"><i style="width:'+Math.min(100, 100 * residUpgradeProgressOf(b, r) / Math.max(1, residUpgradeTargetOf(b, r)))+'%;background:'+RES[r].c+'"></i></div>';
        }
      }
    }
    const allKeys = d.resid
      ? [...new Set([
          ...residRequiredOf(b),
          ...residBonusOf(b),
          ...Object.keys(b.storage).filter(k=>b.storage[k]>0 || (b.inc[k]||0)>0),
        ])].filter(k => RES[k])
      : [...new Set([
          ...Object.keys(b.storage).filter(k=>b.storage[k]>0 || (b.inc[k]||0)>0),
        ])];
    if(allKeys.length){
      h += '<div style="margin-top:8px;color:#8fa3bf">Stocks</div>';
      allKeys.forEach(k => showStock(k, { hideQuant: !!d.resid }));
    }
  }
  if(isStorageDepot(b) && b.type !== 'market'){
    const myOid = MP.myId;
    const isOwner = !b.owner || b.owner === myOid;
    const depotRadius = BUILD[b.type]?.radiusOf ? BUILD[b.type].radiusOf(b) : depotRadiusOf(b);
    h += '<div style="color:#8fa3bf;font-size:10px;margin-bottom:6px">Rayon d\'action : <b style="color:#ffd700">'+depotRadius+' cases</b>'+(b.w*b.h>1?' · Taille <b>'+b.w+'×'+b.h+'</b>':'')+'</div>';
    if(isOwner){
      h += '<div style="color:#8fa3bf;font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px">📦 Ressources stockées'
         + ' <span style="text-transform:none;letter-spacing:0;color:#6e8aa0" title="Les matériaux de chantier stockés ici servent aux grands bâtiments construits dans le rayon de l’entrepôt.">· 🏗️ chantiers dans le rayon</span></div>';
      h += depotResPanel(b, 'allow');
    } else {
      h += '<div style="color:#8fa3bf;font-size:12px;font-style:italic">Appartient à un autre joueur.</div>';
    }
  }
  if(b.type==='market'){
    const myOid = MP.myId;
    const isOwner = !b.owner || b.owner === myOid;
    h += '<div style="color:#8fa3bf;font-size:10px;margin-bottom:6px">Rayon : <b style="color:#ffd700">'+depotRadiusOf(b)+' cases</b>'+(b.w*b.h>1?' · <b>'+b.w+'×'+b.h+'</b>':'')+'</div>';
    if(isOwner){
      // onglets : stock (ressources acceptées) / vente aux autres joueurs
      const nSell = Object.keys(RES).filter(k => b.sellTo?.[k]).length;
      h += '<div class="rtabs"><span class="rtab'+(marketTab === 'stock' ? ' on' : '')+'" data-market-tab="stock">📦 Stock</span>'
         + '<span class="rtab'+(marketTab === 'sell' ? ' on' : '')+'" data-market-tab="sell">🛒 Vente'+(nSell ? ' · '+nSell : '')+'</span></div>';
      if(marketTab === 'sell'){
        h += depotResPanel(b, 'sell');
        // seuils : stock conservé avant de vendre, pour chaque ressource en vente
        const selling = Object.keys(RES).filter(k => k !== 'water' && b.sellTo?.[k]);
        if(selling.length){
          h += '<div style="margin-top:8px;color:#f0c060;font-size:10px;text-transform:uppercase;letter-spacing:.06em">Stock minimum conservé</div><div class="rsell">';
          for(const k of selling)
            h += '<div class="rsell-row" title="'+escHtml(RES[k].n)+'"><span>'+RES[k].ic+'</span><span class="rsell-n">'+escHtml(RES[k].n)+'</span>'
               + '<span style="color:#f0c060">'+(TRADE_PRICES[k] || 0)+' $</span>'
               + '<button class="tbtn sell-min-dec" data-sell-min="'+k+'">−</button>'
               + '<b>'+(b.sellMin?.[k] || 0)+'</b>'
               + '<button class="tbtn sell-min-inc" data-sell-min="'+k+'">+</button></div>';
          h += '</div>';
        }
      } else {
        h += depotResPanel(b, 'allow');
      }
    } else {
      h += depotResPanel(b, 'readonly');
    }
  }
  if(b.type==='tank'){
    h += '<div class="row"><span>Rayon d\'action</span><b style="color:#64b7e8">'+tankRadiusOf(b)+' cases</b></div>';
    h += '<div class="row"><span>Stockage</span><b>Eau uniquement</b></div>';
  }
  if(b.type==='bus_stop'){
    const canRename = !b.owner || b.owner === (MP.myId ?? null);
    const town = getTownOf(b);
    if(town) h += '<div class="row"><span>Village</span><b style="color:#e8d48b">🏘️ '+escHtml(town.name)+'</b></div>';
    const linkedSt = transitHubLinkedRepresentative(b);
    if(linkedSt){
      // arrêt collé à une gare / un port / un aéroport : il partage ses compteurs (entrants et
      // sortants), affichés comme pour un arrêt seul
      const pE = Math.floor((linkedSt.passengersEntrant||0) + (linkedSt.passengersEntrantPending||0));
      const pS = Math.floor(linkedSt.passagersSortant||0);
      h += '<div class="row"><span>Point de transit lié</span><b style="color:#7dd8ff">🚉 '+escHtml(linkedSt.name || BUILD[linkedSt.type]?.n || '')+'</b></div>';
      h += '<div class="row" style="cursor:pointer" onclick="togglePassengerDetail(\'in\')" title="Cliquer : détail par joueur"><span>Passagers entrants</span><b style="color:#c8e040">🚶 '+pE+'</b></div>';
      h += passengerDetailBlock('in', linkedSt);
      h += '<div class="row" style="cursor:pointer" onclick="togglePassengerDetail(\'out\')" title="Cliquer : détail par joueur"><span>Passagers sortants</span><b style="color:#9fd4f0">🚶 '+pS+'</b></div>';
      h += passengerDetailBlock('out', linkedSt);
    } else {
      // même principe que les gares : passagers entrants (en attente) / sortants (arrivés)
      const pE = Math.floor(b.passengers||0), pS = Math.floor(b.passagersSortant||0);
      h += '<div class="row" style="cursor:pointer" onclick="togglePassengerDetail(\'in\')" title="Cliquer : détail par joueur"><span>Passagers entrants</span><b style="color:#c8e040">🚶 '+pE+'</b></div>';
      h += passengerDetailBlock('in', b, 'passengers');
      h += '<div class="row" style="cursor:pointer" onclick="togglePassengerDetail(\'out\')" title="Cliquer : détail par joueur"><span>Passagers sortants</span><b style="color:#9fd4f0">🚶 '+pS+'</b></div>';
      h += passengerDetailBlock('out', b);
    }
    h += '<div class="row"><span>Rayon</span><b>'+BUS_STOP_RADIUS+' cases</b></div>';
    h += '<div class="row"><span>Tarif</span><b style="color:#ffe9a0">'+BUS_FARE_FACTOR+' $/passager/tuile</b></div>';
    h += '<div class="row"><span>Intra-ville</span><b style="color:#a0c8e8">÷'+BUS_INTRA_CITY_DIV+' du tarif</b></div>';
    h += '<div class="row"><span>Arrêt partagé</span><b style="color:#a0c8e8">'+Math.round(BUS_OWNER_SHARE*100)+' % bus · '+Math.round((1-BUS_OWNER_SHARE)*100)+' % arrêts étrangers</b></div>';
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
  if(isAirPiece(b)){
    // Aéroport : état (gare + piste) et gare représentante qui porte les voyageurs.
    const g = airportOf(b);
    h += '<div style="margin-top:8px;color:#8fa3bf;font-size:11px;text-transform:uppercase;letter-spacing:.06em">✈️ Aéroport</div>';
    h += '<div class="row"><span>Gares</span><b>'+g.terminals.length+'</b></div>';
    h += '<div class="row"><span>Tour de contrôle</span><b style="color:'+(g.towers.length ? '#7dda5a' : '#ffb04d')+'">'+g.towers.length+'</b></div>';
    h += '<div class="row"><span>Piste alignée</span><b style="color:'+(g.longest >= AIR_RUNWAY_MIN ? '#7dda5a' : '#ffb04d')+'">'+g.longest+' / '+AIR_RUNWAY_MIN+' cases</b></div>';
    h += g.functional
      ? '<div class="status">✅ Aéroport fonctionnel : les avions peuvent desservir sa gare.</div>'
      : '<div class="warn">⚠️ Non fonctionnel : il faut au moins une gare, une tour de contrôle et '+AIR_RUNWAY_MIN+' cases de piste alignées.</div>';
    if(b.type === 'air_terminal' && g.rep && g.rep !== b)
      h += '<div style="color:#8fa3bf;font-size:11px">Cette gare est reliée à la gare principale de l\'aéroport.</div>';
  }
  if(b.type === 'boat_depot' || isActiveAirTerminal(b)){
    // Escale : voyageurs du voisinage (+ fret via l'entrepôt collé au port).
    const isPort = b.type === 'boat_depot';
    const pE = Math.floor(b.passengersEntrant || 0), pEMax = b.passengersEntrantMax || 0;
    h += '<div style="margin-top:8px;color:#8fa3bf;font-size:11px;text-transform:uppercase;letter-spacing:.06em">'+(isPort ? '⚓ Escale' : '🛫 Escale')+'</div>';
    h += '<div class="row" style="cursor:pointer" onclick="togglePassengerDetail(\'in\')" title="Cliquer : détail par joueur"><span>Passagers entrants</span><b style="color:#c8e040">🚶 '+pE+'</b></div>';
    h += passengerDetailBlock('in', b);
    h += '<div class="row" style="cursor:pointer" onclick="togglePassengerDetail(\'out\')" title="Cliquer : détail par joueur"><span>Passagers sortants</span><b style="color:#9fd4f0">🚶 '+Math.floor(b.passagersSortant || 0)+'</b></div>';
    h += passengerDetailBlock('out', b);
    h += '<div class="row"><span>Rayon</span><b>'+(isPort ? PORT_RADIUS : AIRPORT_RADIUS)+' cases</b></div>';
    h += '<div class="row"><span>Tarif</span><b style="color:#ffe9a0">'+(isPort ? SHIP_FARE_FACTOR : PLANE_FARE_FACTOR)+' $/voyageur/case</b></div>';
    if(isPort){
      if(!portFreightHub(b)) h += '<div class="warn">⚠️ Aucun entrepôt collé au port : les cargos ne peuvent ni charger ni décharger.</div>';
    }
    const termDepot = portFreightHub(b);
    if(termDepot) h += fusedDepotHtml(termDepot);
  }
  if(isVehicleDepot(b)){
    const bvehicles = b.vehicles || [];
    // Comme pour les trains : on n'affiche que les véhicules physiquement présents
    // au dépôt. Une fois sur la route, le véhicule disparaît de la liste du dépôt.
    const shownVehicles = bvehicles.filter(vehiclePresentAtDepot);
    const buyCatalog = Array.isArray(BUILD[b.type]?.buyCatalog)
      ? BUILD[b.type].buyCatalog
      : (b.type === 'garage'
          ? Object.keys(VEHICLE_TYPES).filter(k => !VEHICLE_TYPES[k].buyDisabled && k !== 'train')
          : []);
    h += '<div class="row"><span>Véhicules</span><b>'+shownVehicles.length+'</b></div>';
    if(b.type === 'plane_depot'){
      const f = hangarFleet(b);
      h += '<div class="row"><span>Avions (hangars de l\'aéroport)</span><b style="color:'+(f.planes >= f.capacity ? '#ffb04d' : '#7dda5a')+'">'+f.planes+' / '+f.capacity+' · '+f.hangars+' hangar'+(f.hangars > 1 ? 's' : '')+'</b></div>';
    }
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
      } else if(VEHICLE_TYPES[rmVeh?.vtype]?.mode === 'water' || VEHICLE_TYPES[rmVeh?.vtype]?.mode === 'air'){
        const isShip = VEHICLE_TYPES[rmVeh.vtype].mode === 'water';
        h += '<div class="warn" style="background:#0e1e30;border-color:#3a6f9c;color:#7dd8ff">'
           + (isShip ? '⚓ Clique sur le PORT ' : '🛫 Clique sur l\'AÉROPORT ') + (step==='source' ? 'de départ' : 'd\'arrivée')
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
      const trainCarHtml = (icon, sub, isLoco, sell) =>
          '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:34px;flex:0 0 auto;line-height:1.1">'
        +   '<div style="font-size:15px">'+icon+'</div>'
        +   '<div style="font-size:8px;color:#8fa3bf">'+sub+'</div>'
        +   (sell ? '<button class="tbtn" data-sell-wagon="'+sell.vid+':'+sell.idx+'" title="Vendre ce wagon (+'+sell.refund.toLocaleString('fr-FR')+' $)"'+(sell.ok ? '' : ' disabled')
              + ' style="padding:0 3px;margin:1px 0 0;font-size:9px;line-height:1.3;width:auto;border:none;background:transparent;color:#ff9a8a;cursor:pointer">🗑️</button>' : '')
        + '</div>';
      for(const v of shownVehicles){
        const vt = VEHICLE_TYPES[v.vtype];
        if(!vt) continue;
        if(v.vtype === 'train' && !v.name) assignTrainVehicleName(v);
        const srcName = v.source && !v.source.dead ? trainStopLabel(v.source) : '—';
        const dstName = v.dest   && !v.dest.dead   ? trainStopLabel(v.dest)  : '—';
        const canStart = v.vtype === 'train' && (v.orders?.length || 0) >= 2;
        const trainFlag = ((v.vtype === 'train' && canStart) || (v.vtype !== 'train' && vehiclePresentAtDepot(v) && v.source && v.dest))
          ? trainDepotFlagButtonHtml(v) : '';
        const vehName = v.vtype === 'train' ? (v.name || 'Train') : vt.nom;

        h += '<div style="padding:5px 6px;margin-bottom:4px;border:1px solid #2a3a50;border-radius:4px;background:#0f1820;font-size:11px">';
        const canControlVehicle = !MP.connected || !v.garageRef?.owner || v.garageRef.owner === MP.myId;

        const cfgBtns =
            '<button class="tbtn" style="padding:2px 3px;margin:0;font-size:11px;width:auto;border:none;background:transparent;color:#8fa3bf;cursor:pointer" data-route-v="'+v.id+'" title="Configurer"'+(canControlVehicle?'':' disabled')+'>'+(v.vtype === 'train' ? '🧭' : '🔁')+'</button>'
          + '<button class="tbtn" style="padding:2px 3px;margin:0;font-size:11px;width:auto;border:none;background:transparent;color:#ff9a8a;cursor:pointer" data-sell-v="'+v.id+'" title="Vendre"'+(canControlVehicle?'':' disabled')+'>🗑️</button>';

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
            h += trainCarHtml(icon, load.amt+'/'+load.cap, false, { vid:v.id, idx, ok:canControlVehicle, refund:Math.floor(TRAIN_WAGON_COST * 0.5) });
          }
          h += '</div>';
          h += '<div style="flex:1"></div>';
          h += '<input data-vehname-v="'+v.id+'" value="'+escHtml(vehName)+'" spellcheck="false" title="Renommer le train" style="font-weight:bold;flex:0 1 auto;width:120px;text-align:right;background:transparent;border:none;border-bottom:1px solid #2a3a50;color:#e6edf5;font-size:11px;padding:2px 2px"'
            + (canControlVehicle ? '' : ' readonly disabled') + '>';
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
             + (trainFlag ? trainFlag.replace(/style="/g,'style="font-size:11px;padding:2px 3px;margin:0 0 0 4px;') : '')
             + '</div>';
          // Choix de la ressource transportée (camions pouvant en porter plusieurs)
          if(vt.resources.length > 1){
            const opts = '<option value=""'+(!v.pinnedRes?' selected':'')+'>Auto (toutes)</option>'
              + vt.resources.map(r=>'<option value="'+r+'"'+(v.pinnedRes===r?' selected':'')+'>'
                  +(RES[r]?.ic ? RES[r].ic+' ' : '')+(RES[r]?.n||r)+'</option>').join('');
            h += '<div style="display:flex;align-items:center;gap:5px;margin-top:3px">'
               + '<span style="color:#8fa3bf;font-size:10px;flex:0 0 auto">Ressource</span>'
               + '<select data-pin-v="'+v.id+'" title="Choisir la ressource transportée par ce camion" '
               + (canControlVehicle ? '' : ' disabled')
               + 'style="flex:1;background:#0f1820;color:#e6edf5;border:1px solid #2a3a50;border-radius:3px;font-size:10px;padding:2px">'
               + opts + '</select>'
               + '</div>';
          }
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
        // avion cargo : grisé tant que l'aéroport n'a pas d'entrepôt (la raison est dans l'info-bulle)
        const cargoErr = vk === 'cargo_plane' ? planePurchaseError(b, vk) : null;
        h += '<button class="tbtn" style="width:100%;text-align:left;margin-top:2px'+(cargoErr?';opacity:.55':'')+'" data-buy-v="'+vk+'"'+(canControl?'':' disabled')+(cargoErr?' title="'+escHtml(cargoErr)+'"':'')+'>'
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
      : b.type === 'space_center' ? [] : allOuts; // la capsule rapporte toute sa cargaison
    if(blockableOuts.length){
      h += '<div style="margin-top:8px;color:#8fa3bf;font-size:11px">Production</div>';
      for(const k of blockableOuts){
        const blocked = !!(b.blockedOut?.[k]);
        h += '<button class="tbtn bld-toggle-out'+(blocked?' bld-blocked':'')+'" data-out="'+k+'" '
           + (canControl ? '' : ' disabled')
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
      toast('🏭 Usine créée : '+targetDef.n, 'win', eventTargetForBuilding(b));
    };
  });
  p.querySelectorAll('[data-station-depot-toggle-res]').forEach(el=>{
    el.onclick = ()=>{
      const depot = isTrainStationPiece(b) ? trainStationLinkedDepot(b) : portFreightHub(b);
      if(!depot || !depot.allow) return;
      if(MP.connected && depot.owner && depot.owner !== MP.myId){
        toast('⛔ Ce dépôt appartient à un autre joueur','err');
        return;
      }
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
      if(MP.connected) netSend({ type:'set_depot_resource', x:depot.x, y:depot.y, res:k, allowed:depot.allow[k] !== false, trainAllowed:depot.trainAllow[k] !== false });
      p._html = null;
    };
  });
  p.querySelectorAll('[data-toggle-res]').forEach(el=>{
    el.onclick = ()=>{
      if(MP.connected && b.owner && b.owner !== MP.myId){
        toast('⛔ Ce bâtiment appartient à un autre joueur','err');
        return;
      }
      if(!b.allow) b.allow = {};
      b.allow[el.dataset.toggleRes] = b.allow[el.dataset.toggleRes] === false ? undefined : false;
      if(MP.connected) netSend({ type:'set_depot_resource', x:b.x, y:b.y, res:el.dataset.toggleRes, allowed:b.allow[el.dataset.toggleRes] !== false });
      p._html = null;
    };
  });
  // grille compacte : filtre Toutes / Actives, onglets du marché, famille entière
  p.querySelectorAll('[data-res-view]').forEach(el=>{ el.onclick = ()=> setDepotResView(el.dataset.resView); });
  p.querySelectorAll('[data-market-tab]').forEach(el=>{
    el.onclick = ()=>{ marketTab = el.dataset.marketTab === 'sell' ? 'sell' : 'stock'; p._html = null; renderInfo(); };
  });
  p.querySelectorAll('[data-res-bulk]').forEach(el=>{
    el.onclick = ()=>{
      const mode = el.dataset.bulkMode;
      const depot = mode === 'station' ? (isTrainStationPiece(b) ? trainStationLinkedDepot(b) : portFreightHub(b)) : b;
      if(!depot) return;
      if(MP.connected && depot.owner && depot.owner !== MP.myId){
        toast('⛔ Ce bâtiment appartient à un autre joueur','err');
        return;
      }
      const keys = resKeysByCategory(k => k !== 'water').find(c => c.key === el.dataset.resBulk)?.keys || [];
      if(!keys.length) return;
      if(mode === 'sell'){
        if(!depot.sellTo) depot.sellTo = {};
        const allOn = keys.every(k => depot.sellTo[k]);
        for(const k of keys) depot.sellTo[k] = !allOn;
      } else if(mode === 'station'){
        // toute la famille passe à l'état suivant de la moins avancée : refusée → acceptée → + trains → refusée
        if(!depot.allow) depot.allow = {};
        if(!depot.trainAllow) depot.trainAllow = {};
        const minState = Math.min(...keys.map(k => depotResState(depot, k, true)));
        const next = minState === 0 ? 1 : minState === 1 ? 2 : 0;
        for(const k of keys){
          if(next === 0) depot.allow[k] = false;
          else { depot.allow[k] = undefined; depot.trainAllow[k] = next === 2 ? undefined : false; }
          if(MP.connected) netSend({ type:'set_depot_resource', x:depot.x, y:depot.y, res:k, allowed:depot.allow[k] !== false, trainAllowed:depot.trainAllow[k] !== false });
        }
      } else {
        if(!depot.allow) depot.allow = {};
        const allOn = keys.every(k => depot.allow[k] !== false);
        for(const k of keys){
          depot.allow[k] = allOn ? false : undefined;
          if(MP.connected) netSend({ type:'set_depot_resource', x:depot.x, y:depot.y, res:k, allowed:!allOn });
        }
      }
      p._html = null;
    };
  });
  p.querySelectorAll('.sell-toggle').forEach(el=>{
    el.onclick = ()=>{
      if(MP.connected && b.owner && b.owner !== MP.myId){
        toast('⛔ Ce bâtiment appartient à un autre joueur','err');
        return;
      }
      if(!b.sellTo) b.sellTo = {};
      b.sellTo[el.dataset.sell] = !b.sellTo[el.dataset.sell];
      p._html = null;
    };
  });
  p.querySelectorAll('.sell-min-dec').forEach(btn=>{
    btn.onclick = ()=>{
      if(MP.connected && b.owner && b.owner !== MP.myId){
        toast('⛔ Ce bâtiment appartient à un autre joueur','err');
        return;
      }
      if(!b.sellMin) b.sellMin = {};
      const k = btn.dataset.sellMin;
      b.sellMin[k] = Math.max(0, (b.sellMin[k]||0) - 10);
      p._html = null;
    };
  });
  p.querySelectorAll('.sell-min-inc').forEach(btn=>{
    btn.onclick = ()=>{
      if(MP.connected && b.owner && b.owner !== MP.myId){
        toast('⛔ Ce bâtiment appartient à un autre joueur','err');
        return;
      }
      if(!b.sellMin) b.sellMin = {};
      const k = btn.dataset.sellMin;
      b.sellMin[k] = (b.sellMin[k]||0) + 10;
      p._html = null;
    };
  });
  if(isVehicleDepot(b)){
    p.querySelectorAll('[data-route-v]').forEach(btn=>{
      btn.onclick = ()=>{
        const vid = btn.dataset.routeV;
        const v = vehicles.find(vv=>String(vv.id)===vid);
        if(!v) return;
        if(MP.connected && v.garageRef?.owner && v.garageRef.owner !== MP.myId){
          toast('⛔ Ce véhicule appartient à un autre joueur.','err');
          return;
        }
        if(v.vtype === 'train'){
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
      const vid = inp.dataset.vehnameV;
      const v = vehicles.find(vv=>String(vv.id)===vid);
      if(!v) return;
      const saveName = ()=>{
        const newName = inp.value.trim();
        if(newName === (v.name||'')) return;
        if(MP.connected && v.garageRef?.owner && v.garageRef.owner !== MP.myId){
          inp.value = v.name || '';
          return;
        }
        v.name = newName || null;
        if(!v.name && v.vtype === 'train') assignTrainVehicleName(v);
        p._html = null;
      };
      inp.onkeydown = e => { if(e.key === 'Enter') inp.blur(); };
      inp.onblur = saveName;
    });
    // vente d'un wagon précis du train, au dépôt (50 % du prix, comme le bouton − du panneau train)
    p.querySelectorAll('[data-sell-wagon]').forEach(btn=>{
      btn.onclick = e=>{
        e.stopPropagation();
        const [vid, idxS] = btn.dataset.sellWagon.split(':');
        const v = vehicles.find(vv=>String(vv.id)===vid);
        if(!v || v.vtype !== 'train') return;
        if(MP.connected && v.garageRef?.owner && v.garageRef.owner !== MP.myId){
          toast('⛔ Ce train appartient à un autre joueur.','err');
          return;
        }
        if(!trainPresentAtDepot(v)){ toast('⛔ Le train doit être au dépôt pour vendre un wagon.','err'); return; }
        const wagons = trainNormalizeWagons(v), idx = +idxS;
        if(!wagons[idx]) return;
        wagons.splice(idx, 1);
        const refund = Math.floor(TRAIN_WAGON_COST * 0.5);
        earnMoney(refund, 'rembours');
        syncTrainConfig(v);
        toast('🗑️ Wagon vendu (+'+refund.toLocaleString('fr-FR')+' $)');
        p._html = null;
        if(typeof renderTrainPanel === 'function' && trainConfigVehicle === v) renderTrainPanel();
        renderInfo();
      };
    });
    p.querySelectorAll('[data-sell-v]').forEach(btn=>{
      btn.onclick = ()=>{
        const vid = btn.dataset.sellV;
        const v = vehicles.find(vv=>String(vv.id)===vid);
        if(!v) return;
        if(MP.connected && v.garageRef?.owner && v.garageRef.owner !== MP.myId){
          toast('⛔ Ce véhicule appartient à un autre joueur.','err');
          return;
        }
        const refund = vehicleResaleValue(v);
        earnMoney(refund, 'rembours');
        removePersistentVehicle(v);
        if(MP.connected) netSend({ type:'sell_vehicle', id:v.id });
        toast('🗑️ Véhicule vendu (+'+refund+' $)');
        p._html = null;
      };
    });
    p.querySelectorAll('[data-train-flag]').forEach(btn=>{
      btn.onclick = ()=>{
        const vid = btn.dataset.trainFlag;
        const v = vehicles.find(vv=>String(vv.id)===vid);
        if(!v) return;
        handleTrainDepotFlagClick(v);
        p._html = null;
      };
    });
    p.querySelectorAll('select[data-pin-v]').forEach(sel=>{
      sel.onchange = ()=>{
        const vid = sel.dataset.pinV;
        const v = vehicles.find(vv=>String(vv.id)===vid);
        if(!v) return;
        if(MP.connected && v.garageRef?.owner && v.garageRef.owner !== MP.myId){
          sel.value = v.pinnedRes || '';
          return;
        }
        v.pinnedRes = sel.value || null;
        // changer la ressource en cours de transport : déposer/oublier le chargement non conforme
        if(v.pinnedRes && v.res && v.res !== v.pinnedRes){ v.cargo = 0; v.res = null; }
        if(MP.connected) netSend({ type:'pin_vehicle_res', id:v.id, res:v.pinnedRes });
        p._html = null;
      };
    });
    p.querySelectorAll('[data-buy-v]').forEach(btn=>{
      btn.onclick = ()=>{
        const vtype = btn.dataset.buyV;
        const vt = VEHICLE_TYPES[vtype];
        if(!vt) return;
        if(MP.connected && b.owner && b.owner !== MP.myId){
          toast('⛔ Ce dépôt appartient à un autre joueur.','err');
          return;
        }
        const planeErr = planePurchaseError(b, vtype);
        if(planeErr){ toast('⛔ '+planeErr,'err'); return; }
        if(myWallet().money < vt.cost){ toast('Fonds insuffisants ('+vt.cost+' $)','err'); return; }
        spendMoney(vt.cost, 'construction');
        const v = createPersistentVehicle(vtype, b);
        if(MP.connected){
          // Les IDs de véhicule transitent en CHAÎNE côté serveur/hôte (le
          // serveur valide via validName() qui exige une string, et stocke
          // String(act.id)). Un id numérique frais fait rejeter l'achat par le
          // serveur — l'hôte ne crée jamais le véhicule. On aligne donc l'id
          // optimiste sur la convention chaîne dès la création, pour que CET
          // achat et toutes les actions ultérieures (route, drapeau…) passent.
          v.id = String(v.id);
          // Achat optimiste : l'hôte est autoritatif. On marque le véhicule en
          // attente de confirmation pour qu'il soit élagué (cf. applyStateSync)
          // si l'hôte ne le reconnaît jamais.
          v.mpPendingAck = true;
          v.mpCreatedRealTime = performance.now();
          netSend({ type:'buy_vehicle', id:v.id, vtype, garageX:b.x, garageY:b.y });
        }
        toast(vt.icone+' '+vt.nom+' acheté ! Définis sa route avec 🔁 Route.','win', eventTargetForVehicle(v));
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
  p.querySelectorAll('[data-upgrade-toggle]').forEach(btn=>{
    btn.onclick = ()=>{
      if(MP.connected && b.owner && b.owner !== MP.myId){ toast('⛔ Bâtiment d\'un autre joueur','err'); return; }
      normalizeResidentialUpgradeState(b);
      const r = btn.dataset.upgradeToggle;
      if(!residUpgradeTargetOf(b, r) || residUpgradeRemainingOf(b, r) <= 0) return;
      b.upgradePaused[r] = !b.upgradePaused[r];
      if(MP.connected) netSend({ type:'toggle_resid_upgrade_pause', x:b.x, y:b.y, res:r, paused:!!b.upgradePaused[r] });
      p._html = null;
      renderInfo();
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
    if(MP.connected && b.owner && b.owner !== MP.myId){
      toast('⛔ Ce bâtiment appartient à un autre joueur','err');
      return;
    }
    b.name = newName || null;
    if(MP.connected) netSend({ type:'rename_bus_stop', x:b.x, y:b.y, name: b.name });
    p._html = null;
    toast('🚏 Arrêt renommé : '+(b.name || '(sans nom)'));
  };
  $('bDemol').onclick = ()=>{
    if(MP.connected && b.owner && b.owner !== MP.myId){
      if(mpIsWorldOwner()) demolishForeignBuilding(b); // propriétaire du monde : avec confirmation
      else toast('⛔ Ce bâtiment appartient à un autre joueur','err');
      return;
    }
    if(depotHasStoredVehicles(b)){
      toast('⛔ Impossible de détruire ce dépôt tant que des véhicules sont à l’intérieur.','err');
      return;
    }
    const doDemolish = () => {
      if(b.dead) return;
      if(MP.connected) netSend({ type:'bulldoze_bld', bx:b.x, by:b.y });
      demolishBuilding(b, b.owner);
      selected = null;
    };
    const nUsing = vehiclesUsingBuilding(b).length;
    if(nUsing > 0){
      confirmAction(nUsing+' véhicule(s) utilisent ce bâtiment dans une route. Si vous le détruisez, ils retourneront tous au dépôt.',
        { title:'Détruire ce bâtiment ?', okText:'Détruire', danger:true }).then(ok => { if(ok) doDemolish(); });
      return;
    }
    doDemolish();
  };
}

// ---------- toasts ----------
function toast(msg, cls, target){
  if(target) pushGameEvent(msg, target, cls);
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
  cancel.style.display = options.hideCancel ? 'none' : '';
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
let resourceToolbarGroup = null;
let resourceToolbarMenu = null;
const RESOURCE_TOOLBAR_TOOLS = ['mine','lumber','fisher','pump','oil_well'];
let airportToolbarGroup = null;
let airportToolbarMenu = null;
const AIRPORT_TOOLBAR_TOOLS = ['air_terminal','air_runway','air_taxi','air_parking','air_tower','air_deco'];
let storageToolbarGroup = null;
let storageToolbarMenu = null;
const STORAGE_TOOLBAR_TOOLS = ['depot','tank'];
let buildingToolbarGroup = null;
let buildingToolbarMenu = null;
const BUILDING_TOOLBAR_TOOLS = ['house','lux_house','plant','market','space_center'];
let leisureToolbarGroup = null;
let leisureToolbarMenu = null;
// Infobulle d'un outil : description + matériaux de chantier exigés (entrepôt proche).
function toolTitle(k){
  const d = BUILD[k];
  if(!d) return '';
  const mats = k === 'train_station'
    ? [['Gare', buildMaterialsFor('train_station')], ['Quai', buildMaterialsFor('train_platform')]].filter(e => e[1])
    : (buildMaterialsFor(k) ? [['', buildMaterialsFor(k)]] : []);
  if(!mats.length) return d.desc || '';
  return (d.desc || '') + '\n\n🏗️ Matériaux de chantier (dans un entrepôt dont le rayon couvre le chantier) :\n'
    + mats.map(([lbl, m]) => (lbl ? lbl + ' : ' : '') + resAmountsText(m)).join('\n');
}
// Prix affiché dans la barre d'outils (🏗️ : matériaux de chantier en plus).
function toolCostLabel(k, unit = ' $'){
  const d = BUILD[k];
  if(!d?.cost) return '&nbsp;';
  return d.cost + unit + (buildMaterialsFor(k) ? ' 🏗️' : '');
}
let vehicleToolbarGroup = null;
let vehicleToolbarMenu = null;
const VEHICLE_TOOLBAR_TOOLS = ['road','bus_stop'];
let terraformToolbarGroup = null;
let terraformToolbarMenu = null;
const TERRAFORM_TOOLBAR_TOOLS = ['terraform_dig','terraform_raise','terraform_canal'];

function closeResourceToolbarMenu(){
  if(!resourceToolbarGroup || !resourceToolbarMenu) return;
  resourceToolbarGroup.classList.remove('open');
  resourceToolbarMenu.classList.remove('open');
  syncToolbarState();
}

function closeAirportToolbarMenu(){
  if(!airportToolbarGroup || !airportToolbarMenu) return;
  airportToolbarGroup.classList.remove('open');
  airportToolbarMenu.classList.remove('open');
  syncToolbarState();
}

function closeStorageToolbarMenu(){
  if(!storageToolbarGroup || !storageToolbarMenu) return;
  storageToolbarGroup.classList.remove('open');
  storageToolbarMenu.classList.remove('open');
  syncToolbarState();
}

// Choix « maison basique / maison de luxe » du menu Bâtiments : l'entrée luxe
// apparaît quand le joueur franchit LUX_UNLOCK_POP habitants (déblocage définitif).
// L'annonce n'est faite qu'en cours de partie, pas au chargement d'une sauvegarde
// déjà débloquée (saut de gtime).
let luxeToolbarUnlocked = null, luxeToolbarGtime = 0;
function syncLuxeToolbar(){
  if(!buildingToolbarMenu) return;
  const unlocked = luxuryUnlocked(myOwner());
  const continuous = Math.abs((gtime || 0) - luxeToolbarGtime) < 5;
  luxeToolbarGtime = gtime || 0;
  if(unlocked === luxeToolbarUnlocked) return;
  const announce = unlocked && luxeToolbarUnlocked === false && continuous;
  luxeToolbarUnlocked = unlocked;
  const lux = buildingToolbarMenu.querySelector('[data-building-tool="lux_house"]');
  if(lux) lux.style.display = unlocked ? '' : 'none';
  const basic = buildingToolbarMenu.querySelector('[data-building-tool="house"] .bld-name');
  if(basic) basic.textContent = unlocked ? 'Maison basique' : BUILD.house.n;
  if(!unlocked && tool === 'lux_house') setTool('select');
  if(announce) toast('💎 '+LUX_UNLOCK_POP+' habitants : les maisons de luxe sont disponibles (menu Bâtiments) !', 'win');
}

function closeBuildingToolbarMenu(){
  if(!buildingToolbarGroup || !buildingToolbarMenu) return;
  buildingToolbarGroup.classList.remove('open');
  buildingToolbarMenu.classList.remove('open');
  syncToolbarState();
}

function closeLeisureToolbarMenu(){
  if(!leisureToolbarGroup || !leisureToolbarMenu) return;
  leisureToolbarGroup.classList.remove('open');
  leisureToolbarMenu.classList.remove('open');
  syncToolbarState();
}

function closeVehicleToolbarMenu(){
  if(!vehicleToolbarGroup || !vehicleToolbarMenu) return;
  vehicleToolbarGroup.classList.remove('open');
  vehicleToolbarMenu.classList.remove('open');
  syncToolbarState();
}

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

function closeTerraformToolbarMenu(){
  if(!terraformToolbarGroup || !terraformToolbarMenu) return;
  terraformToolbarGroup.classList.remove('open');
  terraformToolbarMenu.classList.remove('open');
  syncToolbarState();
}

function closeToolbarMenus(){
  closeDepotToolbarMenu();
  closeTrainToolbarMenu();
  closeResourceToolbarMenu();
  closeStorageToolbarMenu();
  closeAirportToolbarMenu();
  closeBuildingToolbarMenu();
  closeLeisureToolbarMenu();
  closeVehicleToolbarMenu();
  closeTerraformToolbarMenu();
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
    const active = ['rail','rail_signal','rail_signal2','train_station','tunnel'].includes(tool);
    trainToolbarGroup.classList.toggle('on', active);
    const groupBtn = trainToolbarGroup.querySelector('.tool-group-btn');
    if(groupBtn) groupBtn.classList.toggle('on', active || trainToolbarGroup.classList.contains('open'));
  }
  if(trainToolbarMenu){
    trainToolbarMenu.querySelectorAll('[data-train-tool]').forEach(b=>{
      b.classList.toggle('on', b.dataset.trainTool === tool);
    });
  }
  if(resourceToolbarGroup){
    const active = RESOURCE_TOOLBAR_TOOLS.includes(tool);
    resourceToolbarGroup.classList.toggle('on', active);
    const groupBtn = resourceToolbarGroup.querySelector('.tool-group-btn');
    if(groupBtn) groupBtn.classList.toggle('on', active || resourceToolbarGroup.classList.contains('open'));
  }
  if(resourceToolbarMenu){
    resourceToolbarMenu.querySelectorAll('[data-resource-tool]').forEach(b=>{
      b.classList.toggle('on', b.dataset.resourceTool === tool);
    });
  }
  if(airportToolbarGroup){
    const active = AIRPORT_TOOLBAR_TOOLS.includes(tool);
    airportToolbarGroup.classList.toggle('on', active);
    const groupBtn = airportToolbarGroup.querySelector('.tool-group-btn');
    if(groupBtn) groupBtn.classList.toggle('on', active || airportToolbarGroup.classList.contains('open'));
  }
  if(airportToolbarMenu){
    airportToolbarMenu.querySelectorAll('[data-airport-tool]').forEach(b=>{
      b.classList.toggle('on', b.dataset.airportTool === tool);
    });
  }
  if(storageToolbarGroup){
    const active = STORAGE_TOOLBAR_TOOLS.includes(tool);
    storageToolbarGroup.classList.toggle('on', active);
    const groupBtn = storageToolbarGroup.querySelector('.tool-group-btn');
    if(groupBtn) groupBtn.classList.toggle('on', active || storageToolbarGroup.classList.contains('open'));
  }
  if(storageToolbarMenu){
    storageToolbarMenu.querySelectorAll('[data-storage-tool]').forEach(b=>{
      b.classList.toggle('on', b.dataset.storageTool === tool);
    });
  }
  if(buildingToolbarGroup){
    const active = BUILDING_TOOLBAR_TOOLS.includes(tool);
    buildingToolbarGroup.classList.toggle('on', active);
    const groupBtn = buildingToolbarGroup.querySelector('.tool-group-btn');
    if(groupBtn) groupBtn.classList.toggle('on', active || buildingToolbarGroup.classList.contains('open'));
  }
  if(buildingToolbarMenu){
    buildingToolbarMenu.querySelectorAll('[data-building-tool]').forEach(b=>{
      b.classList.toggle('on', b.dataset.buildingTool === tool);
    });
  }
  if(leisureToolbarGroup){
    const active = LEISURE_TYPES.includes(tool);
    leisureToolbarGroup.classList.toggle('on', active);
    const groupBtn = leisureToolbarGroup.querySelector('.tool-group-btn');
    if(groupBtn) groupBtn.classList.toggle('on', active || leisureToolbarGroup.classList.contains('open'));
  }
  if(leisureToolbarMenu){
    leisureToolbarMenu.querySelectorAll('[data-leisure-tool]').forEach(b=>{
      b.classList.toggle('on', b.dataset.leisureTool === tool);
    });
  }
  if(vehicleToolbarGroup){
    const active = VEHICLE_TOOLBAR_TOOLS.includes(tool);
    vehicleToolbarGroup.classList.toggle('on', active);
    const groupBtn = vehicleToolbarGroup.querySelector('.tool-group-btn');
    if(groupBtn) groupBtn.classList.toggle('on', active || vehicleToolbarGroup.classList.contains('open'));
  }
  if(vehicleToolbarMenu){
    vehicleToolbarMenu.querySelectorAll('[data-vehicle-tool]').forEach(b=>{
      b.classList.toggle('on', b.dataset.vehicleTool === tool);
    });
  }
  if(terraformToolbarGroup){
    const active = TERRAFORM_TOOLBAR_TOOLS.includes(tool);
    terraformToolbarGroup.classList.toggle('on', active);
    const groupBtn = terraformToolbarGroup.querySelector('.tool-group-btn');
    if(groupBtn) groupBtn.classList.toggle('on', active || terraformToolbarGroup.classList.contains('open'));
  }
  if(terraformToolbarMenu){
    terraformToolbarMenu.querySelectorAll('[data-terraform-tool]').forEach(b=>{
      b.classList.toggle('on', b.dataset.terraformTool === tool);
    });
    terraformToolbarMenu.querySelectorAll('[data-terraform-radius]').forEach(b=>{
      b.classList.toggle('on', +b.dataset.terraformRadius === terraformRadius);
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
  resourceToolbarGroup = null;
  resourceToolbarMenu = null;
  storageToolbarGroup = null;
  storageToolbarMenu = null;
  airportToolbarGroup = null;
  airportToolbarMenu = null;
  buildingToolbarGroup = null;
  buildingToolbarMenu = null;
  leisureToolbarGroup = null;
  leisureToolbarMenu = null;
  vehicleToolbarGroup = null;
  vehicleToolbarMenu = null;
  terraformToolbarGroup = null;
  terraformToolbarMenu = null;
  const depotItems = (DEPOT_TOOLBAR_ITEMS && DEPOT_TOOLBAR_ITEMS.length)
    ? DEPOT_TOOLBAR_ITEMS
    : [
        { key:'vehicules', tool:'garage', label:'Véhicules', icon:'🚛' },
        { key:'train', tool:'train_depot', label:'Train', icon:'🚂' },
        { key:'bateau', tool:'boat_depot', label:'Port', icon:'⚓' },
        { key:'avion', tool:'plane_depot', label:'Aéroport', icon:'✈️' },
      ];
  for(const k of TOOL_ORDER){
    if(k === 'bus_stop') continue; // regroupé sous "Véhicules"
    if(k === 'road'){
      const group = document.createElement('div');
      group.className = 'tool-group';
      const btn = document.createElement('button');
      btn.className = 'tool tool-group-btn';
      btn.dataset.t = 'road';
      btn.title = 'Véhicules';
      btn.innerHTML = '<span class="ic">🛣️</span><span>Véhicules</span><span class="hk">▾</span>';
      const menu = document.createElement('div');
      menu.className = 'tool-group-menu';
      for(const toolKey of VEHICLE_TOOLBAR_TOOLS){
        const d = BUILD[toolKey];
        if(!d) continue;
        const choice = document.createElement('button');
        choice.className = 'tool tool-group-item';
        choice.dataset.vehicleTool = toolKey;
        choice.title = toolTitle(toolKey);
        choice.innerHTML = '<span class="ic">'+d.ic+'</span><span>'+d.n+'</span>'
          + '<span class="cost">'+toolCostLabel(toolKey)+'</span>';
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
      vehicleToolbarGroup = group;
      vehicleToolbarMenu = menu;
      continue;
    }
    if(k === 'lumber' || k === 'fisher' || k === 'pump' || k === 'oil_well') continue; // regroupés sous "Ressources"
    if(k === 'tank') continue; // regroupé sous "Stockage"
    if(k === 'house' || k === 'market' || k === 'space_center') continue; // regroupés sous "Bâtiments"
    if(k === 'terraform_raise' || k === 'terraform_canal') continue; // regroupés sous "Terraforming"
    if(k === 'terraform_dig'){
      const group = document.createElement('div');
      group.className = 'tool-group';
      const btn = document.createElement('button');
      btn.className = 'tool tool-group-btn';
      btn.dataset.t = 'terraform_dig';
      btn.title = 'Terraforming';
      btn.innerHTML = '<span class="ic">⛰️</span><span>Terraforming</span><span class="hk">▾</span>';
      const menu = document.createElement('div');
      menu.className = 'tool-group-menu';
      for(const toolKey of TERRAFORM_TOOLBAR_TOOLS){
        const d = BUILD[toolKey];
        if(!d) continue;
        const choice = document.createElement('button');
        choice.className = 'tool tool-group-item';
        choice.dataset.terraformTool = toolKey;
        choice.title = toolTitle(toolKey);
        choice.innerHTML = '<span class="ic">'+d.ic+'</span><span>'+d.n+'</span>'
          + '<span class="cost">'+(d.cost ? d.cost+' $/tuile' : '&nbsp;')+'</span>';
        choice.onclick = e => { e.stopPropagation(); setTool(toolKey); };
        menu.appendChild(choice);
      }
      const radiusRow = document.createElement('div');
      radiusRow.style.cssText = 'display:flex;gap:4px;margin-top:4px';
      for(let r = 1; r <= 4; r++){
        const rBtn = document.createElement('button');
        rBtn.className = 'tool tool-group-item';
        rBtn.dataset.terraformRadius = String(r);
        rBtn.title = 'Zone d\'effet '+r+'×'+r;
        rBtn.style.cssText = 'width:auto;flex:1;padding:5px 2px;text-align:center;align-items:center';
        rBtn.textContent = r+'×'+r;
        rBtn.onclick = e => { e.stopPropagation(); terraformRadius = r; syncToolbarState(); };
        radiusRow.appendChild(rBtn);
      }
      menu.appendChild(radiusRow);
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
      terraformToolbarGroup = group;
      terraformToolbarMenu = menu;
      continue;
    }
    if(k === 'plant'){
      const group = document.createElement('div');
      group.className = 'tool-group';
      const btn = document.createElement('button');
      btn.className = 'tool tool-group-btn';
      btn.dataset.t = 'plant';
      btn.title = 'Bâtiments';
      btn.innerHTML = '<span class="ic">🏠</span><span>Bâtiments</span><span class="hk">▾</span>';
      const menu = document.createElement('div');
      menu.className = 'tool-group-menu';
      for(const toolKey of BUILDING_TOOLBAR_TOOLS){
        const d = BUILD[toolKey];
        if(!d) continue;
        const choice = document.createElement('button');
        choice.className = 'tool tool-group-item';
        choice.dataset.buildingTool = toolKey;
        choice.title = toolTitle(toolKey);
        choice.innerHTML = '<span class="ic">'+d.ic+'</span><span class="bld-name">'+d.n+'</span>'
          + '<span class="cost">'+toolCostLabel(toolKey)+'</span>';
        choice.onclick = e => { e.stopPropagation(); setTool(toolKey); };
        if(d.lux) choice.style.display = 'none'; // affichée au déblocage (syncLuxeToolbar)
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
      buildingToolbarGroup = group;
      buildingToolbarMenu = menu;
      luxeToolbarUnlocked = null;
      continue;
    }
    if(k === 'restaurant'){
      // lieux de loisirs : un seul menu déroulant pour tous (LEISURE_TYPES)
      const group = document.createElement('div');
      group.className = 'tool-group';
      const btn = document.createElement('button');
      btn.className = 'tool tool-group-btn';
      btn.dataset.t = 'restaurant';
      btn.title = 'Loisirs : les voyageurs arrivés à un arrêt, une gare, un port ou un aéroport proche y passent en priorité et paient l’entrée';
      btn.innerHTML = '<span class="ic">🎡</span><span>Loisirs</span><span class="hk">▾</span>';
      const menu = document.createElement('div');
      menu.className = 'tool-group-menu';
      for(const toolKey of LEISURE_TYPES){
        const d = BUILD[toolKey];
        const choice = document.createElement('button');
        choice.className = 'tool tool-group-item';
        choice.dataset.leisureTool = toolKey;
        choice.title = toolTitle(toolKey);
        choice.innerHTML = '<span class="ic">'+d.ic+'</span><span>'+d.n+'</span>'
          + '<span class="cost">'+toolCostLabel(toolKey)+'</span>';
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
      leisureToolbarGroup = group;
      leisureToolbarMenu = menu;
      continue;
    }
    if(k === 'air_runway' || k === 'air_taxi' || k === 'air_parking' || k === 'air_tower' || k === 'air_deco') continue; // regroupés sous "Aéroport"
    if(k === 'air_terminal'){
      const group = document.createElement('div');
      group.className = 'tool-group';
      const btn = document.createElement('button');
      btn.className = 'tool tool-group-btn';
      btn.dataset.t = 'air_terminal';
      btn.title = 'Aéroport : gare, piste et décor (fusion automatique des cases adjacentes)';
      btn.innerHTML = '<span class="ic">✈️</span><span>Aéroport</span><span class="hk">▾</span>';
      const menu = document.createElement('div');
      menu.className = 'tool-group-menu';
      for(const toolKey of AIRPORT_TOOLBAR_TOOLS){
        const d = BUILD[toolKey];
        if(!d) continue;
        const choice = document.createElement('button');
        choice.className = 'tool tool-group-item';
        choice.dataset.airportTool = toolKey;
        choice.title = toolTitle(toolKey);
        choice.innerHTML = '<span class="ic">'+d.ic+'</span><span>'+d.n.replace(' aéroport','')+'</span>'
          + '<span class="cost">'+toolCostLabel(toolKey)+'</span>';
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
      airportToolbarGroup = group;
      airportToolbarMenu = menu;
      continue;
    }
    if(k === 'depot'){
      const group = document.createElement('div');
      group.className = 'tool-group';
      const btn = document.createElement('button');
      btn.className = 'tool tool-group-btn';
      btn.dataset.t = 'depot';
      btn.title = 'Bâtiments de stockage';
      btn.innerHTML = '<span class="ic">📦</span><span>Stockage</span><span class="hk">▾</span>';
      const menu = document.createElement('div');
      menu.className = 'tool-group-menu';
      for(const toolKey of STORAGE_TOOLBAR_TOOLS){
        const d = BUILD[toolKey];
        if(!d) continue;
        const choice = document.createElement('button');
        choice.className = 'tool tool-group-item';
        choice.dataset.storageTool = toolKey;
        choice.title = toolTitle(toolKey);
        choice.innerHTML = '<span class="ic">'+d.ic+'</span><span>'+d.n+'</span>'
          + '<span class="cost">'+toolCostLabel(toolKey)+'</span>';
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
      storageToolbarGroup = group;
      storageToolbarMenu = menu;
      continue;
    }
    if(k === 'mine'){
      const group = document.createElement('div');
      group.className = 'tool-group';
      const btn = document.createElement('button');
      btn.className = 'tool tool-group-btn';
      btn.dataset.t = 'mine';
      btn.title = 'Bâtiments de ressources';
      btn.innerHTML = '<span class="ic">⛏️</span><span>Ressources</span><span class="hk">▾</span>';
      const menu = document.createElement('div');
      menu.className = 'tool-group-menu';
      for(const toolKey of RESOURCE_TOOLBAR_TOOLS){
        const d = BUILD[toolKey];
        if(!d) continue;
        const choice = document.createElement('button');
        choice.className = 'tool tool-group-item';
        choice.dataset.resourceTool = toolKey;
        choice.title = toolTitle(toolKey);
        choice.innerHTML = '<span class="ic">'+d.ic+'</span><span>'+d.n+'</span>'
          + '<span class="cost">'+toolCostLabel(toolKey)+'</span>';
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
      resourceToolbarGroup = group;
      resourceToolbarMenu = menu;
      continue;
    }
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
      for(const toolKey of ['rail','rail_signal','rail_signal2','train_station','tunnel']){
        const d = BUILD[toolKey];
        const choice = document.createElement('button');
        choice.className = 'tool tool-group-item';
        choice.dataset.trainTool = toolKey;
        choice.title = toolTitle(toolKey);
        choice.innerHTML = '<span class="ic">'+d.ic+'</span><span>'+d.n+'</span>'
          + '<span class="cost">'+toolCostLabel(toolKey)+'</span>';
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
        choice.title = toolTitle(item.tool) || item.desc || '';
        choice.innerHTML = '<span class="ic">'+(item.icon || d?.ic || '◻')+'</span><span>'+item.label+'</span>'
          + '<span class="cost">'+toolCostLabel(item.tool)+'</span>';
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
    btn.title = toolTitle(k);
    btn.innerHTML = '<span class="ic">'+d.ic+'</span><span>'+d.n+'</span>'
      + '<span class="cost">'+toolCostLabel(k)+'</span>';
    btn.onclick = ()=> setTool(k);
    bar.appendChild(btn);
  }

  syncToolbarState();
  syncLuxeToolbar();
}
function setTool(k){
  tool = k;
  roadDragStart = null; roadPreviewTiles = []; tunnelPreview = null;
  shiftToggle = false;
  const cs = $('ctxShift'); if(cs) cs.classList.remove('on');
  closeToolbarMenus();
  syncToolbarState();
}

// ---------- souris / clavier ----------
const mouse = { x:0, y:0, tx:-1, ty:-1, lDown:false, rDown:false, rMoved:0, lastX:0, lastY:0 };
// Bascule tactile du mode "angle droit" pour les routes (équivalent de Maj au clavier).
let shiftToggle = false;

// Tuile sous un point écran (coordonnées iso) en tenant compte du relief : une tuile
// en hauteur est dessinée décalée vers le haut de sa « lift », donc le point peut tomber
// sur une tuile plus éloignée que celle lue à plat. On teste chaque altitude possible et
// on garde, parmi les tuiles dont l'altitude correspond, la plus proche de la caméra.
function pickTileUnderIso(ix, iy){
  const flat = l => {
    const iyl = iy + l;
    const u = (ix/TW2 + iyl/TH2)/2, v = (iyl/TH2 - ix/TW2)/2;
    const [tx, ty] = invRotF(u, v);
    return { tx: Math.floor(tx), ty: Math.floor(ty), depth: u + v };
  };
  const base = flat(0);
  const cfg = reliefCfg();
  if(!cfg.enabled || !terrainHeightMap) return [base.tx, base.ty];
  const step = cfg.stepPx, maxLift = (cfg.levels + 1) * step;
  let best = null;
  for(let l = 0; l <= maxLift; l += 2){
    const c = flat(l);
    if(!inMap(c.tx, c.ty)) continue;
    if(Math.abs(terrainLiftPxAt(c.tx, c.ty) - l) > Math.max(3, step * 0.5)) continue;
    if(!best || c.depth > best.depth) best = c;
  }
  return best ? [best.tx, best.ty] : [base.tx, base.ty];
}
function updateMouseTileAt(x,y){
  mouse.x = x; mouse.y = y;
  const ix = cam.x + x/cam.z, iy = cam.y + y/cam.z;
  const [tx, ty] = pickTileUnderIso(ix, iy);
  mouse.tx = tx; mouse.ty = ty;
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
  // répartition par classe d'habitants (ouvriers, employés, cadres, patrons)
  const byClass = {};
  for(const b of members) if(BUILD[b.type]?.resid && b.pop > 0) byClass[residClassOf(b)] = (byClass[residClassOf(b)] || 0) + b.pop;
  for(const k of RESIDENT_CLASS_ORDER){
    if(!byClass[k]) continue;
    const c = RESIDENT_CLASSES[k];
    h += '<div class="row"><span style="color:#8fa3bf;padding-left:10px">'+c.icone+' '+escHtml(c.pluriel)+'</span><b>'+byClass[k]+'</b></div>';
  }
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
      toast('🏘️ Villages fusionnés : '+srcTown.name+' → '+t.name, 'win', eventTargetForTown(towns.find(tt => tt.id === t.id) || t));
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
    toast('🏘️ Nouveau village : '+newTown.name,'win', eventTargetForTown(newTown));
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
let tunnelPreview = null;   // { path, cost } affiché en surbrillance pendant la confirmation

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
  } else if(tool === 'tunnel'){
    startTunnelBuild(mouse.tx, mouse.ty);
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
  if(mouse.lDown && (tool==='terraform'||tool==='fill_water'||tool==='terraform_dig'||tool==='terraform_raise'||tool==='terraform_canal') && (mouse.tx!==oldTx || mouse.ty!==oldTy))
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
      if(mpInRoom() && !MP.username) toast('👤 Connecte-toi avec un compte joueur pour construire','err');
      else if(myWallet().money < cost) toast('Fonds insuffisants ('+cost+' $)','err');
      else if(mpInRoom()) applyRailPathWithNetwork(roadPreviewTiles);
      else railApplyMaskUpdates(updates, cost);
    } else if(msg) toast(msg, 'err');
    roadDragStart = null; roadPreviewTiles = [];
  } else if(tool === 'road' && roadDragStart){
    if(mpInRoom() && !MP.username) toast('👤 Connecte-toi avec un compte joueur pour construire','err');
    else if(!applyRoadPathWithNetwork(roadPreviewTiles) && roadPreviewTiles.length === 1){
      const t = roadPreviewTiles[0], v = canPlace('road', t.x, t.y);
      if(!v.ok && v.msg) toast(v.msg, 'err');
    }
    roadDragStart = null; roadPreviewTiles = [];
  }
  mouse.lDown = false;
}
// Clic sur l'outil Tunnel : (x,y) doit être une tuile en pente. Calcule automatiquement
// la sortie et le tracé de l'autre côté du relief, les affiche en surbrillance (tunnelPreview,
// dessiné dans draw()) puis demande confirmation du coût avant de creuser.
async function startTunnelBuild(x, y){
  const v = canPlace('tunnel', x, y);
  if(!v.ok){ if(v.msg) toast(v.msg, 'err'); return; }
  const result = findTunnelPath(x, y);
  if(!result || tunnelPathBlocked(result.path)){
    toast('⛔ Impossible de creuser un tunnel ici : aucune sortie valide de l\'autre côté du relief.', 'err');
    return;
  }
  const { path } = result;
  const cost = path.length * TUNNEL_COST_PER_TILE;
  tunnelPreview = { path, cost };
  if(myWallet().money < cost){
    toast('Fonds insuffisants ('+cost+' $)', 'err');
    tunnelPreview = null;
    return;
  }
  const ok = await confirmAction(
    'Construire un tunnel de '+path.length+' tuiles pour '+cost+' $ ?',
    { title:'Tunnel ferroviaire', okText:'Construire' }
  );
  tunnelPreview = null;
  if(!ok) return;
  if(myWallet().money < cost){ toast('Fonds insuffisants ('+cost+' $)','err'); return; }
  const updates = tunnelMaskUpdates(path);
  if(!updates.length){ toast('⛔ Ce tracé de tunnel existe déjà.', 'err'); return; }
  railApplyMaskUpdates(updates, cost);
  const tunnelTiles = path.slice(1, -1);
  for(const t of tunnelTiles) railTunnel[t.y*N + t.x] = 1;
  markRailDirty();
  if(MP.connected) netSend({ type:'tunnel_build', updates, tunnelTiles, costDelta:cost });
  toast('🚇 Tunnel construit ('+path.length+' tuiles, '+cost+' $)', 'win');
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
  camTracking = false; // l'utilisateur reprend la main
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
      camTracking = false; // l'utilisateur reprend la main
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

// Suit focusVehicle en continu : recentre targetCam sur sa position live.
// Le zoom (targetCam.z) reste libre ; un pan manuel désactive camTracking.
function trackCamera(){
  if(!camTracking || !focusVehicle) return;
  if(focusVehicle.garageRef?.dead){ camTracking = false; focusVehicle = null; return; }
  const pos = vehicleWorldPos(focusVehicle);
  if(!pos) return;
  const [u, v] = rotF(pos.x / TILE, pos.y / TILE);
  const p = liftedIso(u, v, terrainLiftPxAtWorld(pos.x, pos.y));
  targetCam.x = p[0] - W/(2*targetCam.z);
  targetCam.y = p[1] - H/(2*targetCam.z);
  clampCamera(targetCam);
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
  if(e.code==='Escape' && resourceToolbarMenu?.classList.contains('open')){
    e.preventDefault();
    closeResourceToolbarMenu();
    return;
  }
  if(e.code==='Escape' && airportToolbarMenu?.classList.contains('open')){
    e.preventDefault();
    closeAirportToolbarMenu();
    return;
  }
  if(e.code==='Escape' && storageToolbarMenu?.classList.contains('open')){
    e.preventDefault();
    closeStorageToolbarMenu();
    return;
  }
  if(e.code==='Escape' && buildingToolbarMenu?.classList.contains('open')){
    e.preventDefault();
    closeBuildingToolbarMenu();
    return;
  }
  if(e.code==='Escape' && vehicleToolbarMenu?.classList.contains('open')){
    e.preventDefault();
    closeVehicleToolbarMenu();
    return;
  }
  keys.add(e.code);
  if(e.code==='Space'){ e.preventDefault(); togglePause(); }
  if(e.code==='Escape'){ setTool('select'); selected = null; selectedExpansion = null; vehicleRouteMode = null; selectedVehicle = null; focusVehicle = null; camTracking = false; closeTownPanel(); closeTrainPanel(); closeVehicleListPanel(); closeEventsPanel(); }
  if((e.code==='ShiftLeft'||e.code==='ShiftRight') && roadDragStart && mouse.lDown && tool==='road')
    roadPreviewTiles = computeRoadPreview(roadDragStart.x, roadDragStart.y, mouse.tx, mouse.ty, true);
  if(e.code==='KeyH') toggleHelp();
  if(e.code==='KeyR') rotate(e.shiftKey ? -1 : 1);
  if(e.code==='KeyB') setTool('terraform');
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
  if(resourceToolbarGroup && !resourceToolbarGroup.contains(e.target)) closeResourceToolbarMenu();
  if(storageToolbarGroup && !storageToolbarGroup.contains(e.target)) closeStorageToolbarMenu();
  if(airportToolbarGroup && !airportToolbarGroup.contains(e.target)) closeAirportToolbarMenu();
  if(buildingToolbarGroup && !buildingToolbarGroup.contains(e.target)) closeBuildingToolbarMenu();
  if(leisureToolbarGroup && !leisureToolbarGroup.contains(e.target)) closeLeisureToolbarMenu();
  if(vehicleToolbarGroup && !vehicleToolbarGroup.contains(e.target)) closeVehicleToolbarMenu();
  if(terraformToolbarGroup && !terraformToolbarGroup.contains(e.target)) closeTerraformToolbarMenu();
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
  if(moved){ syncTargetCam(); camTracking = false; } // l'utilisateur reprend la main
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
$('sVehicles').onclick = () => openVehicleListPanel('road');
$('sTrains').onclick  = () => openVehicleListPanel('train');
$('sShips').onclick   = () => openVehicleListPanel('water');
$('sPlanes').onclick  = () => openVehicleListPanel('air');
// délégation : le ✕ survit aux reconstructions du panneau (rafraîchi 5×/s)
// Le panneau est reconstruit ~5×/s : on agit sur pointerdown (immédiat) plutôt que sur
// click (mousedown+mouseup), qui se perd quand une reconstruction survient entre les deux.
$('finance').addEventListener('pointerdown', e=>{
  if(e.target.closest('#bFinX')){ toggleFinance(); return; }
  if(e.target.closest('#venteToggle')){ financeVentesExpanded = !financeVentesExpanded; renderFinance(); return; }
  if(e.target.closest('#vehToggle')){ financeVehiculesExpanded = !financeVehiculesExpanded; renderFinance(); }
});
$('info').onclick = e=>{ if(e.target.id==='infoCloseBtn') closeInfoPanel(); };

let helpCurrentPage = 0;
const HELP_PAGES = 6;

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
const panelMenu = $('panelMenu');
const graphicPackSelect = $('graphicPackSelect');
const languageSelect = $('languageSelect');
const soundVolumeSlider = $('soundVolumeSlider');
const soundZoomSlider = $('soundZoomSlider');
const topbar = $('topbar');

// Les menus sortent du topbar pour ne pas etre masques par son overflow horizontal.
if(optMenu) document.body.appendChild(optMenu);
if(layerMenu) document.body.appendChild(layerMenu);
if(panelMenu) document.body.appendChild(panelMenu);

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
  if(!graphicPackSelect) return;
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
  if(soundVolumeSlider){
    soundVolumeSlider.value = Math.round((UI_OPTIONS.soundVolume ?? 1) * 100);
    soundVolumeSlider.disabled = !!UI_OPTIONS.disableSounds;
  }
  if(soundZoomSlider){
    soundZoomSlider.value = UI_OPTIONS.soundZoomMin ?? 1.0;
    soundZoomSlider.disabled = !!UI_OPTIONS.disableSounds;
  }
  document.querySelectorAll('.opt-item[data-opt]').forEach(el => {
    const key = el.dataset.opt;
    // réglage du monde : feux désactivés pour tous, modifiable par l'hôte seulement
    const world = key === 'disableTrafficLights';
    if(world) el.style.display = (!MP.connected || MP.role === 'host') ? '' : 'none';
    const active = world ? !!trafficLightsOff : !!UI_OPTIONS[key];
    el.classList.toggle('active', active);
    el.querySelector('.chk').textContent = active ? '✓' : '';
  });
}
refreshOptMenu();
refreshPanelMenu();
applyI18n();
renderEventsPanel();
addEventListener('factopolis:languagechange', () => {
  buildLanguageSelect();
  refreshOptMenu();
  refreshPanelMenu();
  renderEventsPanel();
});

function positionTopbarMenu(btn, menu){
  if(!btn || !menu) return;
  const rect = btn.getBoundingClientRect();
  const pad = 8;
  const menuWidth = menu.offsetWidth || Math.max(220, rect.width);
  const menuHeight = menu.offsetHeight || 0;
  const left = Math.max(pad, Math.min(rect.right - menuWidth, innerWidth - menuWidth - pad));
  const top = Math.max(pad, Math.min(rect.bottom + 6, innerHeight - menuHeight - pad));
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}

function syncTopbarMenus(){
  if(optMenu.classList.contains('open')) positionTopbarMenu($('bOptions'), optMenu);
  if(layerMenu.classList.contains('open')) positionTopbarMenu($('bLayer'), layerMenu);
  if(panelMenu.classList.contains('open')) positionTopbarMenu($('bPanels'), panelMenu);
}

function closeTopbarMenus(exceptMenu=null){
  [optMenu, layerMenu, panelMenu].forEach(menu => {
    if(menu && menu !== exceptMenu) menu.classList.remove('open');
  });
}

function toggleTopbarMenu(btn, menu){
  if(!btn || !menu) return;
  const willOpen = !menu.classList.contains('open');
  closeTopbarMenus(willOpen ? menu : null);
  if(!willOpen){
    menu.classList.remove('open');
    return;
  }
  menu.classList.add('open');
  positionTopbarMenu(btn, menu);
}

$('bOptions').onclick = e => {
  e.stopPropagation();
  toggleTopbarMenu($('bOptions'), optMenu);
};

$('bLayer').onclick = e => {
  e.stopPropagation();
  toggleTopbarMenu($('bLayer'), layerMenu);
};

$('bPanels').onclick = e => {
  e.stopPropagation();
  toggleTopbarMenu($('bPanels'), panelMenu);
};

document.addEventListener('click', e => {
  if(!optMenu.contains(e.target) && e.target.id !== 'bOptions')
    optMenu.classList.remove('open');
  if(!layerMenu.contains(e.target) && e.target.id !== 'bLayer')
    layerMenu.classList.remove('open');
  if(!panelMenu.contains(e.target) && e.target.id !== 'bPanels')
    panelMenu.classList.remove('open');
});

addEventListener('resize', syncTopbarMenus);
topbar?.addEventListener('scroll', syncTopbarMenus, { passive:true });

document.querySelectorAll('.opt-item[data-opt]').forEach(el => {
  el.onclick = e => {
    e.stopPropagation();
    const key = el.dataset.opt;
    if(key === 'disableTrafficLights'){
      if(MP.connected && MP.role !== 'host') return; // réservé à l'hôte
      trafficLightsOff = !trafficLightsOff;
      if(MP.connected) netSend({ type:'traffic_lights', off:trafficLightsOff });
      refreshOptMenu();
      return;
    }
    UI_OPTIONS[key] = !UI_OPTIONS[key];
    saveUIOptions();
    refreshOptMenu();
  };
});

document.querySelectorAll('.opt-item[data-panel-opt]').forEach(el => {
  el.onclick = e => {
    e.stopPropagation();
    const key = el.dataset.panelOpt;
    setPanelVisibility(key, !UI_OPTIONS[key]);
  };
});

languageSelect.onchange = e => {
  e.stopPropagation();
  setLanguage(languageSelect.value);
  toast(t('settings.languageChanged', { language: t('language.' + UI_OPTIONS.language) }));
};

const qualitySelect = $('qualitySelect');
if(qualitySelect){
  qualitySelect.value = UI_OPTIONS.quality;
  qualitySelect.onchange = e => {
    e.stopPropagation();
    UI_OPTIONS.quality = qualitySelect.value;
    qualityAutoLowered = false; _qMon = { start: 0, n: 0, sum: 0, skip: 0 };
    saveUIOptions();
    applyQuality();
    toast('⚙️ Qualité graphique : ' + qualitySelect.options[qualitySelect.selectedIndex].text);
  };
}
graphicPackSelect.onchange = e => {
  e.stopPropagation();
  UI_OPTIONS.graphicPack = graphicPackSelect.value;
  saveUIOptions();
  refreshOptMenu();
  toast(t('settings.graphicPackChanged', { pack: GRAPHIC_PACKS[UI_OPTIONS.graphicPack].n }));
};

if(soundVolumeSlider){
  soundVolumeSlider.oninput = e => {
    e.stopPropagation();
    UI_OPTIONS.soundVolume = Math.max(0, Math.min(1, Number(soundVolumeSlider.value) / 100));
    saveUIOptions();
  };
}

if(soundZoomSlider){
  soundZoomSlider.oninput = e => {
    e.stopPropagation();
    UI_OPTIONS.soundZoomMin = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(soundZoomSlider.value)));
    saveUIOptions();
  };
}

// ---------- boucle principale ----------
// drawFn est une indirection pour permettre aux extensions (multijoueur) de surcharger draw
let drawFn = draw;

// --- Boucle de RENDU (requestAnimationFrame) ---
// rAF est suspendu/throttlé par le navigateur quand l'onglet n'est plus au
// premier plan. On y laisse donc UNIQUEMENT ce qui est visuel : si personne ne
// regarde, peu importe que le rendu se mette en pause. La simulation, elle, est
// pilotée par une horloge indépendante (voir simStep / startSimClock plus bas).
let last = performance.now();
let lastFrameAt = 0; // dernier passage de la boucle de rendu (horloge sim : voir simStep)
// Détection automatique d'une machine lente (qualité « auto ») : 4 s après le
// démarrage, si 90 images successives durent en moyenne plus de 24 ms, on passe en
// qualité basse (résolution 1×, sans fumée). Une seule bascule par session.
let _qMon = { start: 0, n: 0, sum: 0, skip: 0 };
function qualityMonitor(now, dtMs){
  if(UI_OPTIONS.quality !== 'auto' || qualityAutoLowered || document.hidden) return;
  if(!_qMon.start) _qMon.start = now;
  if(now - _qMon.start < 4000) return;
  if(dtMs > 250){ _qMon.n = 0; _qMon.sum = 0; return; } // pause / onglet rendormi : on ignore
  _qMon.n++; _qMon.sum += dtMs;
  if(_qMon.n < 90) return;
  const avg = _qMon.sum / _qMon.n;
  _qMon.n = 0; _qMon.sum = 0;
  if(avg > 24){
    qualityAutoLowered = true;
    applyQuality();
    toast('⚙️ Machine lente détectée : qualité graphique réduite (réglable dans ⚙️ Options)');
  }
}
function frame(now){
  qualityMonitor(now, now - last);
  const rdt = Math.min(0.05, (now-last)/1000);
  const gdt = paused ? 0 : rdt * speed;
  last = now;
  lastFrameAt = performance.now();
  // Simulation avancée JUSTE AVANT le dessin, au rythme de l'affichage : chaque
  // image montre l'état exact à son horodatage (plus de « battement » entre
  // l'horloge du Worker et le vsync, qui faisait saccader trains et camions).
  // On cadence sur l'horodatage VSYNC du navigateur (`now`), pas sur l'heure
  // d'exécution du callback : celle-ci jitte (callbacks en retard puis en rafale,
  // fréquent sur écrans 120/144 Hz ou machines chargées), ce qui donnait des pas
  // de simulation inégaux — grand pas puis petit pas — donc des trains qui
  // avancent par à-coups alors que l'affichage est régulier.
  // Rattrapage plafonné à 100 ms par image : sans plafond, une image longue
  // déclenchait plusieurs pas de rattrapage d'affilée, donc une image encore plus
  // longue (spirale) et des trains qui bondissent. Sous 10 images/s le jeu ralentit
  // au lieu de saccader. Le Worker (onglet masqué) garde son rattrapage complet.
  simStep(now, 0.1);
  panKeys(rdt);
  trackCamera();
  smoothCamera(rdt);
  noteCameraMove(now);
  if(typeof mpUpdateGuestVisuals === 'function') mpUpdateGuestVisuals(rdt, gdt);
  drawFn();
  if(typeof Minimap !== 'undefined') Minimap.draw();
  updateHUD(rdt);
  requestAnimationFrame(frame);
}

// --- Boucle de SIMULATION (indépendante du focus de l'onglet) ---
// Avance l'état du jeu, diffuse l'état (hôte) et gère la sauvegarde auto.
// Pilotée par startSimClock() via un Web Worker dont les timers ne sont pas
// throttlés en arrière-plan : l'hôte continue donc à simuler et à diffuser même
// quand son onglet n'a plus le focus, et les invités ne voient plus le jeu figé.
let simLast = performance.now();
function simStep(now, maxDt = 1){
  if(!(now > simLast)) return; // horloge jamais à reculons (horodatage vsync < heure du Worker)
  let rdt = (now - simLast) / 1000;
  simLast = now;
  // Plafonne le rattrapage après une longue suspension pour éviter un gros saut.
  if(rdt > maxDt) rdt = maxDt;
  // Sous-découpe en tranches de 50 ms max : même pas de simulation que l'ancienne
  // boucle rAF (stabilité), tout en gardant la cadence temps réel si les ticks
  // sont espacés (onglet en arrière-plan).
  if(!paused && mpRunsAuthoritativeSimulation()){
    let acc = rdt;
    while(acc > 0){
      const step = acc > 0.05 ? 0.05 : acc;
      acc -= step;
      update(step * speed);
    }
  }
  if(typeof mpMaybeBroadcastState === 'function') mpMaybeBroadcastState(rdt);
  // Décompte sauvegarde auto (temps réel, pas affecté par speed/pause). La sérialisation
  // bloque plusieurs dizaines de ms sur une grande partie : on la repousse tant que le
  // joueur déplace/zoome la caméra ou tient un bouton (au plus AUTO_SAVE_MAX_DEFER s).
  autoSaveTimer -= rdt;
  if(autoSaveTimer <= 0){
    const busy = now - lastCameraMoveAt < 1500 || mouse.lDown || mouse.rDown;
    if(!busy || autoSaveTimer < -AUTO_SAVE_MAX_DEFER){
      autoSaveTimer = AUTO_SAVE_INTERVAL;
      performAutoSave();
    }
  }
}
const AUTO_SAVE_MAX_DEFER = 30;
// Dernier mouvement de caméra (pan/zoom), relevé à chaque image par frame().
let lastCameraMoveAt = -Infinity, _lastCamX = 0, _lastCamY = 0, _lastCamZ = 0;
function noteCameraMove(now){
  if(cam.x !== _lastCamX || cam.y !== _lastCamY || cam.z !== _lastCamZ){
    lastCameraMoveAt = now;
    _lastCamX = cam.x; _lastCamY = cam.y; _lastCamZ = cam.z;
  }
}

let _simWorker = null, _simFallbackInterval = null;
function startSimClock(){
  if(_simWorker || _simFallbackInterval) return;
  simLast = performance.now();
  const SIM_TICK_MS = 16; // ~60 Hz quand l'onglet est actif
  try {
    // Le Worker sert uniquement d'horloge : ses setInterval ne sont pas
    // throttlés à 1 s comme ceux du thread principal en arrière-plan.
    const src =
      'let id=null;onmessage=function(e){' +
      'if(e.data&&e.data.t==="start"){if(!id)id=setInterval(function(){postMessage(0);},e.data.ms);}' +
      'else if(e.data&&e.data.t==="stop"){clearInterval(id);id=null;}};';
    const blob = new Blob([src], { type:'application/javascript' });
    _simWorker = new Worker(URL.createObjectURL(blob));
    // Onglet visible : c'est frame() qui pilote la simulation. Le Worker ne prend
    // le relais que si l'affichage est suspendu (onglet en arrière-plan).
    _simWorker.onmessage = function(){
      const t = performance.now();
      if(t - lastFrameAt > 120) simStep(t);
    };
    _simWorker.postMessage({ t:'start', ms:SIM_TICK_MS });
  } catch(err){
    // Fallback : setInterval principal (throttlé à ~1 s en arrière-plan, mais
    // grâce au sous-découpage de simStep le jeu garde tout de même sa cadence).
    _simFallbackInterval = setInterval(function(){
      const t = performance.now();
      if(t - lastFrameAt > 120) simStep(t);
    }, SIM_TICK_MS);
  }
}
