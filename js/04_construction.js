// ---------- construction ----------

// état multijoueur — déclaré ici car utilisé dans canPlace, clickAt et drawBuilding
const MP = {
  ws: null, myId: null, myColor: '#ffffff', myName: 'Moi',
  role: null, isAdmin: false, players: [], cursors: {}, chat: [], connected: false,
  username: null, token: null, saves: [], rooms: [],
  roomId: null, roomName: null, roomSaveName: null,
  prevOwnerId: null,   // ancien id de connexion, reçu du serveur lors de l'auth
  savedRegistry: null, // playerRegistry issu de la dernière sauvegarde chargée
  shutdownNotice: false,
  shutdownMessage: '',
};

const mpHasAdminRights = () => MP.connected && (MP.role === 'host' || MP.isAdmin);

const MP_ZONE = 20; // distance minimale entre bâtiments de joueurs différents

// Retourne l'id du joueur adverse le plus proche ayant un bâtiment à moins de MP_ZONE cases,
// ou null si la pose est libre.
function nearbyEnemyOwner(myId, cx, cy){
  if(!myId) return null; // solo : pas de restriction
  // Seuls les joueurs actuellement connectés comptent — évite les faux positifs
  // liés aux bâtiments créés par le joueur lui-même dans une session précédente
  // (où son ID de session était différent).
  const enemyIds = new Set(MP.players.filter(p => p.id !== myId).map(p => p.id));
  for(const b of buildings){
    if(!b.owner || b.owner === myId) continue;
    if(!enemyIds.has(b.owner)) continue; // ID orphelin → traiter comme neutre
    // distance Chebyshev (max des axes) entre centres — simple et rapide
    const bcx = b.x + (b.w-1)/2, bcy = b.y + (b.h-1)/2;
    if(Math.abs(cx - bcx) <= MP_ZONE && Math.abs(cy - bcy) <= MP_ZONE) return b.owner;
  }
  return null;
}

function canPlace(t,x,y){
  if(!inMap(x,y)) return { ok:false };
  const i = y*N+x, ter = terrain[i];
  if(t==='bulldoze') return { ok: !!(road[i] || rail[i] || bgrid[i] || ter===T.TREE || ter===T.WHEAT || ter===T.COTTON) };
  if(t==='terraform') return { ok: !bgrid[i] && (ter===T.TREE || ter===T.WHEAT || ter===T.COTTON || ter===T.IRON || ter===T.COAL) };
  if(t==='fill_water'){
    if(ter !== T.WATER) return { ok:false, msg:'L\'outil Remblai ne s\'applique que sur l\'eau' };
    if(!terrassementNear(x, y, MP.myId ?? 1)) return { ok:false, msg:'Aucune usine de terrassement à portée avec assez de terre ('+FILL_WATER_COST+' terres requises)' };
    return { ok:true };
  }
  if(t==='road'){
    if(road[i] || rail[i] || bgrid[i]) return { ok:false, msg:'Case occupée' };
    if(ter===T.WATER) return { ok:false, msg:"Impossible de construire sur l'eau" };
    if(ter!==T.GRASS) return { ok:false, msg:"Les routes se posent sur l'herbe (démolis les arbres ou champs)" };
    return { ok:true };
  }
  if(t==='rail'){
    if(road[i] || rail[i] || bgrid[i]) return { ok:false, msg:'Case occupée' };
    if(ter===T.WATER) return { ok:false, msg:"Impossible de construire sur l'eau" };
    if(ter!==T.GRASS) return { ok:false, msg:"Les rails se posent sur l'herbe (démolis les arbres ou champs)" };
    return { ok:true };
  }
  if(road[i] || rail[i] || bgrid[i]) return { ok:false, msg:'Case occupée' };
  if(ter===T.WATER) return { ok:false, msg:"Impossible de construire sur l'eau" };
  if(t==='mine'){
    if(ter!==T.IRON && ter!==T.COAL) return { ok:false, msg:'La mine doit être sur un gisement' };
  } else {
    if(ter!==T.GRASS) return { ok:false, msg:'Terrain non constructible' };
    if(t==='lumber' && !treeNear(x,y,2)) return { ok:false, msg:"Aucun arbre à moins de 2 cases" };
    if(t==='farm'){
      if(!fieldNear(x,y,2)) return { ok:false, msg:"Aucun champ de blé à moins de 2 cases" };
      const capErr = farmCapacityError(x, y, 'farm', T.WHEAT);
      if(capErr) return { ok:false, msg:capErr };
    }
    if(t==='cotton_farm'){
      if(!cottonFieldNear(x,y,2)) return { ok:false, msg:"Aucun champ de coton à moins de 2 cases" };
      const capErr = farmCapacityError(x, y, 'cotton_farm', T.COTTON);
      if(capErr) return { ok:false, msg:capErr };
    }
    if(t==='pump' && !waterNear(x,y,1)) return { ok:false, msg:"La pompe doit être au bord de l'eau" };
    if(t==='fisher'){
      if(!waterNear(x,y,1)) return { ok:false, msg:"La cabane de pêcheur doit être au bord de l'eau" };
      const FISHER_EXCL = 4;
      for(const b of buildings){
        if(b.dead || b.type !== 'fisher') continue;
        const bx = b.x + Math.floor((b.w||1)/2), by = b.y + Math.floor((b.h||1)/2);
        if(Math.sqrt((x-bx)**2 + (y-by)**2) <= FISHER_EXCL)
          return { ok:false, msg:'Trop proche d\'une autre pêcherie (rayon '+FISHER_EXCL+' cases)' };
      }
    }
  }
  // zone d'exclusion multijoueur
  if(MP.connected && nearbyEnemyOwner(MP.myId, x, y))
    return { ok:false, msg:"Trop proche d'un autre joueur (−"+MP_ZONE+' cases)' };
  return { ok:true };
}

