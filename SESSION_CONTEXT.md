# Factopolis - Contexte pour prochaines sessions

Ce fichier sert de point d'entrée rapide pour reprendre le projet sans relire tout le code.

## Concept du jeu

Factopolis est un jeu de gestion/simulation en navigateur qui mélange :
- chaînes de production type Factorio ;
- city builder avec population, logements, taxes et ouvriers ;
- transport automatique par camions sur routes ;
- rendu isométrique 2.5D rotatif sur Canvas 2D.

Le joueur construit une ville industrielle : extraire fer/charbon/bois, transformer en acier puis marchandises, livrer les marchandises aux logements, faire grandir la population et financer l'expansion.

## Stack et lancement

- Frontend : `index.html`, `config.js`, `js/*.js`, Canvas 2D, JavaScript vanilla.
- Backend : `server.js`, Node.js, serveur HTTP statique + WebSocket via `ws`.
- Dépendances : seulement `ws` côté serveur.
- Lancement : `npm start` ou `node server.js [port]`.
- Port par défaut : `8765`.
- URL locale : `http://localhost:8765`.
- WebSocket par défaut : `ws://localhost:8765`.

## Fichiers principaux

- `index.html` : structure DOM, styles inline, canvas, topbar, aide, chargement de `config.js` puis des scripts `js/` dans l'ordre numérique.
- `config.js` : valeurs de gameplay configurables sans modifier le moteur : production, logements, fusions, entretien, pénurie, économie, camions.
- `js/README.md` : carte rapide des fichiers client découpés.
- `js/01_definitions.js` à `js/10_saves_chat_console.js` : moteur client découpé par domaine (definitions, monde, bâtiments, construction, logistique, simulation, rendu, UI/input, multi, sauvegardes/chat).
- `server.js` : fichiers statiques, WebSocket, authentification simple, relais multi, sauvegardes JSON.
- `data/users.json` : créé au runtime, comptes utilisateurs.
- `data/saves/<user>_<nom>.json` : créé au runtime, sauvegardes par utilisateur.

## État du jeu côté client

Les variables principales de simulation sont globales dans les scripts `js/` chargés par `index.html` :

- `terrain` : `Uint8Array` de 64 x 64, types `GRASS`, `WATER`, `TREE`, `IRON`, `COAL`.
- `road` : `Uint8Array`, routes par tuile.
- `bgrid` : grille d'occupation, référence vers le bâtiment couvrant chaque tuile.
- `buildings` : liste des bâtiments actifs.
- `trucks` : camions en trajet.
- `walkers` : habitants qui arrivent ou partent à pied.
- `floats` : textes flottants de feedback.
- `WALLETS` : économie par joueur, clé `0` en solo ou id joueur en multi.
- `MP` : état multijoueur local : socket, id, role, joueurs, curseurs, chat, compte, token, sauvegardes.

La carte fait `N = 64` tuiles. Les constantes de rendu isométrique sont `TILE = 36`, `TW = 64`, `TH = 32`.

## Bâtiments et ressources

Ressources :
- `iron` : fer.
- `coal` : charbon.
- `wood` : bois.
- `steel` : acier.
- `goods` : marchandises.

Outils/bâtiments principaux :
- route : connecte la logistique.
- mine : produit fer ou charbon selon le gisement.
- bûcheron : produit du bois prés des arbres.
- fonderie : consomme fer + charbon, produit acier.
- usine : consomme acier + bois, produit marchandises.
- maison : consomme marchandises, gagne population et argent.
- dépôt : stocke et redistribue, avec filtres de ressources.
- démolition : détruit route, arbre ou bâtiment, remboursement partiel.

Les définitions de base sont dans `BUILD`. Les valeurs configurables sont appliquées ensuite depuis `CONFIG`.

## Boucle de simulation

La boucle `frame()` :
1. lit les touches de camera ;
2. appelle `update(dt * speed)` si non pause ;
3. dessine via `drawFn()`;
4. met à jour le HUD ;
5. relance `requestAnimationFrame`.

`update(dt)` gère :
- progression de production ;
- consommation des logements ;
- arrivée/départ des habitants ;
- fusions résidentielles et industrielles ;
- dispatch automatique des camions ;
- taxes ;
- entretien industriel ;
- historique financier ;
- milestones de population ;
- textes flottants.

## Logistique

Les camions sont automatiques.
- Un bâtiment doit toucher une route via `adjRoadTiles()`.
- `tryDispatch()` fait un BFS sur le réseau routier pour trouver une cible qui accepte la ressource.
- Les dépôts sont cibles en dernier recours.
- Les logements pleins sont moins prioritaires que ceux qui peuvent encore grandir.
- Les ressources en transit sont comptées dans `inc` pour éviter de sur-remplir une cible.

## Population, logements et pénurie

Les logements consomment `goods`.
- Chaque consommation donne de l'argent et peut déclencher l'arrivée d'un habitant.
- Les nouveaux habitants marchent depuis le bord de carte via `pathToEdge()`.
- Si un logement peuple reste sans marchandises pendant `STARVE_DELAY`, il se dégrade.
- Un bâtiment résidentiel fusionne se sépare en maisons.
- Une maison simple perd un habitant.

Les fusions résidentielles demandent un rectangle complet de logements plus petits, pleins et approvisionnés.

