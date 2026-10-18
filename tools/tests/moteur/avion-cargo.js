// Avion cargo : achetable au hangar seulement si un entrepôt fait partie de l'aéroport ;
// il transporte du fret entre deux aéroports (entrepôt de l'aéroport) et rapporte de l'argent.
T_.flatWorld();
const errs = [], check = (n, c) => { if(!c) errs.push(n); };
const mkAirport = (x, y) => {
  const t = T_.build('air_terminal', x, y); T_.build('air_tower', x, y - 1);
  T_.build('air_taxi', x + 1, y); T_.build('air_taxi', x + 2, y);
  for(let i = 0; i < 4; i++) T_.build('air_runway', x + 3, y + i);
  return { t, hangar: T_.build('plane_depot', x + 2, y - 1) };
};
const A = mkAirport(100, 100), B = mkAirport(140, 100);
check('aéroports fonctionnels', airportFunctional(A.t) && airportFunctional(B.t));
check('catalogue : avion cargo', BUILD.plane_depot.buyCatalog.includes('cargo_plane'));
check('sans entrepôt : achat refusé', !!planePurchaseError(A.hangar, 'cargo_plane'));
check('avion de ligne inchangé', planePurchaseError(A.hangar, 'plane') === null);
const html = (() => { selected = A.hangar; $('info')._html = null; renderInfo(); return $('info').innerHTML; })();
check('bouton grisé sans entrepôt', /data-buy-v="cargo_plane"[^>]*title=/.test(html));
// entrepôts collés à une pièce de chaque aéroport (l'entrepôt fait partie de l'aéroport)
const dA = T_.build('depot', 99, 100), dB = T_.build('depot', 139, 100);
check('entrepôts posés', dA && dB && portFreightHub(A.t) === dA);
check('avec entrepôt : achat possible', planePurchaseError(A.hangar, 'cargo_plane') === null);
// stock à transporter (comme le test des cargos : filtres par défaut, départ armé)
WALLETS[0].ventesDetail = { res:{}, veh:{} };
for(const k in RES){ dA.allow[k] = dB.allow[k] = true; dA.trainAllow[k] = dB.trainAllow[k] = undefined; }
dA.storage.steel = 40;
const plane = createPersistentVehicle('cargo_plane', A.hangar);
check('avion cargo créé', plane && VEHICLE_TYPES[plane.vtype].mode === 'air' && !VEHICLE_TYPES[plane.vtype].passengers);
check('route entre aéroports', vehicleRouteEndpointOk(A.t, 'cargo_plane', null) && vehicleRouteEndpointOk(B.t, 'cargo_plane', null));
plane.source = A.t; plane.dest = B.t; plane.depotDepartureArmed = true;
T_.run(240, 0.2);
const gain = myWallet().ventesDetail.veh.cargo_plane || 0;
check('fret transporté et payé', gain > 0);
try { drawFn(); drawFn(); } catch(e){ errs.push('rendu : ' + e.message); }
return { ok: errs.length === 0, errs, gain, atB: dB.storage.steel || 0 };
