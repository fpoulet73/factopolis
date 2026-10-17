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
  if(b.type === 'air_deco' && Number.isInteger(b.decor)) return b.decor % ART_VARIANTS;
  if(Number.isInteger(b.design) && BUILD[b.type]?.resid) return b.design % ART_VARIANTS; // design aléatoire du logement (sauvegardé)
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

// Maisons mitoyennes : volume continu et toit commun, sans jardin entre lots.
function artRowHouse(b, u0, v0, u1, v1, rng, d){
  const alongU = u1 - u0 >= v1 - v0;
  const n = Math.max(b.w, b.h);
  const H = d.hgt - 7, R = 7;
  const wall = ART_WALLS[Math.floor(rng() * ART_WALLS.length)];
  const roofs = artRoofPalette();
  const roof = roofs[Math.floor(rng() * roofs.length)];
  const a = u0 + 0.08, c = u1 - 0.08, e = v0 + 0.08, f = v1 - 0.08;
  artGround(u0 + 0.02, v0 + 0.02, u1 - 0.02, v1 - 0.02, '#a8a394');
  artShadow(a, e, c, f, H + R);
  artBox(a, e, c, f, 0, H, wall, { top:false });
  const face = alongU ? 'l' : 'r', k = alongU ? f : c;
  const start = alongU ? a : e, length = (alongU ? c - a : f - e) / n;
  for(let i = 0; i < n; i++){
    const s = start + i * length;
    const facade = shade(wall, (i % 2) * 0.10 - 0.05);
    artWindow(face, k, s, s + length, 0, H, shade(facade, alongU ? ART_LIGHT_LEFT : ART_LIGHT_RIGHT));
    // Porte individuelle, fenêtre du séjour et deux fenêtres à l'étage.
    artWindow(face, k, s + length * 0.14, s + length * 0.34, 0, 8, shade(roof, -0.4));
    artWindow(face, k, s + length * 0.54, s + length * 0.84, 3, 8, '#b4d2dc');
    for(const offset of [0.14, 0.58]){
      artWindow(face, k, s + length * offset, s + length * (offset + 0.24), H - 6, H - 2,
        rng() < 0.4 ? 'rgba(255,226,150,.92)' : '#a4c4d3');
    }
    // Pilastre : séparation visible des logements, sans espace entre les murs.
    if(i) artWindow(face, k, s - 0.015, s + 0.015, 0, H, shade(wall, 0.2));
  }
  // Fenêtres du pignon visible et bandeau continu sous le toit.
  artWindow(alongU ? 'r' : 'l', alongU ? c : f,
    (alongU ? e : a) + 0.28, (alongU ? e : a) + 0.51, H - 6, H - 2, '#a4c4d3');
  artBox(a - 0.015, e - 0.015, c + 0.015, f + 0.015, H - 1, H, shade(wall, 0.22), { top:false, edges:false });
  artGable(a, e, c, f, H, H + R, roof, wall, alongU ? 'u' : 'v');
  // Cheminées alignées sur le faîtage commun.
  for(let i = 0; i < n; i++){
    const s = start + (i + 0.65) * length;
    const cu = alongU ? s : (a + c) / 2, cv = alongU ? (e + f) / 2 : s;
    artBox(cu - 0.045, cv - 0.045, cu + 0.045, cv + 0.045, H + R - 2, H + R + 3, '#826354');
  }
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

// --- Maisons de luxe -------------------------------------------------------
// Pas d'immeuble : en s'agrandissant le logement s'étale (ailes, jardin, piscine,
// tennis, fontaine…) et ne gagne au plus qu'un étage. Comme le reste de l'art,
// le dessin se fait dans l'espace TOURNÉ (u,v) : éléments plats d'abord, puis
// volumes de l'arrière (petit u+v) vers l'avant, haies de façade en dernier.
const ART_LUX_WALLS = ['#f4ecdc', '#efe3c8', '#f7f3ea', '#ecdcc2', '#e8e4dc', '#f1e6d6'];
const ART_LUX_ROOFS = ['#4b5563', '#5a5f6b', '#7a4a3a', '#3e4a5c', '#8a5a44', '#56606e'];
const ART_LAWN = '#6fb04c';
const ART_GRAVEL = '#dacfb4';

function artLine(a, b, col, lw){
  ctx.strokeStyle = col; ctx.lineWidth = lw || 1;
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
}

// Repère d'un lot allongé : a le long du grand côté, b en travers.
function artLotFrame(u0, v0, u1, v1){
  const alongU = (u1 - u0) >= (v1 - v0);
  return {
    R: (a0, b0, a1, b1) => alongU ? [u0 + a0, v0 + b0, u0 + a1, v0 + b1] : [u0 + b0, v0 + a0, u0 + b1, v0 + a1],
    P: (a, b) => alongU ? [u0 + a, v0 + b] : [u0 + b, v0 + a],
  };
}

// Pelouse, tondue en bandes sur les grands domaines.
function artLawn(u0, v0, u1, v1, rng, stripes){
  const base = shade(ART_LAWN, -0.04 + rng() * 0.06);
  artGround(u0 + 0.02, v0 + 0.02, u1 - 0.02, v1 - 0.02, base);
  if(!stripes) return;
  const n = Math.round((u1 - u0) * 4);
  for(let k = 0; k < n; k += 2){
    const a = u0 + 0.02 + (u1 - u0 - 0.04) * k / n, c = u0 + 0.02 + (u1 - u0 - 0.04) * (k + 1) / n;
    artGround(a, v0 + 0.02, c, v1 - 0.02, shade(base, 0.07), 0.65);
  }
}

function artHedge(u0, v0, u1, v1, h = 3.4){
  artBox(u0, v0, u1, v1, 0, h, '#3d7d38', { edges:false });
}
// Haies du fond (côtés u0 et v0) : dessinées avant les volumes.
function artHedgesBack(u0, v0, u1, v1){
  artHedge(u0 + 0.03, v0 + 0.03, u0 + 0.09, v1 - 0.03);
  artHedge(u0 + 0.03, v0 + 0.03, u1 - 0.03, v0 + 0.09);
}
// Haies de façade (côtés u1 et v1), avec une ouverture optionnelle sur le côté
// u1 (gap = [v début, v fin]) pour le portail.
function artHedgesFront(u0, v0, u1, v1, gap){
  if(gap){
    artHedge(u1 - 0.09, v0 + 0.03, u1 - 0.03, gap[0]);
    artHedge(u1 - 0.09, gap[1], u1 - 0.03, v1 - 0.03);
  } else {
    artHedge(u1 - 0.09, v0 + 0.03, u1 - 0.03, v1 - 0.03);
  }
  artHedge(u0 + 0.03, v1 - 0.09, u1 - 0.03, v1 - 0.03);
}

function artTree(u, v, h, col){
  const b = artP(u, v, 0), t = artP(u, v, h * 0.5), c = artP(u, v, h * 0.75), r = h * 0.3;
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath(); ctx.ellipse(b[0] - 2, b[1] + 1, r * 1.1, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  artLine(b, t, '#6b4a2e', 1.6);
  ctx.fillStyle = shade(col, -0.12);
  ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = shade(col, 0.12);
  ctx.beginPath(); ctx.arc(c[0] + r * 0.3, c[1] - r * 0.3, r * 0.55, 0, Math.PI * 2); ctx.fill();
}

function artCypress(u, v, h){
  const b = artP(u, v, 0), c = artP(u, v, h * 0.55);
  ctx.fillStyle = 'rgba(0,0,0,.16)';
  ctx.beginPath(); ctx.ellipse(b[0] - 2, b[1] + 1, 3.2, 1.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2d6636';
  ctx.beginPath(); ctx.ellipse(c[0], c[1], 2.8, h * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3f8445';
  ctx.beginPath(); ctx.ellipse(c[0] + 0.9, c[1] - h * 0.08, 1.3, h * 0.36, 0, 0, Math.PI * 2); ctx.fill();
}

// Buis taillé en cône (jardin à la française).
function artTopiary(u, v, h){
  const b = artP(u, v, 0), t = artP(u, v, h);
  ctx.fillStyle = 'rgba(0,0,0,.16)';
  ctx.beginPath(); ctx.ellipse(b[0] - 1, b[1] + 0.5, 3, 1.3, 0, 0, Math.PI * 2); ctx.fill();
  artPoly([[b[0] - 3, b[1] - 1], [b[0] + 3, b[1] - 1], [t[0], t[1]]], '#2f7134');
  artPoly([[b[0], b[1] - 1], [b[0] + 3, b[1] - 1], [t[0], t[1]]], '#3f8a44');
}

function artFlowerBed(u0, v0, u1, v1, rng){
  artGround(u0, v0, u1, v1, '#7a5a3a', 0.8);
  const cols = ['#e84a5f', '#f7d046', '#f4f4f4', '#c86fd8', '#ff8c42'];
  const n = Math.round((u1 - u0) * (v1 - v0) * 120) + 5;
  for(let k = 0; k < n; k++){
    const p = artP(u0 + (u1 - u0) * (0.1 + rng() * 0.8), v0 + (v1 - v0) * (0.1 + rng() * 0.8), 1.6);
    ctx.fillStyle = cols[Math.floor(rng() * cols.length)];
    ctx.beginPath(); ctx.arc(p[0], p[1], 1.1, 0, Math.PI * 2); ctx.fill();
  }
}

function artDeck(u0, v0, u1, v1){
  artGround(u0, v0, u1, v1, '#b98b5b', 0.7);
  ctx.strokeStyle = 'rgba(90,60,30,.35)'; ctx.lineWidth = 0.5;
  const n = Math.max(2, Math.round((u1 - u0) * 10));
  for(let k = 1; k < n; k++){
    const u = u0 + (u1 - u0) * k / n, a = artP(u, v0, 0.75), c = artP(u, v1, 0.75);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
  }
}

// Piscine : margelle claire, bassin, reflets et échelle chromée.
function artPool(u0, v0, u1, v1){
  artGround(u0, v0, u1, v1, '#ebe5d6', 0.9);
  const i = 0.05;
  artGround(u0 + i, v0 + i, u1 - i, v1 - i, '#2f86b8', 0.5);
  artGround(u0 + i + 0.025, v0 + i + 0.025, u1 - i, v1 - i, '#4fb8e3', 0.5);
  const alongU = (u1 - u0) >= (v1 - v0);
  ctx.strokeStyle = 'rgba(235,250,255,.6)'; ctx.lineWidth = 0.8;
  for(const s of [0.3, 0.62]){
    const p = alongU
      ? [artP(u0 + (u1 - u0) * 0.2, v0 + (v1 - v0) * s, 0.6), artP(u0 + (u1 - u0) * 0.55, v0 + (v1 - v0) * s, 0.6)]
      : [artP(u0 + (u1 - u0) * s, v0 + (v1 - v0) * 0.2, 0.6), artP(u0 + (u1 - u0) * s, v0 + (v1 - v0) * 0.55, 0.6)];
    ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); ctx.lineTo(p[1][0], p[1][1]); ctx.stroke();
  }
  const lu = alongU ? u1 - i : u0 + (u1 - u0) * 0.5, lv = alongU ? v0 + (v1 - v0) * 0.5 : v1 - i;
  for(const d of [-0.04, 0.04]){
    const q0 = alongU ? artP(lu, lv + d, 0.9) : artP(lu + d, lv, 0.9);
    artLine(q0, [q0[0], q0[1] - 4], '#d9e1e8', 0.9);
  }
}

function artLounger(u0, v0, u1, v1){
  artBox(u0, v0, u1, v1, 0.8, 2.4, '#f2f2f0', { edges:false });
}

function artParasol(u, v, col){
  const b = artP(u, v, 0.8), t = artP(u, v, 12);
  artLine(b, t, '#e9e9e9', 1);
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(t[0] - 8, t[1] + 3); ctx.quadraticCurveTo(t[0], t[1] - 5, t[0] + 8, t[1] + 3); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.beginPath(); ctx.moveTo(t[0], t[1] - 1); ctx.quadraticCurveTo(t[0] + 4, t[1] - 2, t[0] + 8, t[1] + 3); ctx.lineTo(t[0] + 3, t[1] + 3); ctx.closePath(); ctx.fill();
}

function artLamp(u, v){
  const b = artP(u, v, 0), t = artP(u, v, 12);
  artLine(b, t, '#2b2f36', 1);
  ctx.fillStyle = 'rgba(255,226,150,.95)';
  ctx.beginPath(); ctx.arc(t[0], t[1], 1.7, 0, Math.PI * 2); ctx.fill();
}

function artFountain(u, v, r){
  artCylinder(u, v, r, 0, 3.5, '#d9d2c3', { topCol:'#cfc6b4' });
  const c = artP(u, v, 3.5);
  ctx.fillStyle = '#5bb8e0';
  ctx.beginPath(); ctx.ellipse(c[0], c[1], r * 0.8 * Math.SQRT2 * TW2, r * 0.8 * Math.SQRT2 * TH2, 0, 0, Math.PI * 2); ctx.fill();
  artCylinder(u, v, r * 0.16, 3.5, 9, '#e3dccd', { top:false });
  artCylinder(u, v, r * 0.42, 9, 10.2, '#d6cebd', { topCol:'#7cc6e6' });
  const t = artP(u, v, 10.2);
  ctx.strokeStyle = 'rgba(205,238,255,.9)'; ctx.lineWidth = 1;
  for(const dx of [-1, 1]){
    ctx.beginPath(); ctx.moveTo(t[0], t[1] - 5); ctx.quadraticCurveTo(t[0] + dx * 5, t[1] - 8, t[0] + dx * 8, t[1] + 4); ctx.stroke();
  }
}

// Court de tennis allongé selon son grand côté : surface, lignes, et, dessinés
// plus tard au bon rang de profondeur, le filet et le grillage avant.
function artTennisCourt(u0, v0, u1, v1, surface){
  const alongU = (u1 - u0) >= (v1 - v0);
  const L = alongU ? u1 - u0 : v1 - v0, W = alongU ? v1 - v0 : u1 - u0;
  const P = (a, b, z) => alongU ? artP(u0 + a, v0 + b, z) : artP(u0 + b, v0 + a, z);
  artGround(u0, v0, u1, v1, '#3f7a52', 0.7);
  const a0 = L * 0.1, a1 = L * 0.9, b0 = W * 0.14, b1 = W * 0.86;
  artPoly([P(a0, b0, 0.8), P(a1, b0, 0.8), P(a1, b1, 0.8), P(a0, b1, 0.8)], surface);
  const seg = (pa, pb, qa, qb) => artLine(P(pa, pb, 0.9), P(qa, qb, 0.9), 'rgba(255,255,255,.92)', 0.8);
  seg(a0, b0, a1, b0); seg(a1, b0, a1, b1); seg(a1, b1, a0, b1); seg(a0, b1, a0, b0);
  const sb = (b1 - b0) * 0.125, am = (a0 + a1) / 2, sl = (a1 - a0) * 0.27;
  seg(a0, b0 + sb, a1, b0 + sb); seg(a0, b1 - sb, a1, b1 - sb);
  seg(am - sl, b0 + sb, am - sl, b1 - sb); seg(am + sl, b0 + sb, am + sl, b1 - sb);
  seg(am - sl, (b0 + b1) / 2, am + sl, (b0 + b1) / 2);
  return { P, L, W, am, b0, b1 };
}
function artTennisFence(c, front){
  const { P, L, W } = c, H = 9;
  const side = (pa, pb, qa, qb) => {
    artPoly([P(pa, pb, 0.8), P(qa, qb, 0.8), P(qa, qb, H), P(pa, pb, H)], 'rgba(40,72,52,.2)');
    artLine(P(pa, pb, H), P(qa, qb, H), 'rgba(30,50,36,.85)', 0.7);
    for(const t of [0, 0.5, 1]){
      const a = pa + (qa - pa) * t, b = pb + (qb - pb) * t;
      artLine(P(a, b, 0.8), P(a, b, H), 'rgba(30,50,36,.85)', 0.8);
    }
  };
  if(front){ side(L, 0, L, W); side(0, W, L, W); }
  else { side(0, 0, L, 0); side(0, 0, 0, W); }
}
function artTennisNet(c){
  const { P, am, b0, b1 } = c;
  const p0 = P(am, b0 - 0.03, 0.9), p1 = P(am, b1 + 0.03, 0.9), q1 = P(am, b1 + 0.03, 4.2), q0 = P(am, b0 - 0.03, 4.2);
  artPoly([p0, p1, q1, q0], 'rgba(28,32,38,.45)');
  artLine(q0, q1, '#ffffff', 1);
  artLine(p0, [q0[0], q0[1] - 1], '#2c3036', 1.2);
  artLine(p1, [q1[0], q1[1] - 1], '#2c3036', 1.2);
}

// Corps de logis : murs clairs, soubassement, hautes fenêtres à encadrement,
// bandeau d'étage, corniche, puis toit en croupe ou toit-terrasse (opts.flat).
// opts.z0 : posé sur un volume inférieur. Retourne la hauteur du sommet.
function artLuxBlock(u0, v0, u1, v1, floors, wall, roof, rng, opts = {}){
  const fh = opts.fh || 11.5, Z = opts.z0 || 0, H = Z + floors * fh;
  if(!Z) artShadow(u0, v0, u1, v1, H + 8);
  artBox(u0, v0, u1, v1, Z, H, wall, { top: !!opts.flat });
  if(!Z) artBox(u0 - 0.005, v0 - 0.005, u1 + 0.005, v1 + 0.005, 0, 2.2, shade(wall, -0.28), { top:false, edges:false });
  const glow = 'rgba(255,226,150,.92)', dark = opts.glass ? 'rgba(126,176,210,.92)' : 'rgba(46,64,88,.88)';
  const doFace = (face, k, a0, a1) => {
    const cols = Math.max(1, Math.round((a1 - a0) * (opts.glass ? 2 : 3)));
    for(let f = 0; f < floors; f++){
      const z0 = Z + f * fh + 3.2, z1 = z0 + (opts.glass ? 6 : 5.4);
      for(let c = 0; c < cols; c++){
        const s0 = a0 + (a1 - a0) * (c + (opts.glass ? 0.12 : 0.24)) / cols, s1 = a0 + (a1 - a0) * (c + (opts.glass ? 0.88 : 0.76)) / cols;
        if(!opts.glass) artWindow(face, k, s0 - 0.012, s1 + 0.012, z0 - 0.7, z1 + 0.7, shade(wall, 0.14));
        artWindow(face, k, s0, s1, z0, z1, rng() < 0.3 ? glow : dark);
      }
    }
  };
  doFace('r', u1, v0, v1);
  doFace('l', v1, u0, u1);
  if(floors > 1) artBox(u0 - 0.01, v0 - 0.01, u1 + 0.01, v1 + 0.01, Z + fh - 0.6, Z + fh + 0.4, shade(wall, 0.18), { top:false, edges:false });
  artBox(u0 - 0.02, v0 - 0.02, u1 + 0.02, v1 + 0.02, H - 1.2, H, shade(wall, 0.2), { top: !!opts.flat, topCol: shade(wall, -0.08), edges:false });
  if(opts.flat){
    // acrotère du toit-terrasse
    artBox(u0 - 0.02, v0 - 0.02, u1 + 0.02, v1 + 0.02, H, H + 1.6, shade(wall, 0.1), { top:false, edges:false });
    return H + 1.6;
  }
  const roofH = opts.roofH || 9;
  artHip(u0, v0, u1, v1, H, H + roofH, roof, 0.3);
  return H + roofH;
}

// Porche / portique sur la face u = k : colonnes, entablement, fronton optionnel.
function artPortico(k, s0, s1, depth, h, wall, cols, pediment){
  for(let i = 0; i < cols; i++){
    const s = s0 + 0.03 + (s1 - s0 - 0.06) * i / Math.max(1, cols - 1);
    artCylinder(k + depth - 0.04, s, 0.028, 0, h, '#f5f2ea', { top:false });
  }
  artBox(k, s0, k + depth, s1, h, h + 1.6, shade(wall, 0.12), { edges:false });
  if(pediment){
    const sm = (s0 + s1) / 2;
    artPoly([artP(k + depth, s0, h + 1.6), artP(k + depth, s1, h + 1.6), artP(k + depth, sm, h + 7)], shade(wall, 0.06), 'rgba(0,0,0,.15)', 0.6);
  }
}

// 1 case — ouvriers : maison bourgeoise, porche, massif de fleurs, haies.
function artLuxHouse(b, u0, v0, u1, v1, rng){
  const wall = ART_LUX_WALLS[Math.floor(rng() * ART_LUX_WALLS.length)];
  const roof = ART_LUX_ROOFS[Math.floor(rng() * ART_LUX_ROOFS.length)];
  const hu0 = u0 + 0.15, hv0 = v0 + 0.14, hu1 = u1 - 0.27, hv1 = v1 - 0.24, hvm = (hv0 + hv1) / 2;
  artLawn(u0, v0, u1, v1, rng, false);
  artGround(hu1, hvm - 0.06, u1 - 0.02, hvm + 0.06, ART_GRAVEL, 0.7);   // allée vers le portillon
  artFlowerBed(hu0 + 0.02, hv1 + 0.04, hu1 - 0.04, v1 - 0.11, rng);
  artHedgesBack(u0, v0, u1, v1);
  const top = artLuxBlock(hu0, hv0, hu1, hv1, 1, wall, roof, rng, { roofH:13, fh:13 });
  artWindow('r', hu1, hvm - 0.07, hvm + 0.07, 0, 8, '#5a3a2a');
  artPortico(hu1, hvm - 0.15, hvm + 0.15, 0.12, 8.5, wall, 2, false);
  const cu = hu0 + (hu1 - hu0) * 0.3, cv = hv0 + (hv1 - hv0) * 0.3;
  artBox(cu - 0.05, cv - 0.05, cu + 0.05, cv + 0.05, top - 7, top + 2, '#8a6a58');
  artTree(u1 - 0.13, v0 + 0.15, 18, '#4f9a3f');
  artLamp(u1 - 0.12, hvm + 0.14);
  artHedgesFront(u0, v0, u1, v1, [hvm - 0.08, hvm + 0.08]);
  return artP((u0 + u1) / 2, (v0 + v1) / 2, top);
}

// 2 cases — employés : villa moderne (toits plats, étage en retrait bardé de
// bois), terrasse en bois et piscine.
function artLuxVilla(b, u0, v0, u1, v1, rng){
  const F = artLotFrame(u0, v0, u1, v1);
  const wall = ['#f6f4ef', '#f1ede4', '#ece8e0'][Math.floor(rng() * 3)];
  const wood = ['#a8754a', '#9a6a42', '#b5845a'][Math.floor(rng() * 3)];
  const sun = ['#e8574a', '#f2c94c', '#3f8fd9', '#f4f4f4'][Math.floor(rng() * 4)];
  artLawn(u0, v0, u1, v1, rng, false);
  artDeck(...F.R(1.0, 0.1, 1.9, 0.9));
  artPool(...F.R(1.1, 0.2, 1.72, 0.64));
  artHedgesBack(u0, v0, u1, v1);
  artTree(...F.P(0.16, 0.16), 22, '#4f9a3f');
  artLuxBlock(...F.R(0.14, 0.16, 0.96, 0.84), 1, wall, '#555', rng, { flat:true, glass:true });
  const top = artLuxBlock(...F.R(0.2, 0.22, 0.62, 0.6), 1, wood, '#555', rng, { flat:true, glass:true, z0:11.5 });
  artTree(...F.P(1.9, 0.12), 18, '#5aa04a');
  artLounger(...F.R(1.18, 0.72, 1.4, 0.84));
  artLounger(...F.R(1.48, 0.72, 1.7, 0.84));
  artParasol(...F.P(1.44, 0.82), sun);
  artBush(...F.P(0.2, 0.9), 3, '#3f8f3a');
  artHedgesFront(u0, v0, u1, v1);
  return artP((u0 + u1) / 2, (v0 + v1) / 2, top);
}

// 4 cases — cadres : manoir à un étage, aile basse, piscine, parterre et fontaine.
function artLuxManor(b, u0, v0, u1, v1, rng){
  const wall = ART_LUX_WALLS[Math.floor(rng() * ART_LUX_WALLS.length)];
  const roof = ART_LUX_ROOFS[Math.floor(rng() * ART_LUX_ROOFS.length)];
  const sun = ['#e8574a', '#f2c94c', '#3f8fd9'][Math.floor(rng() * 3)];
  const U = (s) => u0 + s, V = (s) => v0 + s;
  artLawn(u0, v0, u1, v1, rng, true);
  artDeck(U(1.32), V(0.14), U(1.9), V(1.0));
  artPool(U(1.42), V(0.24), U(1.74), V(0.88));
  artGround(U(1.12), V(1.2), U(1.8), V(1.86), ART_GRAVEL, 0.7);
  artFlowerBed(U(1.18), V(1.26), U(1.34), V(1.42), rng);
  artFlowerBed(U(1.58), V(1.26), U(1.74), V(1.42), rng);
  artFlowerBed(U(1.18), V(1.64), U(1.34), V(1.8), rng);
  artFlowerBed(U(1.58), V(1.64), U(1.74), V(1.8), rng);
  artFlowerBed(U(0.2), V(1.56), U(0.86), V(1.82), rng);
  artHedgesBack(u0, v0, u1, v1);
  for(let s = 0.35; s < 1.9; s += 0.38) artCypress(U(0.1), V(s), 20);
  for(let s = 0.35; s < 1.3; s += 0.38) artCypress(U(s), V(0.1), 20);
  const top = artLuxBlock(U(0.2), V(0.2), U(1.2), V(0.92), 2, wall, roof, rng, { roofH:10 });
  artWindow('r', U(1.2), V(0.48), V(0.64), 0, 9, '#5a3a2a');
  artPortico(U(1.2), V(0.4), V(0.72), 0.1, 10, wall, 3, true);
  artLuxBlock(U(0.2), V(0.92), U(0.8), V(1.42), 1, wall, roof, rng, { roofH:7 });
  artLounger(U(1.78), V(0.3), U(1.86), V(0.52));
  artLounger(U(1.78), V(0.6), U(1.86), V(0.82));
  artParasol(U(1.82), V(0.56), sun);
  artFountain(U(1.46), V(1.53), 0.17);
  artBush(U(0.96), V(1.3), 3.2, '#3f8f3a');
  artTree(U(1.86), V(1.12), 22, '#4f9a3f');
  artLamp(U(1.08), V(1.12));
  artHedgesFront(u0, v0, u1, v1);
  return artP((u0 + u1) / 2, (v0 + v1) / 2, top);
}

// 9 cases — patrons : demeure à un étage et portique, aile, orangerie, piscine,
// court de tennis, jardin à la française avec fontaine, portail.
function artLuxEstate(b, u0, v0, u1, v1, rng){
  const wall = ART_LUX_WALLS[Math.floor(rng() * ART_LUX_WALLS.length)];
  const roof = ART_LUX_ROOFS[Math.floor(rng() * ART_LUX_ROOFS.length)];
  const court = ['#3a6ea8', '#c4643c', '#4a8a5a'][Math.floor(rng() * 3)];
  const U = (s) => u0 + s, V = (s) => v0 + s;
  artLawn(u0, v0, u1, v1, rng, true);
  // sols : cour d'honneur, allée du portail, terrasse de piscine, tennis, parterres
  artGround(U(1.85), V(0.3), U(2.18), V(1.8), ART_GRAVEL, 0.7);
  artGround(U(2.18), V(1.52), U(2.97), V(1.78), ART_GRAVEL, 0.7);
  artDeck(U(2.24), V(0.16), U(2.88), V(1.4));
  artPool(U(2.32), V(0.26), U(2.64), V(1.3));
  const tc = artTennisCourt(U(0.14), V(2.08), U(1.92), V(2.9), court);
  artGround(U(2.08), V(1.92), U(2.9), V(2.88), ART_GRAVEL, 0.7);
  for(const [a, c] of [[2.14, 1.98], [2.56, 1.98], [2.14, 2.46], [2.56, 2.46]])
    artFlowerBed(U(a), V(c), U(a + 0.28), V(c + 0.34), rng);
  artHedgesBack(u0, v0, u1, v1);
  artTennisFence(tc, false);
  for(let s = 0.35; s < 2.0; s += 0.36) artCypress(U(0.1), V(s), 22);
  for(let s = 0.35; s < 2.1; s += 0.36) artCypress(U(s), V(0.1), 22);
  // demeure : corps de logis à un étage, portique à fronton face à la cour
  const top = artLuxBlock(U(0.2), V(0.22), U(1.85), V(1.3), 2, wall, roof, rng, { roofH:11 });
  artWindow('r', U(1.85), V(0.68), V(0.86), 0, 9.5, '#4a2e22');
  artPortico(U(1.85), V(0.52), V(1.02), 0.12, 11, wall, 4, true);
  artLuxBlock(U(0.2), V(1.3), U(0.85), V(1.92), 1, wall, roof, rng, { roofH:7 });
  // orangerie vitrée
  artBox(U(1.0), V(1.4), U(1.62), V(1.84), 0, 9, '#a9d4e6', { topCol:'#d2eaf4' });
  for(let s = 1.0; s <= 1.62; s += 0.124) artLine(artP(U(s), V(1.84), 0), artP(U(s), V(1.84), 9), 'rgba(255,255,255,.8)', 0.7);
  for(let s = 1.4; s <= 1.84; s += 0.11) artLine(artP(U(1.62), V(s), 0), artP(U(1.62), V(s), 9), 'rgba(255,255,255,.8)', 0.7);
  artTree(U(2.92), V(0.1), 22, '#4f9a3f');
  artLounger(U(2.72), V(0.34), U(2.82), V(0.56));
  artLounger(U(2.72), V(0.66), U(2.82), V(0.88));
  artLounger(U(2.72), V(0.98), U(2.82), V(1.2));
  artParasol(U(2.78), V(0.62), '#f4f4f4');
  artParasol(U(2.78), V(1.04), '#e8574a');
  artTennisNet(tc);
  artTennisFence(tc, true);
  // buis d'angle : ceux de l'arrière avant la fontaine, les autres après
  const topiaries = [[2.12, 1.96], [2.86, 1.96], [2.12, 2.84], [2.86, 2.84]];
  for(const [a, c] of topiaries) if(a + c < 4.89) artTopiary(U(a), V(c), 9);
  artFountain(U(2.49), V(2.4), 0.2);
  for(const [a, c] of topiaries) if(a + c >= 4.89) artTopiary(U(a), V(c), 9);
  artLamp(U(2.2), V(1.5)); artLamp(U(2.2), V(1.8));
  artHedgesFront(u0, v0, u1, v1, [V(1.5), V(1.8)]);
  // piliers du portail
  for(const s of [1.44, 1.8]){
    artBox(U(2.9), V(s), U(2.98), V(s + 0.07), 0, 11, '#d8d0c0', { edges:false });
    artBox(U(2.89), V(s - 0.01), U(2.99), V(s + 0.08), 11, 12.5, '#c6bdab', { edges:false });
  }
  return artP((u0 + u1) / 2, (v0 + v1) / 2, top);
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
      const ore = b.ore === 'coal' ? '#2f3036' : b.ore === 'iron' ? '#b0663a' : (RES[b.ore]?.c || '#b0663a');
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
    default: {
      const h = artAdvancedIndustry(b, u0, v0, u1, v1, rng, d);
      if(h == null) return null;
      top = h; break;
    }
  }
  return artP(cu, cv, top);
}

// --- Chaînes de production avancées ------------------------------------------
// Sphère (réservoir de gaz, dôme) posée en (u,v) à l'altitude z.
function artSphere(u, v, z, r, col){
  const c = artP(u, v, z + r);
  const g = ctx.createRadialGradient(c[0] - r * 0.35, c[1] - r * 0.4, r * 0.15, c[0], c[1], r);
  g.addColorStop(0, shade(col, 0.35)); g.addColorStop(0.7, col); g.addColorStop(1, shade(col, -0.35));
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  const f = artP(u, v, 0); ctx.beginPath(); ctx.ellipse(f[0] - 2, f[1] + 1, r * 1.1, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI * 2); ctx.fill();
}
// Petite flamme (torchère de raffinerie, four) au point écran p.
function artFlame(p, s = 1){
  ctx.save();
  ctx.fillStyle = 'rgba(255,170,60,.85)';
  ctx.beginPath(); ctx.moveTo(p[0] - 2.4 * s, p[1]); ctx.quadraticCurveTo(p[0], p[1] - 9 * s, p[0] + 2.4 * s, p[1]); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,236,150,.95)';
  ctx.beginPath(); ctx.moveTo(p[0] - 1.1 * s, p[1]); ctx.quadraticCurveTo(p[0], p[1] - 5 * s, p[0] + 1.1 * s, p[1]); ctx.closePath(); ctx.fill();
  ctx.restore();
}
// Pile de profilés / plaques (laminoir, tôlerie) : barres parallèles le long de u.
function artBars(u0, v0, u1, v1, col, layers = 3, flat = false){
  for(let i = 0; i < layers; i++){
    const z = 1 + i * (flat ? 1.6 : 2.6);
    if(flat){ artBox(u0, v0, u1, v1, z - 1.2, z, shade(col, i % 2 ? 0.08 : -0.04), { edges:false }); continue; }
    for(let k = 0; k < 3; k++){
      const vv = v0 + (v1 - v0) * (k + 0.5) / 3;
      const a = artP(u0, vv, z), e = artP(u1, vv, z);
      ctx.strokeStyle = shade(col, -0.25); ctx.lineWidth = 2.6; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
      ctx.strokeStyle = shade(col, 0.2); ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(a[0], a[1] - 1); ctx.lineTo(e[0], e[1] - 1); ctx.stroke();
    }
  }
}
// Tuyauterie : polyligne épaisse entre points (u,v,z).
function artPipe(pts, col = '#8a9096', lw = 1.6){
  ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach(([u, v, z], i) => { const p = artP(u, v, z); if(i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
  ctx.stroke();
}

// Art des usines avancées ; retourne la hauteur du sommet (ancre des overlays) ou null.
function artAdvancedIndustry(b, u0, v0, u1, v1, rng, d){
  const type = b.type;
  const wu = u1 - u0, wv = v1 - v0, big = Math.max(b.w, b.h);
  const H = 12 + big * 3;
  // hangar principal ; opts.cut : fraction de la largeur laissée libre côté u1 (cuves, piles…)
  const hall = (wall, roof, opts) => artHall(u0 + 0.1, v0 + 0.1, u1 - wu * (opts?.cut ?? 0.1), v1 - 0.12, opts?.H ?? H, wall, roof, rng, opts || {});
  switch(type){
    case 'oil_well': {
      // chevalet de pompage (« tête de cheval ») + cuve de stockage
      artGround(u0 + 0.06, v0 + 0.06, u1 - 0.06, v1 - 0.06, '#6f665c');
      artCylinder(u1 - 0.24, v1 - 0.26, 0.13, 0, 12, '#5d5a66', { bands:1, topCol:'#7a7686' });
      const pu = u0 + wu * 0.42, pv = v0 + wv * 0.42;
      artBox(pu - 0.22, pv - 0.06, pu + 0.22, pv + 0.06, 0, 3, '#3d3a44', { edges:false });
      const apex = artP(pu, pv, 17);
      ctx.strokeStyle = '#2b2a31'; ctx.lineWidth = 1.8;
      for(const du of [-0.14, 0.14]){ const f = artP(pu + du, pv, 0); ctx.beginPath(); ctx.moveTo(f[0], f[1]); ctx.lineTo(apex[0], apex[1]); ctx.stroke(); }
      const hb = artP(pu - 0.34, pv, 15), tb = artP(pu + 0.3, pv, 20);
      ctx.strokeStyle = '#c94a3a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(tb[0], tb[1]); ctx.lineTo(hb[0], hb[1]); ctx.stroke();
      ctx.fillStyle = '#c94a3a'; ctx.beginPath(); ctx.moveTo(hb[0], hb[1] - 3); ctx.lineTo(hb[0] - 4, hb[1] + 2); ctx.lineTo(hb[0] + 1, hb[1] + 4); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#1f1e24'; ctx.lineWidth = 0.8;
      const rodTop = artP(pu - 0.36, pv, 13), rodBot = artP(pu - 0.36, pv, 0);
      ctx.beginPath(); ctx.moveTo(rodTop[0], rodTop[1]); ctx.lineTo(rodBot[0], rodBot[1]); ctx.stroke();
      ctx.lineCap = 'butt';
      artSphere(pu + 0.3, pv + 0.05, 1.5, 2.6, '#4a4752'); // contrepoids
      return 22;
    }
    case 'copper_smelter': case 'glassworks': {
      const glass = type === 'glassworks';
      artGround(u0 + 0.03, v0 + 0.03, u1 - 0.03, v1 - 0.03, '#8b8f93');
      hall(glass ? '#7aa7b6' : '#a86a48', glass ? '#3c5c68' : '#5a3a2c', { cut:0.38 });
      artCylinder(u1 - wu * 0.2, v0 + wv * 0.38, 0.15 * Math.min(2, big), 0, H + 10, glass ? '#5d7f8c' : '#9a5a3a', { bands:2, hollow:true });
      const g = artP(u1 - wu * 0.2, v0 + wv * 0.38, H + 10);
      ctx.save(); ctx.globalAlpha = 0.6; ctx.fillStyle = glass ? '#ffb45a' : '#ff7a2c';
      ctx.beginPath(); ctx.ellipse(g[0], g[1], 4.5, 2.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      artChimney(u0 + wu * 0.25, v0 + 0.22, H, 14 + big * 4, glass ? '#5b6a70' : '#6b4a3a', 0.07);
      if(glass) for(let k = 0; k < 3; k++) artCylinder(u0 + 0.22 + k * 0.14, v1 - 0.12, 0.04, 0, 5, 'rgba(170,230,245,.9)', { top:true });
      else artPile(u0 + 0.25, v1 - 0.14, 0.12, '#c46a3a', 4);
      return H + 14;
    }
    case 'wire_mill': {
      artGround(u0 + 0.03, v0 + 0.03, u1 - 0.03, v1 - 0.03, '#8e9296');
      hall('#b98a6a', '#5c4a3e', { cut:0.32, sawtooth:true });
      for(let k = 0; k < 3; k++){
        const u = u1 - 0.2, v = v0 + 0.2 + k * (wv - 0.4) / 2;
        artCylinder(u, v, 0.09, 0, 6, '#d9804a', { bands:2, topCol:'#e8a070' });
        const t = artP(u, v, 6); ctx.fillStyle = '#5a3a2a'; ctx.beginPath(); ctx.ellipse(t[0], t[1], 2, 1, 0, 0, Math.PI * 2); ctx.fill();
      }
      return H + 10;
    }
    case 'gold_refinery': case 'jeweler': {
      const jew = type === 'jeweler';
      artGround(u0 + 0.05, v0 + 0.05, u1 - 0.05, v1 - 0.05, jew ? '#cfc6b0' : '#8b8f93');
      artShadow(u0 + 0.14, v0 + 0.14, u1 - 0.18, v1 - 0.16, H + 10);
      artBox(u0 + 0.14, v0 + 0.14, u1 - 0.18, v1 - 0.16, 0, H, jew ? '#efe4cc' : '#9a8a6a', { top:false });
      artBox(u0 + 0.13, v0 + 0.13, u1 - 0.17, v1 - 0.15, H - 2.5, H - 1, '#e2b84a', { top:false, edges:false });
      artHip(u0 + 0.14, v0 + 0.14, u1 - 0.18, v1 - 0.16, H, H + 8, jew ? '#5a4a6a' : '#5a5246', 0.3);
      artWindowGrid(u0 + 0.14, v0 + 0.14, u1 - 0.18, v1 - 0.16, 0, H - 3, 6, rng, { lit:0.6, glow:'rgba(255,220,120,.95)' });
      if(!jew){ artCylinder(u1 - 0.12, v0 + 0.2, 0.07, 0, 12, '#7f8a7a', { bands:1 }); artChimney(u0 + 0.3, v0 + 0.25, H, 10, '#6a6252', 0.06); }
      else artSphere((u0 + u1) / 2 - 0.02, (v0 + v1) / 2 - 0.02, H + 6, 3.2, '#f2c94c');
      return H + 14;
    }
    case 'rolling_mill': case 'sheet_mill': case 'nail_factory': {
      artGround(u0 + 0.03, v0 + 0.03, u1 - 0.03, v1 - 0.03, '#868b90');
      const plates = type === 'sheet_mill', nails = type === 'nail_factory';
      hall(nails ? '#8f99a3' : '#6f7f90', '#3a4450', { cut:0.34, sawtooth:!nails });
      if(nails){ for(let k = 0; k < 3; k++) artBox(u1 - 0.3, v0 + 0.16 + k * 0.24, u1 - 0.14, v0 + 0.32 + k * 0.24, 0, 4, '#a07a4a'); }
      else artBars(u1 - 0.3, v0 + 0.14, u1 - 0.1, v1 - 0.16, plates ? '#b9c7d6' : '#7f95ab', 3, plates);
      artChimney(u0 + 0.24, v0 + 0.22, H, 12 + big * 3, '#59626b', 0.07);
      return H + 10;
    }
    case 'cement_plant': case 'concrete_plant': {
      const cement = type === 'cement_plant';
      artGround(u0 + 0.03, v0 + 0.03, u1 - 0.03, v1 - 0.03, '#9a968c');
      if(cement){
        // tour de préchauffage + silos + four rotatif (cylindre incliné le long de u)
        artBox(u0 + 0.12, v0 + 0.14, u0 + 0.42, v0 + 0.44, 0, H + 18, '#b7b1a3');
        artWindowGrid(u0 + 0.12, v0 + 0.14, u0 + 0.42, v0 + 0.44, 4, H + 16, 7, rng, { lit:0.1 });
        const a = artP(u0 + 0.42, v0 + 0.36, 9), e = artP(u1 - 0.12, v0 + 0.36, 4);
        ctx.strokeStyle = '#6e6658'; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
        ctx.strokeStyle = '#a39a8a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a[0], a[1] - 2); ctx.lineTo(e[0], e[1] - 2); ctx.stroke();
        ctx.lineCap = 'butt';
        for(let k = 0; k < 2; k++) artCylinder(u0 + 0.3 + k * 0.28, v1 - 0.25, 0.12, 0, H + 6, '#d2cdbf', { bands:2, topCol:'#b9b3a4' });
        artChimney(u0 + 0.2, v0 + 0.2, H + 18, 10, '#8f8778', 0.06);
        return H + 30;
      }
      // centrale à béton : tour de malaxage, silo à ciment, tas de sable, convoyeur
      artPile(u0 + 0.24, v1 - 0.24, 0.16, '#e0c98a', 6);
      artPile(u0 + 0.5, v1 - 0.18, 0.12, '#9a9690', 5);
      artBox(u1 - 0.42, v0 + 0.14, u1 - 0.14, v0 + 0.42, 0, H + 12, '#c9ccd0');
      artBox(u1 - 0.43, v0 + 0.13, u1 - 0.13, v0 + 0.43, H + 4, H + 6, '#f2c230', { top:false, edges:false });
      artCylinder(u0 + 0.3, v0 + 0.26, 0.12, 6, H + 16, '#b4b8bc', { bands:2 });
      ctx.strokeStyle = '#4f555b'; ctx.lineWidth = 1;
      for(const [du, dv] of [[-0.08, -0.08], [0.08, 0.08], [0.08, -0.08], [-0.08, 0.08]]){
        const p0 = artP(u0 + 0.3 + du, v0 + 0.26 + dv, 0), p1 = artP(u0 + 0.3 + du, v0 + 0.26 + dv, 6);
        ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
      }
      artPipe([[u0 + 0.3, v1 - 0.3, 2], [u1 - 0.4, v0 + 0.42, H + 8]], '#3f454b', 2);
      return H + 18;
    }
    case 'glazier': case 'electronics_plant': case 'appliance_factory': {
      // bâtiments modernes : toit plat, bandeaux vitrés
      const elec = type === 'electronics_plant', appl = type === 'appliance_factory';
      artGround(u0 + 0.03, v0 + 0.03, u1 - 0.03, v1 - 0.03, '#9aa0a6');
      const wall = elec ? '#d9e2ea' : appl ? '#c9d0d8' : '#cfe4ec';
      const hh = H + (elec ? 6 : 2);
      artShadow(u0 + 0.12, v0 + 0.12, u1 - 0.14, v1 - 0.14, hh + 4);
      artBox(u0 + 0.12, v0 + 0.12, u1 - 0.14, v1 - 0.14, 0, hh, wall, { topCol: shade(wall, -0.12) });
      artWindowGrid(u0 + 0.12, v0 + 0.12, u1 - 0.14, v1 - 0.14, 0, hh, 5, rng,
        { perTile:3, lit: elec ? 0.5 : 0.25, dark: type === 'glazier' ? 'rgba(120,200,235,.9)' : 'rgba(40,70,100,.85)', glow:'rgba(190,235,255,.95)' });
      if(elec){
        artBox(u0 + 0.3, v0 + 0.3, u0 + 0.5, v0 + 0.5, hh, hh + 4, '#8a96a2');
        const a0 = artP(u1 - 0.3, v0 + 0.28, hh), a1 = artP(u1 - 0.3, v0 + 0.28, hh + 14);
        ctx.strokeStyle = '#5a6670'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a1[0], a1[1]); ctx.stroke();
        ctx.fillStyle = '#e8584a'; ctx.beginPath(); ctx.arc(a1[0], a1[1], 1.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3f9a5a'; const s = artP(u1 - 0.14, (v0 + v1) / 2, hh * 0.55); ctx.fillRect(s[0] - 1, s[1] - 3, 3, 6);
      } else if(appl){
        for(let k = 0; k < 3; k++) artBox(u1 - 0.12, v0 + 0.2 + k * 0.2, u1 + 0.02, v0 + 0.34 + k * 0.2, 0, 5, '#e8ecef');
      } else {
        // vitres en attente de livraison, appuyées contre la façade
        for(let k = 0; k < 3; k++) artWindow('r', u1 - 0.08, v0 + 0.2 + k * 0.2, v0 + 0.34 + k * 0.2, 0, 7, 'rgba(160,220,245,.85)');
      }
      return hh + 6;
    }
    case 'ropery': case 'furniture_factory': {
      const wood = type === 'furniture_factory';
      artGround(u0 + 0.03, v0 + 0.03, u1 - 0.03, v1 - 0.03, wood ? '#8a7656' : '#9a8a6a');
      hall(wood ? '#a0764a' : '#c9a46a', wood ? '#5c3e26' : '#6a5a3c', { cut:0.3, roofH:7 });
      if(wood) artLogs(u1 - 0.3, v0 + 0.12, u1 - 0.06, v1 - 0.14);
      else for(let k = 0; k < 2; k++){
        const u = u1 - 0.18, v = v0 + 0.28 + k * 0.3;
        artCylinder(u, v, 0.1, 0, 4, '#c9a46a', { topCol:'#a07a48' });
        const t = artP(u, v, 4); ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.ellipse(t[0], t[1], 3.5, 1.7, 0, 0, Math.PI * 2); ctx.stroke();
      }
      if(wood) artChimney(u0 + 0.24, v0 + 0.22, H, 9, '#6c5a48', 0.06);
      return H + 10;
    }
    case 'refinery': {
      // colonnes de distillation, sphère de gaz, torchère
      artGround(u0 + 0.03, v0 + 0.03, u1 - 0.03, v1 - 0.03, '#7d8186');
      artBox(u0 + 0.1, v1 - 0.4, u0 + 0.5, v1 - 0.1, 0, 10, '#8a8f96');
      const cols = [[0.34, 0.28, 0.08, H + 26], [0.5, 0.22, 0.07, H + 18], [0.62, 0.36, 0.06, H + 12]];
      for(const [fu, fv, r, h] of cols) artCylinder(u0 + wu * fu, v0 + wv * fv, r * Math.min(2, big), 0, h, '#c4c9cf', { bands:4, topCol:'#9aa0a6' });
      artPipe([[u0 + wu * 0.34, v0 + wv * 0.28, 14], [u0 + wu * 0.5, v0 + wv * 0.22, 14], [u0 + wu * 0.62, v0 + wv * 0.36, 10]], '#6a7078', 1.4);
      artSphere(u1 - wu * 0.24, v1 - wv * 0.28, 2, 6 * Math.min(1.6, big * 0.8), '#e8ecef');
      const fl = artP(u0 + wu * 0.16, v0 + wv * 0.18, H + 30);
      artChimney(u0 + wu * 0.16, v0 + wv * 0.18, 0, H + 30, '#5a5560', 0.045);
      artFlame(fl, 1.1);
      return H + 30;
    }
    case 'chem_plant': case 'paint_factory': {
      const paint = type === 'paint_factory';
      artGround(u0 + 0.03, v0 + 0.03, u1 - 0.03, v1 - 0.03, '#868b88');
      hall(paint ? '#d8c690' : '#7fa07a', paint ? '#7a6230' : '#3f5a3c', { cut:0.4 });
      const tankCol = paint ? '#f2c230' : '#5f8a5a';
      for(let k = 0; k < 2; k++) artCylinder(u1 - wu * 0.24, v0 + 0.24 + k * (wv - 0.48), 0.12, 0, H + 4, tankCol, { bands:2, topCol: shade(tankCol, 0.2) });
      artPipe([[u1 - wu * 0.36, v0 + 0.3, H - 2], [u1 - wu * 0.24, v0 + 0.3, H + 2]], '#6a7078', 1.4);
      if(paint) for(let k = 0; k < 3; k++) artCylinder(u0 + 0.22 + k * 0.12, v1 - 0.1, 0.045, 0, 4, ['#f2c230', '#e8584a', '#3a8fd9'][k], { top:true });
      else artChimney(u0 + 0.26, v0 + 0.22, H, 14, '#5b6a5a', 0.06);
      return H + 12;
    }
    case 'quantum_lab': {
      // laboratoire futuriste : socle vitré + dôme lumineux + antenne
      artGround(u0 + 0.03, v0 + 0.03, u1 - 0.03, v1 - 0.03, '#a6aab5');
      artShadow(u0 + 0.12, v0 + 0.12, u1 - 0.12, v1 - 0.12, H + 14);
      artBox(u0 + 0.12, v0 + 0.12, u1 - 0.12, v1 - 0.12, 0, H, '#d8dbe8', { topCol:'#b8bccc' });
      artWindowGrid(u0 + 0.12, v0 + 0.12, u1 - 0.12, v1 - 0.12, 0, H, 5, rng, { perTile:3, lit:0.7, glow:'rgba(190,160,255,.95)' });
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      const c = artP(cu, cv, H);
      const r = 9 * Math.min(1.8, big * 0.9);
      const g = ctx.createRadialGradient(c[0] - r * 0.3, c[1] - r * 0.5, 1, c[0], c[1] - r * 0.2, r);
      g.addColorStop(0, '#f4ecff'); g.addColorStop(0.6, '#b58cff'); g.addColorStop(1, '#5a3aa8');
      // dôme : demi-ellipse haute + bord avant de la base (perspective iso)
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(c[0], c[1], r, r * 0.95, 0, Math.PI, 2 * Math.PI); ctx.ellipse(c[0], c[1], r, r * 0.5, 0, 0, Math.PI); ctx.fill();
      ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#d9c8ff';
      ctx.beginPath(); ctx.ellipse(c[0], c[1] - r * 0.9, r * 0.5, r * 0.15, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      const a0 = artP(u1 - 0.22, v0 + 0.22, H), a1 = artP(u1 - 0.22, v0 + 0.22, H + 18);
      ctx.strokeStyle = '#6a6f80'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a1[0], a1[1]); ctx.stroke();
      ctx.fillStyle = '#9fe6ff'; ctx.beginPath(); ctx.arc(a1[0], a1[1], 1.6, 0, Math.PI * 2); ctx.fill();
      return H + r + 6;
    }
    case 'space_center': return artSpaceCenter(b, u0, v0, u1, v1, rng);
    default: {
      // usine non dessinée spécifiquement : hangar générique à sa couleur
      if(!d?.ind) return null;
      artGround(u0 + 0.03, v0 + 0.03, u1 - 0.03, v1 - 0.03, '#8b8f93');
      hall(shade(d.col || '#7a8088', 0.15), shade(d.col || '#7a8088', -0.4), {});
      artChimney(u0 + 0.22, v0 + 0.22, H, 12, '#6a6f75', 0.07);
      return H + 12;
    }
  }
}

// ---------- centre spatial ----------
// Pas de tir dans l'emprise tournée (fractions de rw/rh) : partagé avec l'animation
// de décollage (drawRocketFx, 07_rendering.js) pour que la fusée parte du bon endroit.
const SPACE_PAD_U = 0.68, SPACE_PAD_V = 0.32, SPACE_PAD_Z = 4;
const rocketHeightPx = b => 20 * Math.max(b.w || 3, b.h || 3);
// La fusée est-elle visible sur le pas de tir ? (en vol : non ; en attente de pièces : non)
const spacePadHasRocket = b => b.spacePhase !== 'flight' && (b.prog || 0) > 0;
// Fusée verticale dont la base est au point écran (x,y), hauteur H px.
function drawRocketShape(x, y, H){
  const w = H * 0.17, nose = H * 0.26, body = H - nose;
  ctx.save();
  // ailerons
  ctx.fillStyle = '#c94a3a';
  ctx.beginPath(); ctx.moveTo(x - w / 2, y - H * 0.22); ctx.lineTo(x - w * 1.15, y); ctx.lineTo(x - w / 2, y); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + w / 2, y - H * 0.22); ctx.lineTo(x + w * 1.15, y); ctx.lineTo(x + w / 2, y); ctx.closePath(); ctx.fill();
  // corps
  const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  g.addColorStop(0, '#b9c0c8'); g.addColorStop(0.45, '#ffffff'); g.addColorStop(1, '#9aa2ab');
  ctx.fillStyle = g; ctx.fillRect(x - w / 2, y - body, w, body);
  // bandes et hublot
  ctx.fillStyle = '#2f3a48'; ctx.fillRect(x - w / 2, y - body * 0.55, w, body * 0.07);
  ctx.fillStyle = '#c94a3a'; ctx.fillRect(x - w / 2, y - body * 0.18, w, body * 0.06);
  ctx.fillStyle = '#5ab8e8'; ctx.beginPath(); ctx.arc(x, y - body * 0.78, w * 0.22, 0, Math.PI * 2); ctx.fill();
  // coiffe
  ctx.fillStyle = '#c94a3a';
  ctx.beginPath(); ctx.moveTo(x - w / 2, y - body); ctx.quadraticCurveTo(x - w * 0.42, y - body - nose * 0.7, x, y - H); ctx.quadraticCurveTo(x + w * 0.42, y - body - nose * 0.7, x + w / 2, y - body); ctx.closePath(); ctx.fill();
  // tuyère
  ctx.fillStyle = '#3a3f46'; ctx.fillRect(x - w * 0.3, y, w * 0.6, H * 0.04);
  ctx.restore();
}
// Flamme des moteurs (k : 0 → 1 pendant l'allumage).
function drawRocketFlame(x, y, H, k){
  const w = H * 0.17, len = H * (0.25 + 0.45 * k) * (0.9 + Math.random() * 0.2);
  ctx.save();
  ctx.globalAlpha *= 0.9;
  const g = ctx.createLinearGradient(0, y, 0, y + len);
  g.addColorStop(0, '#fff6c8'); g.addColorStop(0.35, '#ffb43c'); g.addColorStop(1, 'rgba(255,90,30,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(x - w * 0.36, y + 2); ctx.quadraticCurveTo(x, y + len * 1.1, x + w * 0.36, y + 2); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function artSpaceCenter(b, u0, v0, u1, v1, rng){
  const wu = u1 - u0, wv = v1 - v0;
  artGround(u0 + 0.02, v0 + 0.02, u1 - 0.02, v1 - 0.02, '#9aa0a6');
  // allées et marquages
  ctx.strokeStyle = 'rgba(242,194,48,.75)'; ctx.lineWidth = 1;
  const m0 = artP(u0 + 0.1, v0 + wv * 0.5, 0.8), m1 = artP(u1 - 0.1, v0 + wv * 0.5, 0.8);
  ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(m0[0], m0[1]); ctx.lineTo(m1[0], m1[1]); ctx.stroke(); ctx.setLineDash([]);
  // réservoirs d'ergols (fond)
  artSphere(u0 + wu * 0.2, v0 + wv * 0.16, 1, 7, '#e8ecef');
  artSphere(u0 + wu * 0.36, v0 + wv * 0.12, 1, 5.5, '#d8b23a');
  // pas de tir : dalle, carneau, tour de lancement rouge en treillis
  const pu = u0 + wu * SPACE_PAD_U, pv = v0 + wv * SPACE_PAD_V;
  artBox(pu - 0.42, pv - 0.42, pu + 0.42, pv + 0.42, 0, SPACE_PAD_Z, '#b4b8bc', { topCol:'#c9cdd1' });
  artPoly([artP(pu - 0.12, pv + 0.1, SPACE_PAD_Z + 0.1), artP(pu + 0.12, pv + 0.1, SPACE_PAD_Z + 0.1), artP(pu + 0.12, pv + 0.42, SPACE_PAD_Z + 0.1), artP(pu - 0.12, pv + 0.42, SPACE_PAD_Z + 0.1)], '#2a2e33');
  const tu = pu - 0.3, tv = pv - 0.3, TH_ = rocketHeightPx(b) + 12;
  ctx.strokeStyle = '#b8402f'; ctx.lineWidth = 1.4;
  for(const [du, dv] of [[-0.07, -0.07], [0.07, -0.07], [0.07, 0.07], [-0.07, 0.07]]){
    const a = artP(tu + du, tv + dv, SPACE_PAD_Z), e = artP(tu + du, tv + dv, SPACE_PAD_Z + TH_);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
  }
  ctx.lineWidth = 0.7;
  for(let z = 6; z < TH_; z += 6){
    const a = artP(tu - 0.07, tv + 0.07, SPACE_PAD_Z + z), c = artP(tu + 0.07, tv + 0.07, SPACE_PAD_Z + z + 6), e = artP(tu + 0.07, tv - 0.07, SPACE_PAD_Z + z);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
  }
  // bras d'accès vers la fusée
  const arm0 = artP(tu, tv, SPACE_PAD_Z + TH_ * 0.7), arm1 = artP(pu - 0.04, pv - 0.04, SPACE_PAD_Z + TH_ * 0.7);
  ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(arm0[0], arm0[1]); ctx.lineTo(arm1[0], arm1[1]); ctx.stroke();
  const p = artP(pu, pv, SPACE_PAD_Z);
  if(spacePadHasRocket(b)) drawRocketShape(p[0], p[1], rocketHeightPx(b));
  // bâtiment d'assemblage (avant-gauche) : grand volume blanc, porte haute, drapeau
  const vu0 = u0 + 0.12, vv0 = v0 + wv * 0.56, vu1 = u0 + wu * 0.44, vv1 = v1 - 0.1;
  const VH = 30 + Math.max(b.w, b.h) * 4;
  artShadow(vu0, vv0, vu1, vv1, VH + 6);
  artBox(vu0, vv0, vu1, vv1, 0, VH, '#e8ecef', { topCol:'#cdd2d7' });
  artWindow('r', vu1, vv0 + (vv1 - vv0) * 0.3, vv0 + (vv1 - vv0) * 0.7, 0, VH - 6, '#5a6470');
  artWindow('l', vv1, vu0 + (vu1 - vu0) * 0.15, vu0 + (vu1 - vu0) * 0.45, VH - 12, VH - 4, '#2f5fa8');
  artWindow('l', vv1, vu0 + (vu1 - vu0) * 0.55, vu0 + (vu1 - vu0) * 0.85, VH - 12, VH - 4, '#c94a3a');
  // centre de contrôle (avant-droite) + antenne parabolique
  const cu0 = u0 + wu * 0.58, cv0 = v0 + wv * 0.66, cu1 = u1 - 0.12, cv1 = v1 - 0.12;
  artBox(cu0, cv0, cu1, cv1, 0, 10, '#c9d1da', { topCol:'#aeb7c1' });
  artWindowGrid(cu0, cv0, cu1, cv1, 0, 10, 5, rng, { perTile:4, lit:0.8, glow:'rgba(160,220,255,.95)' });
  const dish = artP((cu0 + cu1) / 2, (cv0 + cv1) / 2, 18);
  ctx.strokeStyle = '#7a828c'; ctx.lineWidth = 1.2;
  const dishFoot = artP((cu0 + cu1) / 2, (cv0 + cv1) / 2, 10);
  ctx.beginPath(); ctx.moveTo(dishFoot[0], dishFoot[1]); ctx.lineTo(dish[0], dish[1]); ctx.stroke();
  ctx.fillStyle = '#eef1f4'; ctx.beginPath(); ctx.ellipse(dish[0], dish[1] - 3, 7, 4, -0.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#9aa2ab'; ctx.lineWidth = 0.8; ctx.stroke();
  return Math.max(VH, rocketHeightPx(b) + SPACE_PAD_Z) + 6;
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
    case 'air_runway': {
      // Piste : bitume, bords, ligne axiale en pointillés, seuil rayé aux extrémités de la file
      const nk = airNeighborKey(b);                       // [+x, -x, +y, -y]
      const alongX = nk[0] === 'r' || nk[1] === 'r' || (nk[2] !== 'r' && nk[3] !== 'r');
      const [wx, wy] = alongX ? [1, 0] : [0, 1];
      const [du, dv] = rotDir(wx, wy);
      const cu0 = (u0 + u1) / 2, cv0 = (v0 + v1) / 2;
      artGround(u0, v0, u1, v1, '#3d4247', 0.4);
      const pa = artP(cu0 - du * 0.5, cv0 - dv * 0.5, 0.8), pb = artP(cu0 + du * 0.5, cv0 + dv * 0.5, 0.8);
      ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke(); ctx.restore();
      // bords latéraux (perpendiculaires à l'axe)
      for(const s of [-1, 1]){
        const e0 = artP(cu0 - du * 0.5 - dv * 0.42 * s, cv0 - dv * 0.5 + du * 0.42 * s, 0.8);
        const e1 = artP(cu0 + du * 0.5 - dv * 0.42 * s, cv0 + dv * 0.5 + du * 0.42 * s, 0.8);
        ctx.strokeStyle = '#d8d8d8'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(e0[0], e0[1]); ctx.lineTo(e1[0], e1[1]); ctx.stroke();
      }
      // seuil rayé : extrémité de file (aucune piste dans cette direction)
      const endPlus = alongX ? nk[0] !== 'r' : nk[2] !== 'r', endMinus = alongX ? nk[1] !== 'r' : nk[3] !== 'r';
      for(const [on, sg] of [[endPlus, 1], [endMinus, -1]]){
        if(!on) continue;
        for(let k = -3; k <= 3; k++){
          const bu = cu0 + du * 0.38 * sg + (-dv) * 0.1 * k, bv = cv0 + dv * 0.38 * sg + du * 0.1 * k;
          const s0 = artP(bu, bv, 0.9), s1 = artP(bu + du * 0.1 * sg, bv + dv * 0.1 * sg, 0.9);
          ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(s0[0], s0[1]); ctx.lineTo(s1[0], s1[1]); ctx.stroke();
        }
      }
      // sens de la piste : une seule flèche blanche, sur la case de seuil (début de la piste)
      const run = airportOf(b)?.runs.find(r => r.x0 === b.x && r.y0 === b.y);
      if(run){
        const sg = b.runwayRev ? -1 : 1;
        const tip = artP(cu0 + du * 0.3 * sg, cv0 + dv * 0.3 * sg, 1), base0 = artP(cu0 - du * 0.1 * sg, cv0 - dv * 0.1 * sg, 1);
        const w1 = artP(cu0 - du * 0.05 * sg - dv * 0.14, cv0 - dv * 0.05 * sg + du * 0.14, 1), w2 = artP(cu0 - du * 0.05 * sg + dv * 0.14, cv0 - dv * 0.05 * sg - du * 0.14, 1);
        artPoly([tip, w1, base0, w2], '#f2f2f2');
      }
      return artP(cu, cv, 2);
    }
    case 'air_terminal': {
      // Gare d'aéroport : tarmac + hall vitré ; les murs se prolongent vers les gares voisines (fusion)
      const nk = airNeighborKey(b);
      artGround(u0, v0, u1, v1, '#aeb6be', 0.5);
      const ju = nk[0] === 't' ? 0 : 0.1, jv = nk[2] === 't' ? 0 : 0.1;
      const ku = nk[1] === 't' ? 0 : 0.1, kv = nk[3] === 't' ? 0 : 0.1;
      artHall(u0 + ku, v0 + kv, u1 - ju, v1 - jv, 13, '#c9d3dc', '#56616b', rng, { roofH:3 });
      artWindow('r', u1 - jv, v0 + 0.15, v1 - 0.15, 3, 8, 'rgba(110,160,200,.85)');
      return artP(cu, cv, 17);
    }
    case 'air_taxi': {
      // Voie de circulation : bande plus étroite que la piste, ligne jaune au centre,
      // qui se prolonge vers chaque pièce d'aéroport voisine (4 directions monde)
      const nk = airNeighborKey(b);
      artGround(u0, v0, u1, v1, '#8d949b', 0.4);
      const cu0 = (u0 + u1) / 2, cv0 = (v0 + v1) / 2;
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]].filter((d, i) => nk[i] !== '-');
      if(!dirs.length) dirs.push([1,0], [-1,0]);
      for(const [wx, wy] of dirs){
        const [du, dv] = rotDir(wx, wy);
        const pu = -dv, pv = du; // perpendiculaire
        const a0 = [cu0 - pu * 0.2, cv0 - pv * 0.2], a1 = [cu0 + pu * 0.2, cv0 + pv * 0.2];
        const e0 = [a0[0] + du * 0.5, a0[1] + dv * 0.5], e1 = [a1[0] + du * 0.5, a1[1] + dv * 0.5];
        artPoly([artP(a0[0], a0[1], 0.6), artP(a1[0], a1[1], 0.6), artP(e1[0], e1[1], 0.6), artP(e0[0], e0[1], 0.6)], '#4d5259');
        const l0 = artP(cu0, cv0, 0.9), l1 = artP(cu0 + du * 0.5, cv0 + dv * 0.5, 0.9);
        ctx.strokeStyle = '#f2c230'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(l0[0], l0[1]); ctx.lineTo(l1[0], l1[1]); ctx.stroke();
      }
      artPoly([artP(cu0 - 0.2, cv0 - 0.2, 0.6), artP(cu0 + 0.2, cv0 - 0.2, 0.6), artP(cu0 + 0.2, cv0 + 0.2, 0.6), artP(cu0 - 0.2, cv0 + 0.2, 0.6)], '#4d5259');
      return artP(cu, cv, 2);
    }
    case 'air_tower': {
      // Tour de contrôle : socle, fût, cabine vitrée débordante, toit ; le radar rotatif est un overlay animé
      artGround(u0, v0, u1, v1, '#aeb6be', 0.5);
      artBox(u0 + 0.22, v0 + 0.22, u1 - 0.22, v1 - 0.22, 0, 7, '#b9c2cb');
      artCylinder(cu, cv, 0.1, 7, 38, '#d8dee4', { top:false });
      artBox(cu - 0.22, cv - 0.22, cu + 0.22, cv + 0.22, 38, 47, '#7fa8c8', { topCol:'#55606b' });
      artBox(cu - 0.25, cv - 0.25, cu + 0.25, cv + 0.25, 47, 50, '#4a5560');
      const m0 = artP(cu, cv, 50), m1 = artP(cu, cv, 57);
      ctx.strokeStyle = '#6b7580'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(m0[0], m0[1]); ctx.lineTo(m1[0], m1[1]); ctx.stroke();
      return artP(cu, cv, 57);
    }
    case 'air_parking': {
      // Parking d'avion : aire bétonnée, cadre peint et marquage « P »
      artGround(u0, v0, u1, v1, '#9aa1a8', 0.4);
      const pc = [artP(u0 + 0.08, v0 + 0.08, 0.7), artP(u1 - 0.08, v0 + 0.08, 0.7), artP(u1 - 0.08, v1 - 0.08, 0.7), artP(u0 + 0.08, v1 - 0.08, 0.7)];
      ctx.strokeStyle = '#f2c230'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(pc[0][0], pc[0][1]);
      for(let k = 1; k < 4; k++) ctx.lineTo(pc[k][0], pc[k][1]);
      ctx.closePath(); ctx.stroke();
      const lb = artP(cu, cv, 0.9);
      ctx.fillStyle = 'rgba(245,245,245,.92)'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('P', lb[0], lb[1]);
      return artP(cu, cv, 2);
    }
    case 'air_deco': {
      // Décor : pelouse, allée, arbuste, lampadaire
      const style = Number.isInteger(b.decor) ? b.decor % AIR_DECO_STYLES : artVariantOf(b) % AIR_DECO_STYLES;
      switch(style){
        case 1: { // parking : bitume, places marquées, deux voitures
          artGround(u0, v0, u1, v1, '#5d6268', 0.4);
          ctx.strokeStyle = 'rgba(245,245,245,.85)'; ctx.lineWidth = 0.9;
          for(let k = 0; k <= 4; k++){
            const v = v0 + 0.1 + (v1 - v0 - 0.2) * k / 4, a = artP(u0 + 0.1, v, 0.5), e = artP(u0 + 0.42, v, 0.5);
            ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
          }
          const cars = ['#c0392b', '#2e6fb5', '#e8e8e8', '#e0b030'];
          artBox(u0 + 0.16, v0 + 0.14, u0 + 0.38, v0 + 0.3, 0.6, 3.6, cars[Math.floor(rng() * 4)], { edges:false });
          artBox(u0 + 0.16, v0 + 0.64, u0 + 0.38, v0 + 0.8, 0.6, 3.6, cars[Math.floor(rng() * 4)], { edges:false });
          artLamp(u1 - 0.18, v1 - 0.2);
          return artP(cu, cv, 5);
        }
        case 2: { // parterres fleuris entourés de buis
          artGround(u0, v0, u1, v1, '#79b05a', 0.4);
          artFlowerBed(u0 + 0.12, v0 + 0.12, u1 - 0.12, v0 + 0.44, rng);
          artFlowerBed(u0 + 0.12, v0 + 0.56, u1 - 0.12, v1 - 0.12, rng);
          return artP(cu, cv, 5);
        }
        case 3: { // placette avec fontaine
          artGround(u0, v0, u1, v1, '#d9cfb4', 0.4);
          artGround(u0 + 0.06, v0 + 0.06, u1 - 0.06, v1 - 0.06, '#8fbf6a', 0.5);
          artFountain(cu, cv, 0.2);
          artBush(u0 + 0.16, v1 - 0.16, 3, '#3f8f3a');
          return artP(cu, cv, 12);
        }
        case 4: { // balisage : bandes de gravier, plots et feux orange
          artGround(u0, v0, u1, v1, '#aab0a0', 0.4);
          artGround(u0 + 0.4, v0, u1 - 0.4, v1, '#d9cfb4', 0.5);
          for(const [u, v] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.5], [0.8, 0.5], [0.2, 0.8], [0.8, 0.8]]){
            const p = artP(u0 + (u1 - u0) * u, v0 + (v1 - v0) * v, 0.5), q = artP(u0 + (u1 - u0) * u, v0 + (v1 - v0) * v, 5);
            ctx.strokeStyle = '#5a5f66'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
            ctx.fillStyle = '#ff9a3c'; ctx.beginPath(); ctx.arc(q[0], q[1], 1.7, 0, Math.PI * 2); ctx.fill();
          }
          return artP(cu, cv, 5);
        }
        case 5: { // manche à air sur pelouse
          artGround(u0, v0, u1, v1, '#79b05a', 0.4);
          const p = artP(cu, cv, 0.5), q = artP(cu, cv, 20);
          ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
          for(let k = 0; k < 4; k++){
            ctx.fillStyle = k % 2 ? '#f4f4f4' : '#e8573a';
            ctx.beginPath(); ctx.moveTo(q[0] + k * 3.2, q[1] + k * 0.6); ctx.lineTo(q[0] + k * 3.2 + 3.2, q[1] + k * 0.6 + 0.7);
            ctx.lineTo(q[0] + k * 3.2 + 3.2, q[1] + k * 0.6 + 3.1); ctx.lineTo(q[0] + k * 3.2, q[1] + k * 0.6 + 4); ctx.closePath(); ctx.fill();
          }
          artBush(u0 + 0.18, v1 - 0.18, 3, '#3f8f3a');
          return artP(cu, cv, 14);
        }
        default: { // pelouse, allée, arbres, lampadaire
          artGround(u0, v0, u1, v1, '#79b05a', 0.4);
          artGround(u0 + 0.38, v0, u1 - 0.38, v1, '#d9cfb4', 0.5);
          artTree(u0 + 0.2, v0 + 0.22, 11 + rng() * 5, '#3f8f3a');
          if(rng() > 0.45) artTree(u1 - 0.22, v1 - 0.2, 9 + rng() * 4, '#4a9b42');
          const l0 = artP(u1 - 0.2, v0 + 0.2, 0), l1 = artP(u1 - 0.2, v0 + 0.2, 9);
          ctx.strokeStyle = '#5a5f66'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(l0[0], l0[1]); ctx.lineTo(l1[0], l1[1]); ctx.stroke();
          ctx.fillStyle = '#ffe9a0'; ctx.beginPath(); ctx.arc(l1[0], l1[1], 1.6, 0, Math.PI * 2); ctx.fill();
          return artP(cu, cv, 6);
        }
      }
    }
    case 'plane_depot': {
      // Dépôt d'aéroport = hangar : grand volume à toit en voûte (nervures), large porte
      // coulissante côté piste / taxi, aire bétonnée devant
      artGround(u0 + 0.01, v0 + 0.01, u1 - 0.01, v1 - 0.01, '#8d949b');
      const hu0 = u0 + 0.08, hv0 = v0 + 0.1, hu1 = u1 - 0.2, hv1 = v1 - 0.1;
      artBox(hu0, hv0, hu1, hv1, 0, 15, '#b6c1cc', { edges:true });
      // toit en voûte : bandes de plus en plus hautes vers l'axe central
      const nb = 7;
      for(let k = 0; k < nb; k++){
        const t0 = k / nb, t1 = (k + 1) / nb;
        const z0 = 15 + 9 * Math.sin(Math.PI * t0), z1 = 15 + 9 * Math.sin(Math.PI * t1);
        const sv0 = hv0 + (hv1 - hv0) * t0, sv1 = hv0 + (hv1 - hv0) * t1;
        artPoly([artP(hu0, sv0, z0), artP(hu1, sv0, z0), artP(hu1, sv1, z1), artP(hu0, sv1, z1)], k % 2 ? '#5f7388' : '#6a7f95', 'rgba(20,30,40,.35)', 0.6);
      }
      // grande porte sur la face avant (côté u1)
      artWindow('r', hu1, hv0 + 0.1, hv1 - 0.1, 0, 12, 'rgba(38,46,58,.92)');
      for(let k = 1; k < 5; k++){
        const sv = hv0 + 0.1 + (hv1 - hv0 - 0.2) * k / 5;
        const a = artP(hu1, sv, 0.5), e = artP(hu1, sv, 12);
        ctx.strokeStyle = 'rgba(190,200,212,.55)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
      }
      // chevron de sécurité jaune au-dessus de la porte
      const y0 = artP(hu1, hv0 + 0.1, 13), y1 = artP(hu1, hv1 - 0.1, 13);
      ctx.strokeStyle = '#f2c230'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(y0[0], y0[1]); ctx.lineTo(y1[0], y1[1]); ctx.stroke();
      return artP(cu, cv, 26);
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
        case 'house': tc = artHouse(b, u0, v0, u1, v1, rng, d); break;
        case 'duplex': case 'row': tc = artRowHouse(b, u0, v0, u1, v1, rng, d); break;
        case 'residence': tc = artApartment(b, u0, v0, u1, v1, rng, d, 3, { perTile:2.2 }); break;
        case 'tower':     tc = artApartment(b, u0, v0, u1, v1, rng, d, 6, { perTile:2.4 }); break;
        case 'bigtower':  tc = artApartment(b, u0, v0, u1, v1, rng, d, 9, { perTile:2.4, greenRoof:true }); break;
        case 'tower3':    tc = artTower(b, u0, v0, u1, v1, rng, d, 12); break;
        case 'sky':       tc = artTower(b, u0, v0, u1, v1, rng, d, 16); break;
        case 'lux_house':  tc = artLuxHouse(b, u0, v0, u1, v1, rng); break;
        case 'lux_villa':  tc = artLuxVilla(b, u0, v0, u1, v1, rng); break;
        case 'lux_manor':  tc = artLuxManor(b, u0, v0, u1, v1, rng); break;
        case 'lux_estate': tc = artLuxEstate(b, u0, v0, u1, v1, rng); break;
      }
    } else if(d.ind || b.type === 'plant'){
      _artChimneys = [];
      tc = artIndustry(b, u0, v0, u1, v1, rng, d, bCol);
      if(_artChimneys.length && b.type !== 'plant') BUILDING_CHIMNEYS.set(b, { rot, pts:_artChimneys });
      else BUILDING_CHIMNEYS.delete(b);
      _artChimneys = null;
      if(tc && d.ic) artSign(tc[0] + 10, tc[1] + 2, d.ic, b.type === 'mine' ? (b.ore === 'coal' ? '#b0b0c0' : (RES[b.ore]?.c || '#d98a4f')) : '#ffe082');
    } else {
      tc = artStorage(b, u0, v0, u1, v1, rng, d, bCol);
      // gares d'aéroport fusionnées : un seul badge, sur la gare principale (comme une gare ferroviaire)
      if(tc && d.ic && b.type !== 'bus_stop' && (!AIR_TYPES.includes(b.type) || (b.type === 'air_terminal' && airportRepresentative(b) === b))) artSign(tc[0] + 10, tc[1] + 2, d.ic, '#9fd0ff');
    }
  } finally {
    ctx.restore();
    _artLift = 0;
  }
  return tc;
}
