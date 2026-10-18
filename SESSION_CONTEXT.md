# Factopolis — Contexte pour prochaines sessions

Ce fichier sert de point d'entrée rapide pour reprendre le projet sans
relire tout le code. Le README racine donne la description générale du
jeu et de l'architecture ; ce document est une **référence par système**.

## Concept du jeu

Factopolis est un jeu de gestion/simulation en navigateur qui mélange :

- chaînes de production type Factorio (extraction, recettes, stocks) ;
- city builder avec population, logements, taxes, ouvriers et villages ;
- transport tycoon : camions auto, bus, trains sur routes et rails
  (signaux, cantons), bateaux (ports) et avions (aéroports) ;
- rendu isométrique 2.5D rotatif : scène PixiJS (WebGL) dont les textures
  sont dessinées en Canvas 2D procédural (`07_rendering_art.js`) ;
- exclusivement multijoueur (rooms serveur),
  avec une progression guidée par objectifs (primes).

Le joueur construit une ville industrielle : extraire fer/charbon/bois,
transformer en acier puis marchandises/outils, livrer les ressources aux
logements, faire grandir la population et financer l'expansion.

## Stack et lancement

- Frontend : `index.html`, `config.js`, `js/*.js`, PixiJS embarqué (`js/pixi/`), JS vanilla.
- Backend : `server.js`, Node.js, serveur HTTP statique + WebSocket `ws`.
- Dépendance serveur : `ws` uniquement (aucune côté client).
- Lancement : `npm start` ou `node server.js [port]` (`FACTOPOLIS_DATA_DIR`
  permet un dossier de données alternatif, utilisé par les tests).
- Tests : `npm test` (Playwright requis) — voir `tools/tests/run-all.js`.
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
  `COAL`, `WHEAT`, `COTTON`, `SAND`, `CLAY`, `COPPER`, `GOLD`, `LIMESTONE`,
  `OIL` (`isMineDeposit`, `isClearableTerrain`).
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
- `WALLETS` : économie par joueur (clé `0` hors room, id joueur en room).
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

45 ressources (`RES`, champ `cat` → familles `RES_CATEGORIES`, helper
`resKeysByCategory`) : les 15 historiques (`iron`, `coal`, `wood`, `wheat`,
`cotton`, `clothes`, `flour`, `water`, `bread`, `fish`, `fish_fillet`,
`fish_oil`, `steel`, `goods`, `dirt`) + gisements (`copper_ore`, `gold_ore`,
`limestone`, `sand`, `clay`, `oil`), métallurgie (`copper`, `copper_wire`,
`gold`, `nails`), matériaux de chantier (`steel_beam`, `steel_plate`, `cement`,
`concrete`, `glass`, `window`, `rope`, `paint`), chimie (`chemicals`, `fuel`,
`plastic`, `glue`), électronique (`circuit`, `quantum_chip`), luxe (`furniture`,
`appliances`, `jewelry`) et ressources spatiales (`helium3`, `xenite`).
`TRADE_PRICES` définit les prix commerciaux (marché, fret). Les camions/wagons
se partagent les familles `CARGO_BULK` (vrac), `CARGO_FLAT` (plateau),
`CARGO_GOODS` (marchandises) et `CARGO_LIQUID` (citerne).

**Génération** (`genWorld`) : eau, relief, arbres, taches de blé/coton puis des
gisements de `WORLD_DEPOSITS` (fer, charbon, cuivre, calcaire, pétrole, or — clés
`monde.ressources` de `config.js`), au moins une zone de chaque ressource dans la
zone jouable, sable/argile sur le littoral, puis
**zone de départ garantie** (`ensureStarterArea`, résultat dans `starterSite`) :
site de plaine dégagé proche du centre à ~5 cases d'une rive (étang creusé si
aucune eau à portée), fer, charbon et bosquet à moins de ~11 cases, et au moins
une case de rive plate en herbe (première cabane de pêcheur). Blé et
coton restent dispersés (transport en milieu de partie). La caméra démarre sur
ce site.

## Bâtiments

Outils/bâtiments (catalogue `BUILD`) :

