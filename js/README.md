# Factopolis — Moteur client (`js/`)

Le jeu tourne en **scripts navigateur classiques** chargés dans l'ordre
par `index.html`. Les déclarations de haut niveau sont partagées via le
**scope global de la page** : variables (`WALLETS`, `MP`, `BUILD`, `RES`,
`cam`, `selected`, `tool`…), fonctions (`clickFn`, `drawFn`, `frame`,
`toast`…) et types (`T`, `RAIL_DIRS`…).

Conséquence : **garder l'ordre des préfixes numérotés stable** sauf si on
met à jour les dépendances dans `index.html` en parallèle.

## Ordre de chargement

```
config.js
js/i18n/{fr,en,es}.js   ← dictionnaires (doivent exister avant i18n.js)
js/i18n.js
js/01_definitions.js
js/05_depots/*.js       ← enregistrent les dépôts dans BUILD / toolbar
js/02_world_state.js
js/03_buildings_population.js
js/04_construction.js
js/05_logistics.js
js/06_simulation.js
js/07_rendering.js
js/08_ui_input_loop.js
js/09_multiplayer.js    ← surcharge clickFn / drawFn / boutons pause
js/10_saves_chat_console.js  ← bootstrap final : mpInjectUI, frame()
```

## Carte des fichiers

### Internationalisation

- **`i18n.js`** : IIFE exposée sur `window`. Fournit `t(key, vars)`,
  `setLanguage(lang)`, `applyI18n(root)`, `currentLanguage()`, et le
  tableau `I18N_LANGS = ['fr','en','es']`. Lit les dictionnaires depuis
  `window.FACTOPOLIS_TRANSLATIONS`. Persiste dans
  `localStorage['factopolis_ui_options']` et dispatche l'événement
  `factopolis:languagechange` sur changement.
- **`i18n/fr.js`**, **`i18n/en.js`**, **`i18n/es.js`** : dictionnaires
  (`meta.*`, `splash.*`, `topbar.*`, `layers.*`, `settings.*`,
  `help.*`).

### Moteur (préfixes numérotés)

- **`01_definitions.js`** : constantes (`TILE`, `TW`, `TH`, `T`,
  `RAIL_DIRS`, `OUTCAP`, `INCAP`, `TRUCK_LOAD`, horloges jeu, rayons,
  `ECO`, `TRADE_PRICES`, `AUTO_SAVE_*`), ressources `RES`, types de
  véhicules `VEHICLE_TYPES` et `TRAIN_WAGON_TYPES`, catalogue de
  bâtiments `BUILD`, recettes implicites, niveaux résidentiels `LEVELS`
  + `MERGE_ORDER`, formes de fusion `IND_SHAPES*` et `DEPOT_SHAPES` avec
  helpers (`prodMult`, `upkeepOf`, `indRadiusOf`), noms de villages
  (`generateTownName`, `assignBuildingToTown`, `mergeTowns`), packs
  graphiques (`GRAPHIC_PACKS`, `loadCommunityGraphicPacks`), et
  `registerDepotTool` pour étendre la toolbar.
- **`02_world_state.js`** : variables globales d'état (`terrain`,
  `road`, `rail`, `railSignals`, `bgrid`, `buildings`, `trucks`,
  `vehicles`, `walkers`, `homeless`, `floats`, `towns`, `expansions`,
  `mapBounds`, `mapMask`, `cam`, `targetCam`, `rot`, `gtime`, `speed`,
  `paused`, `UI_OPTIONS`), wallets multi-joueurs (`WALLETS`,
  `walletOf`, `myWallet`, `spendMoney`, `earnMoney`), validation de
  config monde (`normalizeWorldConfig`, `setMapSize`), setup canvas +
  projection iso (`iso`, `rotIdx`, `rotF`, `centerOn`, `rotate`),
  génération procédurale (`valueNoise`, `genWorld`,
  `generateExpansionTerrain`), expansion jigsaw
  (`refreshExpansionSlots`, `buyExpansion`), allocation des travailleurs
  et transit (`refreshWorkerAllocation` 2 passes,
  `refreshTransitPassengerCaps`).
- **`03_buildings_population.js`** : création de bâtiments (`newBuilding`,
  `setGrid`, `recipeOf`), stock/capacité (`capOf`, `accepts`, `space`,
  `adjRoadTiles`), validation de terrain (`treeNear`, `fieldNear`,
  `farmCapacityError`, `tankNear`, `terrassementNear`), population
  (`assignHomelessToHousing`, `makeResidentsHomeless`,
  `routeUnhousedResidents`), démollition (`demolishBuilding`), pause
  (`setBuildingPaused`), spécialisation des usines abandonnées
  (`plantUpgradeError`, `applyPlantUpgrade`), protection starter homes.
