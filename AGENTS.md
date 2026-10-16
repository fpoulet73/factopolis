# Factopolis — Guide agent IA

Ce projet est un **jeu tycoon-like en JS vanilla** dans le navigateur :
gestion industrielle (Factorio) + city-builder (population/ouvriers) +
transport (camions, bus, trains, bateaux, avions). Rendu isométrique 2.5D
rotatif : scène PixiJS dont les textures sont dessinées en Canvas 2D.

## Démarrage rapide

```bash
npm start          # node server.js, port 8765 → http://localhost:8765
npm test           # tests headless (Playwright requis, serveur isolé)
```

## Lecture recommandée avant de toucher au code

1. `README.md` — description complète du jeu et de l'architecture.
2. `SESSION_CONTEXT.md` — référence détaillée par système (état, bâtiments,
   logistique, multi, sauvegardes).
3. `js/README.md` — carte des fichiers client.

## Carte du dépôt

| Chemin | Rôle |
|---|---|
| `index.html` | DOM + styles inline + chargement des scripts dans l'ordre |
| `config.js` | **Équilibrage gameplay** (production, recettes, coûts, véhicules…) — à modifier en priorité pour tuner le jeu |
| `js/01_definitions.js` → `js/10_saves_chat_console.js` | Moteur client découpé par domaine (ordre des préfixes = ordre de chargement) |
| `js/05_depots/*.js` | Enregistrement des dépôts (garage, train, port, aéroport) |
| `js/07_rendering_art.js` | Art procédural des bâtiments (cuit en textures) |
| `js/08_minimap.js`, `js/08_objectives.js` | Mini-carte, panneau des objectifs |
| `js/pixi/` | Scène PixiJS (terrain, sprites triés, culling) + Pixi embarqué |
| `tools/tests/` | Tests automatisés (`npm test`) : scénarios solo et multijoueur |
| `js/i18n.js` + `js/i18n/{fr,en,es}.js` | Traductions (`t()`, `setLanguage()`, `data-i18n`) |
| `server.js` | Serveur HTTP statique + WebSocket (`ws`) — multi-room, scrypt auth, sauvegardes |
| `data/users.json` | Comptes joueurs (créé au runtime) |
| `data/saves/<user>_<nom>.json` | Sauvegardes (créé au runtime) |
| `assets/graphic-packs/` | Packs graphiques (voir son `README.md`) |
| `tools/` | Scripts utilitaires (génération de sprites) |

## Où modifier quoi

| Besoin | Fichier |
|---|---|
| Équilibrage (coûts, temps, capacités, tarifs) | `config.js` |
| Définitions de bâtiments, ressources, fusions | `js/01_definitions.js` |
| État monde, génération terrain, projection iso | `js/02_world_state.js` |
| Logique bâtiment (stock, pop, démollition) | `js/03_buildings_population.js` |
| Validation/Placement, rails, signaux, gares | `js/04_construction.js` |
| Camions, bus, trains, pathfinding | `js/05_logistics.js` |
| Boucle de simulation `update(dt)` | `js/06_simulation.js` |
| Rendu `draw()`, terrain, véhicules | `js/07_rendering.js` |
| Apparence des bâtiments | `js/07_rendering_art.js` |
| Sprites Pixi, culling | `js/pixi/sprites.js` |
| UI, panneaux, input, boucle rAF | `js/08_ui_input_loop.js` |
| Multi WebSocket, snapshots, actions | `js/09_multiplayer.js` |
| Autosaves, chat, commandes console | `js/10_saves_chat_console.js` |
| Auth, sauvegardes, rooms, protocole WS | `server.js` |

## Règles à respecter

- **Pas de build step** : projet vanilla, scripts classiques partagés
  via le scope global. Garder l'ordre des préfixes numérotés dans `js/`.
- **Éviter les refactors larges** : le client dépend fortement du
  partage de globals (`WALLETS`, `MP`, `BUILD`, `RES`, `cam`,
  `selected`, `tool`, `clickFn`, `drawFn`, `frame`, etc.).
- **Ne pas commiter** `node_modules/` ni `data/` (runtime).
- **Tester** : `npm test` (trains, fret, bateaux/avions, économie, interface,
  sauvegardes, performance, multijoueur) puis `npm start` →
  `http://localhost:8765` pour vérifier à l'œil.
- **Fichiers texte en CRLF** : préférer l'outil d'édition ou un script Python
  aux heredocs shell (les heredocs contenant des apostrophes typographiques
  échouent sous Git Bash).
- **Langue des commentaires et des docs** : français (cohérent avec
  l'existant).


<!-- headroom:rtk-instructions -->
# RTK (Rust Token Killer) - Token-Optimized Commands

When running shell commands, **always prefix with `rtk`**. This reduces context
usage by 60-90% with zero behavior change. If rtk has no filter for a command,
it passes through unchanged — so it is always safe to use.

## Key Commands
```bash
# Git (59-80% savings)
rtk git status          rtk git diff            rtk git log

# Files & Search (60-75% savings)
rtk ls <path>           rtk read <file>         rtk grep <pattern>
rtk find <pattern>      rtk diff <file>

# Test (90-99% savings) — shows failures only
rtk pytest tests/       rtk cargo test          rtk test <cmd>

# Build & Lint (80-90% savings) — shows errors only
rtk tsc                 rtk lint                rtk cargo build
rtk prettier --check    rtk mypy                rtk ruff check

# Analysis (70-90% savings)
rtk err <cmd>           rtk log <file>          rtk json <file>
rtk summary <cmd>       rtk deps                rtk env

# GitHub (26-87% savings)
rtk gh pr view <n>      rtk gh run list         rtk gh issue list

# Infrastructure (85% savings)
rtk docker ps           rtk kubectl get         rtk docker logs <c>

# Package managers (70-90% savings)
rtk pip list            rtk pnpm install        rtk npm run <script>
```

## Rules
- In command chains, prefix each segment: `rtk git add . && rtk git commit -m "msg"`
- For debugging, use raw command without rtk prefix
- `rtk proxy <cmd>` runs command without filtering but tracks usage
<!-- /headroom:rtk-instructions -->