- **Infrastructure** : `road`, `rail`, `rail_signal`, `train_station`,
  `train_platform`, `garage`, `train_depot`, `boat_depot`, `plane_depot`,
  `bus_stop`, `depot` (entrepôt), `market`, `tank` (citerne d'eau).
- **Production** : `mine` (fer/charbon/cuivre/or/calcaire/sable/argile selon
  gisement), `oil_well`, `lumber` (bois), `farm`, `cotton_farm`, `pump` (eau),
  `fisher` (poisson), `weaver`, `mill`, `bakery`, `fishery`, `smelter`,
  `factory`, `terrassement` (produit `dirt`), les 19 usines avancées
  (cf. « Chaînes avancées ») et `space_center`.
- **Logement** : `house`, `duplex`, `row`, `residence`, `tower`,
  `bigtower`, `tower3`, `sky` (gratte-ciel) ; luxe : `lux_house` →
  `lux_villa`, `lux_manor`, `lux_estate` (cf. « Maisons de luxe »).
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

### Chaînes avancées

- La `mine` extrait la ressource de sa tuile (`DEPOSIT_ORES` : fer, charbon,
  cuivre, or, calcaire, sable, argile) ; `oil_well` se pose sur `T.OIL`.
- `ADVANCED_FACTORIES` (01_definitions.js) déclare 19 usines obtenues en
  spécialisant une usine abandonnée (`PLANT_UPGRADES`, groupées par
  `PLANT_UPGRADE_CATEGORIES` dans le panneau) : cuivre, tréfilerie, or, laminoir,
  tôlerie, clouterie, cimenterie, centrale à béton, verrerie, vitrerie, corderie,
  raffinerie, usine chimique, peinture, électronique, ébénisterie, électroménager,
  joaillerie, laboratoire quantique. Recettes, temps, coûts et entretien dans
  `config.js` (`production.<cléFrançaise>`), description générée (`recipeText`).
- Les usines dont la recette consomme de l'eau (`usesWater` : boulangerie,
  centrale à béton, usine chimique) ne la reçoivent que par une citerne proche ;
  les pompes ne livrent qu'aux citernes.
- `essentialResources()` (priorité des ouvriers) ne compte que les besoins des
  logements ouvriers : le luxe ne détourne pas la main-d'œuvre alimentaire.

### Matériaux de chantier

`CFG.materiauxChantier.batiments` → `BUILD_MATERIALS` / `buildMaterialsOf(type)`.
Concernés par défaut : port, pièces d'aéroport (hors déco), centre spatial et usines
avancées (raffinerie, usine chimique, affinerie d'or, électronique, électroménager,
labo quantique). Les gares, quais et dépôts de train n'en demandent pas (le code
les gère si on ajoute leurs clés). Fonctions (03_buildings_population.js) : `buildMaterialsFor` (null si désactivé :
`actif:false` ou `WORLD.buildMaterials === false`), `materialDepotsFor(x,y,w,h,owner)`
(entrepôts/marchés du joueur dont `depotRadiusOf` couvre le centre du chantier),
`buildMaterialsMissing`, `buildMaterialsError`, `consumeBuildMaterials`
(plus proches d'abord), `materialTypeForTool` (l'outil Gare pose un
`train_platform` sur un rail). `canPlace` renvoie `{ ok:false, msg, materials }`
quand il en manque ; `clickAt`, l'action réseau `build` (validée par l'hôte) et
`applyPlantUpgrade` les prélèvent. Le fantôme affiche besoin/manque et les rayons
des entrepôts. `WORLD.buildMaterials` voyage dans le snapshot (les tests
`T_.flatWorld()` le mettent à false).

### Centre spatial

`space_center` (`BUILD.size` 3, `noMerge` : ouvriers/entretien comptés une fois via
`indAreaOf`). `footprintOf(t)` + `canPlace` vérifient l'emprise plane et libre.
`updateSpaceCenter` (06_simulation.js) : assemblage (pièces `SPACE_ROCKET_PARTS`
en stock + ouvriers, `SPACE_ASSEMBLY_TIME`) → décollage (`b.spacePhase='flight'`,
`b.launches++`, une de la Gazette) → mission (`SPACE_MISSION_TIME`, sans ouvriers)
→ capsule : `SPACE_CARGO` (hélium-3, xénite) en stock. `recipeOf` renvoie la durée
de la phase en cours (barre de progression). `spacePhase`/`launches` sont
sérialisés ; `spaceCenterPhaseChanged` (07_rendering.js) lance l'animation
(`drawRocketFx` : décollage, capsule sous parachute) côté hôte comme invité.
L'art (`artSpaceCenter`) montre la fusée sur le pas de tir pendant l'assemblage
(`spacePadHasRocket`, inclus dans `bldSig`).