- **`04_construction.js`** : état `MP` (socket, id, role, players,
  cursors, chat, rooms…), `MP_ZONE = 20`, validation principale
  `canPlace(t,x,y)` (terrain, zone MP, règles par type), orchestrateur
  d'actions `clickAt(x,y)` (placement, démollition, terraform,
  véhicule, expansion), gestion des masques rails 8-dir
  (`railPlacementMaskAt`, `collectRailUpdates`,
  `railApplyMaskUpdates`), signaux et cantons (`rebuildRailBlocks`,
  `setRailSignal`, `sanitizeRailSignals`), gares/quais
  (`trainStationPlacementInfo`, `placeTrainStationTile`,
  `tryMergeTrainStations`).
- **`05_logistics.js`** : le cœur logistique. **Camions auto** :
  `tryDispatch` (BFS routier + scoring), `updateTrucks`, `tryRedirect`,
  `syncIncomingReservations`, `syncResidentReservations`. **Réseau
  routier** : feux de carrefour (`trafficGreenAxis`,
  `trafficLightAllows`), anti-collision (`limitByTrafficAhead`,
  `noOncoming`, `advanceRoadUnit`). **Ferroviaire** : passabilité
  (`railEdgePassableForPath`, `railEdgeDirectionAllowedForPath`,
  `railNextSignalAllowsDirection`), occupation cantons
  (`rebuildRailBlockOccupancy`, `railSignalAspect`, `trainNextMoveState`),
  pathfinding (`findRailPath`, `findRailPathFromDecision`,
  `railPathIsPassable`), trail des wagons (`seedTrainTrail`,
  `recordTrainTrailPoint`, `trimTrainTrail`), dépôt
  (`trainCanLeaveDepotNow`, `setTrainDepotDeparture`), mouvement
  (`advanceRailVehicle`, `replanTrainAtSignal`, `updateTrainVehicle`,
  `trainProcessStop`). **Véhicules achetés** : `createPersistentVehicle`,
  `findRoadPath`, `vehicleCanServeRoute`, `startVehicleRoute`,
  `returnToGarage`, `updateVehicles`. **Bus** : `busEarnRevenue`
  (intra/inter-ville, partage multi), `findNearbyTrainStation`.
- **`05_depots/`** : enregistrement des dépôts dans la toolbar via
  `registerDepotTool`.
  - `vehicules.js` : `garage` (camions + bus, `buyCatalog` depuis
    `VEHICLE_TYPES`).
  - `train.js` : `train_depot` (`buyCatalog: ['train']`).
  - `bateau.js` : `boat_depot` (**placeholder**, `buyCatalog: []`).
  - `avion.js` : `plane_depot` (**placeholder**, `buyCatalog: []`).
- **`06_simulation.js`** : boucle `update(dt)` (voir l'ordre détaillé
  dans `SESSION_CONTEXT.md`). Helpers : `fisherFishBonus`,
  `checkRect`/`checkRectInd`, `tryMerge`/`tryMergeInd`/`tryMergeDepot`/
  `tryMergeTrainStations`, `growPop`, `pathToEdge` (Dijkstra maison),
  `spawnWalker`, `spawnLeavers`, `residentialSplitPlan` (backtracking),
  `splitBuilding`, `leaveOne`, `updateWalkers`.
- **`07_rendering.js`** : `draw()` principal (voir ordre dans
  `SESSION_CONTEXT.md`). Système iso (`shade`, `quad`, `diamond`,
  `prism`, `trainPrism`, `spriteDepthKey`, `buildingDepthKey`), sprites
  / packs (`graphicPack`, `packTerrain`, `packBuildingColor`,
  `spriteForBuilding`, `viewForSprite`, `imageForSprite`,
  `contentBoundsForSprite`, `drawBuildingSprite`), primitives de décor
  (`drawTree`, `computeFishTiles`, `getFishTiles`, `drawFishOnTile`),
  bâtiments (`drawBuilding`, `drawTrainStationPiece`,
  `drawPausedBuildingBadge`, `drawBuildingLayerDiagnostic`), véhicules
  (`drawTruck`, `drawVehicle`, `drawTrainWagon`, `trainWagonPose`,
  `trainPose`, `trainBlendedDir`, `lanePose`), overlays
  (`drawWorkRadiusOverlay`, `drawFisherRadiusOverlay`,
  `drawVehicleRoute`), feux/signaux (`drawTrafficLight`,
  `drawRailSignal`), UI canvas (`drawTownLabels`, `drawTrainDepotFlags`,
  `drawExpansionBadges`, `jigsawPath`, `expPieceTabs`), floats
  (`addFloat`).
