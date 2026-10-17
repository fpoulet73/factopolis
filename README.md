# Factopolis

> Extrais · Produis · Transporte · Peuple

Factopolis est un **jeu de gestion / simulation industrielle** en navigateur
qui mélange trois genres :

- ⚙️ **chaînes de production** à la *Factorio* : extraction, transformation,
  assemblage, stocks, recettes ;
- 🏙️ **city-builder** à la *SimCity* : logements, population, ouvriers,
  villages, taxes, expansion territoriale ;
- 🚚 **transport tycoon** : camions, bus, trains (signaux, cantons), bateaux
  et avions.

Le tout en **rendu isométrique 2.5D rotatif** (PixiJS/WebGL, textures cuites
depuis un dessin Canvas 2D procédural), JS vanilla sans build, avec un serveur
Node.js léger pour le multijoueur. Le jeu se joue **en solo** (sauvegardes
locales) ou **en multijoueur** (mondes partagés sur le serveur).

---

## Concept

Le joueur bâtit une ville industrielle sur une carte tuilée de **64×64**
(redimensionnable 32 → 128). Il extrait du minerai et des ressources
naturelles, les transforme en acier puis en outils de construction, livre
les marchandises aux logements, fait grandir la population et finance
l'expansion de son territoire.

### Chaîne de production simplifiée

```
🎣 Cabane pêcheur                      → 🐟 Poissonnerie → filet + huile
⛏️ Mine (fer)      + ⛏️ Mine (charbon)  → 🔥 Fonderie → acier
🪓 Bûcheron (bois) + acier             → 🏭 Usine → outils de construction
🌾 Ferme (blé) → ⚙️ Moulin → farine + 💧 eau + charbon → 🥖 Boulangerie → pain
☁️ Champ (coton)                       → 🧵 Tissage → vêtements
filets (+ huile en bonus) → 🏠 Maisons → 👥 habitants + 💰 argent + 🛠️ ouvriers
outils (quota) → fusion en niveau supérieur ; pain puis vêtements pour les grands immeubles
```

### Chaînes avancées

```
⛏️ Mine (calcaire, argile, sable, cuivre, or)      🛢️ Puits de pétrole (nappe)
calcaire + argile + charbon → 🌋 Cimenterie → ciment ; ciment + sable + eau → 🚧 Centrale à béton → béton
sable + calcaire + charbon → 🏺 Verrerie → verre → 🪟 Vitrerie → vitres
acier → 🔨 Laminoir → poutrelles · 🗜️ Tôlerie → plaques · 📌 Clouterie → clous
minerai de cuivre + charbon → ♨️ Fonderie de cuivre → cuivre → 🌀 Tréfilerie → fil de cuivre
coton → 🪢 Corderie → cordes
pétrole → ⛽ Raffinerie → carburant + produits chimiques → 🧪 Usine chimique → plastique + colle
produits chimiques + argile (ocre) → 🎨 Usine de peinture → peinture jaune
minerai d'or + produits chimiques → 🏅 Affinerie → or
fil de cuivre + plastique + or → 🖥️ Usine électronique → cartes électroniques
bois + clous + colle → 🪑 Ébénisterie → meubles · cartes + plaques + plastique + fil → 🔌 électroménager
or + verre → 💍 Joaillerie → bijoux
plaques + cartes + carburant + fil → 🚀 Centre spatial → fusée → hélium-3 + xénite (espace)
cartes + xénite + hélium-3 → 🔬 Laboratoire quantique → processeurs quantiques
```

**Matériaux de chantier** : ports, hangars, gares d'aéroport, pistes, taxis,
parkings, tours de contrôle, centre spatial et usines avancées (raffinerie, usine
chimique, électronique…) exigent, en plus de leur prix,
des matériaux (poutrelles, plaques d'acier, béton, vitres, cordes, fil de cuivre,
peinture jaune, cartes électroniques) stockés dans un **entrepôt du joueur dont le
rayon couvre le chantier**. Ils sont prélevés à la pose. Le fantôme de placement
affiche le besoin ou le manque, et les rayons des entrepôts s'affichent.
Les gares, quais et dépôts de train n'en demandent pas.
Configuration : `materiauxChantier` dans `config.js` (`actif: false` = bac à sable).

**Luxe** : les employés (villas) demandent des meubles, les cadres (manoirs) de
l'électroménager, les patrons (domaines) des bijoux et des processeurs quantiques.
Les tours et gratte-ciel exigent béton, vitres et poutrelles pour fusionner.