### Noms des points de transit et voyageurs d'un bus

- `uniqueTransitName` / `assignTransitName` (01) : arrêts de bus, gares, aéroports et ports reçoivent
  un nom unique selon l'emplacement (`placeContextAt` : village ou région de la carte, lieu de loisirs /
  industrie nommée à moins de 10 cases, bord de l'eau, direction), puis un numéro en dernier recours.
  Appelé à la pose (04, 09 `build`) et à la migration d'un chargement (nom saisi par le joueur conservé).
- Un bus mémorise la provenance de ses voyageurs (`v.cargoOwners` = { joueur: n }, `setBusLoad`,
  `busCargoLines`) ; le panneau du véhicule déplie une ligne par joueur au clic sur « Cargaison ».
- `arriveAtStop` (05) : les voyageurs qui descendent à un arrêt partent aussitôt vers un lieu de loisirs
  qui les attire, avant que le bus ne les rembarque pour le retour.

### Propriétaire du monde

Le créateur du monde (`MP.roomCreator`, `mpIsWorldOwner`) peut démolir les bâtiments des autres
joueurs (`demolishForeignBuilding`, 04) après confirmation ; le remboursement revient à leur
propriétaire. Tous les clients valident l'action `bulldoze_bld` avec `msg.fromUsername`.

### Magasins
Un **Magasin** vierge (`shop`, menu Bâtiments) se spécialise une fois, comme une usine abandonnée
(même action réseau `upgrade_plant`, `plantUpgradeError` / `applyPlantUpgrade`) : épicerie, fournitures,
outils, bricolage (`SHOP_DEFS`, 01 ; réglages `config.js` `magasins` : coût, rayon, capacité, marge,
produits). Un type spécialisé porte `BUILD[t].shop = { res, capacity, radius, margin }`.
- **Ravitaillement** : le magasin accepte ses produits (`accepts` / `capOf`, 03) mais seuls les entrepôts
  lui livrent (`tryDispatch`, 05) dans leur rayon ; il ne ré-expédie jamais (`dispatchBuilding`).
- **Ventes** : `tickShops` (06, chaque seconde) transfère les unités du stock du magasin vers les logements
  de son rayon qui les consomment ou les attendent (`residDeliveryResourcesOf`, `space`), les moins
  approvisionnés d'abord, dans la limite de `ventesParSeconde`. Le propriétaire du logement paie
  (`shopUnitPrice` = prix habitants × marge, catégorie financière `achats`), celui du magasin encaisse
  (`ventes`). Compteurs `b.shopSales` / `b.shopIncome`, sauvegardés et synchronisés.
- **Chaîne** : les magasins du même type et du même propriétaire dont l'un est dans le rayon de l'autre
  forment une chaîne transitive (`shopChainOf`). `tickShopChains` équilibre chaque produit sur la chaîne
  (les mieux remplis cèdent aux moins remplis, `chaineParSeconde`) : un magasin hors de portée d'un
  entrepôt est ravitaillé par un voisin qui en a un.
- Panneau : stock par produit, logements dans le rayon, chaîne, recettes ; cercle jaune du rayon à la sélection.

### Lieux de loisirs

15 types (`LEISURE_TYPES`, définis par `LEISURE_DEFS` dans 01_definitions.js,
réglages `config.js` `loisirs.lieux`) : restaurant, cinema, museum, treetop
(parcours dans les arbres, arbre à 2 cases), marina (base nautique, bord de l'eau),
tennis, basketball, spa, hotel, concert_hall, zoo, casino, baseball, stadium,
theme_park. Géométrie des terrains de sport partagée art/animations :
`tennisCourtRect`, `basketCourtGeom`, `baseballGeom` (07_rendering_art.js). `BUILD[t].leisure` =
`{ capacity, days, fee, near }` (`days` : jours de jeu sur place) ; emprise carrée `size` + `noMerge` (ouvriers et
entretien comptés une fois). Menu 🎡 Loisirs de la barre d'outils (ancre
`restaurant` dans `TOOL_ORDER`). Contrainte de site : `leisureNearError` (04).
Chaque lieu exige des matériaux de chantier (`config.js` `materiauxChantier.batiments`,
clé = type moteur), vérifiés et prélevés comme pour les ports et aéroports.
- **Rayon d'attractivité** : chaque lieu a son rayon (`BUILD[t].leisure.radius`, config
  `loisirs.lieux.<clé>.rayon`, bornes `rayonMin`/`rayonMax`) ; le joueur le règle lieu par
  lieu (`b.attractRadius`, boutons −/+ du panneau, `adjustLeisureRadius` / `setLeisureRadius`,
  action réseau `set_leisure_radius`, cercle rose autour du lieu sélectionné). `leisureRadiusOf(b)`.
  Un arrêt / une gare / un port / un aéroport situé dans ce rayon (peu importe le sien) y envoie
  ses voyageurs sortants.
