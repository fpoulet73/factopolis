




















































(# Corrections Détaillées - Bug n°1 : mapBounds incorrect

## Localisation exacte du bug

Fichier : **`expansion.js`** (ou fichier principal selon votre structure)  
Fonction : **`buyExpansion()`**  
Ligne approximative : 200-250 (selon la version)

## Code AVANT correction (avec bug)

```javascript
function buyExpansion(pieceId, side) {
    // ... achat de la pièce ...
    
    if(expansionLevels[exp.side] > 0) {
        if(exp.side === 'right')  mapBounds.x1 = s.x1;   // ❌ BUG !
        if(exp.side === 'left')   mapBounds.x0 = s.x0;   // ❌ BUG !
        if(exp.side === 'bottom') mapBounds.y1 = s.y1;   // ❌ BUG !
        if(exp.side === 'top')    mapBounds.y0 = s.y0;   // ❌ BUG !
    } else {
        // Première extension
        if(expansionLevels[exp.side] === 0) {
            exp.x1 = s.x1;  exp.x0 = s.x0; exp.y1 = s.y1; exp.y0 = s.y0;
            mapBounds.x1 = s.x1; mapBounds.x0 = s.x0; mapBounds.y1 = s.y1; mapBounds.y0 = s.y0;
        } else { ... }
    }
}

// Variable s est définie plus haut dans la fonction (la dernière pièce achetée)
let s = pieces[pieceId];  // ou similaire
```

## Code APRÈS correction ✅

```javascript
function buyExpansion(pieceId, side) {
    // ... achat de la pièce ...
    
    if(expansionLevels[exp.side] > 0) {
        // On a déjà étendu cette direction : utiliser max/min pour agrandir
        if(expansionLevels[exp.side] === expansionLevels['right'] || 
           expansionLevels[exp.side] === expansionLevels['bottom']) {
            if(exp.side === 'right')  mapBounds.x1 = Math.max(mapBounds.x1, exp.x1);
            if(exp.side === 'left')   mapBounds.x0 = Math.min(mapBounds.x0, exp.x0);
            if(exp.side === 'bottom') mapBounds.y1 = Math.max(mapBounds.y1, exp.y1);
            if(exp.side === 'top')    mapBounds.y0 = Math.min(mapBounds.y0, exp.y0);
        } else {
            // Première extension complète : utiliser les bornes de la dernière pièce
            if(expansionLevels[exp.side] === 0) {
                exp.x1 = s.x1;  exp.x0 = s.x0; 
                exp.y1 = s.y1; exp.y0 = s.y0;
                mapBounds.x1 = s.x1; mapBounds.x0 = s.x0; 
                mapBounds.y1 = s.y1; mapBounds.y0 = s.y0;
            } else { ... }
        }
    }
}

// Ou version plus simple (si seulement une bande est active à la fois) :
if(expansionLevels[exp.side] > 0) {
    if(expansionLevels[exp.side] === expansionLevels['right'] || 
       expansionLevels[exp.side] === expansionLevels['bottom']) {
        // Extension partielle : agrandir avec max/min
        mapBounds.x1 = Math.max(mapBounds.x1, exp.x1);   // right/bottom
        mapBounds.x0 = Math.min(mapBounds.x0, exp.x0);   // left/top
        mapBounds.y1 = Math.max(mapBounds.y1, exp.y1);
        mapBounds.y0 = Math.min(mapBounds.y0, exp.y0);
    } else {
        // Première extension : utiliser la dernière pièce directement
        if(expansionLevels[exp.side] === 0) {
            mapBounds.x1 = s.x1; mapBounds.x0 = s.x0; 
            mapBounds.y1 = s.y1; mapBounds.y0 = s.y0;
        } else { ... }
    }
}
```

## Vérification par test unitaire mental

**Scénario de test :** Carte 20×20, bande "right" achetée en fragments x=25→30

| Étape | mapBounds.x1 avant | Correction appliquée | mapBounds.x1 après | ✅/❌ |
|-------|-------------------|---------------------|-------------------|------|
| Achat fragment 1 (x=25-28) | 20 | `max(20, 28)` | 28 | ✅ |
| Achat fragment 2 (x=29-30) | 28 | `max(28, 30)` | 30 | ✅ |

**Scénario de test négatif :** Si on achetait le fragment x=15-18 avant x=25-30
| Étape | mapBounds.x1 avant | Correction appliquée | mapBounds.x1 après | ✅/❌ |
|-------|-------------------|---------------------|-------------------|------|
| Achat fragment 1 (x=15-18) | 20 | `max(20, 18)` | 20 | ✅ (reste à 20) |

## Application de la correction

Ouvrez votre fichier source et cherchez :

```javascript
if(expansionLevels[exp.side] > 0) {
    if(exp.side === 'right')  mapBounds.x1 = s.x1;   // ← remplacer par...
    if(exp.side === 'left')   mapBounds.x0 = s.x0;   //    max(mapBounds.x1, exp.x1);
    if(exp.side === 'bottom') mapBounds.y1 = s.y1;   //    min(mapBounds.x0, exp.x0);
    if(exp.side === 'top')    mapBounds.y0 = s.y0;   //    max/mapBounds.y1, exp.y1);
}
```

Et remplacez par la version corrigée ci-dessus.

---

**Note :** Cette correction est critique car sans elle, le joueur ne peut pas explorer au-delà des bornes initiales de sa carte !
