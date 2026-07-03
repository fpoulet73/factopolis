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
  // Terrain sur Pixi : piloté par le flag global PIXI_TERRAIN (défini dans 07_rendering.js,
  // activé par défaut, ?nopixiterrain pour forcer le Canvas2D). L'usage réel dans draw() est
  // gaté sur PixiScene.ready → fallback Canvas2D automatique si Pixi n'initialise pas.
  let bgSky = null, bgTerrain = null, _bgSource = null, _skyKey = '', _bgTexW = 0, _bgTexH = 0, _bgTexVer = -1, _bgUploadTTL = 0;
  const wantTerrain = () => (typeof PIXI_TERRAIN !== 'undefined' && PIXI_TERRAIN);

  async function init(){
    if(typeof PIXI === 'undefined'){ console.warn('[PixiScene] PIXI absent — fallback Canvas2D'); if(typeof PIXI_TERRAIN !== 'undefined') PIXI_TERRAIN = false; return; }
    app = new PIXI.Application();
    try {
      await app.init({
        canvas: document.getElementById('pixi'),
        width: W, height: H,
        resolution: DPR, autoDensity: true,
        backgroundAlpha: 0,                 // transparent : le Canvas2D transparaît dessous
        antialias: true,
        powerPreference: 'high-performance',
        autoStart: false,                   // on pilote app.render() depuis drawFn
      });
    } catch(e){
      // WebGL indisponible / init échouée → on désactive le terrain Pixi et on laisse
      // le jeu tourner en Canvas2D (draw() gate sur PixiScene.ready, qui restera false).
      console.warn('[PixiScene] init échouée — fallback Canvas2D:', e && e.message);
      if(typeof PIXI_TERRAIN !== 'undefined') PIXI_TERRAIN = false;
      app = null;
      return;
    }

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

    if(wantTerrain()) setupPixiTerrain();
    if(DEBUG) buildDebug();
    ready = true;
    // rendu initial immédiat
    render();
  }

  // --- Terrain sur Pixi (Phase 2, flag ?pixiterrain) ---------------------
  // Réutilise le scroll-buffer Canvas2D (groundCache) : on l'affiche via un sprite
  // écran-espace SOUS le conteneur monde, + un ciel dégradé derrière. #cv est masqué.
  // Limite connue : pendant un ZOOM (drawFast), groundCache n'est pas mis à jour →
  // terrain figé le temps du zoom (à traiter ensuite). Le PAN est géré (offset blit).
  function setupPixiTerrain(){
    bgSky = new PIXI.Graphics();
    bgTerrain = new PIXI.Sprite();
    app.stage.addChildAt(bgSky, 0);       // tout au fond
    app.stage.addChildAt(bgTerrain, 1);   // terrain au-dessus du ciel, sous le monde
    // #cv passe AU-DESSUS de #pixi : il ne dessine plus que les overlays dynamiques
    // (transparent, cf. draw() en mode PIXI_TERRAIN). Il garde les handlers d'entrée
    // (drag/molette) et, étant au-dessus, reçoit directement les événements.
    const cvEl = document.getElementById('cv');
    if(cvEl) cvEl.style.zIndex = '2'; // > #pixi (z-index 1)
  }
  function updatePixiTerrain(){
    // ciel (redessiné seulement si viewport/pack change)
    const pack = (typeof graphicBasePack === 'function') ? graphicBasePack() : { sky:['#8ec5e8','#cfe8f5'] };
    const skyKey = W + '|' + H + '|' + pack.sky[0] + '|' + pack.sky[1];
    if(skyKey !== _skyKey){
      _skyKey = skyKey;
      const grad = new PIXI.FillGradient(0, 0, 0, H);
      grad.addColorStop(0, pack.sky[0]); grad.addColorStop(1, pack.sky[1]);
      bgSky.clear(); bgSky.rect(0, 0, W, H).fill(grad);
    }
    // Terrain : le sprite affiche le scroll-buffer Canvas2D `groundCache`. On gère la
    // source WebGL nous-mêmes plutôt que via PIXI.Texture.from(canvas) : ce dernier met
    // la source EN CACHE par élément canvas et NE la redimensionne PAS quand le canvas
    // change de taille. Or groundCache passe de 300×150 (canvas par défaut) à (W+2M)*DPR
    // au 1er bake ; selon l'ordre init-Pixi ↔ 1er bake (course), Texture.from() pouvait
    // renvoyer une source figée à 300×150 → terrain échantillonné sur un coin minuscule
    // = écran noir aléatoire, persistant même après chargement d'une partie. On crée donc
    // une CanvasSource explicite qu'on RESIZE (resolution 1 : le buffer est déjà en px device).
    let needUpload = false;
    if(!_bgSource){
      _bgSource = new PIXI.CanvasSource({ resource: groundCache, resolution: 1 });
      bgTerrain.texture = new PIXI.Texture({ source: _bgSource });
      _bgTexW = groundCache.width; _bgTexH = groundCache.height; needUpload = true;
    }
    if(groundCache.width !== _bgTexW || groundCache.height !== _bgTexH){
      _bgSource.resize(groundCache.width, groundCache.height, 1);
      _bgTexW = groundCache.width; _bgTexH = groundCache.height; needUpload = true;
    }
    if(_bgTexVer !== groundTexVersion){ _bgTexVer = groundTexVersion; needUpload = true; }
    // Filet de sécurité anti-écran-noir : après tout changement (init Pixi, resize,
    // nouveau contenu de sol), on ré-uploade la texture pendant QUELQUES frames au lieu
    // d'un seul upload. Sur GPU réel, un upload unique peut tomber sur une frame où le
    // contexte WebGL ou le backing-store du canvas 2D `groundCache` n'est pas encore prêt
    // → terrain noir figé, car groundTexVersion ne rebouge plus tant que la scène est
    // statique (écran-titre). Non reproductible en headless (swiftshader upload sync).
    // Le TTL garantit plusieurs tentatives puis s'éteint → aucun coût au repos.
    if(needUpload) _bgUploadTTL = 8;
    if(_bgUploadTTL > 0){ _bgSource.update(); _bgUploadTTL--; }
    // Placement du buffer (repère écran) selon la caméra COURANTE, y compris zoom.
    // Le buffer a été baké à cacheCam (cacheCamX/Y) et cacheCamZ, avec marge M et un
    // suréchantillonnage DPR. Un point monde P → pixel buffer (P-cacheCam)*cacheCamZ*DPR+M*DPR,
    // et doit atterrir à l'écran en (P-cam)*cam.z. D'où : scale = cam.z/(cacheCamZ*DPR),
    // position = (cacheCam-cam)*cam.z - M*cam.z/cacheCamZ. En pan (cam.z==cacheCamZ) c'est
    // l'offset de blit ; en zoom le buffer figé scale/track avec les sprites (flou transitoire,
    // net à la fin du zoom quand le buffer se reconstruit).
    const M = (typeof GROUND_BUFFER_MARGIN !== 'undefined') ? GROUND_BUFFER_MARGIN : 320;
    const zr = cam.z / cacheCamZ;
    bgTerrain.scale.set(cam.z / (cacheCamZ * DPR));
    bgTerrain.position.set(
      (cacheCamX - cam.x) * cam.z - M * zr,
      (cacheCamY - cam.y) * cam.z - M * zr
    );
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
    if(wantTerrain() && bgTerrain) updatePixiTerrain();
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
