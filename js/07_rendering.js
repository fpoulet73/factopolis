function addFloat(x,y,txt,col){
  if(floats.length > 60) return;
  floats.push({ x:x*TILE+TILE/2, y:y*TILE, txt, col, life:1.3 });
}

// ---------- rendu isométrique ----------
function hash(x,y){ return ((x*73856093) ^ (y*19349663)) >>> 0; }

const _shadeCache = {};
function shade(hex,f){
  const k = hex+f;
  let c = _shadeCache[k];
  if(c) return c;
  const n = parseInt(hex.slice(1),16);
  let r = n>>16&255, g = n>>8&255, b = n&255;
  if(f>=0){ r += (255-r)*f; g += (255-g)*f; b += (255-b)*f; }
  else    { r *= 1+f; g *= 1+f; b *= 1+f; }
  return _shadeCache[k] = 'rgb('+(r|0)+','+(g|0)+','+(b|0)+')';
}

function quad(a,b,c,d){
  ctx.beginPath();
  ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]);
  ctx.lineTo(c[0],c[1]); ctx.lineTo(d[0],d[1]);
  ctx.closePath(); ctx.fill();
}

// prisme iso : base [u0,v0]-[u1,v1] (tuiles tournées), hauteur hp px, surélévation lift
// renvoie le centre du toit
function prism(u0,v0,u1,v1,hp,col,lift){
  lift = lift||0;
  const lf = p=> [p[0], p[1]-lift];
  const A = lf(iso(u0,v0)), B = lf(iso(u1,v0)), C = lf(iso(u1,v1)), D = lf(iso(u0,v1));
  const up = p=> [p[0], p[1]-hp];
  ctx.fillStyle = shade(col,-0.22); quad(B,C,up(C),up(B));        // face droite
  ctx.fillStyle = shade(col,-0.45); quad(C,D,up(D),up(C));        // face gauche
  ctx.fillStyle = shade(col, 0.20); quad(up(A),up(B),up(C),up(D)); // toit
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(...up(A)); ctx.lineTo(...up(B)); ctx.lineTo(...up(C)); ctx.lineTo(...up(D));
  ctx.closePath(); ctx.stroke();
  return [ (A[0]+C[0])/2, (A[1]+C[1])/2 - hp ];
}

function diamond(rx,ry,w,h){
  w = w||1; h = h||w;
  const A = iso(rx,ry), B = iso(rx+w,ry), C = iso(rx+w,ry+h), D = iso(rx,ry+h);
  ctx.beginPath();
  ctx.moveTo(A[0],A[1]); ctx.lineTo(B[0],B[1]);
  ctx.lineTo(C[0],C[1]); ctx.lineTo(D[0],D[1]);
  ctx.closePath();
}

const GRASS_COLS = ['#74b048','#6ea944','#7ab84d','#68a23f'];
const WATER_COLS = ['#3590cf','#3187c2'];