- **Orientation** (visuelle) : `b.dir` (quarts de tour 0..3, 0 non stocké), choisie à la pose
  (touche T / Maj+T ou bouton ⟳ tactile → `leisurePlaceDir`, 04 ; fantôme dessiné avec l'art) et
  modifiable ensuite (boutons ⟲ ⟳ du panneau ou T sur le lieu sélectionné, `rotateLeisure` /
  `setLeisureDir`, action réseau `set_leisure_dir`, `dir` dans l'action `build`). L'art
  (`artLeisure`, 07_rendering_art.js) est décrit dans un repère LOCAL tourné par `_artXf`
  (`leisureXf` : q = (rot + dir) & 3) : le lieu garde son orientation dans le monde quand la
  caméra pivote. Les primitives (`artBox`, `artGable`, `artHip`, `artWindowGrid`, `artShadow`)
  dessinent les faces visibles de l'emprise tournée, `artWindow` masque une façade passée à
  l'arrière ; les éléments (`flat` / `at` / `atView`) sont triés de l'arrière vers l'avant de la
  vue (`artRunItems`). Animations : `leisureFxFrame(b).P` applique le même repère (`Pv` : vue).
- `tickSortantsToHomes` (06) : pour chaque point de transit ayant des passagers
  sortants, `sendSortantsToLeisure` les envoie d'abord vers les lieux dont le rayon
  d'attractivité couvre le point (le plus proche d'abord, `LEISURE_AFFLUX` par heure de jeu, dans
  la limite de `leisureCapacityOf` = capacité × part des employés en poste), avant
  la recherche d'un logement / Airbnb.
- `admitVisitors` : lot `{ t:gtime, n, o }` ajouté à `b.visitors`, entrée
  (`n × fee`) créditée au propriétaire du lieu (catégorie finance `loisirs`).
- `tickLeisureVisits` : au bout de `days` jours de jeu (`leisureStaySecs`), `sendVisitorsToTransit`
  renvoie le lot au point de transit le plus proche (de préférence du joueur
  d'origine) en passagers entrants. Démolition : `evictVisitors`.
- Cohérence : les visiteurs comptent dans `transitByOwner` (`visiting`) pour leur
  joueur d'origine, sans jamais être retirés.
- `visitors`, `visitsTotal`, `leisureIncome` sont sérialisés (`applyLeisureState`,
  09_multiplayer.js). Art : `artLeisure` (07_rendering_art.js). Animations :
  `drawLeisureFx` (07_rendering.js, couche 2D au-dessus des sprites) quand
  `cam.z >= LEISURE_FX_ZOOM` (`loisirs.zoomAnimation`) et que le lieu a des visiteurs ;
  géométrie identique à `artLeisure` (le parcours dans les arbres rejoue son hasard
  via `artSeedOf`). Base nautique : flottille (`drawWaterCraft`, types `WATER_CRAFT`)
  sur les cases d'eau à moins de `MARINA_FX_RADIUS` (8) cases (`marinaWaterTiles`,
  cache `b._fxWater`). Poissons : au zoom ≥ `FISH_ANIM_ZOOM` (`lac.zoomAnimationPoissons`)
  ils ne sont plus cuits dans le sol (`fishAnimated`, la clé du buffer inclut cam.z)
  mais animés par `drawFishFx` (nage, queue, sauts). Test :
  `tools/tests/moteur/loisirs.js`.

## Boucle de simulation

La boucle `frame()` (dans `08_ui_input_loop.js`) :

1. `simStep(now)` : avance la simulation jusqu'à l'instant de l'image
   (`update(dt * speed)` par tranches de 50 ms max, si non pause et si on est
   autoritaire), diffuse l'état (hôte) et gère l'autosave.
2. `panKeys(dt)`, `trackCamera()`, `smoothCamera(dt)`.
3. dessine via `drawFn()` (Canvas 2D overlays + `PixiScene.render()`), puis la
   mini-carte (`Minimap.draw`).
4. met à jour le HUD (`updateHUD`, 5×/s : panneaux, objectifs).
5. relance `requestAnimationFrame`.

Onglet en arrière-plan (rAF suspendu) : une horloge Web Worker prend le relais
de `simStep` (au-delà de 120 ms sans image) pour que l'hôte continue à simuler.

`update(dt)` dans `06_simulation.js` gère dans l'ordre :

1. objectifs (`updateObjectives`, 1×/s) puis sync pré-boucle
   (`ensureAllStarterProtections`, `refreshWorkerAllocationIfNeeded` — grille
   spatiale, recalcul sur changement ou toutes les 0,5 s —,
   `syncIncomingReservations`, `syncResidentReservations`).
2. production (avec `eff` efficacité = workers alloués/requis) ; elle ne
   s'arrête que si TOUTES les sorties sont pleines (sous-produit non bloquant).
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
par niveau : `ressourcesIndispensables`, `ressourcesUpgrade` (quota avant
fusion), `ressourcesBonus` — l'huile de poisson par défaut). Rayon de travail
d'un logement : `habitants.rayonTravail` (4 + 2 × plus grand côté).

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
- `sky` gratte-ciel 4×4 (180 hab).

### Maisons de luxe et classes d'habitants

- Débloquées par joueur à `LUX_UNLOCK_POP` habitants (`CFG.maisonLuxe.seuilHabitants`,
  100) ; déblocage définitif (`wallet.luxeUnlocked`, posé dans `update()`).
  Le menu Bâtiments affiche alors « Maison basique » / « Maison de luxe »
  (`syncLuxeToolbar`) ; `canPlace` refuse `lux_house` avant le seuil.
- Prix : `multiplicateurCout` (5) × prix de `house`, appliqué après la config.
- Ligne `LUX_LEVELS` séparée de `LEVELS` (01_definitions.js) : jamais de
  fusion (`checkRect`/`tryMerge` les ignorent) ni de défusion (pénurie →
  `leaveOne`). `tryExpandLuxury` (06_simulation.js) : logement plein + quota
  d'outils atteint → la maison s'étend **en place** (même objet) sur les cases
  libres voisines (`luxExpansionTileFree` : herbe plate au même niveau, sans
  route/rail/bâtiment), rectangle choisi par `luxExpansionRect` (le plus de
  route le long). Population inchangée, compteur d'upgrade remis à zéro.
- Niveaux : `lux_house` 1 case (ouvriers) → `lux_villa` 2 cases (employés) →
  `lux_manor` 2×2 (cadres) → `lux_estate` 3×3 (patrons, max). Art dédié
  dans 07_rendering_art.js (jardin, piscine, tennis, fontaine ; un étage max).
- Biens de luxe (config) : villa → meubles en bonus et pour s'agrandir ; manoir →
  meubles indispensables, électroménager en bonus, électroménager + bijoux pour
  s'agrandir ; domaine → meubles + électroménager indispensables, bijoux et
  processeurs quantiques en bonus.
- Classes (`RESIDENT_CLASSES`, `CFG.classesHabitants`) : la classe découle
  du type (`residClassOf`, `ouvrier` par défaut pour tous les logements
  basiques). Multiplicateurs `revenu` (consommation) et `taxe`
  (`popTaxMultiplier`). Pas d'effet sur l'allocation des ouvriers aux usines.

## Villages / villes

Chaque logement est rattaché à un village :

- `generateTownName(seedX, seedY)` : nom déterministe par position
  (cohérence multi).
- `assignBuildingToTown(b)` rattache au village le plus proche ; crée
  un nouveau village si hors portée.
- `townReachableJobBuildings(tid)` : emplois accessibles depuis les
  maisons du village (selon `workRadiusOf`).
- `refreshWorkerAllocation()` : deux passes — proximité d'abord, puis
  bus_stops à portée pour compléter (`workersByBusStop`). Ordre des postes :
  filières **vitales** d'abord (`isEssentialJob` : produit une ressource exigée
  par un logement ou l'un de ses intrants — poisson, filets, blé, farine, eau,
  charbon, pain, coton, vêtements ; cf. `essentialResources()`), puis les plus
  gros postes. Évite qu'une nouvelle fonderie vide les pêcheurs (spirale de
  déclin). Une usine du joueur sans aucun ouvrier affiche un badge « 👷 0/n ».
