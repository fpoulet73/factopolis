// Aides injectées dans la page de test (scope global du jeu). Voir run-all.js.
window.T_ = {
  // Monde plat, tout en herbe, entièrement jouable, budget illimité, sans
  // matériaux de chantier (bac à sable : materials=true pour les exiger).
  flatWorld(materials = false){
    for(let i = 0; i < N * N; i++){ terrain[i] = T.GRASS; terrainHeightMap[i] = 1; }
    mapMask.fill(1);
    mapBounds = { x0:0, y0:0, x1:N, y1:N };
    rebuildWaterLevels(); markTerrainDirty();
    myWallet().money = 1e9;
    WORLD.buildMaterials = !!materials;
  },
  // Remplit un entrepôt (acceptant ces ressources) : { res: quantité }.
  stock(depot, map){
    for(const r in map){ depot.allow[r] = true; depot.storage[r] = (depot.storage[r] || 0) + map[r]; }
    return depot;
  },
  water(x0, y0, x1, y1){
    for(let y = y0; y < y1; y++) for(let x = x0; x < x1; x++) terrain[y * N + x] = T.WATER;
    rebuildWaterLevels(); markTerrainDirty();
  },
  rail(path){
    const { updates, msg } = collectRailUpdates(path);
    if(msg) throw new Error('rail: ' + msg);
    railApplyMaskUpdates(updates, 0);
  },
  line(x0, y0, x1, y1){
    const pts = [], n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for(let k = 0; k <= n; k++) pts.push({ x:x0 + Math.round((x1 - x0) * k / n), y:y0 + Math.round((y1 - y0) * k / n) });
    return pts;
  },
  build(t, x, y){ setTool(t); clickAt(x, y); setTool('select'); return bgrid[y * N + x]; },
  // Signal protégeant l'arête (x,y)→(x-dx,y-dy) : (dx,dy) = direction de la face.
  sig(x, y, dx, dy, kind){
    const def = railDirDef(dx, dy);
    if(!def) throw new Error('direction de signal invalide');
    setRailSignal(x, y, def.bit, true, false, kind || 'block');
  },
  train(depot, stops, wagons){
    const v = createPersistentVehicle('train', depot);
    v.wagons = (wagons || ['minerai']).map(w => trainCreateWagon(w));
    v.orders = stops.slice(); v.orderModes = stops.map(() => 'load_unload');
    syncTrainOrders(v); assignTrainVehicleName(v);
    const r = setTrainDepotDeparture(v, true);
    return { v, r };
  },
  run(sec, step = 0.05){ for(let t = 0; t < sec; t += step) update(step); },
};
