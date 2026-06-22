# Factopolis — Guide agent IA

Ce projet est un **jeu tycoon-like en JS vanilla** dans le navigateur :
gestion industrielle (Factorio) + city-builder (population/ouvriers) +
transport (camions, bus, trains sur routes et rails). Rendu isométrique
2.5D rotatif sur Canvas 2D.

## Démarrage rapide

```bash
npm start          # node server.js, port 8765 → http://localhost:8765
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
| `js/05_depots/*.js` | Enregistrement des dépôts (garage, train, bateau, avion) |
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
| Rendu `draw()` | `js/07_rendering.js` |
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
- **Tester au minimum** : `npm start` → `http://localhost:8765` →
  panneau multijoueur sur `ws://localhost:8765`.
- **Langue des commentaires et des docs** : français (cohérent avec
  l'existant).
