# Migration rendu → PixiJS — État & reprise

But : remplacer le rendu Canvas2D (`draw()` dans `js/07_rendering.js`) par une scène
**PixiJS v8** unique ("Full Pixi"), pour tenir ~5000 entités animées (Canvas2D était
GPU-bound). Un spike (`spike/pixi-spike.html`) l'a validé.

## Principe : "bake, don't rewrite"
On réutilise les fonctions de dessin Canvas2D (`drawX`) comme **générateurs de
textures**. Le helper `bake()` (dans `js/pixi/sprites.js`) redirige le global `ctx`
(passé en `let` dans `js/02_world_state.js`) vers un canvas offscreen, translate pour
que le point centre monde `c` tombe sur une ancre fixe, dessine, restaure `ctx`. Le
sprite est ensuite placé au `c` monde réel → parité pixel + lift géré gratuitement.

## Fichiers
- `js/pixi/vendor/pixi.min.js` — Pixi v8.6.6 (UMD, expose global `PIXI`).
- `js/pixi/scene.js` — app Pixi sur canvas `#pixi` (superposé à `#cv`), conteneur
  monde synchronisé caméra (`scale=cam.z`, `position=(-cam.x*z,-cam.y*z)`), 4 couches
  (`terrain / overlaysUnder / sprites / overlaysOver`), hook `onFrame`, debug `?pixidebug`.
- `js/pixi/sprites.js` — bakery + rendu arbres / entités / bâtiments + overlays.
- `index.html` — `<canvas id="pixi">` + scripts pixi (chargés APRÈS le jeu ; scene.js
  wrappe `drawFn` après l'override MP de 09). Entrée souris reste sur `#cv`
  (`#pixi` = `pointer-events:none`).
- `js/07_rendering.js` — `drawX` refactorés en `pose` + `core` (source unique
  rendu/baking) ; entités/arbres/bâtiments retirés de `draw()`. `drawBuilding` splitté
  en `drawBuildingBody` (baké) + `drawBuildingOverlays` (référence Canvas2D).
- `js/01_definitions.js` — `GRAPHIC_PACK_IMAGES_GEN` (incrémenté au chargement d'image,
  signal de re-bake des bâtiments).

## Fait (Phase 0 + Phase 1)
- Scaffolding Pixi + caméra alignée (vérifié).
- Arbres (baké 8 variantes, zone jouable via `mapMask`, rebuild sur groundVersion/rot/N).
- Entités directionnelles : camions/voitures/locos/wagons (bake `dirTextures` à
  KDIRS=24 angles par couleur ; cores `drawTruckCore`/`drawCarCore`/`drawTrainLocoCore`/
  `drawWagonCore` ; `vehiclePose`/`vehicleColor`).
- Piétons/sans-abri (statiques, `drawWalkerCore` + `walkerPose`/`homelessPose`).
- Bâtiments : corps baké (retenu, re-bake sur signature structurelle) + overlays LIVE
  Pixi (progression, 👤/💤, sélection, contour owner, badge pausé, ⚠️, $, 👥,
  surbrillances de route pleines) ; anneaux focus/sélection véhicule (Graphics).
- Tout est dans une seule couche `sprites` triée (`zIndex`) → occlusion cohérente.

## Reste à faire
- **Non validé headless** (Bash momentanément indispo au dernier incrément) : refaire
  `node --check js/pixi/sprites.js js/07_rendering.js` + smoke-test (voir plus bas).
- Pièces de gare (`drawTrainStationPiece`) encore Canvas2D → à porter.
- Mode diagnostic `highlightUnderstaffedFactories` (baker le diagnostic si activé).
- **Phase 2** — terrain sur Pixi (chunks RenderTexture bakés depuis l'art terrain,
  culling, invalidation groundVersion, ciel) → retirer le Canvas2D terrain.
- **Phase 3** — overlays au sol (feux, signaux rail, rayons, routes de véhicule, labels
  villes, drapeaux dépôt, badges d'expansion, curseurs MP) sur Pixi.
- **Phase 4** — supprimer le chemin Canvas2D + `draw()` ; tuning (ParticleContainer si
  besoin, résolution atlas, rebuild textures au changement de pack).

## Valider / lancer
- Serveur : `node server.js` → http://localhost:8765 (`?pixidebug` pour repères).
- Smoke-test headless : Playwright est dans `node_modules`. Charger `index.html`,
  vérifier `PixiScene.ready`, `PixiScene.layers.sprites.children.filter(c=>c.visible).length`
  vs attendu, `ctx===cv.getContext('2d')` (bake restauré), aucune pageerror. L'erreur
  `packs.json` en `file://` est pré-existante (servir en http pour un vrai test).

## Gotchas
- Const supersample = `SS` dans sprites.js, PAS `RES` (= table ressources globale).
- `drawFast` forcé à false pendant le bake des bâtiments (détails pleins).
- Le hook `drawFn` s'auto-répare en tête de `draw()` (`ctx = cv.getContext('2d')`).
