# Packs graphiques Factopolis

Un pack graphique communautaire est un dossier dans `assets/graphic-packs/`
avec un fichier `pack.json` et des images (`png`, `webp`, `svg`, etc.).

Ajoutez le manifeste du pack dans `assets/graphic-packs/packs.json` :

```json
{
  "packs": [
    "mon-pack/pack.json"
  ]
}
```

## Format de `pack.json`

```json
{
  "id": "mon-pack",
  "name": "Mon pack",
  "description": "Sprites isometriques personnalises.",
  "fallback": "classic",
  "defaultScale": 1,
  "buildings": {
    "house": {
      "src": "house-1x1-N.png",
      "anchorX": 0.5,
      "anchorY": 1,
      "views": {
        "N": { "src": "house-1x1-N.png" },
        "E": { "src": "house-1x1-E.png" },
        "S": { "src": "house-1x1-S.png" },
        "W": { "src": "house-1x1-W.png" }
      }
    },
    "factory": {
      "src": "factory-1x1-N.png",
      "anchorX": 0.5,
      "anchorY": 1,
      "views": {
        "N": { "src": "factory-1x1-N.png" },
        "E": { "src": "factory-1x1-E.png" },
        "S": { "src": "factory-1x1-S.png" },
        "W": { "src": "factory-1x1-W.png" }
      },
      "variants": {
        "1x1": { "src": "factory-small.png" },
        "2x1": {
          "views": {
            "N": { "src": "factory-2x1-N.png" },
            "E": { "src": "factory-2x1-E.png" },
            "S": { "src": "factory-2x1-S.png" },
            "W": { "src": "factory-2x1-W.png" }
          }
        },
        "1x2": { "src": "factory-deep.png" },
        "2x2": { "src": "factory-large.png" },
        "area:6": { "src": "factory-6tiles.png" }
      }
    }
  }
}
```

- `src` est relatif au dossier du `pack.json`.
- `views` permet 4 images selon la rotation de la carte. Les clés recommandées
  sont `N`, `E`, `S`, `W` ; les anciennes clés `0`, `1`, `2`, `3` restent
  acceptées. La vue de départ est `N` ; rotation gauche affiche `E`, puis `S`,
  puis `W`, et la rotation droite parcourt l'ordre inverse. Si une vue manque,
  le moteur utilise `src`.
- `anchorX` / `anchorY` indiquent le point d'ancrage dans l'image. `0.5, 1`
  signifie centre bas, le plus pratique pour une image isometrique.
- `offsetX` / `offsetY` déplacent le sprite en pixels canvas.
- `scale`, `width`, `height` permettent d'ajuster un sprite précis.
- `fit: "footprint"` redimensionne le contenu visible d'un PNG pour que sa
  largeur corresponde à l'empreinte isométrique des tuiles occupées. Le moteur
  applique ce comportement par défaut aux PNG, et un pack peut le déclarer avec
  `defaultFit: "footprint"`.
- `autoScale: true` agrandit automatiquement le sprite selon la taille du
  bâtiment fusionné pour les sprites qui n'utilisent pas `fit: "footprint"`.
  Utilisez `scale`, `width`, `height` ou `variants` pour ajuster un rendu précis.
- `labelX` / `labelY` règlent la position des barres et alertes par-dessus.
- `variants` permet une image différente pour un bâtiment fusionné. L'ordre de
  recherche est : empreinte réelle (`2x1`), empreinte tournée à l'écran (`1x2`),
  nombre de tuiles (`area:2` ou `2`), puis `default`, puis le sprite de base.
- Chaque variante peut elle aussi définir ses propres `views`. Si une variante
  ne redéfinit pas `anchorX`, `anchorY`, `scale`, etc., elle hérite des valeurs
  du sprite parent.
- Les variantes par empreinte sont utiles pour dessiner une usine longue,
  profonde ou massive. Les variantes par aire sont pratiques quand la même image
  peut servir pour toutes les orientations d'un bâtiment de même taille.

## Identifiants de bâtiments

Production : `mine`, `lumber`, `farm`, `cotton_farm`, `weaver`, `pump`,
`fisher`, `mill`, `bakery`, `fishery`, `smelter`, `factory`, `plant`.

Logements : `house`, `duplex`, `row`, `residence`, `tower`, `bigtower`,
`tower3`, `sky`.

Logistique : `depot`, `tank`, `garage`.

Les bâtiments non définis dans le pack restent dessinés avec le rendu polygonal
de base.
