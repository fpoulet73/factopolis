// Ouvre tous les panneaux (bâtiments, véhicules, train, finances, villes, aide…).
T_.flatWorld();
T_.water(80, 96, 84, 104);
terrain[100*N+90] = T.IRON;
for(let x = 86; x < 89; x++) terrain[95*N+x] = T.TREE;
for(let x = 92; x < 95; x++) terrain[95*N+x] = T.WHEAT;
terrain[95*N+96] = T.COTTON;
markTerrainDirty();
for(const t of T_.line(84,98,120,98)) road[t.y*N+t.x] = 1;
markGroundDirty();
T_.rail(T_.line(84,110,120,110));
const errs = [];
const tryOpen = (label, fn) => { try { fn(); } catch(e){ errs.push(label + ': ' + e.message); } };
const pos = { mine:[90,100], lumber:[87,96], farm:[93,96], cotton_farm:[96,96], pump:[84,99], fisher:[84,97], boat_depot:[84,102] };
let x = 98;
for(const t of ['mine','lumber','farm','cotton_farm','pump','fisher','plant','house','depot','market','tank','garage','bus_stop','train_depot','terrassement','boat_depot','plane_depot']){
  const [px, py] = pos[t] || [x++, 97];
  const b = T_.build(t, px, py);
  if(!b){ errs.push('pose impossible : ' + t); continue; }
  tryOpen('info ' + t, () => { selected = b; selectedVehicle = null; $('info')._html = null; renderInfo(); });
}
for(const up of ['smelter','weaver','mill','bakery','fishery','factory']){
  const b = T_.build('plant', x++, 99);
  if(!b) continue;
  applyPlantUpgrade(b, up);
  tryOpen('info ' + up, () => { selected = b; $('info')._html = null; renderInfo(); });
}
const st = T_.build('train_station', 100, 109); T_.build('train_station', 100, 110);
const st2 = T_.build('train_station', 115, 109); T_.build('train_station', 115, 110);
const dep = T_.build('train_depot', 86, 109);
tryOpen('gare', () => { selected = st; $('info')._html = null; renderInfo(); });
const { v } = T_.train(dep, [st, st2], ['minerai','voiture']);
tryOpen('panneau train', () => { openTrainPanel(v); renderTrainPanel(); });
tryOpen('info train', () => { selected = null; selectedVehicle = v; $('info')._html = null; renderInfo(); });
tryOpen('finances', () => { toggleFinance(); renderFinance(); });
tryOpen('liste véhicules', () => { openVehicleListPanel('road'); openVehicleListPanel('train'); });
tryOpen('événements', () => { setPanelVisibility('panelEvents', true); renderEventsPanel(); });
tryOpen('aide', () => { toggleHelp(); goHelpPage(4); toggleHelp(); });
tryOpen('partie', () => { $('bGame').click(); $('bGame').click(); });
tryOpen('rotation', () => { for(let k = 0; k < 4; k++){ rotate(1); drawFn(); } });
tryOpen('simulation', () => T_.run(30, 0.1));
tryOpen('sauvegarde', () => applySnapshot(JSON.parse(JSON.stringify(serializeState()))));
tryOpen('rendu après chargement', () => { drawFn(); drawFn(); });
return { ok: errs.length === 0, errs };
