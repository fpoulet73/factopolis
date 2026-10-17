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
  let bgSky = null, bgTerrain = null, _bgSource = null, _skyKey = '', _bgTexW = 0, _bgTexH = 0, _bgTexVer = -1, _bgUploadUntil = 0, _bgLastUpload = 0;
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
    // Perte/restauration du contexte WebGL — cause n°1 de l'écran-titre « sapins sans
    // sol » : au démarrage (surtout Firefox/Windows, GPU hybride qui bascule à cause de
    // powerPreference, reset driver) le contexte GL est perdu puis restauré. À la
    // restauration, Pixi recrée les textures des SPRITES (arbres, bâtiments) et re-rend
    // le ciel (vecteur) — mais PAS notre terrain : il n'est uploadé qu'une fois (gaté sur
    // groundTexVersion), donc sur une scène statique il resterait vide.
    // On force donc sa reconstruction : (1) via le runner interne contextChange de Pixi
    // (fiable, émis à chaque restauration), et (2) via l'évènement DOM en secours.
    if(app.renderer && app.renderer.runners && app.renderer.runners.contextChange){
      app.renderer.runners.contextChange.add({ contextChange(){ bgForceReupload(); } });
    }
    const glEl = document.getElementById('pixi');
    if(glEl) glEl.addEventListener('webglcontextrestored', bgForceReupload);
  }
  // Force la reconstruction complète de la texture terrain + ré-upload continu pendant
  // une fenêtre (le contexte peut encore vaciller juste après). Appelé à chaque
  // (re)création de contexte GL.
  function bgForceReupload(){
    _bgSource = null; _bgTexW = 0; _bgTexH = 0; _bgTexVer = -1; _skyKey = '';
    _bgUploadUntil = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 4000;
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
    // Anti-écran-noir. Un upload unique de la texture peut tomber pendant que le contexte
    // WebGL vacille au démarrage (Firefox/Windows, GPU hybride) : le binding GL de la
    // source est alors invalidé et un simple update() NE rétablit PAS l'affichage — seule
    // une source NEUVE le fait (cf. récupération après restauration de contexte). Comme la
    // scène est statique (écran-titre), groundTexVersion ne rebouge plus → terrain figé en
    // noir (« on ne voit que les sapins »). On maintient donc une FENÊTRE de robustesse
    // (démarrage + après chaque (re)création de contexte, cf. bgForceReupload) pendant
    // laquelle on RECRÉE périodiquement la source, throttlé, jusqu'à ce que le contexte se
    // stabilise. Hors fenêtre : upload uniquement sur changement réel → aucun coût au repos.
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if(_bgUploadUntil === 0) _bgUploadUntil = now + 4000; // fenêtre initiale au 1er passage
    if(_bgSource && now < _bgUploadUntil && now - _bgLastUpload > 200){
      const old = bgTerrain.texture;
      _bgSource = null;
      if(old && old !== PIXI.Texture.EMPTY){ try { old.destroy(true); } catch(e){} }
    }
    let needUpload = false;
    if(!_bgSource){
      _bgSource = new PIXI.CanvasSource({ resource: groundCache, resolution: 1 });
      bgTerrain.texture = new PIXI.Texture({ source: _bgSource });
      _bgTexW = groundCache.width; _bgTexH = groundCache.height; needUpload = true;
    }
    if(groundCache.width !== _bgTexW || groundCache.height !== _bgTexH){
      // Source NEUVE plutôt que _bgSource.resize() : après un redimensionnement (zoom navigateur
      // Ctrl +/-), la texture GPU redimensionnée restait au mauvais format → terrain décalé
      // (très visible sur le relief) tant qu'on ne la recréait pas.
      const old = bgTerrain.texture;
      _bgSource = new PIXI.CanvasSource({ resource: groundCache, resolution: 1 });
      bgTerrain.texture = new PIXI.Texture({ source: _bgSource });
      if(old && old !== PIXI.Texture.EMPTY){ try { old.destroy(true); } catch(e){} }
      _bgTexW = groundCache.width; _bgTexH = groundCache.height; needUpload = true;
    }
    if(_bgTexVer !== groundTexVersion){ _bgTexVer = groundTexVersion; needUpload = true; }
    if(needUpload){ _bgSource.update(); _bgLastUpload = now; }
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
    // même translation (calée) que le monde : sol et sprites restent solidaires au pixel près
    bgTerrain.position.set(
      camOffset(cam.x) + cacheCamX * cam.z - M * zr,
      camOffset(cam.y) + cacheCamY * cam.z - M * zr
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
  // Translation calée sur le pixel PHYSIQUE quand le zoom est stable : à position
  // fractionnaire, chaque image rééchantillonne sprites et sol différemment
  // (scintillement / tremblement au pan lent). Pendant un zoom, pas de calage (le
  // facteur d'échelle varie de toute façon à chaque image).
  function camOffset(v){
    const o = -v * cam.z;
    if(typeof targetCam !== 'undefined' && targetCam.z !== cam.z) return o;
    const d = (typeof DPR === 'number' && DPR > 0) ? DPR : 1;
    return Math.round(o * d) / d;
  }
  function syncCamera(){
    world.scale.set(cam.z);
    world.position.set(camOffset(cam.x), camOffset(cam.y));
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
    // Zoom navigateur : la taille en px PHYSIQUES peut rester identique (ex. 1284×805 à 100 % comme
    // à 125 %) alors que la résolution change. Pixi ignore alors le resize et garde renderer.screen
    // aux anciennes valeurs → tout le rendu Pixi (terrain, arbres, bâtiments) est mis à l'échelle
    // et rogné (décalage visible surtout sur le relief). On force le recalcul via une taille
    // intermédiaire différente.
    if(app.renderer.resolution !== DPR) app.renderer.resize(W + 1, H + 1, DPR);
    app.renderer.resize(W, H, DPR);
    // Zoom navigateur (Ctrl +/-) : W/H (px CSS) et DPR changent ensemble, mais autoDensity ne
    // remet pas toujours le style CSS à jour → le canvas WebGL gardait l'ancienne taille CSS et
    // se retrouvait étiré/décalé par rapport à #cv (100vw×100vh) et à la souris.
    const el = app.canvas;
    if(el){ el.style.width = W + 'px'; el.style.height = H + 'px'; }
    // Le buffer-sol (groundCache) est cuit à l'ancien DPR : reconstruction au prochain draw().
    if(typeof markGroundDirty === 'function') markGroundDirty();
    render();
  }
  addEventListener('resize', resize);

  return { init, render, resize, onFrame, get app(){ return app; }, get layers(){ return layers; },
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