function drawTree(rx,ry,x,y){
  const c = iso(rx+0.5, ry+0.5);
  const h = 13 + (hash(x,y)&7);
  ctx.fillStyle = 'rgba(0,0,0,.16)';
  ctx.beginPath(); ctx.ellipse(c[0]+2, c[1]+2, 9, 4.5, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#6b4a2a';
  ctx.fillRect(c[0]-1.5, c[1]-h*0.4, 3, h*0.4+1);
  const tri = (top, base, hw, col)=>{
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(c[0], c[1]-top);
    ctx.lineTo(c[0]+hw, c[1]-base);
    ctx.lineTo(c[0]-hw, c[1]-base);
    ctx.closePath(); ctx.fill();
  };
  tri(h+9,  h*0.25, 9.5, '#2e7d32');
  tri(h+14, h*0.55, 6.5, '#43a047');
}

function drawBuilding(b){
  const d = BUILD[b.type];
  const [r1x,r1y] = rotIdx(b.x, b.y);
  const [r2x,r2y] = rotIdx(b.x+b.w-1, b.y+b.h-1);
  const rx0 = Math.min(r1x,r2x), ry0 = Math.min(r1y,r2y);
  // l'empreinte tournée échange largeur et profondeur selon l'orientation
  const rw = Math.abs(r1x-r2x)+1, rh = Math.abs(r1y-r2y)+1;
  // les sites industriels fusionnés gagnent en hauteur avec leur taille
  const hgt = d.ind ? d.hgt*(1+0.18*(Math.max(b.w,b.h)-1)) : d.hgt;
  // Couleur spécifique pour les mines selon le minerai
  const bCol = (b.type==='mine' && b.ore) ? (b.ore==='iron' ? '#8a5c3a' : '#4a4a5a') : d.col;
  const tc = prism(rx0, ry0, rx0+rw, ry0+rh, hgt, bCol);

  // fenêtres éclairées sur les faces des grands logements
  if(!drawFast && d.resid && d.hgt >= 40){
    const B = iso(rx0+rw,ry0), C = iso(rx0+rw,ry0+rh), D = iso(rx0,ry0+rh);
    const rows = Math.max(3, Math.min(9, Math.floor(d.hgt/14)));
    const face = (P,Q,tiles,seed)=>{
      const cols = Math.min(8, 3*tiles);
      for(let r=0;r<rows;r++) for(let cI=0;cI<cols;cI++){
        const s0 = (cI+0.25)/cols, s1 = (cI+0.80)/cols;
        const t0 = (0.08 + r*0.86/rows)*d.hgt, t1 = t0 + 0.45*0.86/rows*d.hgt;
        const p0 = [P[0]+(Q[0]-P[0])*s0, P[1]+(Q[1]-P[1])*s0];
        const p1 = [P[0]+(Q[0]-P[0])*s1, P[1]+(Q[1]-P[1])*s1];
        ctx.fillStyle = (hash(b.x*7+r+seed, b.y*13+cI)&3)
          ? 'rgba(255,236,170,.65)' : 'rgba(22,32,48,.55)';
        quad([p0[0],p0[1]-t0],[p1[0],p1[1]-t0],[p1[0],p1[1]-t1],[p0[0],p0[1]-t1]);
      }
    };
    face(B,C,rh,1); face(C,D,rw,2);
  }

  // icône sur le toit
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = (TH*(0.62+0.28*(Math.max(b.w,b.h)-1)))+'px "Segoe UI Emoji",sans-serif';
  if(b.type === 'mine' && b.ore){
    // Pioche colorée selon le minerai (fer = orange, charbon = gris clair)
    const oreColor = b.ore === 'iron' ? '#d98a4f' : '#b0b0c0';
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = oreColor;
    // fond coloré rond derrière l'icône
    const fs = TH*(0.62+0.28*(Math.max(b.w,b.h)-1));
    ctx.beginPath();
    ctx.arc(tc[0], tc[1], fs*0.55, 0, Math.PI*2);
    ctx.globalAlpha = 0.28;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillText(d.ic, tc[0], tc[1]+1);
    ctx.restore();
  } else {
    ctx.fillText(d.ic, tc[0], tc[1]+1);
  }

  // barre de progression
  const r = recipeOf(b);
  if(!drawFast && r && b.prog>0){
    const bw = TW*0.42*b.w;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(tc[0]-bw/2, tc[1]+TH*0.36, bw, 4);
    ctx.fillStyle = '#7fd96a';
    ctx.fillRect(tc[0]-bw/2, tc[1]+TH*0.36, bw*Math.min(1,b.prog/r.time), 4);
  }
  // habitants
  if(!drawFast && d.resid && b.pop>0){
    ctx.font = 'bold 11px sans-serif';
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 3;
    ctx.strokeText('👤'+b.pop, tc[0], tc[1]-TH*0.55);
    ctx.fillStyle = '#ffe9a0';
    ctx.fillText('👤'+b.pop, tc[0], tc[1]-TH*0.55);
  }
  // pas de route adjacente
  if(!drawFast && !adjRoadTiles(b).length){
    ctx.font = '14px "Segoe UI Emoji",sans-serif';
    ctx.fillText('⚠️', tc[0], tc[1]-TH*0.95);
  }
  // contour couleur propriétaire (multijoueur)
  if(!drawFast && !UI_OPTIONS.hideColorMarkers && b.owner && MP.connected){
    const ownerColor = (MP.players.find(p=>p.id===b.owner)||{}).color || '#aaa';
    ctx.strokeStyle = ownerColor; ctx.lineWidth = b===selected ? 3 : 1.5;
    diamond(rx0, ry0, rw, rh); ctx.stroke();
    // petit drapeau couleur en haut à gauche du toit
    ctx.fillStyle = ownerColor;
    ctx.beginPath(); ctx.arc(tc[0]-TW*rw*0.28, tc[1]-4, 4, 0, 7); ctx.fill();
  } else if(b===selected){
    // sélection solo
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    diamond(rx0, ry0, rw, rh); ctx.stroke();
  }
  // sélection par-dessus (multijoueur)
  if(b===selected && MP.connected){
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    diamond(rx0, ry0, rw, rh); ctx.stroke();
  }
  // Indicateur "en vente" : petit $ doré sur le dépôt
  if(!drawFast && b.type === 'depot' && b.sellTo && Object.values(b.sellTo).some(v=>v)){
    ctx.save();
    ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f0c060';
    ctx.fillText('$', tc[0] + TW*rw*0.3, tc[1] - 3);
    ctx.restore();
  }
  // Contour vert clignotant sur les dépôts éligibles lors de l'assignation de route (source)
  if(vehicleRouteMode && vehicleRouteMode.step === 'source' && b.type === 'depot'){
    const myOid = MP.connected ? MP.myId : null;
    if(b.owner != null && b.owner !== myOid){
      const vt = VEHICLE_TYPES[vehicleRouteMode.vehicle.vtype];
      if(vt.resources.some(r => b.sellTo?.[r])){
        ctx.strokeStyle = '#f0c060'; ctx.lineWidth = 1.5;
        ctx.setLineDash([4,3]);
        diamond(rx0, ry0, rw, rh); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
}

function drawWalker(wk){
  const a = wk.pts[wk.seg], b = wk.pts[Math.min(wk.seg+1, wk.pts.length-1)];
  const wx = a.x + (b.x-a.x)*wk.t, wy = a.y + (b.y-a.y)*wk.t;
  const [u,v] = rotF(wx/TILE, wy/TILE);
  const c = iso(u,v);
  const bob = Math.sin(gtime*12 + wk.phase)*1.1;
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath(); ctx.ellipse(c[0], c[1]+1, 3.2, 1.7, 0, 0, 7); ctx.fill();
  ctx.fillStyle = wk.col;                       // corps
  ctx.fillRect(c[0]-2, c[1]-8+bob, 4, 7);
  ctx.fillStyle = '#f0c8a0';                    // tête
  ctx.beginPath(); ctx.arc(c[0], c[1]-10+bob, 2.5, 0, 7); ctx.fill();
}

function drawHomeless(h){
  const [u,v] = rotF(h.x/TILE, h.y/TILE);
  const c = iso(u,v);
  const bob = Math.sin(gtime*4 + h.phase)*0.7;
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.beginPath(); ctx.ellipse(c[0], c[1]+1, 3.2, 1.7, 0, 0, 7); ctx.fill();
  ctx.fillStyle = h.col || playerColor(h.owner);
  ctx.fillRect(c[0]-2, c[1]-8+bob, 4, 7);
  ctx.fillStyle = '#f0c8a0';
  ctx.beginPath(); ctx.arc(c[0], c[1]-10+bob, 2.5, 0, 7); ctx.fill();
}

function drawWorkRadiusOverlay(center, radius, color, minRx, maxRx, minRy, maxRy){
  for(let ry=minRy; ry<=maxRy; ry++) for(let rx=minRx; rx<=maxRx; rx++){
    const [x,y] = invRotIdx(rx,ry);
    const d = Math.max(Math.abs(x-center.x), Math.abs(y-center.y));
    if(d > radius) continue;
    ctx.fillStyle = color + (Math.ceil(d) === radius ? '33' : '1a');
    diamond(rx,ry); ctx.fill();
    if(Math.ceil(d) === radius){
      ctx.strokeStyle = color + '99';
      ctx.lineWidth = 1;
      diamond(rx,ry); ctx.stroke();
    }
  }
}

function drawTruck(tk){
  const a = tk.pts[tk.seg], b = tk.pts[Math.min(tk.seg+1, tk.pts.length-1)];
  const wx = a.x + (b.x-a.x)*tk.t, wy = a.y + (b.y-a.y)*tk.t;
  const [u,v] = rotF(wx/TILE, wy/TILE);
  const [du,dv] = rotDir(b.x-a.x, b.y-a.y);
  const alongU = Math.abs(du) >= Math.abs(dv);
  const au = alongU ? 0.26 : 0.14, av = alongU ? 0.14 : 0.26;
  const c = iso(u,v);
  ctx.fillStyle = 'rgba(0,0,0,.20)';
  ctx.beginPath(); ctx.ellipse(c[0]+1, c[1]+1, 11, 5, 0, 0, 7); ctx.fill();
  prism(u-au, v-av, u+au, v+av, 5, '#39404c');
  prism(u-au*0.72, v-av*0.72, u+au*0.72, v+av*0.72, 7, RES[tk.res].c, 5);
}

function drawVehicleRoute(veh){
  if(!veh.vizRoute) return;
  const drawPath = (pts, color) => {
    if(!pts || pts.length < 2) return;
    ctx.beginPath();
    let first = true;
    for(const pt of pts){
      const [sx, sy] = worldPxToIso(pt.x, pt.y);
      if(first){ ctx.moveTo(sx, sy); first = false; }
      else ctx.lineTo(sx, sy);
    }
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.globalAlpha = 0.82;
    ctx.setLineDash([10, 6]);
    ctx.stroke();
    ctx.restore();
  };
  drawPath(veh.vizRoute.fwd, '#4dd9ff');   // cyan  : source → dest
  drawPath(veh.vizRoute.bwd, '#ffaa44');   // orange: dest   → source

  // Surligner les bâtiments source et destination
  const highlightBld = (b, col) => {
    if(!b || b.dead) return;
    const [r1x,r1y] = rotIdx(b.x, b.y);
    const [r2x,r2y] = rotIdx(b.x+b.w-1, b.y+b.h-1);
    const rx0 = Math.min(r1x,r2x), ry0 = Math.min(r1y,r2y);
    const rw = Math.abs(r1x-r2x)+1, rh = Math.abs(r1y-r2y)+1;
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.globalAlpha = 0.9;
    diamond(rx0, ry0, rw, rh); ctx.stroke();
    ctx.restore();
  };
  highlightBld(veh.source, '#4dd9ff');
  highlightBld(veh.dest,   '#ffaa44');
}

function drawTownLabels(){
  townLabelHits = [];
  if(!towns.length) return;
  const z = cam.z;
  for(const t of towns){
    const members = buildings.filter(b => !b.dead && b.townId === t.id && BUILD[b.type]?.resid);
    if(!members.length) continue;
    const isOwn = townOwnedBy(t);
    const isSelectedTown = t.id === selectedTownId;

    const pop = members.reduce((s, b) => s + (b.pop||0), 0);

    // Centroïde en tiles → position X centrale du label
    let sx = 0, sy = 0;
    for(const b of members){ sx += b.x + b.w/2; sy += b.y + b.h/2; }
    const cx = sx / members.length, cy = sy / members.length;
    const [ruc, rvc] = rotF(cx, cy);
    const [ix] = iso(ruc, rvc);

    // Trouver le point le plus haut (min Y iso) parmi tous les bâtiments du village
    let topIsoY = Infinity;
    for(const b of members){
      const [ru, rv] = rotF(b.x + b.w/2, b.y + b.h/2);
      const [, biy] = iso(ru, rv);
      const bTop = biy - BUILD[b.type].hgt;
      if(bTop < topIsoY) topIsoY = bTop;
    }
    const labelIy = topIsoY - 14; // marge au-dessus du toit le plus haut

    // Conversion iso → CSS pixels
    const cssX = (ix  - cam.x) * z;
    const cssY = (labelIy - cam.y) * z;

    if(cssX < -300 || cssX > W + 300 || cssY < -60 || cssY > H + 20) continue;

    const label = t.name + (pop > 0 ? ' · ' + pop + ' 👤' : '');

    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px "Segoe UI Emoji","Segoe UI",sans-serif';
    const tw = ctx.measureText(label).width;
    const pw = tw + 18, ph = 20;
    const bx = cssX - pw/2, by = cssY - ph/2;
    townLabelHits.push({ id:t.id, x:bx, y:by, w:pw, h:ph });

    // Fond pilule
    ctx.globalAlpha = isSelectedTown ? 0.96 : 0.88;
    ctx.fillStyle = isSelectedTown ? '#143659' : '#0c1a2b';
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(bx, by, pw, ph, 5);
    else ctx.rect(bx, by, pw, ph);
    ctx.fill();

    // Bordure dorée
    ctx.globalAlpha = isSelectedTown ? 0.95 : 0.65;
    ctx.strokeStyle = isSelectedTown ? '#7fb0ff' : (isOwn ? '#c9a830' : '#6e7480');
    ctx.lineWidth = isSelectedTown ? 2 : 1;
    ctx.stroke();

    // Texte
    ctx.globalAlpha = 1;
    ctx.fillStyle = isSelectedTown ? '#ffffff' : '#f0dc90';
    ctx.fillText(label, cssX, cssY);
    ctx.restore();
  }
}

function drawVehicle(veh){
  if(!veh.pts || !veh.pts.length) return;
  const a = veh.pts[veh.seg], b = veh.pts[Math.min(veh.seg+1, veh.pts.length-1)];
  const wx = a.x + (b.x-a.x)*veh.t, wy = a.y + (b.y-a.y)*veh.t;
  const [u,v] = rotF(wx/TILE, wy/TILE);
  const [du,dv] = rotDir(b.x-a.x, b.y-a.y);
  const alongU = Math.abs(du) >= Math.abs(dv);
  const au = alongU ? 0.30 : 0.18, av = alongU ? 0.18 : 0.30;
  const vt = VEHICLE_TYPES[veh.vtype];
  const c = iso(u, v);
  ctx.fillStyle = 'rgba(0,0,0,.20)';
  ctx.beginPath(); ctx.ellipse(c[0]+1, c[1]+1, 13, 6, 0, 0, 7); ctx.fill();
  prism(u-au, v-av, u+au, v+av, 6, '#39404c');
  prism(u-au*0.72, v-av*0.72, u+au*0.72, v+av*0.72, 9, vt.color, 6);
  if(!drawFast && veh.cargo > 0){
    const label = vt.icone + ' ' + veh.cargo;
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 2;
    ctx.strokeText(label, c[0], c[1] - TH);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, c[0], c[1] - TH);
  }
  // Cercle blanc si sélectionné
  if(veh === selectedVehicle){
    ctx.save();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.ellipse(c[0], c[1], 16, 8, 0, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }
}

const EXP_N_PIECES = 3; // pièces de puzzle par côté

// Badge de prix canvas (remplace les anciennes fonctions jigsawPath/expPieceTabs devenus inutiles)
function jigsawPath(cx, cy, w, h, tabs){
  const r  = Math.min(w, h) * 0.10; // rayon de coin
  const tr = Math.min(w, h) * 0.20; // rayon de tab/slot
  const x0 = cx - w/2, x1 = cx + w/2;
  const y0 = cy - h/2, y1 = cy + h/2;
  const PI = Math.PI;

  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);

  // Bord TOP (gauche → droite)
  if(tabs.top === 'tab'){
    ctx.lineTo(cx - tr, y0);
    ctx.arc(cx, y0, tr, PI, 0, false);   // tab vers le HAUT
    ctx.lineTo(x1 - r, y0);
  } else if(tabs.top === 'slot'){
    ctx.lineTo(cx - tr, y0);
    ctx.arc(cx, y0, tr, PI, 0, true);    // slot vers le BAS (rentrant)
    ctx.lineTo(x1 - r, y0);
  } else { ctx.lineTo(x1 - r, y0); }

  ctx.quadraticCurveTo(x1, y0, x1, y0 + r);

  // Bord RIGHT (haut → bas)
  if(tabs.right === 'tab'){
    ctx.lineTo(x1, cy - tr);
    ctx.arc(x1, cy, tr, PI*1.5, PI*0.5, false); // tab vers la DROITE
    ctx.lineTo(x1, y1 - r);
  } else if(tabs.right === 'slot'){
    ctx.lineTo(x1, cy - tr);
    ctx.arc(x1, cy, tr, PI*1.5, PI*0.5, true);  // slot vers la GAUCHE
    ctx.lineTo(x1, y1 - r);
  } else { ctx.lineTo(x1, y1 - r); }

  ctx.quadraticCurveTo(x1, y1, x1 - r, y1);

  // Bord BOTTOM (droite → gauche)
  if(tabs.bottom === 'tab'){
    ctx.lineTo(cx + tr, y1);
    ctx.arc(cx, y1, tr, 0, PI, false);   // tab vers le BAS
    ctx.lineTo(x0 + r, y1);
  } else if(tabs.bottom === 'slot'){
    ctx.lineTo(cx + tr, y1);
    ctx.arc(cx, y1, tr, 0, PI, true);    // slot vers le HAUT
    ctx.lineTo(x0 + r, y1);
  } else { ctx.lineTo(x0 + r, y1); }

  ctx.quadraticCurveTo(x0, y1, x0, y1 - r);

  // Bord LEFT (bas → haut)
  if(tabs.left === 'tab'){
    ctx.lineTo(x0, cy + tr);
    ctx.arc(x0, cy, tr, PI*0.5, PI*1.5, false); // tab vers la GAUCHE
    ctx.lineTo(x0, y0 + r);
  } else if(tabs.left === 'slot'){
    ctx.lineTo(x0, cy + tr);
    ctx.arc(x0, cy, tr, PI*0.5, PI*1.5, true);  // slot vers la DROITE
    ctx.lineTo(x0, y0 + r);
  } else { ctx.lineTo(x0, y0 + r); }

  ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
  ctx.closePath();
}

// Détermine les tabs d'une pièce selon sa position dans le côté
function expPieceTabs(side, pi, n){
  const t = { left:'flat', right:'flat', top:'flat', bottom:'flat' };
  // Face vers la carte = tab (s'emboîte sur le bord existant)
  if(side === 'right')  t.left   = 'tab';
  if(side === 'left')   t.right  = 'tab';
  if(side === 'bottom') t.top    = 'tab';
  if(side === 'top')    t.bottom = 'tab';
  // Interfaces entre pièces voisines : tab alternent avec slots
  if(side === 'right' || side === 'left'){
    if(pi < n-1) t.bottom = (pi%2===0) ? 'tab' : 'slot';
    if(pi > 0)   t.top    = ((pi-1)%2===0) ? 'slot' : 'tab';
  } else {
    if(pi < n-1) t.right = (pi%2===0) ? 'tab' : 'slot';
    if(pi > 0)   t.left  = ((pi-1)%2===0) ? 'slot' : 'tab';
  }
  return t;
}

function drawExpansionBadges(){
  if(drawFast) return;
  for(const exp of expansions){
    const isHov = exp === hoveredExpansion;
    const isSel = exp === selectedExpansion;
    const canAfford = myWallet().money >= exp.cost;
    // Centre ISO de la pièce
    const [ru, rv] = rotF(exp.cx, exp.cy);
    const [px, py] = iso(ru, rv);
    const pulse = 0.85 + 0.15 * Math.sin(gtime * 2.4 + exp.cx * 0.12);

    // Mini badge fond
    const R = TH * 1.35;
    ctx.save();
    ctx.beginPath(); ctx.arc(px, py, R, 0, Math.PI*2);
    ctx.fillStyle = isSel ? 'rgba(12,50,38,0.96)' : `rgba(8,25,20,${0.85*pulse})`;
    ctx.fill();
    ctx.strokeStyle = isSel ? 'rgba(60,240,150,1)' : `rgba(50,190,130,${0.65*(isHov?1.4:1)*pulse})`;
    ctx.lineWidth = isSel ? 2.5 : 1.5;
    ctx.stroke();
    ctx.restore();

    // Prix
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 4;
    ctx.fillStyle = canAfford ? '#ffe9a0' : '#ff9a8a';
    ctx.font = 'bold '+Math.round(TH*0.52)+'px "Segoe UI",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(exp.cost.toLocaleString()+'$', px, py);
    ctx.restore();
  }
}

function draw(){
  drawFast = performance.now() < zoomActiveUntil || Math.abs(targetCam.z - cam.z) > 0.006;
  // ciel
  ctx.setTransform(DPR,0,0,DPR,0,0);
  const sky = ctx.createLinearGradient(0,0,0,H);
  sky.addColorStop(0,'#1c2740');
  sky.addColorStop(1,'#0b101a');
  ctx.fillStyle = sky;
  ctx.fillRect(0,0,W,H);

  const z = cam.z;
  ctx.setTransform(DPR*z,0,0,DPR*z, -cam.x*DPR*z, -cam.y*DPR*z);

  // fenêtre visible en px iso
  const vx0 = cam.x - TW, vx1 = cam.x + W/z + TW;
  const vy0 = cam.y - TH*3 - 160, vy1 = cam.y + H/z + TH*2; // marge haute = gratte-ciel

  const sprites = [];

  const isoToTile = (px,py)=> [ (px/TW2 + py/TH2)/2, (py/TH2 - px/TW2)/2 ];
  const viewCorners = [
    isoToTile(vx0-TW, vy0-TH),
    isoToTile(vx1+TW, vy0-TH),
    isoToTile(vx0-TW, vy1+TH),
    isoToTile(vx1+TW, vy1+TH),
  ];
  let minRx = N-1, maxRx = 0, minRy = N-1, maxRy = 0;
  for(const [u,v] of viewCorners){
    minRx = Math.min(minRx, Math.floor(u)-2);
    maxRx = Math.max(maxRx, Math.ceil(u)+2);
    minRy = Math.min(minRy, Math.floor(v)-2);
    maxRy = Math.max(maxRy, Math.ceil(v)+2);
  }
  minRx = Math.max(0, minRx); minRy = Math.max(0, minRy);
  maxRx = Math.min(N-1, maxRx); maxRy = Math.min(N-1, maxRy);
  const radiusSel = selected && !selected.dead && BUILD[selected.type]?.resid ? {
    center: centerOfBuilding(selected),
    r: workRadiusOf(selected),
    color: playerColor(selected.owner),
  } : null;
  const depotRadiusSel = selected && !selected.dead && selected.type === 'depot' ? {
    center: centerOfBuilding(selected),
    r: depotRadiusOf(selected),
  } : null;
  const tankRadiusSel = selected && !selected.dead && selected.type === 'tank' ? {
    center: centerOfBuilding(selected),
    r: tankRadiusOf(selected),
  } : null;
  const indRadiusSel = selected && !selected.dead && BUILD[selected.type]?.ind ? {
    center: centerOfBuilding(selected),
    r: indRadiusOf(selected),
  } : null;

  // --- passe 1 : sol (ordre ligne par ligne = peintre) ---
  for(let ry=minRy; ry<=maxRy; ry++) for(let rx=minRx; rx<=maxRx; rx++){
    const px = (rx-ry)*TW2, py = (rx+ry)*TH2;
    if(px < vx0-TW || px > vx1 || py < vy0 || py > vy1) continue;
    const [x,y] = invRotIdx(rx,ry);
    if(x<0||y<0||x>=N||y>=N) continue;
    const i = y*N+x, t = terrain[i];

    // Tuiles hors zone jouable : zones d'expansion ou void
    const inPlay = !!mapMask && mapMask[i]===1;
    if(!inPlay){
      const expZone = expansions.find(e=>e.inPiece(x,y));
      if(!expZone) continue;
      // Terrain dim + overlay sarcelle teinté par pièce
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = t===T.WATER ? WATER_COLS[hash(x,y)&1] : GRASS_COLS[hash(x,y)&3];
      diamond(rx,ry); ctx.fill();
      ctx.globalAlpha = 1;
      const isHov = expZone === hoveredExpansion;
      const isSel = expZone === selectedExpansion;
      // Couleur légèrement différente par pièce pour distinguer visuellement
      const PIECE_COLS = ['rgba(14,68,52,0.68)','rgba(20,82,62,0.68)','rgba(10,58,44,0.68)'];
      const hovCol = isSel ? 'rgba(50,180,120,0.80)' : isHov ? 'rgba(38,150,105,0.75)' : PIECE_COLS[expZone.pieceIndex%3];
      ctx.fillStyle = hovCol;
      diamond(rx,ry); ctx.fill();
      // Bordure lumineuse sur les tuiles adjacentes à la zone jouable
      if(!drawFast){
        const nextToMap = (x>0&&mapMask[i-1]===1)||(x<N-1&&mapMask[i+1]===1)
                        ||(y>0&&mapMask[i-N]===1)||(y<N-1&&mapMask[i+N]===1);
        if(nextToMap){
          ctx.strokeStyle = isHov||isSel ? 'rgba(60,220,150,0.90)' : 'rgba(40,160,100,0.50)';
          ctx.lineWidth = 1.5;
          diamond(rx,ry); ctx.stroke();
        }
        // Distinguer les pièces voisines (via un stroke discret sur les tuiles de la "zone tab" centrale)
        // La différence de couleur PIECE_COLS suffit ; pas de calcul coûteux ici
      }
      continue;
    }

    if(t===T.WATER){
      ctx.fillStyle = WATER_COLS[hash(x,y)&1];
      diamond(rx,ry); ctx.fill();
    } else {
      ctx.fillStyle = GRASS_COLS[hash(x,y)&3];
      diamond(rx,ry); ctx.fill();
      if(!drawFast && t===T.WHEAT){
        const hs = hash(x,y), c = iso(rx+0.5, ry+0.5);
        ctx.strokeStyle = '#d7b348';
        ctx.lineWidth = 1.2;
        for(let k=0;k<6;k++){
          const ox = ((hs>>(k*3))&7)/7*TW*0.42 - TW*0.21;
          const oy = ((hs>>(k*3+6))&7)/7*TH*0.34 - TH*0.17;
          ctx.beginPath();
          ctx.moveTo(c[0]+ox, c[1]+oy+5);
          ctx.lineTo(c[0]+ox+((k&1)?2:-2), c[1]+oy-4);
          ctx.stroke();
        }
      }
      if(!drawFast && (t===T.IRON || t===T.COAL)){
        ctx.fillStyle = t===T.IRON ? '#c0763a' : '#23232b';
        const hs = hash(x,y), c = iso(rx+0.5, ry+0.5);
        for(let k=0;k<4;k++){
          const ox = ((hs>>(k*4))&7)/7*TW*0.36 - TW*0.18;
          const oy = ((hs>>(k*4+8))&7)/7*TH*0.36 - TH*0.18;
          ctx.beginPath(); ctx.ellipse(c[0]+ox, c[1]+oy, 4.2, 2.6, 0, 0, 7); ctx.fill();
        }
      }
    }

    // routes
    if(road[i]){
      ctx.fillStyle = '#33373e';
      diamond(rx,ry); ctx.fill();
      if(drawFast) {
        // Pendant le zoom on évite les traits arrondis multiples, très coûteux en canvas.
        continue;
      }
      const c = iso(rx+0.5, ry+0.5);
      let links = 0;
      ctx.lineCap = 'round';
      for(const [dx,dy] of DIRS){
        const nx = x+dx, ny = y+dy;
        if(!inMap(nx,ny) || !road[ny*N+nx]) continue;
        links++;
        const [du,dv] = rotDir(dx,dy);
        const m = iso(rx+0.5+du*0.5, ry+0.5+dv*0.5);
        ctx.strokeStyle = '#4c525c'; ctx.lineWidth = 12;
        ctx.beginPath(); ctx.moveTo(c[0],c[1]); ctx.lineTo(m[0],m[1]); ctx.stroke();
        ctx.strokeStyle = 'rgba(200,206,214,.55)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(c[0],c[1]); ctx.lineTo(m[0],m[1]); ctx.stroke();
      }
      if(!links){
        ctx.fillStyle = '#4c525c';
        ctx.beginPath(); ctx.ellipse(c[0], c[1], 8, 4.5, 0, 0, 7); ctx.fill();
      }
    }

    // falaises au bord de la carte
    const D = 15;
    const cliff = t===T.WATER ? '#1c557f' : '#6f5236';
    if(ry===N-1){
      const Cc = iso(rx+1,ry+1), Dd = iso(rx,ry+1);
      ctx.fillStyle = shade(cliff,-0.15);
      quad(Cc, Dd, [Dd[0],Dd[1]+D], [Cc[0],Cc[1]+D]);
    }
    if(rx===N-1){
      const Bb = iso(rx+1,ry), Cc = iso(rx+1,ry+1);
      ctx.fillStyle = shade(cliff,-0.35);
      quad(Bb, Cc, [Cc[0],Cc[1]+D], [Bb[0],Bb[1]+D]);
    }

    // collecte des sprites (arbres / bâtiments) au passage
    if(!drawFast && t===T.TREE){
      sprites.push({ k:ry*1024+rx, f:()=>drawTree(rx,ry,x,y) });
    }
    const b = bgrid[i];
    if(b){
      const [r1x,r1y] = rotIdx(b.x, b.y);
      const [r2x,r2y] = rotIdx(b.x+b.w-1, b.y+b.h-1);
      // dessiné une seule fois, depuis sa tuile la plus « en avant »
      if(rx===Math.max(r1x,r2x) && ry===Math.max(r1y,r2y))
        sprites.push({ k:ry*1024+rx, f:()=>drawBuilding(b) });
    }
  }

  if(radiusSel)
    drawWorkRadiusOverlay(radiusSel.center, radiusSel.r, radiusSel.color, minRx, maxRx, minRy, maxRy);

  // rayon du dépôt sélectionné (jaune)
  if(depotRadiusSel)
    drawWorkRadiusOverlay(depotRadiusSel.center, depotRadiusSel.r, '#ffd700', minRx, maxRx, minRy, maxRy);

  // rayon de la citerne sélectionnée (bleu)
  if(tankRadiusSel)
    drawWorkRadiusOverlay(tankRadiusSel.center, tankRadiusSel.r, '#64b7e8', minRx, maxRx, minRy, maxRy);

  // rayon de l'industrie sélectionnée (orange)
  if(indRadiusSel)
    drawWorkRadiusOverlay(indRadiusSel.center, indRadiusSel.r, '#ff8c42', minRx, maxRx, minRy, maxRy);

  // en mode placement d'entrepôt : afficher tous les rayons existants (semi-transparent)
  if(tool === 'depot' && !drawFast){
    for(const b of buildings){
      if(b.type !== 'depot' || b.dead) continue;
      ctx.globalAlpha = 0.45;
      drawWorkRadiusOverlay(centerOfBuilding(b), depotRadiusOf(b), '#ffd700', minRx, maxRx, minRy, maxRy);
      ctx.globalAlpha = 1;
    }
    // rayon du futur entrepôt sous le curseur
    if(inMap(mouse.tx, mouse.ty)){
      const ghost = { type:'depot', x:mouse.tx, y:mouse.ty, w:1, h:1 };
      drawWorkRadiusOverlay(centerOfBuilding(ghost), depotRadiusOf(ghost), '#ffd700', minRx, maxRx, minRy, maxRy);
    }
  }

  // en mode placement de citerne : afficher tous les rayons existants
  if(tool === 'tank' && !drawFast){
    for(const b of buildings){
      if(b.type !== 'tank' || b.dead) continue;
      ctx.globalAlpha = 0.45;
      drawWorkRadiusOverlay(centerOfBuilding(b), tankRadiusOf(b), '#64b7e8', minRx, maxRx, minRy, maxRy);
      ctx.globalAlpha = 1;
    }
    if(inMap(mouse.tx, mouse.ty)){
      const ghost = { type:'tank', x:mouse.tx, y:mouse.ty, w:1, h:1 };
      drawWorkRadiusOverlay(centerOfBuilding(ghost), tankRadiusOf(ghost), '#64b7e8', minRx, maxRx, minRy, maxRy);
    }
  }

  // en mode placement d'industrie : afficher tous les rayons industriels existants
  if(['mine','lumber','farm','pump','mill','bakery','smelter','factory'].includes(tool) && !drawFast){
    for(const b of buildings){
      if(!BUILD[b.type]?.ind || b.dead) continue;
      ctx.globalAlpha = 0.35;
      drawWorkRadiusOverlay(centerOfBuilding(b), indRadiusOf(b), '#ff8c42', minRx, maxRx, minRy, maxRy);
      ctx.globalAlpha = 1;
    }
    if(inMap(mouse.tx, mouse.ty)){
      const ghost = { type:tool, x:mouse.tx, y:mouse.ty, w:1, h:1 };
      drawWorkRadiusOverlay(centerOfBuilding(ghost), indRadiusOf(ghost), '#ff8c42', minRx, maxRx, minRy, maxRy);
    }
  }

  // camions
  if(!drawFast){
    for(const h of homeless){
      const [u,v] = rotF(h.x/TILE, h.y/TILE);
      sprites.push({ k:Math.floor(v)*1024 + Math.floor(u) + 0.55, f:()=>drawHomeless(h) });
    }

    for(const tk of trucks){
      const a = tk.pts[tk.seg], b = tk.pts[Math.min(tk.seg+1, tk.pts.length-1)];
      const wx = a.x + (b.x-a.x)*tk.t, wy = a.y + (b.y-a.y)*tk.t;
      const [u,v] = rotF(wx/TILE, wy/TILE);
      sprites.push({ k:Math.floor(v)*1024 + Math.floor(u) + 0.5, f:()=>drawTruck(tk) });
    }

    for(const veh of vehicles){
      if(veh.state === 'idle' || !veh.pts || !veh.pts.length) continue;
      const a = veh.pts[veh.seg], b = veh.pts[Math.min(veh.seg+1, veh.pts.length-1)];
      const wx = a.x + (b.x-a.x)*veh.t, wy = a.y + (b.y-a.y)*veh.t;
      const [u,v] = rotF(wx/TILE, wy/TILE);
      sprites.push({ k:Math.floor(v)*1024 + Math.floor(u) + 0.52, f:()=>drawVehicle(veh) });
    }

    // piétons
    for(const wk of walkers){
      const a = wk.pts[wk.seg], b = wk.pts[Math.min(wk.seg+1, wk.pts.length-1)];
      const wx = a.x + (b.x-a.x)*wk.t, wy = a.y + (b.y-a.y)*wk.t;
      const [u,v] = rotF(wx/TILE, wy/TILE);
      sprites.push({ k:Math.floor(v)*1024 + Math.floor(u) + 0.6, f:()=>drawWalker(wk) });
    }
  }

  // --- passe 2 : sprites triés arrière → avant ---
  sprites.sort((a,b)=> a.k-b.k);
  for(const s of sprites) s.f();

  // Parcours du véhicule sélectionné (style Transport Tycoon)
  if(selectedVehicle && !selectedVehicle.garageRef?.dead)
    drawVehicleRoute(selectedVehicle);

  // Noms des villages au centre de chaque groupe de maisons
  drawTownLabels();

  // fantôme de placement
  if(tool!=='select' && inMap(mouse.tx,mouse.ty)){
    const va = canPlace(tool, mouse.tx, mouse.ty);
    const [grx,gry] = rotIdx(mouse.tx, mouse.ty);
    ctx.fillStyle = va.ok ? 'rgba(110,230,120,.4)' : 'rgba(235,80,80,.4)';
    diamond(grx,gry); ctx.fill();
    const d = BUILD[tool];
    if(d.resid){
      drawWorkRadiusOverlay(
        { x:mouse.tx, y:mouse.ty },
        workRadiusOf({ type:tool, w:1, h:1 }),
        va.ok ? playerColor(MP.connected ? MP.myId : null) : '#eb5050',
        minRx, maxRx, minRy, maxRy
      );
      ctx.fillStyle = va.ok ? 'rgba(110,230,120,.45)' : 'rgba(235,80,80,.45)';
      diamond(grx,gry); ctx.fill();
    }
    if(va.ok && d.hgt){
      ctx.globalAlpha = 0.55;
      const tc = prism(grx, gry, grx+1, gry+1, d.hgt, d.col);
      ctx.font = (TH*0.62)+'px "Segoe UI Emoji",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.ic, tc[0], tc[1]+1);
      ctx.globalAlpha = 1;
    }
  } else if(tool==='select' && inMap(mouse.tx,mouse.ty)){
    const [grx,gry] = rotIdx(mouse.tx, mouse.ty);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5;
    diamond(grx,gry); ctx.stroke();
  }

  // badges des zones d'expansion
  if(!drawFast && expansions.length) drawExpansionBadges();

  // textes flottants
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for(const f of floats){
    const p = worldPxToIso(f.x, f.y);
    ctx.globalAlpha = Math.min(1, f.life);
    ctx.fillStyle = f.col;
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(f.txt, p[0], p[1] - 20 - (1.3-f.life)*26);
  }
  ctx.globalAlpha = 1;
}

