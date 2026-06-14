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
      "src": "house-0.png",
      "anchorX": 0.5,
      "anchorY": 1,
      "views": {
        "0": { "src": "house-0.png" },
        "1": { "src": "house-1.png" },
        "2": { "src": "house-2.png" },
        "3": { "src": "house-3.png" }
      }
    },
    "factory": {
      "src": "factory-0.png",
      "anchorX": 0.5,
      "anchorY": 1,
      "views": {
        "0": { "src": "factory-0.png" },
        "1": { "src": "factory-1.png" },
        "2": { "src": "factory-2.png" },
        "3": { "src": "factory-3.png" }
      },
      "variants": {
        "1x1": { "src": "factory-small.png" },
        "2x1": {
          "views": {
            "0": { "src": "factory-2x1-0.png" },
            "1": { "src": "factory-2x1-1.png" },
            "2": { "src": "factory-2x1-2.png" },
            "3": { "src": "factory-2x1-3.png" }
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
- `views` permet 4 images selon la rotation de la carte. Les clés sont `0`,
  `1`, `2`, `3`, correspondant aux 4 valeurs de rotation du jeu. Si une vue
  manque, le moteur utilise `src`.
- `anchorX` / `anchorY` indiquent le point d'ancrage dans l'image. `0.5, 1`
  signifie centre bas, le plus pratique pour une image isometrique.
- `offsetX` / `offsetY` déplacent le sprite en pixels canvas.
- `scale`, `width`, `height` permettent d'ajuster un sprite précis.
- `autoScale: true` agrandit automatiquement le sprite selon la taille du
  bâtiment fusionné. Par défaut, le moteur ne redimensionne pas selon
  l'empreinte : utilisez plutôt `scale` ou `variants` pour un rendu précis.
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

Production : `mine`, `lumber`, `farm`, `pump`, `fisher`, `mill`, `bakery`,
`fishery`, `smelter`, `factory`, `plant`.

Logements : `house`, `duplex`, `row`, `residence`, `tower`, `bigtower`, `sky`.

Logistique : `depot`, `tank`, `garage`.

Les bâtiments non définis dans le pack restent dessinés avec le rendu polygonal
de base.