function clickAt(x,y){
  if(!inMap(x,y)){
    // Zones d'expansion : cliquables quel que soit l'outil
    const exp = expansions.find(e=>e.inPiece(x,y));
    if(exp){ selectedExpansion = exp; selected = null; selectedVehicle = null; hudTimer = 0; return; }
    return;
  }
  selectedExpansion = null;
  const i = y*N+x;

  // Mode assignation de route véhicule (intercepte avant tout le reste)
  if(vehicleRouteMode && tool === 'select'){
    const b = bgrid[i];
    if(b && !b.dead){
      const veh = vehicleRouteMode.vehicle;
      const isBus = veh.vtype === 'bus';
      if(!vehicleRouteEndpointOk(b)){
        if(isBus)
          toast('⛔ Le bus ne peut utiliser que des arrêts de bus comme source et destination.','err');
        else
          toast('⛔ Les véhicules ne peuvent utiliser que des entrepôts comme source et destination.','err');
        return;
      }
      if(vehicleRouteMode.step === 'source'){
        const v = vehicleRouteMode.vehicle;
        const vt = VEHICLE_TYPES[v.vtype];
        const myOwner = MP.myId;
        if(isBus){
          // Les bus peuvent utiliser n'importe quel arrêt (y compris inter-joueurs)
          vehicleRouteMode.vehicle.source = b;
          vehicleRouteMode.step = 'dest';
          const stopName = b.name || BUILD[b.type].n;
          toast('🚌 Départ : '+stopName+'. Clique sur l\'arrêt de destination.');
        } else if(b.owner !== myOwner && b.owner != null){
          // Seul un marché d'un autre joueur est autorisé comme source (pas son dépôt)
          if(b.type !== 'market'){
            toast('⛔ Vous ne pouvez acheter que depuis le marché d\'un autre joueur.','err'); return;
          }
          const hasSellRes = vt.resources.some(r => b.sellTo?.[r]);
          if(!hasSellRes){
            toast('⛔ Ce marché ne vend pas les ressources de ce véhicule.','err'); return;
          }
          vehicleRouteMode.vehicle.source = b;
          vehicleRouteMode.step = 'dest';
          toast('🛒 Source (achat) : '+(MP.players.find(p=>p.id===b.owner)||{}).name+'. Clique sur ta destination.');
        } else {
          vehicleRouteMode.vehicle.source = b;
          vehicleRouteMode.step = 'dest';
          toast('Source définie : '+BUILD[b.type].n+'. Clique sur la destination.');
        }
      } else {
        const vRef = vehicleRouteMode.vehicle;
        const myOwner = MP.myId;
        if(!isBus && b.owner !== myOwner && b.owner != null){
          // Destination chez un autre joueur : uniquement un marché (hors bus)
          if(b.type !== 'market'){
            toast('⛔ Vous ne pouvez livrer que vers le marché d\'un autre joueur.','err'); return;
          }
        }
        vRef.dest = b;
        if(!vehicleCanServeRoute(vRef)){
          vRef.dest = null;
          toast('⛔ Destination hors rayon de la citerne source.','err');
          return;
        }
        vehicleRouteMode = null;
        startVehicleRoute(vRef);
        if(MP.connected) netSend({
          type:'route_vehicle',
          id:vRef.id,
          sourceX:vRef.source.x, sourceY:vRef.source.y,
          destX:vRef.dest.x, destY:vRef.dest.y,
        });
        toast('Route définie ! Le véhicule commence sa tournée.','win');
      }
    }
    return;
  }

  if(tool==='select'){
    // Détecter si on clique sur un véhicule en mouvement (priorité sur les bâtiments)
    if(!vehicleRouteMode){
      const clickWx = x * TILE + TILE/2, clickWy = y * TILE + TILE/2;
      for(const veh of vehicles){
        if(!veh.pts || !veh.pts.length) continue;
        const a = veh.pts[veh.seg], bp = veh.pts[Math.min(veh.seg+1, veh.pts.length-1)];
        const wx = a.x + (bp.x-a.x)*veh.t, wy = a.y + (bp.y-a.y)*veh.t;
        if(Math.hypot(wx - clickWx, wy - clickWy) < TILE * 1.5){
          selectedVehicle = veh;
          selected = null;
          return;
        }
      }
    }
    selectedVehicle = null;
    selected = bgrid[i];
    return;
  }
  if(tool==='bulldoze'){
    if(bgrid[i]){
      const b = bgrid[i];
      // en multijoueur : impossible de démolir le bâtiment d'un autre joueur
      if(MP.connected && b.owner && b.owner !== MP.myId){
        toast('⛔ Ce bâtiment appartient à un autre joueur','err'); return;
      }
      const refund = demolishBuilding(b, b.owner);
      if(refund) addFloat(x,y,'+'+refund+' $','#9fe89f');
    } else if(road[i]){
      road[i] = 0; earnMoney(3, 'rembours');
    } else if(rail[i]){
      rail[i] = 0; earnMoney(Math.floor((BUILD.rail?.cost||0) * 0.3), 'rembours');
    } else if(terrain[i]===T.TREE || terrain[i]===T.WHEAT || terrain[i]===T.COTTON){
      terrain[i] = T.GRASS;
    }
    return;
  }
  if(tool==='terraform'){
    const ter = terrain[i];
    if(bgrid[i]){ toast('⛔ Démolissez d\'abord le bâtiment','err'); return; }
    if(ter===T.TREE || ter===T.WHEAT || ter===T.COTTON || ter===T.IRON || ter===T.COAL){
      terrain[i] = T.GRASS;
      if(MP.connected) netSend({ type:'terraform', i });
    }
    return;
  }
  if(tool==='fill_water'){
    const ter = terrain[i];
    if(ter !== T.WATER){ toast('L\'outil Remblai ne s\'applique que sur l\'eau','err'); return; }
    const depot = terrassementNear(x, y, MP.myId ?? 1);
    if(!depot){ toast('⛔ Aucune usine de terrassement à portée avec '+FILL_WATER_COST+' terres','err'); return; }
    depot.storage['dirt'] = (depot.storage['dirt']||0) - FILL_WATER_COST;
    terrain[i] = T.GRASS;
    // netSend géré par l'intercept MP (09_multiplayer.js) pour éviter le double envoi
    return;
  }
  // outil de construction
  const v = canPlace(tool,x,y);
  if(!v.ok){
    if(bgrid[i]){ selected = bgrid[i]; }       // clic sur bâtiment existant → inspecter
    else if(v.msg) toast(v.msg,'err');
    return;
  }
  const cost = BUILD[tool].cost;
  if(myWallet().money < cost){ toast('Fonds insuffisants ('+cost+' $)','err'); return; }
  spendMoney(cost, 'construction');
  if(tool==='road'){ road[i] = 1; return; }
  if(tool==='rail'){ rail[i] = 1; return; }
  const b = newBuilding(tool,x,y);
  b.owner = MP.myId;
  markStarterHomeIfNeeded(b);
  assignBuildingToTown(b);
  assignIndustryName(b);
  buildings.push(b);
  bgrid[i] = b;
  selected = b;
  if(BUILD[b.type].resid) assignHomelessToHousing(b.owner);
}