- Livraison des outils (ressource de fusion) : concentrée sur les logements
  **pleins** les plus avancés (score de `tryDispatch` dans `05_logistics.js`)
  pour que la première fusion arrive vite au lieu d'étaler le quota.
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
- **Occupation des cantons** : `trainFootprintIndex` (cantons couverts par loco
  + wagons de chaque train), reconstruit une fois par pas puis mis à jour à
  chaque train traité (`trainFootprintTouch`) → un canton qu'un train vient
  d'occuper est aussitôt rouge pour les suivants (y compris départs de dépôt).
- **Retournement** : `prepareRailTrip` détecte un demi-tour et retourne le
  convoi façon TTD (`trainReversalPlan` : la tête devient l'ancienne queue).
- **Itinéraire** : `findRailPath` préfère une sortie au premier feu vert mais
  se replie sur un itinéraire passant un feu rouge (le train attendra au feu).
- **Ordres en circulation** : `trainApplyOrdersLive` (panneau train ou action
  `route_vehicle` quand le train n'est pas au dépôt) ; replanification à la
  tuile suivante (`rerouteAtNextTile`). La composition reste au dépôt.
- **Fret payé une fois** : `b.trainReceived[res]` (stock livré par train) et
  `v.cargoFresh` (part « fraîche » du chargement) empêchent une rente en navette.
- **Circuits** : `v.orders` (≥ 2), `orderIndex` circulaire,
  `syncTrainOrders` nettoie les doublons.
- **Dépôt** : `setTrainDepotDeparture` arme le départ manuel (drapeau
  UI dans `08_ui_input_loop.js`).
- **Revenus** : passagers = `nb × distance × TRAIN_FARE_FACTOR`,
  fret = unités fraîches × prix commercial × distance × `TRAIN_FREIGHT_FACTOR`
  (`config.js` `logistique.gare`).

### Bus et arrêts de bus

- `bus_stop` configuré par `CONFIG.logistique.arretBus` (rayon 8,
  tarif 1, diviseurIntra 3, partProprietaire 0.8).
- `refreshTransitPassengerCaps()` répartit les habitants oisifs d'un
  village entre les arrêts à portée (apportionment à reste trié).
- Transfert bus → gare via `passengersEntrant`/`passagersSortant`.

### Bateaux et avions

- Types de véhicules à `mode` dédié (`VEHICLE_TYPES[k].mode` : road | rail |
  water | air) : `cargo_ship`, `ferry` (port `boat_depot`), `plane`
  (aéroport `plane_depot`). Réglages : `config.js` `logistique.bateau/avion`.
- Le port se pose au bord de l'eau. Itinéraire : `findWaterPath` (BFS 8
  directions sur l'eau, sans couper les coins) ; avion : `findAirPath` (ligne
  droite, altitude `planeAltitudePx` au rendu + ombre au sol).
- `vehiclePathBetween(v, a, b)` choisit route / eau / air ; bateaux et avions
  avancent sans trafic (`advanceFreeUnit`) et, à chaque escale,
  `transportStopProcess` décharge puis recharge (lignes à double sens).
- Fret (cargo) : réutilise `trainProcessStop` avec l'entrepôt collé au port
  (`portFreightHub`) et le tarif `SHIP_FREIGHT_FACTOR`. Voyageurs (ferry,
  avion) : habitants sans emploi dans le rayon de l'escale
  (`refreshTransitPassengerCaps`), revenu voyageurs × distance × tarif.

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
- `objIndex` : avancement dans `OBJECTIVES` (`06_simulation.js`) ; primes
  versées dans la catégorie `fin.primes` ;
- `mi` : progression des milestones `[25, 50, 100, 200, 400]` ;
- `eff` : efficacité de production (workers alloués / requis) ;
- `starterHomes`, `starterHomesGranted` : 2 maisons protégées par
  joueur pour éviter le blocage au démarrage.

En multi, chaque joueur a son wallet. Les revenus, taxes, entretien et
coûts sont appliqués au propriétaire du bâtiment/véhicule. Hors room (monde vierge du lobby) le wallet
est rangé sous la clé `0` alors que les bâtiments ont `owner = null` :
`walletOwnerOf(k)` fait la conversion pour les boucles « par wallet ».

## Expansion de carte

Le joueur achète des **pièces de puzzle** sur les 4 bords + 4 coins :

- `refreshExpansionSlots()` calcule les pièces (3 par bande + 4 coins),
  avec multiplicateur `2^level` pour les bandes suivantes.
- `jigsawTileInPiece` détermine l'appartenance d'une tuile à une pièce
  (formes "tabs" circulaires).
- `buyExpansionAction(exp)` (UI) diffuse l'action `buy_expansion` puis
  `buyExpansion(exp, payer)` débite le wallet, étend `mapMask` et `mapBounds`,
  incrémente `expansionLevels` à la complétion d'une bande (l'hôte rejoue
  l'achat pour le joueur expéditeur).
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
  puis l'appliquer localement ; hors room (`mpInRoom()` faux : hors ligne ou lobby)
  la construction est refusée (toast). Les tracés partent groupés
  (`applyRailPathWithNetwork`, `applyRoadPathWithNetwork`).
- L'hôte valide les poses reçues (`canPlace(..., actorId)` : terrain, emprise,
  matériaux de chantier dans les entrepôts de l'expéditeur ; fonds), prélève les
  matériaux et facture la composition des trains (`configure_train`).
  `ALLOWED_BUILD_TYPES` (server.js) inclut les pièces d'aéroport, les usines
  avancées et le centre spatial.
- Signature du monde (`worldSignature`, FNV-1a sur terrain, relief, routes,
  rails, tunnels, zones et signaux) jointe à chaque `state_sync` ; un invité
  durablement divergent envoie `resync_request` → snapshot complet.
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
`state_sync`, `move_sync`, `action`, `cursor`, `chat`, `promote_admin`,
`demote_admin`, `resync_request`.

**Types d'actions** (sanitizées puis relayées) : `road`, `road_batch`,
`rail_update`, `rail_batch`, `rail_signal_update` (avec `forcedRed`, `kind`),
`tunnel_build`, `bulldoze_road`, `bulldoze_tree`, `terraform`,
`terraform_level`, `fill_water`, `bulldoze_bld`, `build`, `toggle_bld_pause`,
`toggle_out_block`, `toggle_resid_upgrade_pause`, `set_depot_resource`, `clear_bld_stock`,
`upgrade_plant`, `buy_vehicle`, `sell_vehicle`, `route_vehicle`,
`return_vehicle`, `pin_vehicle_res`, `configure_train`,
`depot_departure_flag`, `merge_towns`, `zone_reassign`, `rename_bus_stop`,
`rename_bld`, `buy_expansion`, `owner_remap`, `pause`, `speed` (0.5–4).

`set_depot_resource {x, y, res, allowed, trainAllowed?}` fixe le filtre d'une
ressource d'un stockage ; `trainAllowed` est fourni depuis la gare liée.
L'hôte vérifie la ressource, le type du bâtiment et son propriétaire.
Sans `trainAllowed`, le filtre ferroviaire reste inchangé.

Le serveur limite le débit par client avec un seau de jetons (rafale 400,
150 msg/s) au lieu de jeter silencieusement au-delà de 60 msg/s.

**Commandes serveur** (`server_cmd`) : `regen_expansions`,
`set_money {amount}`, `spawn_fields {fieldType, count}`.

## Sauvegardes

- **État compacté** (`packStateForStorage` / `unpackStateFromStorage`) :
  grilles codées par plages (RLE) et bâtiments sans champs vides/par défaut
  (`compactBuildingForStorage`, flottants arrondis) — ~×4 sur une grande
  ville. Utilisé aussi sur le réseau : snapshot d'arrivée, flux monde 1 Hz,
  snapshots forcés, sauvegardes serveur. `applySnapshot` dépaquette tout état
  portant `_rle` ; `applyBuildingDynamicState` restaure les valeurs par défaut.
- **Serveur** : `data/saves/<room>_<nom>.json`.
- Format : `{ meta:{username, name, date}, state }` (état compacté ou brut,
  le serveur le traite comme opaque).
- Charger une sauvegarde diffuse `game_loaded` à tous les clients
  connectés (remplace la partie pour tout le monde dans la room).
- Autosaves serveur envoyées par le client admin toutes les
  `AUTO_SAVE_INTERVAL = 300` s (rotation `AUTO_SAVE_MAX = 5`).
- Résolution de fichier résiliente (recherche par nom de fichier, puis
  par `meta.username` / `meta.name`, insensible à la casse).

## UI et contrôles

Interface principale :

- **splash** : titre isométrique + bouton "Commencer".
- **la Gazette** (`publishNews`, `showNewsCard`, `newsOnArrival`,
  `updateNews` dans `08_ui_input_loop.js`) : carte « journal » en haut de
  l'écran pour les grands moments, une fois par partie (`newsFlags`). Seule
  la simulation autoritative publie ; `state.news` ({flags, log, next}) voyage
  dans le flux monde et les sauvegardes, l'invité affiche les nouvelles dont
  l'id dépasse `newsSeenId` (pas de rediffusion au chargement). Les unes
  rejoignent aussi le journal d'événements.
- **topbar** : argent (cliquable → finances), village, population,
  emplois, camions, date jeu, rotation, pause, vitesses 1×/2×/3×,
  aide, calques (surbrillance usines sous-effectuées), options
  (langue, pack graphique, marqueurs couleur, feux).
- **toolbar** : outils + menus déroulants (groupe Ferroviaire,
  groupe Dépôts).
- **ressources d'un entrepôt** (entrepôt, marché, entrepôt lié à une gare/un
  port) : grille compacte `depotResPanel(depot, mode)` — une tuile par ressource
  (icône, nom court `RES[k].s`, quantité en pastille, jauge de remplissage),
  une ligne par famille dont la pastille bascule toute la famille, filtre
  « Toutes / Actives » mémorisé (`depotResView`), onglets Stock / Vente pour le
  marché. L'infobulle (`resProductionInfo`) indique l'usine et la recette qui
  produisent la ressource, ses consommateurs, logements et chantiers.
