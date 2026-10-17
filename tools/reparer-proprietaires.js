#!/usr/bin/env node
// Répare une sauvegarde dont les propriétaires ont été fusionnés sur un seul joueur
// (bug de reprise d'identité), à partir d'une sauvegarde de référence antérieure
// où les propriétaires étaient encore distincts.
//
//   node tools/reparer-proprietaires.js <sauvegarde> <référence> <sortie> [--ecrire]
//
// Sans --ecrire : rapport seulement. Le fichier source n'est jamais modifié.
//
// Règle : une case occupée dans la référence reprend son propriétaire d'alors ;
// ce qui a été construit depuis hérite du propriétaire de son village, à défaut du
// plus proche voisin connu (≤ 8 cases), sinon reste à l'hôte. Voir le rapport pour les cas ambigus.
const fs = require('fs');
const [src, ref, out] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const WRITE = process.argv.includes('--ecrire');
if(!src || !ref || !out){ console.error('usage : node tools/reparer-proprietaires.js <sauvegarde> <référence> <sortie> [--ecrire]'); process.exit(2); }

const rleDecode = rle => { const o = []; for(let i = 0; i < rle.length; i += 2) for(let k = 0; k < rle[i + 1]; k++) o.push(rle[i]); return o; };
const rleEncode = a => { const o = []; for(let i = 0; i < a.length;){ let n = 1; while(i + n < a.length && a[i + n] === a[i]) n++; o.push(a[i], n); i += n; } return o; };
const load = f => { const d = JSON.parse(fs.readFileSync(f, 'utf8')); return { file: d, st: d.state || d }; };

const A = load(src), R = load(ref);
const S = A.st, N = S.size;
if(R.st.size !== N) throw new Error('tailles de carte différentes');

// identités : hôte (celui de la sauvegarde) et invité (celui du registre de la référence)
const hostName = A.file.meta?.username || Object.keys(R.st.playerRegistry || {})[0];
const refReg = R.st.playerRegistry || {}, curReg = S.playerRegistry || {};
const guestName = Object.keys(refReg).find(n => n !== hostName);
const refHost = refReg[hostName], refGuest = refReg[guestName];
const curHost = curReg[hostName];                       // id actuel de l'hôte (propriétaire unique à défaut)
const curGuest = curReg[guestName];                     // id actuel du registre pour l'invité
if(refHost == null || refGuest == null || curHost == null || curGuest == null) throw new Error('registres incomplets');
const soleOwner = curHost;
console.log('hôte', hostName, ':', refHost, '→', curHost, '| invité', guestName, ':', refGuest, '→', curGuest);

// propriétaire de référence par case
const refTile = new Map();
const fp = (b, f) => { for(let y = b.y; y < b.y + (b.h || 1); y++) for(let x = b.x; x < b.x + (b.w || 1); x++) f(x, y); };
for(const b of R.st.buildings) fp(b, (x, y) => refTile.set(y * N + x, b.owner));
const mapOwner = o => o === refGuest ? curGuest : (o === refHost ? curHost : null);

// villages : propriétaire majoritaire dans la référence
const townVotes = {};
for(const b of R.st.buildings) if(b.townId != null && b.owner != null) (townVotes[b.townId] ||= {})[b.owner] = (townVotes[b.townId][b.owner] || 0) + 1;
const townOwner = {};
for(const t in townVotes) townOwner[t] = mapOwner(Object.entries(townVotes[t]).sort((a, c) => c[1] - a[1])[0][0] * 1);

// 1) bâtiments : tuiles connues, puis voisins, puis village
const stats = { connu: 0, voisin: 0, village: 0, defaut: 0 };
const decided = new Map();           // case → propriétaire décidé (pour la propagation)
const unknown = [];
for(const b of S.buildings){
  if(b.owner !== soleOwner){ continue; }            // déjà distinct : on n'y touche pas
  let o = null;
  fp(b, (x, y) => { const r = refTile.get(y * N + x); if(o == null && r != null) o = mapOwner(r); });
  if(o != null){ b.owner = o; stats.connu++; fp(b, (x, y) => decided.set(y * N + x, o)); }
  else unknown.push(b);
}
const near = (b, r) => {
  let best = null, bd = Infinity;
  for(const [k, o] of decided){
    const x = k % N, y = (k / N) | 0, d = Math.max(Math.abs(x - b.x), Math.abs(y - b.y));
    if(d < bd){ bd = d; best = o; }
  }
  return bd <= r ? best : null;
};
for(const b of unknown){
  if(b.townId != null && townOwner[b.townId] != null){ b.owner = townOwner[b.townId]; stats.village++; }
  else { const o = near(b, 8); if(o != null){ b.owner = o; stats.voisin++; } else { stats.defaut++; continue; } }
  fp(b, (x, y) => decided.set(y * N + x, b.owner));
}
console.log('bâtiments', S.buildings.length, JSON.stringify(stats), '→ par propriétaire', JSON.stringify(S.buildings.reduce((m, b) => (m[b.owner] = (m[b.owner] || 0) + 1, m), {})));