La partie est guidée par une suite d'**objectifs** (première maison → filière
poisson → acier → outils → fusions → camions → trains → ports/aéroports) qui
rapportent des primes. **La Gazette** met à la une les grands moments de la
partie (premier train en gare, premier navire, premier vol, villes de 250 à
10 000 habitants, premier immeuble / tour / gratte-ciel), avec un bouton pour
s'y rendre.

---

## Stack technique

| Couche | Techno | Détail |
|---|---|---|
| Client | HTML + CSS + JS vanilla | `index.html`, `config.js`, `js/*.js` (scripts classiques, globals partagés) |
| Rendu | PixiJS v8 (WebGL) + Canvas 2D | sprites triés en profondeur sur Pixi ; bâtiments, véhicules, arbres dessinés en Canvas 2D procédural puis cuits en textures ; sol rendu dans un scroll-buffer ; overlays dynamiques sur `#cv` |
| Serveur | Node.js | `server.js`, HTTP statique + WebSocket via `ws` |
| Dépendances | `ws` (serveur) ; Pixi embarqué (`js/pixi/vendor`) | aucun build step ; Playwright optionnel pour les tests |
| Données | JSON sur disque | `data/users.json`, `data/saves/<room>_<nom>.json` |

### Lancement

```bash
npm start                 # ou : node server.js
# Port par défaut : 8765 → http://localhost:8765
# WebSocket         → ws://localhost:8765
```

Le serveur sert aussi les fichiers statiques. **Solo** : cliquer « Commencer »
et construire ; le bouton 💾 (Partie) crée une nouvelle carte, sauvegarde/charge
localement (navigateur, grilles compressées) et exporte/importe un fichier JSON.
**Multijoueur** : bouton 🌐 → connexion, compte, choix d'un monde.

### Tests automatisés

```bash
npm i -D playwright && npx playwright install chromium   # une fois
npm test                  # serveur isolé (données temporaires) + Chromium headless
npm test -- trains        # filtre par nom de scénario
```