- **panneau info** : universel (bâtiment, véhicule, expansion, gare,
  dépôt), avec édition du nom, filtres de dépôt, spécialisation plant,
  boutons pause/démolition/vente.
- **panneau train** : composition des wagons, ordres (circuit),
  drapeau de départ dépôt.
- **panneau village** : infos, fusions, création par rectangle.
- **panneau finances** : totaux et rythme $/min, bilans par catégorie.
- **panneau multijoueur** injecté par `mpInjectUI()` : connexion,
  auth, lobby des mondes, liste joueurs, sauvegardes, chat.
- **panneau aide** : 6 pages paginées (intro, bâtiments, logements &
  fusion, contrôles, chaînes avancées, transports).
- **panneau Partie** (💾), **mini-carte** (`Minimap`, bas-droite) et
  **objectifs** (`ObjectivesPanel`, haut-gauche), activables dans le menu
  Panneaux (🗂️).

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

Le rendu est hybride : `PixiScene` (`js/pixi/scene.js`) affiche le ciel, le sol
(texture du scroll-buffer `groundCache`) et une couche de sprites triés en
profondeur (`js/pixi/sprites.js` : bâtiments cuits par `drawBuildingBody` /
`drawBuildingArt`, arbres, véhicules en textures directionnelles à 24 angles,
piétons) avec culling sur la vue ; le canevas `#cv` par-dessus porte les
overlays dynamiques. Les corps de bâtiments sont **partagés** : la position ne
choisit qu'une variante d'art parmi `ART_VARIANTS` (`artVariantOf`), et les
bâtiments de même signature (`bldSig`) + variante réutilisent la même texture
(`sharedBodies`, compteur de références ; ancre des overlays et cheminées
stockées en relatif). Une ville de 3 700 bâtiments tient en ~40 textures.
Exceptions : gares (géométrie de groupe) et mode diagnostic (corps propre à
chaque usine). `PixiSprites.stats()` expose les compteurs.

Coût par image maîtrisé : les passes « sol » et « routes/rails » de `draw()`
ne parcourent les cases que lors d'une reconstruction du buffer-sol
(`groundDirty`) ; les feux tricolores sont relevés à ce moment-là
(`_cachedTrafficLights`) puis seulement recolorés chaque image. Les overlays
Pixi d'un bâtiment (`drawBuildingOv`) ne sont regéométrisés que si leur clé
visuelle change (barre de progression au pixel près, habitants, sélection,
alertes…) ; la sélection de gare est préparée une fois par image
(`prepareSelection`) et l'accès route/rail mis en cache par version du réseau.

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
- Les tests automatisés (`npm test`) couvrent trains, fret, bateaux/avions,
  économie de départ, interface, sauvegardes, performance et multijoueur :
  les relancer après toute modification de la logistique ou du réseau.
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
