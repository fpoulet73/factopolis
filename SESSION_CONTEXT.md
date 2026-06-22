# Factopolis — Contexte pour prochaines sessions

Ce fichier sert de point d'entrée rapide pour reprendre le projet sans
relire tout le code. Le README racine donne la description générale du
jeu et de l'architecture ; ce document est une **référence par système**.

## Concept du jeu

Factopolis est un jeu de gestion/simulation en navigateur qui mélange :

- chaînes de production type Factorio (extraction, recettes, stocks) ;
- city builder avec population, logements, taxes, ouvriers et villages ;
- transport tycoon : camions auto, bus, trains sur routes et rails
  (signaux, cantons) ;
- rendu isométrique 2.5D rotatif sur Canvas 2D.

Le joueur construit une ville industrielle : extraire fer/charbon/bois,
transformer en acier puis marchandises/outils, livrer les ressources aux
logements, faire grandir la population et financer l'expansion.

## Stack et lancement

- Frontend : `index.html`, `config.js`, `js/*.js`, Canvas 2D, JS vanilla.
- Backend : `server.js`, Node.js, serveur HTTP statique + WebSocket `ws`.
- Dépendance serveur : `ws` uniquement (aucune côté client).
- Lancement : `npm start` ou `node server.js [port]`.
- Port par défaut : `8765`.
- URL locale : `http://localhost:8765` · WebSocket : `ws://localhost:8765`.
- Le serveur peut être interrogé en console (`help`, `rooms`, `players`,
  `saves`, `say`, `kick`, `promote`, `setmoney`, `regenexpansions`,
  `spawnfields`, `stop`).

## Fichiers principaux

- `index.html` : DOM, styles inline, canvas, topbar, splash, aide
  paginée, chargement de `config.js` + scripts `js/` dans l'ordre.
- `config.js` : valeurs de gameplay configurables sans modifier le
  moteur (production, recettes, bâtiments civils, logements par niveau,
  fusions industrielles, pénurie, habitants, économie, camions, dépôts,
  bus, trains, véhicules, lac/poisson).
- `js/01_definitions.js` : constantes, ressources `RES`, catalogue
  `BUILD`, recettes, fusions, helpers de villages, packs graphiques.
- `js/02_world_state.js` → `js/10_saves_chat_console.js` : voir
  `js/README.md` pour le détail par fichier.
- `server.js` : fichiers statiques, multi-room, WebSocket, auth scrypt,
  snapshots, actions sanitizées, sauvegardes, console serveur.
- `data/users.json` : créé au runtime, comptes (scrypt hash + sel).
- `data/saves/<user>_<nom>.json` : sauvegardes par utilisateur.
- `assets/graphic-packs/` : thèmes + sprites (packs communautaires).

## État du jeu côté client

Variables globales principales (déclarées pour la plupart dans
`02_world_state.js`) :

- `terrain` : `Uint8Array(N*N)`, types `GRASS`, `WATER`, `TREE`, `IRON`,
  `COAL`, `WHEAT`, `COTTON`.
- `road` : `Uint8Array`, routes par tuile (8-connues).
- `rail` : `Uint8Array`, masque bitfield des connexions rail
  (`RAIL_DIRS`, 8 directions).
- `railSignals`, `railBlocks`, `railBlockOccupancy` : signaux,
  cantons et occupation par canton (Int16Array reconstruit chaque frame).
- `bgrid` : `Array(N*N)`, référence vers le bâtiment couvrant chaque tuile.
- `buildings` : bâtiments actifs.
- `trucks` : camions éphémères auto-dispatchés.
- `vehicles` : véhicules persistants achetés (camions/bus/trains).
- `walkers`, `homeless` : habitants qui entrent/sortent à pied.
- `floats` : textes flottants de feedback.
- `towns`, `nextTownId`, `selectedTownId` : villages/villes.
- `expansions`, `expansionLevels`, `purchasedPieces` : pièces d'expansion.
- `mapBounds`, `mapMask` : boîte jouable + masque des tuiles jouables.
- `WALLETS` : économie par joueur (clé `0` en solo, id joueur en multi).
- `MP` : état multijoueur local (voir section dédiée).
- `UI_OPTIONS` : préférences UI persistées (`language`,
  `hideColorMarkers`, `highlightUnderstaffedFactories`,
  `disableTrafficLights`, `graphicPack`).