- **`08_ui_input_loop.js`** : HUD (`updateHUD`, `formatGameDate`),
  panneaux (`renderInfo`, `renderFinance`, `openTrainPanel`/
  `renderTrainPanel`, `openTownPanel`/`renderTownPanel`, `toggleFinance`,
  `goHelpPage`/`toggleHelp`), draggable (`makePanelDraggable`),
  toolbar (`buildToolbar`, `setTool`, `syncToolbarState`), souris
  (`updateMouseTile`, `selectTownLabelAt`, `selectTrainDepotFlagAt`),
  aperçus (`computeRoadPreview` Bresenham, `computeRailPreview` A*),
  caméra (`clampCamera`, `smoothCamera`, `panKeys`), options
  (`refreshOptMenu`, `buildLanguageSelect`, `buildGraphicPackSelect`),
  zone village (`updateZoneOverlay`, `cancelTownZoneSelect`),
  toasts (`toast`), confirmation (`confirmAction`), **boucle `frame(now)`**
  principale.
- **`09_multiplayer.js`** : WebSocket client (`mpConnect`, `mpDisconnect`,
  `mpJoinRoom`, `mpLeaveRoom`, `mpLogoutAccount`), sérialisation
  (`serializeState`, `applySnapshot`), remap d'owner (`remapOwnerId`,
  `applyOwnerRemap`, `inferSavedOwnerIdForUsername`), actions réseau
  (`netSend`, `applyAction` — switch géant sur tous les types d'action),
  override de `clickFn` et `drawFn` (curseurs distants), UI multi
  (`mpInjectUI`, `mpTogglePanel`, `mpUpdateUI`, `mpRenderRooms`,
  `mpRenderPlayerList`, `mpRenderSaves`, `mpRenderChat`, `mpSendChat`,
  `mpRenderNewCollapse`), helpers rail multi
  (`applyRailPathWithNetwork`).
- **`10_saves_chat_console.js`** : autosaves locales
  (`loadAutoSaves`, `performAutoSave`, `renderAutoSaves`,
  `autoSaveStorageKey`) + serveur (`autoSaveServerName`,
  `autoSaveServerPattern`), chat (`mpRenderChat`, `mpSendChat`),
  `escHtml` (échappement), commandes console exposées sur `window`
  (`regenExpansions`, `spawnFieldsOnMap`), **bootstrap final**
  (appel `mpInjectUI → buildToolbar → genWorld → renderAutoSaves →
  requestAnimationFrame(frame)`).

## Globals partagés importants

| Symbole | Défini dans | Rôle |
|---|---|---|
| `CONFIG` | `config.js` | Équilibrage gameplay |
| `BUILD`, `RES`, `LEVELS`, `VEHICLE_TYPES`, `TRAIN_WAGON_TYPES`, `T`, `RAIL_DIRS` | `01_definitions.js` | Catalogues |
| `terrain`, `road`, `rail`, `bgrid`, `buildings`, `trucks`, `vehicles`, `walkers`, `homeless`, `towns`, `expansions`, `cam`, `rot`, `gtime`, `selected`, `tool`, `paused`, `speed`, `UI_OPTIONS` | `02_world_state.js` | État runtime |
| `WALLETS`, `walletOf`, `myWallet`, `spendMoney`, `earnMoney` | `02_world_state.js` | Économie |
| `MP` | `04_construction.js` (état) / `09_multiplayer.js` (logique) | Multi-joueur |
| `newBuilding`, `capOf`, `accepts`, `recipeOf`, `demolishBuilding` | `03_buildings_population.js` | Bâtiments |
| `canPlace`, `clickAt`, `MP_ZONE` | `04_construction.js` | Construction |
| `tryDispatch`, `findRailPath`, `findRoadPath`, `updateVehicles`, `updateTrucks` | `05_logistics.js` | Logistique |
| `update`, `tryMerge`, `tryMergeInd` | `06_simulation.js` | Simulation |
| `draw`, `addFloat`, `iso` | `07_rendering.js` / `02_world_state.js` | Rendu |
| `frame`, `updateHUD`, `renderInfo`, `renderFinance`, `setTool`, `clickFn`, `drawFn`, `toast`, `confirmAction` | `08_ui_input_loop.js` | UI / boucle |
| `serializeState`, `applySnapshot`, `applyAction`, `netSend`, `mpInjectUI` | `09_multiplayer.js` | Multi |
| `t`, `setLanguage`, `applyI18n` | `i18n.js` | Traductions |
