// ---------- Art procédural des bâtiments ----------
// Dessin « maquette » des bâtiments (maisons à toit en pente, immeubles fenêtrés,
// usines, moulin, chevalement de mine…) à la place du simple prisme + emoji.
// Les fonctions dessinent dans le `ctx` global en espace iso TOURNÉ (u,v en
// tuiles, z en px au-dessus du sol, lift = relief) : le résultat est cuit en
// texture par js/pixi/sprites.js (bakeBuildingBody), donc aucun coût par image.
//
// Repère : un point (u,v,z) → écran ((u-v)·TW2, (u+v)·TH2 − lift − z).
// Faces visibles : u = u1 (face « droite », éclairée) et v = v1 (face « gauche »,
// ombrée) ; lumière venant du haut-droite.

const ART_LIGHT_RIGHT = -0.10;   // teinte de la face u = u1
const ART_LIGHT_LEFT  = -0.34;   // teinte de la face v = v1
const ART_LIGHT_TOP   =  0.16;

let _artLift = 0;
function artP(u, v, z){ return [(u - v) * TW2, (u + v) * TH2 - _artLift - (z || 0)]; }

// Sommets de cheminée par bâtiment (coordonnées iso + teinte), relevés pendant le
// dessin de l'art : le rendu y émet de la fumée quand l'usine produit.
const BUILDING_CHIMNEYS = new Map();
let _artChimneys = null;

