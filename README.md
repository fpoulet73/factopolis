# Factopolis

> Extrais · Produis · Transporte · Peuple

Factopolis est un **jeu de gestion / simulation industrielle** en navigateur
qui mélange trois genres :

- ⚙️ **chaînes de production** à la *Factorio* : extraction, transformation,
  assemblage, stocks, recettes ;
- 🏙️ **city-builder** à la *SimCity* : logements, population, ouvriers,
  villages, taxes, expansion territoriale ;
- 🚚 **transport tycoon** : camions, bus, trains sur routes et réseaux
  ferrés avec signaux et cantons.

Le tout en **rendu isométrique 2.5D rotatif** sur Canvas 2D, sans dépendance
cliente (JS vanilla), avec un serveur Node.js léger pour le multijoueur.

---

## Concept

Le joueur bâtit une ville industrielle sur une carte tuilée de **64×64**
(redimensionnable 32 → 128). Il extrait du minerai et des ressources
naturelles, les transforme en acier puis en outils de construction, livre
les marchandises aux logements, fait grandir la population et finance
l'expansion de son territoire.

### Chaîne de production simplifiée

```
⛏️ Mine (fer)      + ⛏️ Mine (charbon)  → 🔥 Fonderie → acier
🌾 Ferme (blé)     + 💧 Pompe (eau)     → ⚙️ Moulin → farine → 🥖 Boulangerie → pain
☁️ Champ (coton)                       → 🧵 Tissage → vêtements
🎣 Cabane pêcheur                      → 🐟 Poissonnerie → filet + huile
🪓 Bûcheron (bois)
acier + bois → 🏭 Usine → outils de construction
outils + vêtements + pain + filets → 🏠 Logements → 👥 habitants + 💰 argent + 🛠️ ouvriers
```

---

## Stack technique

| Couche | Techno | Détail |
|---|---|---|
| Client | HTML + CSS + JS vanilla | `index.html`, `config.js`, `js/*.js` (scripts classiques, globals partagés) |
| Rendu | Canvas 2D | isométrique 2.5D rotatif, painter's algorithm, sprites / prismes |
| Serveur | Node.js | `server.js`, HTTP statique + WebSocket via `ws` |
| Dépendances | `ws` (côté serveur uniquement) | aucune dépendance cliente, aucun build step |
| Données | JSON sur disque | `data/users.json`, `data/saves/<user>_<nom>.json` |

### Lancement

```bash
npm start                 # ou : node server.js
# Port par défaut : 8765 → http://localhost:8765
# WebSocket         → ws://localhost:8765
```

Le serveur sert aussi les fichiers statiques ; on peut jouer en ouvrant
`index.html` directement (mode solo, sans multi ni sauvegardes serveur).

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
| `03_buildings_population.js` | Création de bâtiments, stock, capacité, population/logement, spécialisation des usines, démollition |
| `04_construction.js` | Validation `canPlace`, placement `clickAt`, routes, masques rails 8-dir, signaux et cantons, gares/quais fusionnables, zone multi `MP_ZONE=20` |
| `05_logistics.js` | Camions auto (dispatch BFS), véhicules persistants, bus, trains + wagons, pathfinding ferroviaire, signaux, réservation de quais, feux de carrefour |
| `05_depots/*.js` | Enregistrement des dépôts (garage, train_depot, boat_depot, plane_depot) dans la toolbar |
| `06_simulation.js` | Boucle `update(dt)` : production, consommation logements, taxes, entretien, fusions, walkers, pénurie, milestones, transit passagers |
| `07_rendering.js` | `draw()` principal : terrain iso, bâtiments (sprites + prismes), routes, rails, véhicules, walkers, overlays, packs graphiques, badges |
| `08_ui_input_loop.js` | HUD, panneaux (info/finance/train/town/help), barre d'outils, souris/clavier, aperçus route/rail, boucle `requestAnimationFrame(frame)` |
| `09_multiplayer.js` | WebSocket client, `serializeState`/`applySnapshot`, `applyAction`, rooms, auth token, owner remapping, override de `clickFn`/`drawFn`, panneau multijoueur |
| `10_saves_chat_console.js` | Auto-saves locales + serveur, chat, commandes console (`regenExpansions`, `spawnFieldsOnMap`) |
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

15 ressources manipulées dans le jeu :

`iron` (fer), `coal` (charbon), `wood` (bois), `wheat` (blé),
`cotton` (coton), `clothes` (vêtements), `flour` (farine), `water` (eau),
`bread` (pain), `fish` (poisson), `fish_fillet` (filet),
`fish_oil` (huile), `steel` (acier), `goods` (outils de construction),
`dirt` (terre).

---

## Bâtiments

### Production (fusionnables en rectangles)
- `mine` : fer **ou** charbon selon le gisement
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
150 habitants).

### Logistique
- `road`, `rail`, `rail_signal`, `train_station`, `train_platform`
- `garage` (camions + bus), `train_depot`, `bus_stop`
- `boat_depot`, `plane_depot` (placeholders non implémentés)
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

Trains = système le plus complexe : **signaux**, **cantons** (block
occupancy reconstruit à chaque frame), **réservation de quais**, **trail
des wagons**, replanification aux bifurcations, départ armé depuis dépôt.

---

## Population, logements et ouvriers

- Chaque logement consomme des ressources (outils, vêtements, pain…)
  → argent + arrivée d'habitants (marchent depuis le bord de carte).
- Les **ouvriers** sont alloués aux usines par proximité (`workRadiusOf`).
  Une usine sous-effectuée tourne au ralenti.
- Les logements **pleins et approvisionnés** couvrant un rectangle
  fusionnent en niveau supérieur.
- En cas de pénurie prolongée (`STARVE_DELAY`) : un bâtiment fusionné se
  sépare ; une maison simple perd un habitant (qui quitte la carte à pied).

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
- **Revenus bus/train** au prorata des passagers × distance, avec partage
  inter-joueurs configurable.
- **Starter homes** : 2 premières maisons protégées par joueur pour
  éviter le blocage démarrage.

---

## Multijoueur

- Le serveur n'est **pas autoritaire** sur la simulation : il relaie les
  actions et synchronise via snapshots.
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

- **Locales** (autosaves, rotation 5 slots en `localStorage`).
- **Serveur** (`data/saves/<user>_<nom>.json`) — par utilisateur,
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
- Les snapshots ne sérialisent **pas** camions, walkers et floats —
  remis à zéro au chargement/synchronisation.
- Les bateaux et avions sont des **placeholders** (dépôts achetables
  mais aucun déplacement implémenté).
- `node_modules/` est présent localement et non suivi par git.
- Projet volontairement **vanilla, sans build step** — éviter les
  refactors globaux qui casseraient le partage de globals entre scripts.
