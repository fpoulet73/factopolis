# Sons du jeu

Effets sonores servis statiquement (dossier `assets/` autorisé par `server.js`).
Ils sont déclarés dans `js/02_world_state.js` (objet `SOUNDS`) et joués via
`playSound(name)`. Désactivables globalement par ⚙️ → « Désactiver les sons »
(`UI_OPTIONS.disableSounds`).

## Fichiers attendus

| Nom logique  | Fichier                  | Déclenchement                                  |
|--------------|--------------------------|------------------------------------------------|
| `trainDepart`| `train_depart.mp3`       | Départ d'un train depuis une gare              |

## Recommandations

- Format : MP3 (large compatibilité navigateur).
- Durée courte (~1–3 s).
- Volume normalisé.

## Volume & déclenchement

- **Par effet** : réglé dans `config.js` → `CONFIG.sons.<nom>.volume` (0 → 1).
- **Global** : curseur « Volume des sons » dans ⚙️ (persisté en localStorage).
  Volume effectif = volume global × volume de l'effet.
- **Proximité** : les sons « de carte » (départ de train) ne jouent que si la
  source est visible à l'écran et que le zoom ≥ `CONFIG.sons.zoomMin`.

Tant qu'un fichier est absent, aucune erreur bloquante : le son ne joue
simplement pas (lecture entourée d'un `try/catch`).