Niveaux connus :
- maison 1x1 ;
- maison jumelée 2x1 ou 1x2 ;
- maisons en rangée 3x1 ou 1x3 ;
- résidence 4x1 ou 1x4 ;
- immeuble 2x2 ;
- grand immeuble 3x2 ou 2x3 ;
- gratte-ciel 4x4.

## Industrie et fusions

Les bâtiments industriels identiques peuvent fusionner en rectangles :
- mines avec même minerai uniquement ;
- bâtiments en pause exclus de la fusion ;
- formes : 2x1, 3x1, 4x1, 2x2, 3x2, 4x4 et orientations associées ;
- production = nombre de cases x facteur de `CONFIG.industrie.facteurs`.

L'entretien industriel est périodique :
- coût = base x cases x facteur ;
- les sites en pause paient une fraction configurée par `entretienEnPause`.

## Économie

Chaque wallet contient :
- `money` : argent ;
- `basePop` : population de base ;
- `fin` : compteurs financiers ;
- `finHist` : historique pour calculer le rythme par minute ;
- `mi` : progression des milestones ;
- `eff` : efficacité de production selon population / emplois.

En multi, chaque joueur a son wallet. Les revenus, taxes et coûts sont appliqués au propriétaire du bâtiment.

## Multijoueur

Le serveur n'est pas autoritaire sur la simulation. Il :
- sert les fichiers statiques ;
- attribue un id, une couleur et un rôle hôte/invite ;
- relaie `action`, `cursor`, `chat` ;
- demande à l'hôte un snapshot complet quand un nouvel invite arrive ;
- gère comptes, tokens et sauvegardes.

Côté client :
- `serializeState()` produit l'état complet envoyé par l'hôte ou sauvegarde.
- `applySnapshot()` remplace l'état local par un snapshot.
- `applyAction()` rejoue une action reçue d'un autre joueur.
- `clickFn` intercepte les actions locales pour les envoyer au réseau puis les appliquer localement.
- Les bâtiments posés en multi reçoivent `owner = MP.myId`.
- `MP_ZONE = 20` interdit de construire trop près des bâtiments d'un autre joueur.
- Les curseurs des autres joueurs sont dessinés via surcharge de `drawFn`.

Messages WebSocket importants :
- serveur vers client : `hello`, `promoted_host`, `snapshot_request`, `snapshot`, `action`, `cursor`, `chat`, `player_list`, `auth_ok`, `auth_err`, `saves_list`, `save_ok`, `save_err`, `game_saved`, `game_loaded`.
- client vers serveur : `register`, `login`, `resume`, `list_saves`, `save_game`, `load_game`, `delete_save`, `snapshot`, `action`, `cursor`, `chat`.

## Authentification et sauvegardes

`server.js` stocke les comptes dans `data/users.json`.
- Mot de passe : hash SHA-256 simple.
- Token : hash déterministe `token:<username>:<passwordHash>`.
- Le token est stocké dans `localStorage` sous `fp_token`.
- Une sauvegarde contient `{ meta, state }`, ou `state` est le résultat de `serializeState()`.
- Charger une sauvegarde diffuse `game_loaded` à tous les clients connectés.

Ce système est suffisant pour du prototype local, pas pour un environnement non fiable.

## UI et contrôles

Interface principale :
- topbar : argent, population, ouvriers, camions, rotation, pause, vitesse, nouveau monde, aide, multijoueur ;
- toolbar : outils 1 à 9 ;
- panneau info : stocks, progression, entretien, demolition, filtres de dépôt ;
- panneau finances : total et rythme par minute ;
- panneau multijoueur injecté par `mpInjectUI()`.

Contrôles :
- clic gauche : construire, inspecter, tracer route/démolition si glisse ;
- clic droit glisse : camera ;
- clic droit simple : retour à l'outil inspecter ;
- molette : zoom ;
- `R` / `Maj+R` : rotation ;
- `ZQSD`, WASD ou flèches : camera ;
- `1` à `9` : outils ;
- `Espace` : pause ;
- `H` : aide ;
- `Échap` : annuler sélection/outil.

## Points d'attention connus

- Le serveur relaie les actions sans validation métier complète. Les clients valident aussi certains droits, mais ce n'est pas une sécurité forte.
- Les snapshots ne sérialisent pas les camions, walkers et floats ; ils sont remis à zéro au chargement/synchronisation.
- Les sauvegardes sont par utilisateur, mais charger une sauvegarde remplace la partie pour tous les clients connectés.
- Le chargement solo historique a été supprimé ; les sauvegardes passent par le panneau multijoueur.
- `node_modules/` est présent dans le workspace et non suivi par git. Éviter de le documenter comme source projet.

## Style de modification recommandé

- Garder le projet vanilla et sans build step sauf besoin explicite.
- Modifier `config.js` pour l'équilibrage gameplay quand c'est possible.
- Toucher le fichier `js/` correspondant au domaine visé ; voir `js/README.md`.
- Toucher `server.js` pour auth, sauvegardes, protocole WebSocket et fichiers statiques.
- Éviter les refactors larges : le client reste en scripts classiques avec globals partagés, découpés par domaines.
- Tester au minimum avec `npm start`, connexion à `http://localhost:8765`, puis panneau multijoueur sur `ws://localhost:8765`.