La taille par défaut est `N = 64` (redimensionnable 32 → 128 via
`setMapSize`). Constantes iso : `TILE = 36`, `TW = 64`, `TH = 36`,
`TW2 = 32`, `TH2 = 18`.

## Projection isométrique

- `rot` ∈ 0..3 (mapping N/E/S/W).
- `rotIdx(x,y)` / `invRotIdx(rx,ry)` : conversion tuile monde ↔ espace
  tourné.
- `rotF(tx,ty)` / `invRotF(u,v)` : variantes flottantes.
- `iso(u,v)` : projection tuile tournée → pixels écran
  `[(u-v)*TW2, (u+v)*TH2]`.
- `centerOn(wx, wy)` / `rotate(d)` : caméra ; préserve le centre visé.

## Ressources

15 ressources (`RES`) : `iron`, `coal`, `wood`, `wheat`, `cotton`,
`clothes`, `flour`, `water`, `bread`, `fish`, `fish_fillet`, `fish_oil`,
`steel`, `goods` (outils de construction), `dirt` (terre de remblai).
`TRADE_PRICES` définit les prix de vente inter-joueurs.

## Bâtiments

Outils/bâtiments (catalogue `BUILD`) :

- **Infrastructure** : `road`, `rail`, `rail_signal`, `train_station`,
  `train_platform`, `garage`, `train_depot`, `boat_depot`, `plane_depot`,
  `bus_stop`, `depot` (entrepôt), `market`, `tank` (citerne d'eau).
- **Production** : `mine` (fer/charbon selon gisement), `lumber` (bois),
  `farm`, `cotton_farm`, `pump` (eau), `fisher` (poisson), `weaver`,
  `mill`, `bakery`, `fishery`, `smelter`, `factory`, `terrassement`
  (produit `dirt`).
- **Logement** : `house`, `duplex`, `row`, `residence`, `tower`,
  `bigtower`, `tower3`, `sky` (gratte-ciel).
- **Outils** : `select`, `bulldoze`, `terraform`, `fill_water`.
- **Usine abandonnée** `plant` : à spécialiser en
  farm/cotton_farm/lumber/fisher/pump/mine via `applyPlantUpgrade`.

Les définitions de base sont dans `BUILD`. Les valeurs configurables sont
appliquées ensuite depuis `CONFIG`.

## Recettes de transformation

- `weaver` : 3 cotton → 1 clothes
- `mill` : 2 wheat → 1 flour
- `bakery` : 0.5 coal + 2 flour + 1 water → 1 bread (nécessite `tank`
  à portée `BAKERY_TANK_RADIUS = 8`)
- `fishery` : 2 fish → 1 fish_fillet + 1 fish_oil
- `smelter` : 1 iron + 1 coal → 1 steel
- `factory` : 1 steel + 1 wood → 1 goods

`PROD_CONFIG_KEYS` fait le pont entre clés `CFG.production` (`bucheron`,
`fonderie`…) et types de bâtiments (`lumber`, `smelter`…).

## Boucle de simulation

La boucle `frame()` (dans `08_ui_input_loop.js`) :

1. `panKeys(dt)` puis `smoothCamera(dt)` (caméra lissée vers `targetCam`).
2. appelle `update(dt * speed)` si non pause.
3. dessine via `drawFn()` (surchargé en multi pour curseurs).
4. met à jour le HUD (`updateHUD`).
5. décrémente `autoSaveTimer` (autosave local + serveur).
6. relance `requestAnimationFrame`.

`update(dt)` dans `06_simulation.js` gère dans l'ordre :

1. sync pré-boucle (`ensureAllStarterProtections`,
   `refreshWorkerAllocation`, `syncIncomingReservations`,
   `syncResidentReservations`).
2. production (avec `eff` efficacité = workers alloués/requis).
3. consommation des logements (revenu + bonus +20 % si ressource bonus).
4. croissance population (walkers si logement plein et approvisionné).
5. pénurie (split ou perte d'habitant).
6. fusions périodiques (`tryMerge`, `tryMergeInd`, `tryMergeDepot`,
   `tryMergeTrainStations`).
7. dispatch automatique des camions (`tryDispatch` toutes les 0.7 s).
8. mouvements (`updateTrucks`, `updateVehicles`, `updateWalkers`).
9. transfert passagers bus → gare.
10. taxes (par wallet, sur `popTotal(oid)`).
11. entretien bâtiments (`IND_UPKEEP_INTERVAL`).
12. entretien véhicules (`VEHICLE_MAINTENANCE_DAY`, +3 %/mois).
13. historique financier (`finHist`, max 61 échantillons).
14. milestones de population.
15. floats.
16. bus stops & gares : remplissage passagers sur 3 jours de jeu.

## Population, logements et pénurie

Les logements consomment les ressources indispensables (configurables
par niveau : `ressourcesIndispensables`,
`ressourcesFusion`, `ressourcesBonus`).

- Chaque consommation donne de l'argent et peut déclencher l'arrivée
  d'un habitant (`spawnWalker` via `pathToEdge`, Dijkstra maison).
- Croissance bonus si stock > seuil → +1 habitant toutes les
  `BONUS_GROWTH_INTERVAL` s.
- Si un logement peuple reste sans ressources indispensables pendant
  `STARVE_DELAY`, il se dégrade :
  - bâtiment fusionné → `splitBuilding` se sépare en logements inférieurs
    (via `residentialSplitPlan`, backtracking) + leavers à pied ;
  - maison simple → `leaveOne` perd un habitant.

Les fusions résidentielles demandent un rectangle complet de logements
plus petits, pleins et approvisionnés.

Niveaux (du plus petit au plus grand) :
- `house` 1×1 ;
- `duplex` 2×1 / 1×2 ;
- `row` 3×1 / 1×3 ;
- `residence` 4×1 / 1×4 ;
- `tower` 2×2 ;
- `bigtower` 3×2 / 2×3 ;
- `tower3` 3×3 ;
- `sky` gratte-ciel 4×4 (150 hab).

## Villages / villes

Chaque logement est rattaché à un village :

- `generateTownName(seedX, seedY)` : nom déterministe par position
  (cohérence multi).
- `assignBuildingToTown(b)` rattache au village le plus proche ; crée
  un nouveau village si hors portée.
- `townReachableJobBuildings(tid)` : emplois accessibles depuis les
  maisons du village (selon `workRadiusOf`).
- `refreshWorkerAllocation()` : deux passes — proximité d'abord, puis
  bus_stops à portée pour compléter (`workersByBusStop`).
- `mergeTowns(dstId, srcId)` / `reassignBuildingsInRect(...)` : fusion
  et réaffectation (création par rectangle via panneau village).

`IND_AREA_RADIUS = 30` : rayon de nommage industriel anti-doublon
(`assignIndustryName`).

## Industrie et fusions

Bâtiments industriels identiques (même type, même minerai pour les
mines, non en pause) fusionnent en rectangles :

- formes par défaut : `2×1, 3×1, 4×1, 2×2, 3×2, 3×3, 4×4`
  (`IND_SHAPES_ALL`), surcharge possible par type dans
  `CONFIG.industrie.formesParType`.
- orientations inverses ajoutées automatiquement (`[2,1]` ⇒ `[1,2]`).
- production = `w·h × IND_FACTORS[aire]` (`{2:1.15, 3:1.3, 4:1.5,
  6:1.75, 16:2.5}`, palier inférieur).
- entretien industriel périodique : `base × cases × facteur`, réduit
  si en pause (`PAUSE_UPKEEP = 0.5`).

Entrepôts (`depot`) fusionnables aussi (`DEPOT_SHAPES`,
`checkRectDepot`, `tryMergeDepot`) : la capacité de stock est sommée,
les permissions `allow` héritées, les petits bâtiments supprimés.

## Logistique

### Camions automatiques

- Un bâtiment doit toucher une route via `adjRoadTiles()`.
- `tryDispatch(b, res, load)` fait un **BFS routier** (8-connexité avec
  contrainte anti-coup de coin) pour scorer les cibles et crée un
  camion vers la meilleure. Score :
  `distScore + (hub?500:0) + (full?200:0) + stockRatio*150`.
- Les dépôts (`storageHub`) sont cibles en dernier recours.
- Les logements pleins sont moins prioritaires.
- Les ressources en transit sont comptées dans `inc` pour éviter la
  sur-livraison.
- `tryRedirect` : re-BFS si la cible est pleine/supprimée.

### Véhicules achetés (camions/bus)

- Achetés dans un `garage` selon `VEHICLE_TYPES`.
- Types : `minerai`, `plateau`, `cereale`, `marchandises`, `frigo`,
  `citerne`, `bus` (les clés historiques `bois`, `ble`… restent pour
  compatibilité mais `buyDisabled: true`).
- L'utilisateur assigne la route via `vehicleRouteMode`
  (source → dest) ; `findRoadPath` (BFS) calcule l'itinéraire.
- Bus : revenu `nb × distance × BUS_FARE_FACTOR`, divisé par
  `BUS_INTRA_CITY_DIV` pour un trajet intra-ville, et partagé
  `BUS_OWNER_SHARE = 0.8` entre propriétaires pour un trajet inter-joueurs.
- Maintenance : `maintenanceCost × (1 + VEHICLE_MAINTENANCE_RATE)^mois`
  prélevée tous les `VEHICLE_MAINTENANCE_DAY`.

### Trains

Le système le plus complexe (~880 lignes dans `05_logistics.js`) :

- **Réseau ferré** : masques bitfield par tuile (`RAIL_DIRS`).
- **Signaux et cantons** : `rebuildRailBlocks` (BFS) découpe en cantons
  à chaque signal ; `rebuildRailBlockOccupancy` recompte l'occupation
  chaque frame ; `railSignalAspect` détermine rouge/vert effectif.
- **Pathfinding** : `findRailPath` (BFS tuile-par-tuile respectant bits,
  sens, anti-demi-tour via `previousTile`, quais libres) ;
  `findRailPathFromDecision` à une bifurcation choisit la branche la
  plus courte entièrement verte.
- **Trail des wagons** : `seedTrainTrail` reconstruit une voie "arrière"
  pour positionner les wagons même après replanification.
- **Quais** : `trainStationStopTiles` choisit le quai d'arrivée selon
  l'axe d'approche ; `trainTargetTileAvailable` réservation souple
  (train le plus proche gagne, tie-break par `id`).
- **Circuits** : `v.orders` (≥ 2), `orderIndex` circulaire,
  `syncTrainOrders` nettoie les doublons.
- **Dépôt** : `setTrainDepotDeparture` arme le départ manuel (drapeau
  UI dans `08_ui_input_loop.js`).
- **Revenus** : passagers = `nb × distance × TRAIN_FARE_FACTOR`,
  fret = `× TRAIN_FREIGHT_FACTOR`.

### Bus et arrêts de bus

- `bus_stop` configuré par `CONFIG.logistique.arretBus` (rayon 8,
  tarif 1, diviseurIntra 3, partProprietaire 0.8).
- `refreshTransitPassengerCaps()` répartit les habitants oisifs d'un
  village entre les arrêts à portée (apportionment à reste trié).
- Transfert bus → gare via `passengersEntrant`/`passagersSortant`.

### Bateaux et avions

**Placeholders uniquement** : `boat_depot` et `plane_depot` sont
déclarés dans `js/05_depots/bateau.js` et `avion.js` mais `buyCatalog`
est vide et aucune logique de déplacement n'existe. Structure prête pour
implémentation future.

### Gares

- `train_station` + `train_platform` constituent un **groupe de gare**
  (`stationGroupId`), fusionnable (`tryMergeTrainStations`) si même axe
  et même longueur.
- `trainStationPlacementInfo` valide la pose (1er quai doit toucher la
  gare, suivants raccordés à un quai existant).
- Une gare peut être **liée** à un dépôt (`trainStationLinkedDepot`)
  pour le fret et à des bus_stops à proximité pour les passagers.

## Économie

Chaque wallet contient :

- `money` : argent ;
- `basePop` : population de base ;
- `fin` : compteurs financiers
  `{ventes, taxes, rembours, construction, entretien, expansion}` ;
- `finHist[]` : historique (max 61 échantillons ~1 s) pour calculer
  le rythme $/min ;
- `mi` : progression des milestones `[25, 50, 100, 200, 400]` ;
- `eff` : efficacité de production (workers alloués / requis) ;
- `starterHomes`, `starterHomesGranted` : 2 maisons protégées par
  joueur pour éviter le blocage au démarrage.

En multi, chaque joueur a son wallet. Les revenus, taxes, entretien et
coûts sont appliqués au propriétaire du bâtiment/véhicule.

## Expansion de carte

Le joueur achète des **pièces de puzzle** sur les 4 bords + 4 coins :

- `refreshExpansionSlots()` calcule les pièces (3 par bande + 4 coins),
  avec multiplicateur `2^level` pour les bandes suivantes.
- `jigsawTileInPiece` détermine l'appartenance d'une tuile à une pièce
  (formes "tabs" circulaires).
- `buyExpansion(exp)` débite le wallet, étend `mapMask` et `mapBounds`,
  incrémente `expansionLevels` à la complétion d'une bande.
- `expTileCost(t)` : prix de base par type de terrain (eau 600, herbe
  3000, coton 4200, fer 6000…).

## Multijoueur

Le serveur n'est **pas autoritaire** sur la simulation. Il :

- sert les fichiers statiques ;
- gère le **multi-room** (plusieurs mondes simultanés, créés au démarrage
  à partir des sauvegardes non-auto) ;
- attribue un id, une couleur et un rôle (hôte/invite/admin) ;
- **sanitizaiton stricte** des actions (`sanitizeAction` : whitelist de
  types et validation des paramètres) ;
- relaie `action`, `cursor`, `chat` ;
- demande à l'hôte un snapshot complet quand un nouvel invité arrive ;
- gère comptes, tokens et sauvegardes.

Côté client :

- `serializeState()` produit l'état complet envoyé par l'hôte ou sauvegardé.
- `applySnapshot(d)` remplace l'état local (avec migration anciens
  formats et remap d'owner ID).
- `applyAction(msg)` rejoue une action reçue d'un autre joueur.
- `clickFn` est surchargé en multi pour envoyer l'action via `netSend`
  puis l'appliquer localement.
- Les bâtiments posés en multi reçoivent `owner = MP.myId`.
- `MP_ZONE = 20` interdit de construire trop près des bâtiments d'un
  autre joueur (parmi les joueurs **connectés**).
- Les curseurs des autres joueurs sont dessinés via surcharge de `drawFn`.

### Authentification, rôles et owner IDs

- **scrypt** + sel par utilisateur, token de session aléatoire persisté
  dans `localStorage['fp_token']`. (Compat SHA-256 historique conservée,
  migration auto à la première connexion.)
- L'**hôte** (`MP.role === 'host'`) répond aux `snapshot_request`,
  contrôle pause/vitesse.
- Les **admins** (`MP.isAdmin` ou via console `promote`) ont droits
  save/load/new world.
- À la (re)connexion, `remapOwnerId()` relie l'ancien owner ID au nouveau
  via `prevOwnerId` (serveur) ou `savedRegistry` (sauvegarde) et propage
  `owner_remap` aux autres clients.
- `userOwnerRegistry` (côté serveur) persiste dans les sauvegardes sous
  `state.playerRegistry`.

### Messages WebSocket

**Serveur → client** : `rooms_list`, `hello`, `promoted_host`,
`admin_promoted`, `admin_changed`, `snapshot_request`, `snapshot`,
`action`, `cursor`, `chat`, `player_list`, `player_left`, `host_absent`,
`auth_ok`, `logout_ok`, `auth_err`, `saves_list`, `save_ok`, `save_err`,
`save_deleted`, `permission_err`, `game_saved`, `game_loaded`,
`game_new_world`, `room_err`, `left_room`, `server_full`,
`server_shutdown`, `server_cmd`.

**Client → serveur** : `register`, `login`, `resume`, `logout`,
`list_rooms`, `join_room`, `create_room`, `leave_room`, `list_saves`,
`save_game`, `load_game`, `delete_save`, `new_world`, `snapshot`,
`action`, `cursor`, `chat`, `promote_admin`.

**Types d'actions** (sanitizées puis relayées) : `road`, `rail_update`,
`rail_signal_update`, `bulldoze_road`, `bulldoze_tree`, `terraform`,
`fill_water`, `bulldoze_bld`, `build`, `toggle_bld_pause`,
`toggle_out_block`, `clear_bld_stock`, `upgrade_plant`, `buy_vehicle`,
`sell_vehicle`, `route_vehicle`, `return_vehicle`, `merge_towns`,
`zone_reassign`, `rename_bus_stop`, `owner_remap`, `pause`, `speed`.

**Commandes serveur** (`server_cmd`) : `regen_expansions`,
`set_money {amount}`, `spawn_fields {fieldType, count}`.

## Sauvegardes

- **Locales** : autosaves en `localStorage` (rotation 5 slots,
  pattern `[Auto] <room> <slot>` en multi).
- **Serveur** : `data/saves/<user>_<nom>.json` par utilisateur.
- Format : `{ meta:{username, name, date}, state: serializeState() }`.
- Charger une sauvegarde diffuse `game_loaded` à tous les clients
  connectés (remplace la partie pour tout le monde dans la room).
- Autosaves serveur envoyées par le client admin toutes les
  `AUTO_SAVE_INTERVAL = 300` s (rotation `AUTO_SAVE_MAX = 5`).
- Résolution de fichier résiliente (recherche par nom de fichier, puis
  par `meta.username` / `meta.name`, insensible à la casse).

## UI et contrôles

Interface principale :

- **splash** : titre isométrique + bouton "Commencer".
- **topbar** : argent (cliquable → finances), village, population,
  emplois, camions, date jeu, rotation, pause, vitesses 1×/2×/3×,
  aide, calques (surbrillance usines sous-effectuées), options
  (langue, pack graphique, marqueurs couleur, feux).
- **toolbar** : outils + menus déroulants (groupe Ferroviaire,
  groupe Dépôts).
- **panneau info** : universel (bâtiment, véhicule, expansion, gare,
  dépôt), avec édition du nom, filtres de dépôt, spécialisation plant,
  boutons pause/démolition/vente.
- **panneau train** : composition des wagons, ordres (circuit),
  drapeau de départ dépôt.
- **panneau village** : infos, fusions, création par rectangle.
- **panneau finances** : totaux et rythme $/min, bilans par catégorie.
- **panneau multijoueur** injecté par `mpInjectUI()` : connexion,
  auth, lobby des mondes, liste joueurs, sauvegardes, chat.
- **panneau aide** : 4 pages paginées (intro, bâtiments, logements &
  fusion, contrôles).

Panneaux draggable via leur `.panel-head`.

Contrôles :

- clic gauche : construire / inspecter / tracer route/démolition si
  glisse (Bresenham 8-dir ou angle droit avec Shift).
- clic droit glisse : caméra.
- clic droit simple : retour à l'outil inspecter.
- molette : zoom (lissage vers `targetCam`).
- `R` / `Maj+R` : rotation.
- `ZQSD`, `WASD` ou flèches : caméra.
- `1` à `9` : outils.
- `B` : bulldoze.
- `Espace` : pause.
- `H` : aide.
- `Échap` : annuler sélection/outil/zone.

## Internationalisation (i18n)

Système `i18n.js` (IIFE exposé sur `window`) :

- 3 langues : `fr` (défaut), `en`, `es` — dictionnaires dans
  `js/i18n/{fr,en,es}.js`.
- `t(key, vars)` : traduction avec substitution `{var}`.
- `applyI18n(root)` : applique aux éléments `[data-i18n]`,
  `[data-i18n-html]`, `[data-i18n-title]`.
- `setLanguage(lang)` : change, persiste, dispatche l'événement
  `factopolis:languagechange`.
- Préférence lue depuis `localStorage['factopolis_ui_options']`.

## Packs graphiques

Thèmes et sprites communautaires dans `assets/graphic-packs/` :

- 4 thèmes codés en dur : `classic`, `brick`, `modern`, `industrial`.
- Packs communautaires déclarés dans `packs.json` (déjà inclus :
  `medieval`, `example`).
- Format `pack.json` détaillé dans `assets/graphic-packs/README.md` :
  vues directionnelles `N/E/S/W`, variantes par empreinte, ancrages
  PNG/SVG, `fit: "footprint"`, `autoScale`.
- Outil : `tools/generate-medieval-pack.js` génère les sprites
  médiévaux. `tools/graphic-pack-inventory.js` inventorie un pack.

## Rendu isométrique

`draw()` dans `07_rendering.js` suit cet ordre :

1. ciel (gradient) ;
2. transformation iso (`setTransform` DPR + zoom) ;
3. calcul viewport visible ;
4. précompute rayons de sélection (logements, dépôts, citernes,
   industries, pêcheries) ;
5. **passe 1 — sol** : eau (+ poissons procéduraux), herbe + décorations
   (blé, coton, minerai, arbres), falaises, zones d'expansion ;
6. **passe 2 — routes & rails** : bitume, lignes, ballast, traverses,
   double rail, **signaux**, **feux de circulation** ;
7. overlays de rayon (résidentiel/dépôt/citerne/industrie/pêcherie) ;
8. collecte sprites (bâtiments via sprites ou prismes, arbres, véhicules
   avec wagons, walkers, homeless) ;
9. tri par `spriteDepthKey` puis dessin (painter's algorithm) ;
10. parcours véhicule sélectionné ;
11. labels de village + drapeaux de dépôt train ;
12. aperçus (route, rail, fantôme de placement, rayon) ;
13. badges expansion (jigsaw) ;
14. textes flottants avec fondu.

`drawFast` (défini dans `02_world_state.js`) : pendant zoom/pan, saute
les éléments décoratifs (fenêtres éclairées, badges, overlays) pour
préserver le FPS. La simulation n'est pas gelée.

## Points d'attention connus

- Le serveur relaie les actions sans validation métier complète
  (sanitization des paramètres mais pas de logique métier). Les clients
  valident aussi certains droits, mais ce n'est pas une sécurité forte.
- Les snapshots ne sérialisent pas les camions, walkers et floats ; ils
  sont remis à zéro au chargement/synchronisation.
- Les sauvegardes sont par utilisateur, mais charger une sauvegarde
  remplace la partie pour tous les clients connectés à la room.
- Bateaux et avions = placeholders (dépôts achetables, aucun déplacement).
- `rename_bld` est envoyé en multi mais non géré dans `applyAction` —
  à corriger.
- `node_modules/` est présent dans le workspace et non suivi par git.

## Style de modification recommandé

- Garder le projet vanilla et sans build step sauf besoin explicite.
- Modifier `config.js` pour l'équilibrage gameplay quand c'est possible.
- Toucher le fichier `js/` correspondant au domaine visé ; voir
  `js/README.md`.
- Toucher `server.js` pour auth, sauvegardes, protocole WebSocket et
  fichiers statiques.
- Éviter les refactors larges : le client reste en scripts classiques
  avec globals partagés, découpés par domaines.
- Tester au minimum avec `npm start`, connexion à
  `http://localhost:8765`, puis panneau multijoueur sur
  `ws://localhost:8765`.