Scénarios dans `tools/tests/solo/` (trains : terminus, boucle, quais, évitement,
ordres en route ; fret/voyageurs ; bateaux/avions ; zone de départ des cartes
générées ; économie de début de partie et filière acier → outils → première fusion ;
matériaux de chantier ; chaînes avancées ; centre spatial ; interface ; sauvegarde ;
performance) et `tools/tests/mp/` (synchronisation hôte/invité, migration d'hôte,
sauvegarde/chargement serveur, validation des matériaux par l'hôte).
`T_.flatWorld()` crée un monde « bac à sable » sans matériaux de chantier
(`T_.flatWorld(true)` pour les exiger).

---

## Architecture

### Découpage client (`js/`)

Le moteur est découpé par domaine en scripts chargés dans l'ordre par
`index.html`. Les déclarations de haut niveau sont partagées via le scope
global — **l'ordre numérique des prefixes doit rester stable**.

| Fichier | Rôle |
|---|---|
| `01_definitions.js` | Constantes, catalogue de bâtiments `BUILD`, ressources `RES`, types de véhicules, recettes, fusions (résidentielles, industrielles, entrepôts), helpers de villages, packs graphiques |
| `02_world_state.js` | État global (terrain, routes, rails, buildings, vehicles, towns…), wallets multi-joueurs, génération du monde, projection iso rotative, expansion de carte, allocation des travailleurs |
| `02b_biomes.js` | Biomes (prairie, forêt, désert, toundra, marais, savane, canyon) : climat déterministe par graine, influence sur lacs/relief/forêts/gisements, teintes et essences d'arbres, régions nommées |
| `03_buildings_population.js` | Création de bâtiments, stock, capacité, population/logement, spécialisation des usines, démollition |
| `04_construction.js` | Validation `canPlace`, placement `clickAt`, routes, masques rails 8-dir, signaux et cantons, gares/quais fusionnables, zone multi `MP_ZONE=20` |
| `05_logistics.js` | Camions auto (dispatch BFS), véhicules persistants, bus, trains + wagons, pathfinding ferroviaire, signaux, réservation de quais, feux de carrefour |
| `05_depots/*.js` | Enregistrement des dépôts (garage, dépôt de train, port, aéroport) dans la toolbar |
| `06_simulation.js` | Boucle `update(dt)` : production, consommation logements, taxes, entretien, fusions, walkers, pénurie, milestones, transit passagers |
| `07_rendering.js` | `draw()` principal : terrain iso (prairies nuancées, pentes éclairées, eau profonde), routes, rails, signaux, overlays, cœurs des véhicules (loco, wagons, camions, bus, bateaux, avions), fumée |
| `07_rendering_art.js` | Art procédural des bâtiments (maisons à toit en pente, immeubles, tours, usines, moulin, mine, port, aéroport, gares…) cuit en textures |
| `08_ui_input_loop.js` | HUD, panneaux (info/finance/train/town/help), barre d'outils, souris/clavier, aperçus route/rail, boucle `requestAnimationFrame(frame)` (qui pilote aussi la simulation) |
| `08_minimap.js` | Mini-carte isométrique (vue d'ensemble, cadre caméra, clic pour s'y rendre) |
| `08_objectives.js` | Panneau des objectifs (progression guidée, primes) |
| `pixi/scene.js`, `pixi/sprites.js` | Scène PixiJS : terrain (texture du scroll-buffer), sprites triés (bâtiments, arbres, véhicules), overlays, culling |
| `09_multiplayer.js` | WebSocket client, `serializeState`/`applySnapshot`, `applyAction`, rooms, auth token, owner remapping, override de `clickFn`/`drawFn`, panneau multijoueur |
| `10_saves_chat_console.js` | Panneau Partie (solo), sauvegardes locales compressées (RLE) + auto-saves serveur, chat, commandes console, bootstrap |
| `i18n.js` + `i18n/{fr,en,es}.js` | Système de traduction (`t()`, `setLanguage()`, attributs `data-i18n`) |

### Serveur (`server.js`)

Serveur **non autoritaire** sur la simulation : il sert les fichiers,
attribue ids/couleurs/rôles, relaie les actions et gère comptes + sauvegardes.

- **Multi-room** : plusieurs mondes simultanés, créés à partir des
  sauvegardes au démarrage.
- **Authentification** : `scrypt` + sel par utilisateur, token de session
  aléatoire persisté côté client (`localStorage['fp_token']`).
- **Sanitization** des actions (`sanitizeAction`) : liste blanche de types
  et validation des paramètres.
- **Hôte / admin / invité** : hôte = autorité sur snapshots et vitesse ;
  admin = droits de save/load.
- **Console serveur** : `help`, `rooms`, `players`, `saves`, `say`,
  `kick`, `promote`, `setmoney`, `regenexpansions`, `spawnfields`, `stop`.

### Configuration gameplay (`config.js`)

Toutes les valeurs d'équilibrage sont centralisées dans l'objet global
`CONFIG` (voir l'en-tête du fichier pour la liste des ressources). On peut
régler sans toucher au moteur : temps de production, recettes, coûts,
entretien, formes de fusion, capacités des véhicules, tarifs bus/train,
paramètres des logements, etc.

---

## Ressources

45 ressources, rangées par familles (`RES[k].cat`, `RES_CATEGORIES`) :

- **base** : `iron`, `coal`, `wood`, `wheat`, `cotton`, `water`, `fish`, `dirt`,
  `copper_ore`, `gold_ore`, `limestone`, `sand`, `clay`, `oil` ;
- **alimentation & textile** : `clothes`, `flour`, `bread`, `fish_fillet`, `fish_oil` ;
- **métallurgie** : `steel`, `copper`, `gold`, `nails` ;
- **matériaux de chantier** : `goods`, `copper_wire`, `steel_beam`, `steel_plate`,
  `cement`, `concrete`, `glass`, `window`, `rope`, `paint` ;
- **chimie** : `chemicals`, `fuel`, `plastic`, `glue` ;
- **électronique** : `circuit`, `quantum_chip` ;
- **luxe** : `furniture`, `appliances`, `jewelry` ;
- **espace** (fusées) : `helium3`, `xenite`.

Gisements (`T.COPPER`, `T.GOLD`, `T.LIMESTONE`, `T.OIL`, plus le sable et l'argile
du littoral) générés en taches (`WORLD_DEPOSITS`, `monde.ressources` dans `config.js`).

---

## Bâtiments

### Production (fusionnables en rectangles)
- `mine` : fer, charbon, cuivre, or, calcaire, sable ou argile selon le gisement
- `oil_well` : pétrole (sur une nappe)
- usines avancées (spécialisations de `plant`, `ADVANCED_FACTORIES`) :
  `copper_smelter`, `wire_mill`, `gold_refinery`, `rolling_mill`, `sheet_mill`,
  `nail_factory`, `cement_plant`, `concrete_plant`, `glassworks`, `glazier`,
  `ropery`, `refinery`, `chem_plant`, `paint_factory`, `electronics_plant`,
  `furniture_factory`, `appliance_factory`, `jeweler`, `quantum_lab`
- `space_center` : centre spatial 3×3 (non fusionnable) — fusées et ressources spatiales
- `lumber` : bois (près d'arbres)
- `farm` / `cotton_farm` : blé / coton
- `pump` : eau (bord de l'eau)
- `fisher` : poisson (bord de l'eau)
- `weaver` (tissage), `mill` (moulin), `bakery` (boulangerie),
  `fishery` (poissonnerie), `smelter` (fonderie), `factory` (usine)
- `plant` (usine abandonnée à spécialiser)

### Logements (fusionnables par paliers)
`house` (1×1) → `duplex` (2×1) → `row` (3×1) → `residence` (4×1) →
`tower` (2×2) → `bigtower` (3×2) → `tower3` (3×3) → `sky` gratte-ciel (4×4,
180 habitants).

### Logistique
- `road`, `rail`, `rail_signal`, `train_station`, `train_platform`
- `garage` (camions + bus), `train_depot`, `bus_stop`
- `boat_depot` (**port**, au bord de l'eau : cargos + ferries), `plane_depot`
  (**aéroport** : avions de ligne)
- `depot` (entrepôt, fusionnable), `market` (vente inter-joueurs),
  `tank` (citerne d'eau)
- `terrassement` (produit la terre utilisée pour remblayer l'eau)

### Outils
`select`, `bulldoze`, `terraform`, `fill_water`.

---

## Véhicules

| Type | Rôle | Achat |
|---|---|---|
| **Camions** (auto) | Dispatch BFS automatique entre bâtiments connectés | gratuit, éphémère |
| **Camions** (achetés) | `minerai`, `plateau`, `céréale`, `marchandises`, `frigo`, `citerne` | via `garage` |
| **Bus** | Transport de passagers entre arrêts / gares | via `garage` |
| **Trains** | Fret + passagers, wagons configurables, circuits | via `train_depot` |
| **Bateaux** | Cargo (fret via un entrepôt collé au port) et ferry (voyageurs), navigation par l'eau entre ports | via le port |
| **Avions** | Voyageurs, vol direct entre aéroports (altitude + ombre) | via l'aéroport |

Trains = système le plus complexe : **signaux** (bloc et jonction, rouge
forcé), **cantons** (empreinte loco + wagons, index incrémental), **réservation
de quais**, **trail des wagons**, replanification aux bifurcations, départ armé
depuis le dépôt (un seul train à la fois dans le canton de sortie),
**retournement façon TTD** au terminus, **ordres modifiables en circulation**
(la composition se change au dépôt), revenu de fret payé une seule fois par
marchandise (pas de rente en navette).

---

## Population, logements et ouvriers

- Chaque logement consomme ses ressources indispensables (filets de poisson,
  puis pain, vêtements selon le niveau) → argent + arrivée d'habitants
  (marchent depuis le bord de carte) ; l'huile de poisson est un bonus.
- Les **ouvriers** sont alloués aux usines par proximité (`workRadiusOf` :
  6 cases pour une maison, jusqu'à 12 pour un gratte-ciel ; au-delà, bus),
  les filières vitales (poisson, pain, vêtements) étant servies en premier.
  Une usine sous-effectuée tourne au ralenti ; sans aucun ouvrier elle affiche
  un badge 👷 0/n. Un sous-produit sans débouché ne
  bloque plus la production principale.
- Les logements **pleins et approvisionnés** couvrant un rectangle
  fusionnent en niveau supérieur.
- En cas de pénurie prolongée (`STARVE_DELAY`) : un bâtiment fusionné se
  sépare ; une maison simple perd un habitant (qui quitte la carte à pied).
- 💎 **Maisons de luxe** (dès 100 habitants, 5× le prix d'une maison) :
  pleines et livrées en outils, elles s'agrandissent sur les cases libres
  voisines (2, 4 puis 9 cases : villa, manoir, domaine avec piscine et tennis)
  sans gagner d'habitants. Leurs habitants changent de **classe** — ouvriers
  → employés → cadres → patrons — et paient plus de taxes et d'achats
  (`maisonLuxe` et `classesHabitants` dans `config.js`). Les logements
  basiques abritent toujours des ouvriers.

### Villages / villes

Chaque logement est rattaché à un **village** (nom déterministe par
position). Un village regroupe logements + emplois accessibles. Les
villages peuvent être créés/fusionnés/réaffectés via le panneau village.

---

## Économie

Chaque joueur possède un **wallet** :

```
{ money, basePop, fin{ventes,taxes,rembours,construction,entretien,expansion},
  finHist[], finTimer, mi, eff, homelessSeeded, starterHomes, starterHomesGranted }
```

- **Taxes** périodiques par habitant actif (réduit pour les oisifs).
- **Entretien** industriel périodique (réduit si en pause).
- **Entretien véhicules** quotidien, croissant de +3 % par mois.
- **Revenus logements** à chaque consommation + bonus si ressources bonus.
- **Revenus bus/train/bateau/avion** au prorata des passagers × distance ;
  fret payé au prix commercial × distance × tarif.
- **Primes d'objectifs** (catégorie « primes » du panneau finances).
- **Starter homes** : 2 premières maisons protégées par joueur pour
  éviter le blocage démarrage.

---

## Multijoueur

- Le serveur n'est **pas autoritaire** sur la simulation : il relaie les
  actions et synchronise via snapshots ; l'hôte simule et diffuse un flux
  « monde » (1 Hz) et un flux « mouvement » (5 Hz) interpolé côté invité.
- Les tracés (rails, routes au glisser) partent en **une seule action groupée**
  (`rail_batch`, `road_batch`) ; le serveur limite le débit par seau de jetons.
- Chaque synchro porte une **signature du monde** (routes, rails, signaux,
  terrain, zones) : un invité qui diverge demande automatiquement un snapshot
  complet (`resync_request`).
- Si l'hôte quitte, un autre joueur identifié est promu et reprend la simulation.
- L'**hôte** répond aux `snapshot_request`, détient la vérité pour les
  nouveaux invités, contrôle pause/vitesse.
- Les **admins** peuvent sauvegarder/charger.
- Chaque bâtiment a un `owner` (id joueur) ; à la reconnexion, l'owner ID
  est remappé vers la nouvelle session via `prevOwnerId` ou
  `playerRegistry` persisté dans les sauvegardes.
- `MP_ZONE = 20` interdit de construire à moins de 20 cases d'un bâtiment
  adverse.
- Les curseurs des autres joueurs sont affichés (canevas).

Voir `SESSION_CONTEXT.md` pour le détail du protocole WebSocket.

---

## Sauvegardes

- **Locales** (solo) : panneau 💾 Partie — sauvegardes nommées et autosaves
  (rotation 5 slots) en `localStorage`, grilles compressées par plages (RLE,
  ~×13) ; export/import d'un fichier JSON.
- **Serveur** (`data/saves/<room>_<nom>.json`) — par monde (room),
  chargement/diffusion à toute la room.
- Autosaves serveur pattern `[Auto] <room> <slot>`.
- Format : `{ meta:{username,name,date}, state: serializeState() }`.

---

## Packs graphiques

Système de thèmes communautaires dans `assets/graphic-packs/`. Voir
`assets/graphic-packs/README.md` pour le format `pack.json` (vues
directionnelles `N/E/S/W`, variantes par empreinte, ancrages, fit
footprint…).

4 thèmes codés en dur (`classic`, `brick`, `modern`, `industrial`) +
packs communautaires déclarés dans `packs.json` (déjà inclus :
`medieval`, `example`).

Outil : `tools/generate-medieval-pack.js` génère les sprites du pack
médiéval.

---

## Documentation

- `SESSION_CONTEXT.md` — point d'entrée détaillé pour reprendre le
  projet (état client, bâtiments, logistique, multi, sauvegardes…).
- `AGENTS.md` — vue concise orientée agent IA.
- `js/README.md` — carte des fichiers client.
- `assets/graphic-packs/README.md` — format des packs graphiques.

---

## Points d'attention connus

- Serveur non autoritaire : validation métier côté serveur partielle
  (sanitization des paramètres mais pas de logique métier complète).
- Les sauvegardes ne conservent pas les camions automatiques ni les piétons
  (éphémères) ; le multijoueur les transmet en direct.
- `node_modules/` est présent localement et non suivi par git.
- Projet volontairement **vanilla, sans build step** — éviter les
  refactors globaux qui casseraient le partage de globals entre scripts.
