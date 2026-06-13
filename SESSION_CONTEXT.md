# Factopolis - contexte pour prochaines sessions

Ce fichier sert de point d'entree rapide pour reprendre le projet sans relire tout le code.

## Concept du jeu

Factopolis est un jeu de gestion/simulation en navigateur qui melange :

- chaines de production type Factorio ;
- city builder avec population, logements, taxes et ouvriers ;
- transport automatique par camions sur routes ;
- rendu isometrique 2.5D rotatif sur Canvas 2D.

Le joueur construit une ville industrielle : extraire fer/charbon/bois, transformer en acier puis marchandises, livrer les marchandises aux logements, faire grandir la population et financer l'expansion.

## Stack et lancement

- Frontend : `index.html`, `config.js`, `js/*.js`, Canvas 2D, JavaScript vanilla.
- Backend : `server.js`, Node.js, serveur HTTP statique + WebSocket via `ws`.
- Dependances : seulement `ws` cote serveur.
- Lancement : `npm start` ou `node server.js [port]`.
- Port par defaut : `8765`.
- URL locale : `http://localhost:8765`.
- WebSocket par defaut : `ws://localhost:8765`.

## Fichiers principaux

- `index.html` : structure DOM, styles inline, canvas, topbar, aide, chargement de `config.js` puis des scripts `js/` dans l'ordre numerique.
- `config.js` : valeurs de gameplay configurables sans modifier le moteur : production, logements, fusions, entretien, penurie, economie, camions.
- `js/README.md` : carte rapide des fichiers client decoupes.
- `js/01_definitions.js` a `js/10_saves_chat_console.js` : moteur client decoupe par domaine (definitions, monde, batiments, construction, logistique, simulation, rendu, UI/input, multi, sauvegardes/chat).
- `server.js` : fichiers statiques, WebSocket, authentification simple, relais multi, sauvegardes JSON.
- `data/users.json` : cree au runtime, comptes utilisateurs.
- `data/saves/<user>_<nom>.json` : cree au runtime, sauvegardes par utilisateur.

## Etat du jeu cote client

Les variables principales de simulation sont globales dans les scripts `js/` charges par `index.html` :

- `terrain` : `Uint8Array` de 64 x 64, types `GRASS`, `WATER`, `TREE`, `IRON`, `COAL`.
- `road` : `Uint8Array`, routes par tuile.
- `bgrid` : grille d'occupation, reference vers le batiment couvrant chaque tuile.
- `buildings` : liste des batiments actifs.
- `trucks` : camions en trajet.
- `walkers` : habitants qui arrivent ou partent a pied.
- `floats` : textes flottants de feedback.
- `WALLETS` : economie par joueur, cle `0` en solo ou id joueur en multi.
- `MP` : etat multijoueur local : socket, id, role, joueurs, curseurs, chat, compte, token, sauvegardes.

La carte fait `N = 64` tuiles. Les constantes de rendu isometrique sont `TILE = 36`, `TW = 64`, `TH = 32`.

## Batiments et ressources

Ressources :

- `iron` : fer.
- `coal` : charbon.
- `wood` : bois.
- `steel` : acier.
- `goods` : marchandises.

Outils/batiments principaux :

- route : connecte la logistique.
- mine : produit fer ou charbon selon le gisement.
- bucheron : produit du bois pres des arbres.
- fonderie : consomme fer + charbon, produit acier.
- usine : consomme acier + bois, produit marchandises.
- maison : consomme marchandises, gagne population et argent.
- depot : stocke et redistribue, avec filtres de ressources.
- demolition : detruit route, arbre ou batiment, remboursement partiel.

Les definitions de base sont dans `BUILD`. Les valeurs configurables sont appliquees ensuite depuis `CONFIG`.

## Boucle de simulation

La boucle `frame()` :

1. lit les touches de camera ;
2. appelle `update(dt * speed)` si non pause ;
3. dessine via `drawFn()`;
4. met a jour le HUD ;
5. relance `requestAnimationFrame`.

`update(dt)` gere :

- progression de production ;
- consommation des logements ;
- arrivee/depart des habitants ;
- fusions residentielles et industrielles ;
- dispatch automatique des camions ;
- taxes ;
- entretien industriel ;
- historique financier ;
- milestones de population ;
- textes flottants.

## Logistique

Les camions sont automatiques.

- Un batiment doit toucher une route via `adjRoadTiles()`.
- `tryDispatch()` fait un BFS sur le reseau routier pour trouver une cible qui accepte la ressource.
- Les depots sont cibles en dernier recours.
- Les logements pleins sont moins prioritaires que ceux qui peuvent encore grandir.
- Les ressources en transit sont comptees dans `inc` pour eviter de sur-remplir une cible.

## Population, logements et penurie

Les logements consomment `goods`.

- Chaque consommation donne de l'argent et peut declencher l'arrivee d'un habitant.
- Les nouveaux habitants marchent depuis le bord de carte via `pathToEdge()`.
- Si un logement peuple reste sans marchandises pendant `STARVE_DELAY`, il se degrade.
- Un batiment residentiel fusionne se separe en maisons.
- Une maison simple perd un habitant.

Les fusions residentielles demandent un rectangle complet de logements plus petits, pleins et approvisionnes.

