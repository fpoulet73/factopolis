// ===========================================================================
// Migration du rendu vers PixiJS — Scène (Phase 0 : scaffolding)
// ---------------------------------------------------------------------------
// Objectif de la migration : remplacer progressivement le rendu Canvas2D
// (draw() dans 07_rendering.js) par une scène PixiJS unique, en réutilisant
// toute la logique existante (math iso, caméra, poses d'entités, lift, MP…).
//
// Phase 0 ne dessine (presque) rien : elle monte l'app Pixi sur le canvas
// #pixi superposé au #cv Canvas2D, synchronise le conteneur monde sur la
// caméra du jeu, et branche le rendu Pixi à la fin de drawFn. Un overlay de
// debug (?pixidebug dans l'URL) trace quelques repères pour vérifier que la
// couche Pixi est bien alignée sur le Canvas2D dessous.
//
// Couches (remplies dans les phases suivantes) :
//   sky → terrain → sprites triés (arbres+bâtiments+entités) → overlays
// ===========================================================================
const PixiScene = (function(){
  let app = null, ready = false;
  let world = null;          // conteneur monde (échelle/position = caméra)
  const layers = {};         // sous-conteneurs par couche
  let debugG = null;
  const DEBUG = location.search.includes('pixidebug');

  async function init(){
    if(typeof PIXI === 'undefined'){ console.warn('[PixiScene] PIXI absent'); return; }
    app = new PIXI.Application();
    await app.init({
      canvas: document.getElementById('pixi'),
      width: W, height: H,
      resolution: DPR, autoDensity: true,
      backgroundAlpha: 0,                 // transparent : le Canvas2D transparaît dessous
      antialias: true,
      powerPreference: 'high-performance',
      autoStart: false,                   // on pilote app.render() depuis drawFn
    });

    world = new PIXI.Container();
    world.sortableChildren = true;        // tri profondeur (zIndex = spriteDepthKey)
    app.stage.addChild(world);
    // Couches ordonnées ; on les remplira aux phases suivantes.
    for(const name of ['terrain', 'overlaysUnder', 'sprites', 'overlaysOver']){
      const c = new PIXI.Container();
      c.sortableChildren = (name === 'sprites');
      layers[name] = c;
      world.addChild(c);
    }

    if(DEBUG) buildDebug();
    ready = true;
    // rendu initial immédiat
    render();
  }

  // Repères de debug : diamants aux coins + centre de la carte, pour vérifier
  // l'alignement Pixi ↔ Canvas2D. En coordonnées TOURNÉES (comme le jeu).
  function buildDebug(){
    debugG = new PIXI.Graphics();
    layers.overlaysOver.addChild(debugG);
    redrawDebug();
  }
  function redrawDebug(){
    if(!debugG) return;
    debugG.clear();
    // Diamant plein + contour épais + croix centrale : impossible à confondre avec
    // le terrain ou les zones d'expansion. Couvre ~1 tuile, centré sur la tuile.
    const mark = (tx, ty, color) => {
      const [rx, ry] = rotIdx(tx, ty);
      const c = iso(rx + 0.5, ry + 0.5);
      const path = g => g.moveTo(c[0], c[1] - TH2).lineTo(c[0] + TW2, c[1])
                         .lineTo(c[0], c[1] + TH2).lineTo(c[0] - TW2, c[1]).closePath();
      path(debugG); debugG.fill({ color, alpha: 0.5 });
      path(debugG); debugG.stroke({ width: 3, color, alpha: 1 });
      // croix centrale
      debugG.moveTo(c[0] - 6, c[1]).lineTo(c[0] + 6, c[1])
            .moveTo(c[0], c[1] - 6).lineTo(c[0], c[1] + 6)
            .stroke({ width: 2, color: 0xffffff, alpha: 1 });
    };
    const n = (typeof N === 'number' ? N : 64) - 1;
    mark(0, 0, 0xff00ff); mark(n, 0, 0x00ffff);
    mark(0, n, 0xffff00); mark(n, n, 0x00ff88);
    mark(n >> 1, n >> 1, 0xffffff);
  }

  // Synchronise le conteneur monde sur la caméra (identique au setTransform du
  // Canvas2D : écran = (monde - cam) * z ; resolution=DPR gère le HiDPI).
  function syncCamera(){
    world.scale.set(cam.z);
    world.position.set(-cam.x * cam.z, -cam.y * cam.z);
  }

  // Modules (arbres, entités, bâtiments…) qui se mettent à jour chaque frame.
  const frameCbs = [];
  function onFrame(cb){ frameCbs.push(cb); }

  // Appelé chaque frame à la fin de drawFn (après le rendu Canvas2D).
  function render(){
    if(!ready) return;
    syncCamera();
    for(const cb of frameCbs){ try { cb(); } catch(e){ console.error('[PixiScene] frameCb', e); } }
    if(DEBUG && debugG) redrawDebug(); // rot peut changer
    app.render();
  }

  function resize(){
    if(!ready) return;
    app.renderer.resize(W, H);
    render();
  }
  addEventListener('resize', resize);

  return { init, render, onFrame, get app(){ return app; }, get layers(){ return layers; },
           get world(){ return world; }, get ready(){ return ready; } };
})();

// --- Branchement dans la boucle de rendu -----------------------------------
// drawFn a déjà pu être wrappé par le multijoueur (09_multiplayer.js). On
// enveloppe la version courante : Canvas2D d'abord, puis rendu Pixi par-dessus.
(function hookRenderLoop(){
  const prev = (typeof drawFn === 'function') ? drawFn : (typeof draw === 'function' ? draw : null);
  if(!prev){ console.warn('[PixiScene] drawFn introuvable'); return; }
  drawFn = function(){
    prev();
    PixiScene.render();
  };
})();

PixiScene.init();
