// Barre du haut : compteurs et listes camions / trains / bateaux / avions.
T_.flatWorld();
const errs = [];
const garage = T_.build('garage', 100, 100);
if(!garage) return { ok:false, errs:['dépôt'] };
const mk = vt => { const v = createPersistentVehicle(vt, garage); return v; };
const roadT = Object.keys(VEHICLE_TYPES).find(k => VEHICLE_TYPES[k].mode === 'road');
mk(roadT); mk('cargo_ship'); mk('ferry'); mk('plane');
updateHUD(1);
const n = id => +$(id).textContent;
if(n('hVehicles') !== 1) errs.push('camions ' + n('hVehicles'));
if(n('hShips') !== 2) errs.push('bateaux ' + n('hShips'));
if(n('hPlanes') !== 1) errs.push('avions ' + n('hPlanes'));
for(const [id, mode, count] of [['sShips','water',2], ['sPlanes','air',1], ['sVehicles','road',1], ['sTrains','train',0]]){
  $(id).click();
  renderVehicleListPanel();
  const rows = document.querySelectorAll('#vehicleListPanel .vehlist-row').length;
  if(rows !== count) errs.push(mode + ' : ' + rows + ' lignes au lieu de ' + count);
}
// propriétaire affiché dans les détails d'un bâtiment et d'un véhicule
selected = garage; selectedVehicle = null; $('info')._html = null; renderInfo();
if(!/Propriétaire/.test($('info').textContent)) errs.push('propriétaire absent (bâtiment)');
const veh = vehicles.find(v => vehicleMode(v) === 'air'); selected = null; selectedVehicle = veh; $('info')._html = null; renderInfo();
if(!/Propriétaire/.test($('info').textContent)) errs.push('propriétaire absent (véhicule)');
return { ok: errs.length === 0, errs };