Niveaux connus :

- maison 1x1 ;
- maison jumelee 2x1 ou 1x2 ;
- maisons en rangee 3x1 ou 1x3 ;
- residence 4x1 ou 1x4 ;
- immeuble 2x2 ;
- grand immeuble 3x2 ou 2x3 ;
- gratte-ciel 4x4.

## Industrie et fusions

Les batiments industriels identiques peuvent fusionner en rectangles :

- mines avec meme minerai uniquement ;
- batiments en pause exclus de la fusion ;
- formes : 2x1, 3x1, 4x1, 2x2, 3x2, 4x4 et orientations associees ;
- production = nombre de cases x facteur de `CONFIG.industrie.facteurs`.

L'entretien industriel est periodique :

- cout = base x cases x facteur ;
- les sites en pause paient une fraction configuree par `entretienEnPause`.

## Economie

Chaque wallet contient :

- `money` : argent ;
- `basePop` : population de base ;
- `fin` : compteurs financiers ;
- `finHist` : historique pour calculer le rythme par minute ;
- `mi` : progression des milestones ;
- `eff` : efficacite de production selon population / emplois.

En multi, chaque joueur a son wallet. Les revenus, taxes et couts sont appliques au proprietaire du batiment.

## Multijoueur

Le serveur n'est pas autoritaire sur la simulation. Il :

- sert les fichiers statiques ;
- attribue un id, une couleur et un role hote/invite ;
- relaie `action`, `cursor`, `chat` ;
- demande a l'hote un snapshot complet quand un nouvel invite arrive ;
- gere comptes, tokens et sauvegardes.

Cote client :

- `serializeState()` produit l'etat complet envoye par l'hote ou sauvegarde.
- `applySnapshot()` remplace l'etat local par un snapshot.
- `applyAction()` rejoue une action recue d'un autre joueur.
- `clickFn` intercepte les actions locales pour les envoyer au reseau puis les appliquer localement.
- Les batiments poses en multi recoivent `owner = MP.myId`.
- `MP_ZONE = 20` interdit de construire trop pres des batiments d'un autre joueur.
- Les curseurs des autres joueurs sont dessines via surcharge de `drawFn`.

Messages WebSocket importants :

- serveur vers client : `hello`, `promoted_host`, `snapshot_request`, `snapshot`, `action`, `cursor`, `chat`, `player_list`, `auth_ok`, `auth_err`, `saves_list`, `save_ok`, `save_err`, `game_saved`, `game_loaded`.
- client vers serveur : `register`, `login`, `resume`, `list_saves`, `save_game`, `load_game`, `delete_save`, `snapshot`, `action`, `cursor`, `chat`.

## Authentification et sauvegardes

`server.js` stocke les comptes dans `data/users.json`.

- Mot de passe : hash SHA-256 simple.
- Token : hash deterministe `token:<username>:<passwordHash>`.
- Le token est stocke dans `localStorage` sous `fp_token`.
- Une sauvegarde contient `{ meta, state }`, ou `state` est le resultat de `serializeState()`.
- Charger une sauvegarde diffuse `game_loaded` a tous les clients connectes.

Ce systeme est suffisant pour du prototype local, pas pour un environnement non fiable.

## UI et controles

Interface principale :

- topbar : argent, population, ouvriers, camions, rotation, pause, vitesse, nouveau monde, aide, multijoueur ;
- toolbar : outils 1 a 9 ;
- panneau info : stocks, progression, entretien, demolition, filtres de depot ;
- panneau finances : total et rythme par minute ;
- panneau multijoueur injecte par `mpInjectUI()`.

Controles :

- clic gauche : construire, inspecter, tracer route/demolition si glisse ;
- clic droit glisse : camera ;
- clic droit simple : retour a l'outil inspecter ;
- molette : zoom ;
- `R` / `Maj+R` : rotation ;
- `ZQSD`, WASD ou fleches : camera ;
- `1` a `9` : outils ;
- `Espace` : pause ;
- `H` : aide ;
- `Echap` : annuler selection/outil.

## Points d'attention connus

- Le serveur relaie les actions sans validation metier complete. Les clients valident aussi certains droits, mais ce n'est pas une securite forte.
- Les snapshots ne serialisent pas les camions, walkers et floats ; ils sont remis a zero au chargement/synchronisation.
- Les sauvegardes sont par utilisateur, mais charger une sauvegarde remplace la partie pour tous les clients connectes.
- Le chargement solo historique a ete supprime ; les sauvegardes passent par le panneau multijoueur.
- `node_modules/` est present dans le workspace et non suivi par git. Eviter de le documenter comme source projet.

## Style de modification recommande

- Garder le projet vanilla et sans build step sauf besoin explicite.
- Modifier `config.js` pour l'equilibrage gameplay quand c'est possible.
- Toucher le fichier `js/` correspondant au domaine vise ; voir `js/README.md`.
- Toucher `server.js` pour auth, sauvegardes, protocole WebSocket et fichiers statiques.
- Eviter les refactors larges : le client reste en scripts classiques avec globals partages, decoupes par domaines.
- Tester au minimum avec `npm start`, connexion a `http://localhost:8765`, puis panneau multijoueur sur `ws://localhost:8765`.