const towns = {};
for(const b of S.buildings) if(b.townId != null) (towns[b.townId] ||= {})[b.owner] = (towns[b.townId][b.owner] || 0) + 1;
console.log('villages', (S.towns || []).map(t => t.id + ' ' + t.name + ' ' + JSON.stringify(towns[t.id] || {})).join(' | '));
console.log('sans propriétaire déduit (restés à l’hôte) :', S.buildings.filter(b => b.owner === soleOwner && !decided.has(b.y * N + b.x)).map(b => b.type + '@' + b.x + ',' + b.y).join(' '));
// 2) rails
const railOwner = rleDecode(S.railOwner), refRail = rleDecode(R.st.railOwner);
const rails = [];
let changedRail = 0;
const seeds = [];
for(let i = 0; i < railOwner.length; i++){
  if(railOwner[i] !== soleOwner) continue;
  const o = mapOwner(refRail[i]);
  if(o != null){ railOwner[i] = o; changedRail++; seeds.push(i); } else rails.push(i);
}
// propagation de proche en proche depuis les rails connus (le long du réseau)
const isMine = new Set(rails);
let frontier = seeds, filled = 0;
while(frontier.length && isMine.size){
  const next = [];
  for(const i of frontier) for(const j of [i - 1, i + 1, i - N, i + N]){
    if(!isMine.has(j)) continue;
    railOwner[j] = railOwner[i]; isMine.delete(j); next.push(j); filled++;
  }
  frontier = next;
}
// rails encore sans propriétaire : celui du bâtiment le plus proche (≤ 10 cases)
let byBuilding = 0;
for(const i of [...isMine]){
  const x = i % N, y = (i / N) | 0;
  let best = null, bd = Infinity;
  for(const b of S.buildings){
    if(b.owner === soleOwner && !isMine.has(-1) && !decided.has(b.y * N + b.x)) continue;
    const d = Math.max(Math.abs(x - (b.x + (b.w || 1) / 2)), Math.abs(y - (b.y + (b.h || 1) / 2)));
    if(d < bd){ bd = d; best = b.owner; }
  }
  if(best != null && bd <= 10){ railOwner[i] = best; isMine.delete(i); byBuilding++; }
}
S.railOwner = rleEncode(railOwner);
console.log('rails : connus', changedRail, '| propagés', filled, '| par bâtiment voisin', byBuilding, '| restés à l’hôte', isMine.size);

// 3) wallets : le wallet fusionné (nommé d'après l'invité) retourne à l'invité ;
//    l'hôte retrouve le wallet de la référence (dernier état connu, plus ancien).
const merged = S.wallets[soleOwner];
const hostWalletRef = R.st.wallets[refHost];
console.log('wallet fusionné', soleOwner, merged?.username, Math.round(merged?.money), '| wallet hôte de référence', Math.round(hostWalletRef?.money));
S.wallets[curGuest] = merged; if(merged) merged.username = guestName;
S.wallets[curHost] = JSON.parse(JSON.stringify(hostWalletRef)); S.wallets[curHost].username = hostName;
S.ownerColors = { ...(S.ownerColors || {}) };
S.ownerColors[curHost] = R.st.ownerColors?.[refHost] || S.ownerColors[curHost];
S.ownerColors[curGuest] = R.st.ownerColors?.[refGuest] || '#e0e0e0';
S.playerRegistry = { ...curReg, [hostName]: curHost, [guestName]: curGuest };

if(WRITE){
  if(A.file.meta) A.file.meta = { ...A.file.meta, name: require('path').basename(out, '.json').replace(/^[^_]*_/, ''), date: new Date().toISOString() };
  fs.writeFileSync(out, JSON.stringify(A.file));
  console.log('écrit :', out);
} else console.log('(rapport seul : ajouter --ecrire pour produire', out + ')');