function artPoly(points, fill, stroke, lw){
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for(let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  if(fill){ ctx.fillStyle = fill; ctx.fill(); }
  if(stroke){ ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
}

function artRng(seed){
  let s = (seed >>> 0) || 1;
  return () => { s = Math.imul(s ^ (s >>> 15), 2246822519) >>> 0; s ^= s >>> 13; return (s >>> 0) / 4294967296; };
}

// Variante d'art d'un bâtiment : la position ne choisit qu'une variante parmi
// ART_VARIANTS (couleurs, toits…). Des bâtiments de même type/taille/variante
// sont donc identiques et PARTAGENT leur texture cuite (js/pixi/sprites.js) au
// lieu d'en cuire une par bâtiment (mémoire GPU et temps de cuisson ÷ ~100).
const ART_VARIANTS = 8;
function artVariantOf(b){
  return (hash(b.x * 31 + b.w, b.y * 17 + b.h) >>> 0) % ART_VARIANTS;
}

// Ombre portée douce vers le bas-gauche (lumière haut-droite).
function artShadow(u0, v0, u1, v1, h){
  const k = Math.min(0.9, h / 70);
  const C = artP(u1, v1, 0), D = artP(u0, v1, 0);
  ctx.save();
  ctx.globalAlpha = 0.22;
  artPoly([artP(u0, v0, 0), artP(u1, v0, 0), [C[0] - k * 14, C[1] + k * 6], [D[0] - k * 14, D[1] + k * 6]], '#0b1a10');
  ctx.restore();
}

// Parallélépipède (murs + dessus). top=false : pas de dessus (un toit suit).
function artBox(u0, v0, u1, v1, z0, z1, col, opts = {}){
  const A = artP(u0, v0, z1), B = artP(u1, v0, z1), C = artP(u1, v1, z1), D = artP(u0, v1, z1);
  const Bb = artP(u1, v0, z0), Cb = artP(u1, v1, z0), Db = artP(u0, v1, z0);
  artPoly([Bb, Cb, C, B], shade(col, opts.right ?? ART_LIGHT_RIGHT));
  artPoly([Cb, Db, D, C], shade(col, opts.left ?? ART_LIGHT_LEFT));
  if(opts.top !== false) artPoly([A, B, C, D], opts.topCol || shade(col, ART_LIGHT_TOP));
  if(opts.edges !== false){
    ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(C[0], C[1]); ctx.lineTo(Cb[0], Cb[1]); ctx.stroke();
  }
  return { A, B, C, D };
}

// Toit à deux pans. axis='u' : faîtage parallèle à u (pignons sur les faces v).
function artGable(u0, v0, u1, v1, zEave, zRidge, roofCol, wallCol, axis = 'u', overhang = 0.06){
  const o = overhang;
  if(axis === 'u'){
    const vm = (v0 + v1) / 2;
    // pignon visible (face u = u1)
    artPoly([artP(u1, v0, zEave), artP(u1, v1, zEave), artP(u1, vm, zRidge)], shade(wallCol, ART_LIGHT_RIGHT));
    // pan arrière (vers -v) puis pan avant (vers +v)
    artPoly([artP(u0 - o, v0 - o, zEave - 1), artP(u1 + o, v0 - o, zEave - 1), artP(u1 + o, vm, zRidge), artP(u0 - o, vm, zRidge)],
      shade(roofCol, 0.10));
    artPoly([artP(u0 - o, vm, zRidge), artP(u1 + o, vm, zRidge), artP(u1 + o, v1 + o, zEave - 1), artP(u0 - o, v1 + o, zEave - 1)],
      shade(roofCol, -0.18));
    ctx.strokeStyle = shade(roofCol, 0.35); ctx.lineWidth = 1;
    const r0 = artP(u0 - o, vm, zRidge), r1 = artP(u1 + o, vm, zRidge);
    ctx.beginPath(); ctx.moveTo(r0[0], r0[1]); ctx.lineTo(r1[0], r1[1]); ctx.stroke();
  } else {
    const um = (u0 + u1) / 2;
    artPoly([artP(u0, v1, zEave), artP(u1, v1, zEave), artP(um, v1, zRidge)], shade(wallCol, ART_LIGHT_LEFT));
    artPoly([artP(u0 - o, v0 - o, zEave - 1), artP(um, v0 - o, zRidge), artP(um, v1 + o, zRidge), artP(u0 - o, v1 + o, zEave - 1)],
      shade(roofCol, 0.10));
    artPoly([artP(um, v0 - o, zRidge), artP(u1 + o, v0 - o, zEave - 1), artP(u1 + o, v1 + o, zEave - 1), artP(um, v1 + o, zRidge)],
      shade(roofCol, -0.08));
    ctx.strokeStyle = shade(roofCol, 0.35); ctx.lineWidth = 1;
    const r0 = artP(um, v0 - o, zRidge), r1 = artP(um, v1 + o, zRidge);
    ctx.beginPath(); ctx.moveTo(r0[0], r0[1]); ctx.lineTo(r1[0], r1[1]); ctx.stroke();
  }
}

// Toit à quatre pans (pyramide tronquée).
function artHip(u0, v0, u1, v1, zEave, zTop, roofCol, inset = 0.25){
  const o = 0.05;
  const a = artP(u0 - o, v0 - o, zEave), b = artP(u1 + o, v0 - o, zEave), c = artP(u1 + o, v1 + o, zEave), d = artP(u0 - o, v1 + o, zEave);
  const iu = Math.min(inset, (u1 - u0) / 2), iv = Math.min(inset, (v1 - v0) / 2);
  const ta = artP(u0 + iu, v0 + iv, zTop), tb = artP(u1 - iu, v0 + iv, zTop), tc = artP(u1 - iu, v1 - iv, zTop), td = artP(u0 + iu, v1 - iv, zTop);
  artPoly([a, b, tb, ta], shade(roofCol, 0.14));
  artPoly([d, a, ta, td], shade(roofCol, 0.02));
  artPoly([b, c, tc, tb], shade(roofCol, -0.10));
  artPoly([c, d, td, tc], shade(roofCol, -0.24));
  artPoly([ta, tb, tc, td], shade(roofCol, 0.08));
}

// Toit en sheds (dents de scie) : usines.
function artSawtooth(u0, v0, u1, v1, z, h, roofCol, teeth){
  const n = Math.max(2, teeth || Math.round((u1 - u0) * 2.5));
  for(let i = 0; i < n; i++){
    const ua = u0 + (u1 - u0) * i / n, ub = u0 + (u1 - u0) * (i + 1) / n;
    // verrière verticale (face u = ub) puis pan incliné
    artPoly([artP(ub, v0, z), artP(ub, v1, z), artP(ub, v1, z + h), artP(ub, v0, z + h)], 'rgba(170,215,240,.85)', 'rgba(40,60,80,.5)', 0.6);
    artPoly([artP(ua, v0, z), artP(ub, v0, z + h), artP(ub, v1, z + h), artP(ua, v1, z)], shade(roofCol, -0.05 - (i % 2) * 0.04));
  }
}

// Fenêtre sur une face. face='r' (u = const, s le long de v) ou 'l' (v = const, s le long de u).
function artWindow(face, k, s0, s1, z0, z1, col){
  let pts;
  if(face === 'r') pts = [artP(k, s0, z0), artP(k, s1, z0), artP(k, s1, z1), artP(k, s0, z1)];
  else pts = [artP(s0, k, z0), artP(s1, k, z0), artP(s1, k, z1), artP(s0, k, z1)];
  artPoly(pts, col);
}

// Grille de fenêtres sur les deux faces visibles d'un volume.
function artWindowGrid(u0, v0, u1, v1, z0, z1, floorH, rng, opts = {}){
  const floors = Math.max(1, Math.floor((z1 - z0) / floorH));
  const lit = opts.lit ?? 0.35;
  const dark = opts.dark || 'rgba(28,40,58,.78)';
  const glow = opts.glow || 'rgba(255,226,150,.92)';
  const perTile = opts.perTile || 2;
  const doFace = (face, k, a0, a1) => {
    const cols = Math.max(1, Math.round((a1 - a0) * perTile));
    for(let f = 0; f < floors; f++){
      const fz0 = z0 + f * floorH + floorH * 0.28, fz1 = fz0 + floorH * 0.46;
      if(fz1 > z1 - 1) break;
      for(let c = 0; c < cols; c++){
        const s0 = a0 + (a1 - a0) * (c + 0.22) / cols, s1 = a0 + (a1 - a0) * (c + 0.78) / cols;
        artWindow(face, k, s0, s1, fz0, fz1, rng() < lit ? glow : dark);
      }
    }
  };
  doFace('r', u1, v0, v1);
  doFace('l', v1, u0, u1);
}

// Cylindre vertical (citerne, silo, cheminée, haut-fourneau).
function artCylinder(cu, cv, r, z0, z1, col, opts = {}){
  const c0 = artP(cu, cv, z0), c1 = artP(cu, cv, z1);
  const rx = r * Math.SQRT2 * TW2, ry = r * Math.SQRT2 * TH2;
  const g = ctx.createLinearGradient(c0[0] - rx, 0, c0[0] + rx, 0);
  g.addColorStop(0, shade(col, -0.38)); g.addColorStop(0.55, shade(col, -0.05)); g.addColorStop(0.8, shade(col, 0.12)); g.addColorStop(1, shade(col, -0.12));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(c0[0], c0[1], rx, ry, 0, 0, Math.PI);
  ctx.lineTo(c1[0] - rx, c1[1]);
  ctx.ellipse(c1[0], c1[1], rx, ry, 0, Math.PI, 0, true);
  ctx.closePath(); ctx.fill();
  if(opts.bands){
    ctx.strokeStyle = shade(col, -0.30); ctx.lineWidth = 0.8;
    for(let i = 1; i <= opts.bands; i++){
      const z = z0 + (z1 - z0) * i / (opts.bands + 1), c = artP(cu, cv, z);
      ctx.beginPath(); ctx.ellipse(c[0], c[1], rx, ry, 0, 0, Math.PI); ctx.stroke();
    }
  }
  if(opts.top !== false){
    ctx.fillStyle = opts.topCol || shade(col, 0.22);
    ctx.beginPath(); ctx.ellipse(c1[0], c1[1], rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    if(opts.hollow){
      ctx.fillStyle = 'rgba(20,20,24,.85)';
      ctx.beginPath(); ctx.ellipse(c1[0], c1[1], rx * 0.7, ry * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// Petit arbuste rond (jardins).
function artBush(u, v, r, col){
  const c = artP(u, v, 0);
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath(); ctx.ellipse(c[0] - 1, c[1] + 1, r * 1.1, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = shade(col, -0.15);
  ctx.beginPath(); ctx.arc(c[0], c[1] - r * 0.8, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = shade(col, 0.15);
  ctx.beginPath(); ctx.arc(c[0] + r * 0.3, c[1] - r * 1.1, r * 0.55, 0, Math.PI * 2); ctx.fill();
}

// Dalle de sol (cour, parking, jardin) légèrement surélevée.
function artGround(u0, v0, u1, v1, col, z = 0.6){
  artPoly([artP(u0, v0, z), artP(u1, v0, z), artP(u1, v1, z), artP(u0, v1, z)], col);
}

// Enseigne ronde avec l'icône du bâtiment (repère lisible sans masquer l'art).
function artSign(x, y, icon, col){
  ctx.save();
  ctx.fillStyle = 'rgba(12,18,28,.82)';
  ctx.beginPath(); ctx.arc(x, y, 8.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = col || '#ffe082'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.font = '10px "Segoe UI Emoji",sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(icon, x, y + 0.5);
  ctx.restore();
}

const ART_WALLS  = ['#efe6d2', '#e8d8b8', '#f2efe6', '#e6cfae', '#dfe3e6', '#f0dcc8', '#e9e1c9'];
const ART_ROOFS  = ['#b0503a', '#9c4632', '#7a4a3a', '#5b5f66', '#8a3f2e', '#a65c3c', '#4f5a68'];
const ART_ROOFS_PACK = {
  tiles: ['#b0503a', '#a24a35', '#bd6142', '#93412f'],
  glass: ['#4f6a86', '#5b778f', '#3f5873', '#6a8199'],
  vents: ['#4b4f55', '#5a5f66', '#3f4349', '#60564c'],
};

function artRoofPalette(){
  const style = graphicBasePack().roof;
  return ART_ROOFS_PACK[style] || ART_ROOFS;
}

// --- Logements -----------------------------------------------------------
function artHouse(b, u0, v0, u1, v1, rng, d){
  const wall = ART_WALLS[Math.floor(rng() * ART_WALLS.length)];
  const roofs = artRoofPalette();
  const roof = roofs[Math.floor(rng() * roofs.length)];
  const wu = u1 - u0, wv = v1 - v0;
  // jardin + clôture basse
  artGround(u0 + 0.04, v0 + 0.04, u1 - 0.04, v1 - 0.04, shade('#6fae4a', -0.06 + rng() * 0.08));
  const n = Math.max(1, Math.round(Math.max(wu, wv)));       // nb de maisons accolées
  const alongU = wu >= wv;
  const H = 13, R = 10;
  for(let i = 0; i < n; i++){
    const a0 = (alongU ? u0 : v0) + (alongU ? wu : wv) * i / n, a1 = (alongU ? u0 : v0) + (alongU ? wu : wv) * (i + 1) / n;
    const hu0 = alongU ? a0 + 0.14 : u0 + 0.18, hu1 = alongU ? a1 - 0.14 : u1 - 0.12;
    const hv0 = alongU ? v0 + 0.18 : a0 + 0.14, hv1 = alongU ? v1 - 0.12 : a1 - 0.14;
    const wcol = n > 1 ? ART_WALLS[(i * 3 + Math.floor(rng() * 7)) % ART_WALLS.length] : wall;
    const rcol = n > 1 ? roofs[(i + Math.floor(rng() * 4)) % roofs.length] : roof;
    artShadow(hu0, hv0, hu1, hv1, H + R);
    artBox(hu0, hv0, hu1, hv1, 0, H, wcol, { top:false });
    // porte + fenêtres sur la face droite (u = hu1), fenêtres face gauche
    artWindow('r', hu1, hv0 + (hv1 - hv0) * 0.18, hv0 + (hv1 - hv0) * 0.38, 0, 8, shade(rcol, -0.35));
    artWindow('r', hu1, hv0 + (hv1 - hv0) * 0.58, hv0 + (hv1 - hv0) * 0.82, 4.5, 9.5, rng() < 0.4 ? 'rgba(255,226,150,.92)' : 'rgba(40,56,78,.85)');
    artWindow('l', hv1, hu0 + (hu1 - hu0) * 0.2, hu0 + (hu1 - hu0) * 0.45, 4.5, 9.5, 'rgba(40,56,78,.85)');
    artWindow('l', hv1, hu0 + (hu1 - hu0) * 0.58, hu0 + (hu1 - hu0) * 0.82, 4.5, 9.5, rng() < 0.4 ? 'rgba(255,226,150,.92)' : 'rgba(40,56,78,.85)');
    artGable(hu0, hv0, hu1, hv1, H, H + R, rcol, wcol, (hu1 - hu0) >= (hv1 - hv0) ? 'u' : 'v');
    if(rng() < 0.7){
      const cu = hu0 + (hu1 - hu0) * 0.3, cv = hv0 + (hv1 - hv0) * 0.3;
      artBox(cu - 0.05, cv - 0.05, cu + 0.05, cv + 0.05, H + 2, H + R + 3, '#7a5c4a');
    }
  }
  if(n === 1 && rng() < 0.8) artBush(u0 + 0.16, v1 - 0.14, 3.2, '#3f8f3a');
  return artP((u0 + u1) / 2, (v0 + v1) / 2, H + R);
}

function artApartment(b, u0, v0, u1, v1, rng, d, floors, opts = {}){
  const palette = opts.palette || ['#d9cbb0', '#c9b79c', '#b8c2c9', '#d6c3a8', '#c5b3a1', '#a9b6bf'];
  const wall = palette[Math.floor(rng() * palette.length)];
  const fh = 9.5;
  const H = floors * fh + 3;
  artGround(u0 + 0.03, v0 + 0.03, u1 - 0.03, v1 - 0.03, '#8c9196');
  const i = 0.12;
  artShadow(u0 + i, v0 + i, u1 - i, v1 - i, H);
  artBox(u0 + i, v0 + i, u1 - i, v1 - i, 0, H, wall);
  // rez-de-chaussée plus sombre (commerces) + bandeaux
  artBox(u0 + i - 0.01, v0 + i - 0.01, u1 - i + 0.01, v1 - i + 0.01, 0, fh, shade(wall, -0.18), { top:false, edges:false });
  artWindowGrid(u0 + i, v0 + i, u1 - i, v1 - i, fh, H - 2, fh, rng, { lit:0.3, perTile: opts.perTile || 2.6 });
  // vitrines
  artWindowGrid(u0 + i, v0 + i, u1 - i, v1 - i, 0, fh, fh, rng, { lit:0.9, glow:'rgba(255,240,200,.85)', perTile:1.6 });
  // acrotère + édicule technique
  const top = H;
  artBox(u0 + i, v0 + i, u1 - i, v1 - i, top, top + 2, shade(wall, -0.1), { topCol: shade(wall, -0.25) });
  if(opts.roofHouse !== false){
    const cu = (u0 + u1) / 2 - 0.1, cv = (v0 + v1) / 2 - 0.1;
    artBox(cu - 0.18, cv - 0.18, cu + 0.12, cv + 0.12, top + 2, top + 8, '#9ea4aa');
  }
  if(opts.greenRoof){
    artGround(u0 + i + 0.06, v0 + i + 0.06, u1 - i - 0.06, v1 - i - 0.06, '#5f9a48', top + 2.1);
  }
  return artP((u0 + u1) / 2, (v0 + v1) / 2, top + 4);
}

function artTower(b, u0, v0, u1, v1, rng, d, floors){
  // tour en gradins (retraits) avec mur-rideau vitré
  const glass = ['#7f9cb3', '#6d8aa3', '#8aa6b5', '#7393a8'][Math.floor(rng() * 4)];
  const frame = '#d8dde2';
  const fh = 8.5;
  artGround(u0 + 0.02, v0 + 0.02, u1 - 0.02, v1 - 0.02, '#7f868c');
  const tiers = floors > 10 ? 3 : 2;
  let z = 0, inset = 0.1;
  const total = floors * fh;
  artShadow(u0 + inset, v0 + inset, u1 - inset, v1 - inset, total);
  for(let t = 0; t < tiers; t++){
    const h = t === tiers - 1 ? total - z : Math.round(total * (t === 0 ? 0.5 : 0.3));
    const a0 = u0 + inset, a1 = u1 - inset, b0 = v0 + inset, b1 = v1 - inset;
    artBox(a0, b0, a1, b1, z, z + h, glass, { right:-0.02, left:-0.28, topCol: shade(frame, -0.15) });
    // meneaux horizontaux
    ctx.strokeStyle = 'rgba(230,236,242,.55)'; ctx.lineWidth = 0.8;
    for(let zz = z + fh; zz < z + h - 1; zz += fh){
      const p0 = artP(a1, b0, zz), p1 = artP(a1, b1, zz), p2 = artP(a0, b1, zz);
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
    }
    // fenêtres éclairées éparses
    artWindowGrid(a0, b0, a1, b1, z, z + h, fh, rng, { lit:0.18, dark:'rgba(0,0,0,0)', perTile:3 });
    z += h;
    inset += Math.min((u1 - u0), (v1 - v0)) * 0.12;
  }
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  if(floors > 10){
    const a = artP(cu, cv, z), t2 = artP(cu, cv, z + 22);
    ctx.strokeStyle = '#c9ced4'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(t2[0], t2[1]); ctx.stroke();
    ctx.fillStyle = '#ff4b4b'; ctx.beginPath(); ctx.arc(t2[0], t2[1], 1.6, 0, Math.PI * 2); ctx.fill();
  }
  return artP(cu, cv, z + 2);
}

// --- Industrie -----------------------------------------------------------
function artHall(u0, v0, u1, v1, H, wall, roof, rng, opts = {}){
  artShadow(u0, v0, u1, v1, H + 8);
  artBox(u0, v0, u1, v1, 0, H, wall, { top: !!opts.flat });
  // grandes portes + fenêtres hautes
  const vm = (v0 + v1) / 2;
  artWindow('r', u1, vm - (v1 - v0) * 0.18, vm + (v1 - v0) * 0.18, 0, Math.min(H - 3, 11), shade(wall, -0.45));
  for(let s = 0.12; s < 0.9; s += 0.22) artWindow('l', v1, u0 + (u1 - u0) * s, u0 + (u1 - u0) * (s + 0.12), H - 7, H - 3, 'rgba(160,200,225,.8)');
  if(opts.sawtooth) artSawtooth(u0, v0, u1, v1, H, 7, roof);
  else if(!opts.flat) artGable(u0, v0, u1, v1, H, H + (opts.roofH || 8), roof, wall, (u1 - u0) >= (v1 - v0) ? 'u' : 'v', 0.04);
}

function artChimney(u, v, z0, h, col, r = 0.09){
  artCylinder(u, v, r, z0, z0 + h, col || '#8a5a48', { bands:2, hollow:true });
  if(_artChimneys){
    const t = artP(u, v, z0 + h);
    _artChimneys.push([t[0], t[1], r >= 0.08]);
  }
}

function artPile(u, v, r, col, h = 6){
  const c = artP(u, v, 0);
  const rx = r * Math.SQRT2 * TW2, ry = r * Math.SQRT2 * TH2;
  ctx.fillStyle = shade(col, -0.25);
  ctx.beginPath(); ctx.ellipse(c[0], c[1], rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(c[0] - rx, c[1]); ctx.quadraticCurveTo(c[0] - rx * 0.3, c[1] - h * 1.6, c[0] + rx * 0.2, c[1] - h);
  ctx.quadraticCurveTo(c[0] + rx * 0.7, c[1] - h * 0.5, c[0] + rx, c[1]); ctx.closePath(); ctx.fill();
  ctx.fillStyle = shade(col, 0.2);
  ctx.beginPath(); ctx.ellipse(c[0] - rx * 0.15, c[1] - h * 0.9, rx * 0.35, ry * 0.3, 0, 0, Math.PI * 2); ctx.fill();
}

function artLogs(u0, v0, u1, v1){
  for(let i = 0; i < 3; i++){
    const z = i * 2.6;
    for(let k = 0; k < 3 - i; k++){
      const vv = v0 + (v1 - v0) * (k + 0.5 + i * 0.5) / 3.2;
      const a = artP(u0, vv, z + 1.4), b2 = artP(u1, vv, z + 1.4);
      ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b2[0], b2[1]); ctx.stroke();
      ctx.fillStyle = '#c9a26b';
      ctx.beginPath(); ctx.arc(b2[0], b2[1], 1.5, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.lineCap = 'butt';
}

function artIndustry(b, u0, v0, u1, v1, rng, d, bCol){
  const type = b.type;
  const wu = u1 - u0, wv = v1 - v0;
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  const big = Math.max(b.w, b.h);
  let top = 30;
  switch(type){
    case 'mine': {
      const ore = b.ore === 'iron' ? '#b0663a' : '#2f3036';
      artGround(u0 + 0.04, v0 + 0.04, u1 - 0.04, v1 - 0.04, '#8a7a66');
      artPile(u0 + wu * 0.3, v1 - wv * 0.28, 0.22 * Math.min(2, big), ore, 7);
      artHall(u0 + wu * 0.45, v0 + 0.12, u1 - 0.1, v0 + wv * 0.55, 12, '#8d8173', '#5a524a', rng);
      // chevalement (tour en treillis + molette)
      const hu = u0 + wu * 0.3, hv = v0 + wv * 0.3, H = 30 + big * 4;
      const legs = [[-0.12, -0.12], [0.12, -0.12], [0.12, 0.12], [-0.12, 0.12]];
      const t = artP(hu, hv, H);
      ctx.strokeStyle = '#3b3f45'; ctx.lineWidth = 1.6;
      for(const [du, dv] of legs){ const p = artP(hu + du, hv + dv, 0); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(t[0], t[1]); ctx.stroke(); }
      ctx.lineWidth = 0.8;
      for(let z = 6; z < H - 4; z += 6){
        const k = 1 - z / H;
        const a = artP(hu - 0.12 * k, hv + 0.12 * k, z), c2 = artP(hu + 0.12 * k, hv + 0.12 * k, z), e = artP(hu + 0.12 * k, hv - 0.12 * k, z);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c2[0], c2[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
      }
      ctx.strokeStyle = '#c94a3a'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.ellipse(t[0], t[1] + 3, 5.5, 5.5, 0, 0, Math.PI * 2); ctx.stroke();
      top = H; break;
    }
    case 'lumber': {
      artGround(u0 + 0.04, v0 + 0.04, u1 - 0.04, v1 - 0.04, '#7d6a4b');
      artLogs(u0 + 0.12, v1 - wv * 0.45, u0 + wu * 0.55, v1 - 0.1);
      artHall(u0 + wu * 0.45, v0 + 0.12, u1 - 0.1, v0 + wv * 0.6, 11, '#8a6a46', '#5c4630', rng, { roofH:7 });
      artChimney(u1 - 0.25, v0 + 0.25, 11, 10, '#6c6c70', 0.06);
      top = 26; break;
    }
    case 'farm': case 'cotton_farm': {
      const cotton = type === 'cotton_farm';
      artGround(u0 + 0.02, v0 + 0.02, u1 - 0.02, v1 - 0.02, cotton ? '#9aa86a' : '#b9a24e');
      // sillons
      ctx.strokeStyle = cotton ? 'rgba(245,242,224,.75)' : 'rgba(120,96,40,.45)'; ctx.lineWidth = 1;
      for(let k = 0.15; k < 1; k += 0.14){ const a = artP(u0 + 0.06, v0 + wv * k, 0.8), e = artP(u1 - 0.06, v0 + wv * k, 0.8); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(e[0], e[1]); ctx.stroke(); }
      const barn = cotton ? '#e7e2d2' : '#a8322a';
      artHall(u0 + 0.14, v0 + 0.14, u0 + Math.min(0.75, wu * 0.6), v0 + Math.min(0.62, wv * 0.55), 10, barn, cotton ? '#6a6f78' : '#5c3a2c', rng, { roofH:9 });
      artCylinder(u1 - 0.24, v0 + 0.26, 0.13, 0, 24, cotton ? '#d6d0bd' : '#b9bec4', { bands:3, topCol:'#8f959b' });
      top = 26; break;
    }
    case 'weaver': case 'fishery': case 'factory': case 'smelter': case 'bakery': case 'terrassement': {
      const conf = {
        weaver:  { wall:'#9d7aa8', roof:'#5d4c66', saw:true,  chim:1, chimCol:'#7d6a88' },
        fishery: { wall:'#7fa5ad', roof:'#3e6670', saw:false, chim:0 },
        factory: { wall:'#a2694f', roof:'#4f5866', saw:true,  chim:2, chimCol:'#8a4f3c' },
        smelter: { wall:'#7a5a50', roof:'#3d3534', saw:false, chim:1, chimCol:'#5b4038' },
        bakery:  { wall:'#e2c49a', roof:'#a2563a', saw:false, chim:1, chimCol:'#9b5a42' },
        terrassement: { wall:'#a58f63', roof:'#6a5a3c', saw:false, chim:0 },
      }[type];
      artGround(u0 + 0.03, v0 + 0.03, u1 - 0.03, v1 - 0.03, '#8b8f93');
      const H = 13 + big * 3;
      const hu1 = type === 'smelter' ? u1 - wu * 0.38 : u1 - 0.1;
      artHall(u0 + 0.1, v0 + 0.1, hu1, v1 - 0.12, H, conf.wall, conf.roof, rng, { sawtooth:conf.saw, roofH:8 });
      if(type === 'smelter'){
        // haut-fourneau
        artCylinder(u1 - wu * 0.2, v0 + wv * 0.35, 0.16 * Math.min(2, big), 0, H + 14, '#6d4a40', { bands:3, hollow:true });
        const g = artP(u1 - wu * 0.2, v0 + wv * 0.35, H + 14);
        ctx.save(); ctx.globalAlpha = 0.55; ctx.fillStyle = '#ff8a3c';
        ctx.beginPath(); ctx.ellipse(g[0], g[1], 5, 2.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        artChimney(u0 + wu * 0.25, v0 + 0.22, 0, H + 26, '#5b4038', 0.08);
      }
      for(let k = 0; k < conf.chim; k++) artChimney(u0 + 0.22 + k * 0.32, v0 + 0.22, H, 14 + big * 4, conf.chimCol, 0.07);
      if(type === 'bakery'){
        // auvent rayé sur la façade
        const a = artP(hu1, v0 + 0.25, 8), e = artP(hu1, v1 - 0.3, 8), f = artP(hu1 + 0.12, v1 - 0.3, 5), g = artP(hu1 + 0.12, v0 + 0.25, 5);
        artPoly([a, e, f, g], '#d94a3a');
      }
      if(type === 'terrassement') artPile(u1 - 0.25, v1 - 0.22, 0.2, '#8b6347', 6);
      top = H + 14; break;
    }
    case 'pump': {
      artGround(u0 + 0.06, v0 + 0.06, u1 - 0.06, v1 - 0.06, '#7f8a8f');
      artHall(u0 + 0.16, v0 + 0.2, u0 + 0.62, v1 - 0.18, 10, '#6f97ad', '#3d5a6a', rng, { roofH:6 });
      artCylinder(u1 - 0.24, v0 + 0.28, 0.14, 8, 22, '#9fb6c4', { topCol:'#6f8a99' });
      // pieds de la cuve
      ctx.strokeStyle = '#4b5a63'; ctx.lineWidth = 1.2;
      for(const [du, dv] of [[-0.1, -0.1], [0.1, 0.1], [0.1, -0.1], [-0.1, 0.1]]){
        const a = artP(u1 - 0.24 + du, v0 + 0.28 + dv, 0), e = artP(u1 - 0.24 + du, v0 + 0.28 + dv, 8);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
      }
      top = 22; break;
    }
    case 'fisher': {
      // cabane en bois sur pilotis + barque + filets
      artGround(u0 + 0.08, v0 + 0.08, u1 - 0.08, v1 - 0.08, '#9a7a52');
      artBox(u0 + 0.2, v0 + 0.2, u1 - 0.22, v1 - 0.28, 0, 10, '#8b5e3c', { top:false });
      artGable(u0 + 0.2, v0 + 0.2, u1 - 0.22, v1 - 0.28, 10, 17, '#5a6b74', '#8b5e3c', 'u');
      const p = artP(u1 - 0.18, v1 - 0.14, 0.5);
      ctx.fillStyle = '#c9773e';
      ctx.beginPath(); ctx.ellipse(p[0], p[1], 7, 2.6, -0.45, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(230,230,210,.7)'; ctx.lineWidth = 0.6;
      const n0 = artP(u0 + 0.12, v1 - 0.15, 0), n1 = artP(u0 + 0.12, v1 - 0.15, 9);
      for(let k = 0; k < 5; k++){ ctx.beginPath(); ctx.moveTo(n0[0] + k * 1.6, n0[1]); ctx.lineTo(n1[0] + k * 1.6, n1[1]); ctx.stroke(); }
      top = 17; break;
    }
    case 'mill': {
      // moulin à vent : tour conique + ailes
      artGround(u0 + 0.06, v0 + 0.06, u1 - 0.06, v1 - 0.06, '#b9a77a');
      artCylinder(cu, cv, 0.24, 0, 26, '#e8dfca', { bands:0, top:false });
      const t = artP(cu, cv, 26);
      artPoly([[t[0] - 13, t[1] + 2], [t[0] + 13, t[1] + 2], [t[0], t[1] - 12]], '#7a4a32');
      const hub = [t[0] + 4, t[1] - 2];
      ctx.strokeStyle = '#5b4632'; ctx.lineWidth = 1.2;
      for(let k = 0; k < 4; k++){
        const a = Math.PI / 4 + k * Math.PI / 2;
        const ex = hub[0] + Math.cos(a) * 18, ey = hub[1] + Math.sin(a) * 18;
        ctx.beginPath(); ctx.moveTo(hub[0], hub[1]); ctx.lineTo(ex, ey); ctx.stroke();
        const px = -Math.sin(a) * 3.5, py = Math.cos(a) * 3.5;
        artPoly([[hub[0] + Math.cos(a) * 6, hub[1] + Math.sin(a) * 6], [ex, ey], [ex + px, ey + py], [hub[0] + Math.cos(a) * 6 + px, hub[1] + Math.sin(a) * 6 + py]], 'rgba(240,232,210,.9)', 'rgba(90,70,50,.6)', 0.6);
      }
      ctx.fillStyle = '#3d2c1e'; ctx.beginPath(); ctx.arc(hub[0], hub[1], 1.8, 0, Math.PI * 2); ctx.fill();
      top = 40; break;
    }
    case 'plant': {
      // usine abandonnée : hangar gris délavé, vitres cassées
      artGround(u0 + 0.04, v0 + 0.04, u1 - 0.04, v1 - 0.04, '#7c7f78');
      artHall(u0 + 0.12, v0 + 0.12, u1 - 0.12, v1 - 0.16, 14, '#8b8f94', '#5a5f66', rng, { roofH:6 });
      ctx.strokeStyle = 'rgba(30,30,30,.6)'; ctx.lineWidth = 0.8;
      const a = artP(u1 - 0.12, v0 + 0.3, 12), e = artP(u1 - 0.12, v0 + 0.4, 5);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
      artBush(u0 + 0.2, v1 - 0.12, 2.6, '#5a7a3a');
      top = 24; break;
    }
    default: return null;
  }
  return artP(cu, cv, top);
}

// --- Stockage et transport ------------------------------------------------
function artStorage(b, u0, v0, u1, v1, rng, d, bCol){
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  const wu = u1 - u0, wv = v1 - v0;
  switch(b.type){
    case 'depot': {
      artGround(u0 + 0.03, v0 + 0.03, u1 - 0.03, v1 - 0.03, '#8e9296');
      artHall(u0 + 0.1, v0 + 0.1, u1 - 0.1, v1 - 0.22, 13, shade(bCol, 0.15), shade(bCol, -0.35), rng, { roofH:5 });
      // caisses
      for(let k = 0; k < Math.min(4, Math.round(wu * 2)); k++){
        const u = u0 + 0.18 + k * 0.22, v = v1 - 0.12;
        artBox(u, v - 0.08, u + 0.14, v + 0.04, 0, 4, '#b08a52');
      }
      return artP(cu, cv, 20);
    }
    case 'market': {
      artGround(u0 + 0.03, v0 + 0.03, u1 - 0.03, v1 - 0.03, '#b7ab93');
      const cols = ['#d94a3a', '#3a8fd9', '#e3b23c', '#4aa35a'];
      const n = Math.max(2, Math.round(wu * 2));
      for(let k = 0; k < n; k++){
        const a0 = u0 + 0.1 + (wu - 0.2) * k / n, a1 = a0 + (wu - 0.2) / n - 0.05;
        artBox(a0, v0 + 0.25, a1, v1 - 0.25, 0, 5, '#9a7a52');
        artGable(a0, v0 + 0.2, a1, v1 - 0.2, 8, 11, cols[k % cols.length], '#e8e0d0', 'v', 0.02);
      }
      return artP(cu, cv, 16);
    }
    case 'tank': {
      artGround(u0 + 0.05, v0 + 0.05, u1 - 0.05, v1 - 0.05, '#8e9aa0');
      const r = Math.min(wu, wv) * 0.32;
      artCylinder(cu, cv, r, 0, 18 + Math.max(b.w, b.h) * 4, shade(bCol, 0.1), { bands:2, topCol: shade(bCol, 0.3) });
      return artP(cu, cv, 24);
    }
    case 'boat_depot': {
      // Port : quai en planches, entrepôt de port, grue à flèche
      artGround(u0 + 0.02, v0 + 0.02, u1 - 0.02, v1 - 0.02, '#8a7a62');
      ctx.strokeStyle = 'rgba(60,45,30,.35)'; ctx.lineWidth = 0.7;
      for(let k = 0.1; k < 1; k += 0.12){ const a = artP(u0 + 0.04, v0 + wv * k, 0.7), e = artP(u1 - 0.04, v0 + wv * k, 0.7); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(e[0], e[1]); ctx.stroke(); }
      artHall(u0 + 0.1, v0 + 0.1, u0 + wu * 0.55, v1 - 0.15, 11, '#7d93a6', '#3e5566', rng, { roofH:5 });
      const cu2 = u1 - 0.24, cv2 = v0 + 0.3;
      artBox(cu2 - 0.08, cv2 - 0.08, cu2 + 0.08, cv2 + 0.08, 0, 20, '#d9a028');
      artBox(cu2 - 0.1, cv2 - 0.1, cu2 + 0.1, cv2 + 0.1, 20, 25, '#c98a1a');
      const j0 = artP(cu2, cv2, 24), j1 = artP(cu2 + 0.55, cv2 + 0.3, 28);
      ctx.strokeStyle = '#c98a1a'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(j0[0], j0[1]); ctx.lineTo(j1[0], j1[1]); ctx.stroke();
      ctx.strokeStyle = '#3b3f45'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(j1[0], j1[1]); ctx.lineTo(j1[0], j1[1] + 14); ctx.stroke();
      return artP(cu, cv, 26);
    }
    case 'plane_depot': {
      // Aéroport : tarmac, piste balisée, hangar et tour de contrôle
      artGround(u0 + 0.01, v0 + 0.01, u1 - 0.01, v1 - 0.01, '#6f757b');
      const r0 = artP(u0 + 0.08, v1 - 0.22, 0.8), r1 = artP(u1 - 0.08, v1 - 0.22, 0.8);
      ctx.strokeStyle = '#3d4247'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(r0[0], r0[1]); ctx.lineTo(r1[0], r1[1]); ctx.stroke();
      ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(r0[0], r0[1]); ctx.lineTo(r1[0], r1[1]); ctx.stroke(); ctx.restore();
      artHall(u0 + 0.12, v0 + 0.1, u1 - 0.3, v0 + wv * 0.55, 12, '#a9b3bc', '#56616b', rng, { roofH:5 });
      artCylinder(u1 - 0.18, v0 + 0.22, 0.06, 0, 28, '#d8dde2', { top:false });
      artBox(u1 - 0.27, v0 + 0.13, u1 - 0.09, v0 + 0.31, 28, 34, '#7fa8c8', { topCol:'#55606b' });
      return artP(cu, cv, 34);
    }
    case 'garage': case 'train_depot': {
      const rail = b.type === 'train_depot';
      artGround(u0 + 0.03, v0 + 0.03, u1 - 0.03, v1 - 0.03, rail ? '#7a6a5a' : '#80868c');
      const wall = rail ? shade(bCol, 0.05) : '#9aa3ad';
      const roof = rail ? '#4a3f3a' : '#3d4f6b';
      artHall(u0 + 0.1, v0 + 0.1, u1 - 0.1, v1 - 0.12, 15, wall, roof, rng, { roofH: rail ? 9 : 6 });
      // portes de remise (arches)
      const doors = rail ? 2 : 3;
      for(let k = 0; k < doors; k++){
        const s0 = v0 + 0.18 + (wv - 0.36) * k / doors, s1 = s0 + (wv - 0.36) / doors - 0.06;
        artWindow('r', u1 - 0.1, s0, s1, 0, 10, 'rgba(25,30,38,.85)');
      }
      return artP(cu, cv, 24);
    }
    case 'bus_stop': {
      artGround(u0 + 0.1, v0 + 0.1, u1 - 0.1, v1 - 0.1, '#a4a8ad');
      // abri vitré
      artBox(u0 + 0.3, v0 + 0.25, u0 + 0.42, v1 - 0.25, 0, 9, '#4a6a9a', { top:false });
      artPoly([artP(u0 + 0.26, v0 + 0.22, 10), artP(u0 + 0.62, v0 + 0.22, 10), artP(u0 + 0.62, v1 - 0.22, 10), artP(u0 + 0.26, v1 - 0.22, 10)], '#2e5a9a');
      const p0 = artP(u1 - 0.28, v1 - 0.3, 0), p1 = artP(u1 - 0.28, v1 - 0.3, 16);
      ctx.strokeStyle = '#5a5f66'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
      ctx.fillStyle = '#e8b12f'; ctx.beginPath(); ctx.arc(p1[0], p1[1], 3, 0, Math.PI * 2); ctx.fill();
      return artP(cu, cv, 16);
    }
    default: return null;
  }
}

// Bâtiment voyageurs d'une gare (groupe de pièces 'train_station') : murs clairs,
// toit en croupe, bandeau aux couleurs du propriétaire, horloge en façade.
function drawStationBuildingArt(rx0, ry0, rw, rh, lift, ownerCol, b){
  _artLift = lift || 0;
  ctx.save();
  try {
    const u0 = rx0 + 0.06, v0 = ry0 + 0.06, u1 = rx0 + rw - 0.06, v1 = ry0 + rh - 0.06;
    const rng = artRng(hash(b.x * 13, b.y * 7));
    const wall = ['#e9dcc2', '#efe3cf', '#e3d3b8'][Math.floor(rng() * 3)];
    const H = 14;
    artGround(rx0 + 0.02, ry0 + 0.02, rx0 + rw - 0.02, ry0 + rh - 0.02, '#b8b3a8');
    artShadow(u0, v0, u1, v1, H + 8);
    artBox(u0, v0, u1, v1, 0, H, wall, { top:false });
    artBox(u0 - 0.01, v0 - 0.01, u1 + 0.01, v1 + 0.01, H - 3, H - 1.5, ownerCol, { top:false, edges:false });
    // portes et hautes fenêtres cintrées (rectangles) sur les deux faces
    const nu = Math.max(1, Math.round((u1 - u0) * 2)), nv = Math.max(1, Math.round((v1 - v0) * 2));
    for(let i = 0; i < nv; i++){
      const s0 = v0 + (v1 - v0) * (i + 0.25) / nv, s1 = v0 + (v1 - v0) * (i + 0.75) / nv;
      artWindow('r', u1, s0, s1, 0, i % 2 ? 8 : 10, i % 2 ? 'rgba(255,226,150,.9)' : '#5a3a2a');
    }
    for(let i = 0; i < nu; i++){
      const s0 = u0 + (u1 - u0) * (i + 0.25) / nu, s1 = u0 + (u1 - u0) * (i + 0.75) / nu;
      artWindow('l', v1, s0, s1, 3, 10, 'rgba(40,56,78,.85)');
    }
    artHip(u0, v0, u1, v1, H, H + 9, '#5b5f6a', 0.3);
    // horloge sur la face droite
    const c = artP(u1, (v0 + v1) / 2, H + 3.5);
    ctx.fillStyle = '#f5f2e6'; ctx.beginPath(); ctx.arc(c[0] + 1, c[1], 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 0.7; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c[0] + 1, c[1]); ctx.lineTo(c[0] + 1, c[1] - 2); ctx.moveTo(c[0] + 1, c[1]); ctx.lineTo(c[0] + 2.4, c[1]); ctx.stroke();
    const top = artP((u0 + u1) / 2, (v0 + v1) / 2, H + 9);
    artSign(top[0], top[1] - 4, '🚉', ownerCol);
  } finally {
    ctx.restore();
    _artLift = 0;
  }
}

// Point d'entrée : dessine le bâtiment et retourne le centre « haut » (ancre des
// overlays), ou null si ce type n'a pas d'art dédié (prisme de repli).
function drawBuildingArt(b, rx0, ry0, rw, rh, lift, hgt, bCol){
  const d = BUILD[b.type];
  if(!d) return null;
  _artLift = lift || 0;
  const rng = artRng(Math.imul(artVariantOf(b) + 1, 2654435761) ^ (b.type.length * 40503) ^ (b.w * 7 + b.h * 131));
  const u0 = rx0, v0 = ry0, u1 = rx0 + rw, v1 = ry0 + rh;
  ctx.save();
  let tc = null;
  try {
    if(d.resid){
      switch(b.type){
        case 'house': case 'duplex': case 'row': tc = artHouse(b, u0, v0, u1, v1, rng, d); break;
        case 'residence': tc = artApartment(b, u0, v0, u1, v1, rng, d, 3, { perTile:2.2 }); break;
        case 'tower':     tc = artApartment(b, u0, v0, u1, v1, rng, d, 6, { perTile:2.4 }); break;
        case 'bigtower':  tc = artApartment(b, u0, v0, u1, v1, rng, d, 9, { perTile:2.4, greenRoof:true }); break;
        case 'tower3':    tc = artTower(b, u0, v0, u1, v1, rng, d, 12); break;
        case 'sky':       tc = artTower(b, u0, v0, u1, v1, rng, d, 16); break;
      }
    } else if(d.ind || b.type === 'plant'){
      _artChimneys = [];
      tc = artIndustry(b, u0, v0, u1, v1, rng, d, bCol);
      if(_artChimneys.length && b.type !== 'plant') BUILDING_CHIMNEYS.set(b, { rot, pts:_artChimneys });
      else BUILDING_CHIMNEYS.delete(b);
      _artChimneys = null;
      if(tc && d.ic) artSign(tc[0] + 10, tc[1] + 2, d.ic, b.type === 'mine' ? (b.ore === 'iron' ? '#d98a4f' : '#b0b0c0') : '#ffe082');
    } else {
      tc = artStorage(b, u0, v0, u1, v1, rng, d, bCol);
      if(tc && d.ic && b.type !== 'bus_stop') artSign(tc[0] + 10, tc[1] + 2, d.ic, '#9fd0ff');
    }
  } finally {
    ctx.restore();
    _artLift = 0;
  }
  return tc;
}
