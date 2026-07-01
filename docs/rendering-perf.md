# Performance de rendu — état, décisions et roadmap

Résumé de la discussion du 2026-06-30 sur le lag de rendu et la question « faut-il
passer à PixiJS / changer de techno ? ».

## Problème

Sur une carte **128**, le jeu lague au **déplacement** (pan) et au **zoom/dézoom**.

## État du rendu (Canvas2D)

Deux optimisations existaient déjà :

1. **Culling viewport** — seules les tuiles visibles sont dessinées (pas les 16 384 d'une
   carte 128). Voir `draw()` dans `js/07_rendering.js`.
2. **Cache offscreen du sol** (`groundCache`) — terrain + eau + routes + rails rendus
   une fois puis blittés.

**Limite identifiée** : la clé du cache incluait `cam.x`/`cam.y`, donc **chaque pan
invalidait le cache** et redessinait tout le sol tuile par tuile, 60×/s. Idem au zoom
(`drawFast` désactive le cache). C'était précisément la source du lag.

Détail aggravant : les entités (camions, trains, walkers) sont **dessinées en
vectoriel** (`drawTruck`, `drawVehicle`, `drawTrainWagon` = `ctx.save` + paths +
rotations), soit ~10-50× le coût d'un sprite texturé.

## Options pesées

### Canvas2D optimisé (faible risque)
- **Scroll-buffer à marge** ✅ *retenu, implémenté* — rendre le sol dans un buffer plus
  grand que le viewport ; tant que la caméra reste dans la marge, simple blit décalé,
  zéro re-rendu. Voir section « Implémenté » ci-dessous.
- Pré-rendre les types de tuiles en bitmaps (`drawImage` au lieu de `fill()` + path).
- Couper davantage les détails (blé/coton/minerai…) au dézoom selon `cam.z`.

### PixiJS / WebGL (différé)
- **Justifié par la roadmap** (~5000 entités animées) : le batching GPU avale des
  milliers de sprites là où Canvas2D immediate-mode plafonne. C'est *le* bon outil pour
  le mur « beaucoup d'entités ».
- **Mais** : réécriture de toute la couche pixels (~2600 lignes), couplée au picking,
  aux overlays et à l'interpolation MP. La sim, la logistique, le MP et la **math iso**
  se réutilisent tels quels.
- **Pas un changement de langage** : le goulot des 5000 entités est GPU, pas CPU — V8
  n'est pas le problème.
- **Plan** : faire un **spike** (5000 sprites en mouvement avec la projection iso
  existante) pour valider perf + intégration + picking, AVANT de s'engager. Puis migrer
  par couches (entités d'abord, terrain ensuite), sans geler le dev.
- **Risque clé** : un port naïf peut être *plus lent* que du Canvas2D bien optimisé
  (objets recréés chaque frame, textures non batchées). Le gain n'est garanti que si on
  architecture en mode retenu.

### Autres technos (écartées ou conditionnelles)
- **WASM (Rust / AssemblyScript)** — seulement si un profil prouve que la **sim**
  devient CPU-bound (pathfinding de milliers de véhicules). On garde JS + WebGL autour
  et on déporte juste le hot-loop. À garder en réserve, pas maintenant.
- **TypeScript** — pas pour la perf, pour la **robustesse** d'un codebase de 16k lignes
  qui grossit (aurait attrapé des bugs d'état déjà rencontrés). Migration progressive,
  fichier par fichier. Recommandé indépendamment.
- **Moteurs natifs (Godot 4, Unity, Bevy)** — gèrent 5000 entités facilement, mais
  **perte de la distribution web** (lancement par URL, multijoueur en rooms, zéro
  install). Export web possible mais lourd. Écartés.

## Décision

1. **Maintenant** : scroll-buffer Canvas2D (fait) pour régler le lag de pan.
2. **Roadmap → PixiJS** quand on attaque les ~5000 entités, via spike de validation
   d'abord, puis migration par couches. Langage **JS conservé**.
3. WASM en réserve (sim), TypeScript pour la robustesse — au choix, indépendants.

## Roadmap cible (donnée par l'utilisateur)

- ~**5000 entités** animées simultanées (500 = trop peu).
- Cartes **plus grandes**.
- **Plus de multijoueur**.
- **Contenu / gameplay** additionnel.

## Implémenté : scroll-buffer à marge

- `groundCache` devient un canvas de `(W+2M)·DPR × (H+2M)·DPR` (marge
  `GROUND_BUFFER_MARGIN = 320` px CSS, dans `js/02_world_state.js`).
- Le sol est rendu une fois centré sur la caméra du moment (`cacheCamX/cacheCamY`),
  fond **transparent** (le ciel est dessiné séparément sur le canvas principal, donc
  reste fixe à l'écran). Tant que `|(cam−cacheCam)·z| ≤ M` (et que rien d'autre n'a
  changé : zoom, rotation, version du sol, taille canvas, survol d'expansion), on
  **blitte le buffer décalé** — la plupart des frames de pan = un seul `drawImage`.
- Reconstruction uniquement en sortant de la marge, au zoom (`drawFast`, rendu direct
  inchangé), sur rotation ou mutation du sol.
- `ctx` (global) est temporairement basculé vers `groundCacheCtx` pendant la
  reconstruction, avec self-heal en tête de `draw()`.

Réglage : augmenter `GROUND_BUFFER_MARGIN` = pan plus long sans reconstruction, au prix
de plus de mémoire (≈ `(W+2M)(H+2M)·DPR²·4` octets) et de reconstructions plus chères.

## Prochaines étapes possibles

- Mesurer le gain (compteur reconstructions/s + ms/frame en pan).
- Si besoin de plus : pré-rendu des tuiles en bitmaps, puis le spike PixiJS.
