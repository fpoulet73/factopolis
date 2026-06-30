'use strict';
/* ===================== Factopolis — Serveur multijoueur =====================
   Multi-room : plusieurs mondes simultanés.

   Données persistantes :
     data/users.json                → comptes joueurs
     data/saves/<user>_<nom>.json   → sauvegardes
   =========================================================================== */

const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const readline = require('readline');
const { WebSocketServer } = require('ws');

const PORT      = process.env.PORT || process.argv[2] || 8765;
const STATIC    = __dirname;
const DATA_DIR  = path.join(__dirname, 'data');
const SAVES_DIR = path.join(DATA_DIR, 'saves');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR))  fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(SAVES_DIR)) fs.mkdirSync(SAVES_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');

// ---- utilitaires ----
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');
const tokenHash = token => sha256('session:' + token);
const passwordHash = (password, salt = crypto.randomBytes(16).toString('hex')) => ({
  algo: 'scrypt', salt,
  hash: crypto.scryptSync(password, salt, 64).toString('hex'),
});
function verifyPassword(password, user) {
  if (!user) return false;
  if (user.passwordAlgo === 'scrypt' && user.passwordSalt && user.passwordHash) {
    const expected = Buffer.from(user.passwordHash, 'hex');
    const actual = crypto.scryptSync(password, user.passwordSalt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }
  return user.passwordHash === sha256(password);
}
function issueToken(users, username) {
  const token = randomToken();
  const u = users[username];
  u.sessionHash = tokenHash(token);
  u.sessionIssuedAt = new Date().toISOString();
  saveUsers(users);
  return token;
}

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return {}; }
}
function saveUsers(u) { fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2)); }
function validateToken(token) {
  if (!token) return null;
  const users = loadUsers();
  const hash = tokenHash(token);
  for (const [username, u] of Object.entries(users)) {
    if (u.sessionHash && u.sessionHash === hash) return { username, color: u.color };
  }
  return null;
}

const safeName = s => s.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 64);
const isAutoSaveName = name => /^\[Auto\]/i.test(String(name || '').trim());

function saveBelongsToUser(file, data, username) {
  const userLower = String(username || '').toLowerCase();
  const prefixLower = safeName(username) + '_';
  return file.toLowerCase().startsWith(prefixLower.toLowerCase())
    || String(data?.meta?.username || '').toLowerCase() === userLower;
}

function listUserSaves(username) {
  const prefix = safeName(username) + '_';
  const prefixLower = prefix.toLowerCase();
  try {
    const files = fs.readdirSync(SAVES_DIR).filter(f => f.endsWith('.json'));
    const saves = files
      .filter(f => {
        if (!f.endsWith('.json')) return false;
        if (f.toLowerCase().startsWith(prefixLower)) return true;
        try {
          const data = JSON.parse(fs.readFileSync(path.join(SAVES_DIR, f), 'utf8'));
          return saveBelongsToUser(f, data, username);
        } catch { return false; }
      })
      .map(f => {
        const fullPath = path.join(SAVES_DIR, f);
        const stat = fs.statSync(fullPath);
        let data = null;
        try { data = JSON.parse(fs.readFileSync(fullPath, 'utf8')); } catch {}
        const owned = saveBelongsToUser(f, data, username);
        const name = data?.meta?.name || f.replace(/\.json$/, '');
        return { name, date: stat.mtime.toISOString(), owned };
      });
    return saves.sort((a, b) => b.date.localeCompare(a.date));
  } catch { return []; }
}

// ---- sauvegardes rattachées à la ROOM (carte), pas au joueur ----
// Une sauvegarde appartient à la room courante si elle porte son identité de
// room (nom de la carte). Les nouvelles sauvegardes la stockent dans meta.room ;
// les anciennes (sans meta.room) sont rattachées par leur meta.name == nom de
// room, ce qui couvre le modèle « une sauvegarde principale nommée comme la room ».
function roomIdentity(room) {
  return String(room?.name || '').toLowerCase();
}
function saveBelongsToRoom(data, room) {
  const rid = roomIdentity(room);
  if (!rid) return false;
  const metaRoom = String(data?.meta?.room || '').toLowerCase();
  if (metaRoom) return metaRoom === rid;
  // héritage : pas de meta.room → rattachement par nom de sauvegarde
  const metaName = String(data?.meta?.name || '').toLowerCase();
  const saveName = String(room?.saveName || '').toLowerCase();
  return metaName === rid || (saveName && metaName === saveName);
}

function listRoomSaves(room) {
  try {
    const files = fs.readdirSync(SAVES_DIR).filter(f => f.endsWith('.json'));
    const saves = [];
    for (const f of files) {
      const fullPath = path.join(SAVES_DIR, f);
      let data = null;
      try { data = JSON.parse(fs.readFileSync(fullPath, 'utf8')); } catch { continue; }
      if (!saveBelongsToRoom(data, room)) continue;
      const stat = fs.statSync(fullPath);
      const name = data?.meta?.name || f.replace(/\.json$/, '');
      saves.push({ name, date: stat.mtime.toISOString() });
    }
    return saves.sort((a, b) => b.date.localeCompare(a.date));
  } catch { return []; }
}

// Résout le fichier d'une sauvegarde nommée DANS la room. Si elle n'existe pas
// et que mustExist=false, retourne un chemin neuf nommé d'après la room (les
// sauvegardes d'une même carte sont ainsi regroupées, indépendamment du joueur).
function resolveRoomSavePath(room, name, { mustExist = false } = {}) {
  const wantedName = String(name || '').toLowerCase();
  try {
    const match = fs.readdirSync(SAVES_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const p = path.join(SAVES_DIR, f);
        let data = null, mtimeMs = 0;
        try { data = JSON.parse(fs.readFileSync(p, 'utf8')); mtimeMs = fs.statSync(p).mtimeMs; } catch {}
        return { p, data, mtimeMs };
      })
      .filter(x => x.data && saveBelongsToRoom(x.data, room)
        && String(x.data?.meta?.name || '').toLowerCase() === wantedName)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (match) return match.p;
  } catch {}
  if (mustExist) return null;
  return path.join(SAVES_DIR, safeName(room.name) + '_' + safeName(name) + '.json');
}

// Charge une sauvegarde par nom (optionnel) — sinon la plus récente du dossier
function getSave(saveName = null, saveUsername = null) {
  try {
    const files = fs.readdirSync(SAVES_DIR).filter(f => f.endsWith('.json'));
    const candidates = files.map(f => {
      const fullPath = path.join(SAVES_DIR, f);
      const stat = fs.statSync(fullPath);
      let data = null;
      try { data = JSON.parse(fs.readFileSync(fullPath, 'utf8')); } catch {}
      if (!data?.state) return null;
      return { file: f, path: fullPath, mtimeMs: stat.mtimeMs, data };
    }).filter(Boolean);

    let filtered = candidates;
    if (saveName) filtered = filtered.filter(x => x.data.meta?.name === saveName);
    if (saveUsername) filtered = filtered.filter(x => x.data.meta?.username === saveUsername);
    if (filtered.length === 0 && saveName) filtered = candidates; // fallback

    const latest = filtered.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (!latest) return null;
    return {
      name: latest.data.meta?.name || latest.file.replace(/\.json$/, ''),
      username: latest.data.meta?.username || null,
      state: latest.data.state,
    };
  } catch (e) {
    console.warn('[getSave]', e.message);
    return null;
  }
}

const COLORS = ['#e25e4c','#4ca3e2','#58c470','#e2a93f','#b06fd8','#f0a040','#40d0c0','#e0e0e0'];
const userColor = username => COLORS[parseInt(sha256(username).slice(0,2), 16) % COLORS.length];

// ---- serveur HTTP ----
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};
const PUBLIC_ROOT_FILES = new Set(['index.html', 'config.js', 'favicon.ico']);
const PUBLIC_DIRS = ['js', 'assets'];
function resolvePublicPath(reqUrl) {
  let urlPath;
  try { urlPath = decodeURIComponent(reqUrl.split('?')[0]); } catch { return null; }
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath.includes('\0')) return null;
  const rel = path.normalize(urlPath.replace(/^\/+/, ''));
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const top = rel.split(path.sep)[0];
  if (!PUBLIC_ROOT_FILES.has(rel) && !PUBLIC_DIRS.includes(top)) return null;
  const p = path.join(STATIC, rel);
  if (!p.startsWith(STATIC + path.sep)) return null;
  return p;
}
const httpServer = http.createServer((req, res) => {
  const p = resolvePublicPath(req.url);
  if (!p) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(p)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain', 'Cache-Control': 'no-cache' });
  fs.createReadStream(p).pipe(res);
});

// ---- WebSocket ----
const wss = new WebSocketServer({ server: httpServer });

// ---- état global ----
const DEFAULT_WORLD_CONFIG = { size: 64, maxPlayers: 8, resources: { tree: 8, wheat: 4, cotton: 1, iron: 2, coal: 2 } };
let nextId = 1;
let nextRoomId = 1;
let allClients = [];   // tous les clients (lobby + rooms)
const rooms = new Map();
const userOwnerRegistry = new Map(); // username → last connection id
let shuttingDown = false;
let consoleRl = null;

// ---- rooms ----
function createRoom({ name, worldConfig, saveName, saveUsername } = {}) {
  const id = nextRoomId++;
  const room = {
    id,
    name: name || `Monde ${id}`,
    hostId: null,
    worldConfig: sanitizeWorldConfig(worldConfig || {}),
    pendingSnapshots: new Map(),
    saveName: saveName || null,
    saveUsername: saveUsername || null,
  };
  rooms.set(id, room);
  return room;
}

function initRooms() {
  try {
    const files = fs.readdirSync(SAVES_DIR).filter(f => f.endsWith('.json'));
    // Regroupe les sauvegardes par ROOM (carte), pas par nom de sauvegarde :
    // une room = identité meta.room (ou, en héritage, le nom de la sauvegarde).
    const byRoom = new Map(); // roomName → { saveName, username, mtimeMs, worldConfig }
    for (const f of files) {
      const fullPath = path.join(SAVES_DIR, f);
      const stat = fs.statSync(fullPath);
      let data = null;
      try { data = JSON.parse(fs.readFileSync(fullPath, 'utf8')); } catch {}
      if (!data?.state) continue;
      const name = data.meta?.name || f.replace(/\.json$/, '');
      if (/^\[Auto\]/i.test(name)) continue; // ignorer les auto-sauvegardes
      const roomName = data.meta?.room || name; // héritage : room = nom de save
      const username = data.meta?.username || null;
      const existing = byRoom.get(roomName);
      if (!existing || stat.mtimeMs > existing.mtimeMs) {
        byRoom.set(roomName, { saveName: name, username, mtimeMs: stat.mtimeMs, worldConfig: data.state?.world });
      }
    }
    if (byRoom.size === 0) {
      createRoom({ name: 'Monde 1' });
    } else {
      for (const [roomName, info] of byRoom.entries()) {
        createRoom({ name: roomName, saveName: info.saveName, saveUsername: info.username, worldConfig: info.worldConfig });
        if (rooms.size >= 20) break; // limite de sécurité
      }
    }
  } catch {
    createRoom({ name: 'Monde 1' });
  }

  // Init du registry et du nextId à partir de toutes les saves
  try {
    const files = fs.readdirSync(SAVES_DIR).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(SAVES_DIR, f), 'utf8'));
        const reg = data.state?.playerRegistry;
        if (reg && typeof reg === 'object') {
          for (const [username, id] of Object.entries(reg)) {
            const n = Number(id);
            if (username && Number.isFinite(n)) {
              const existing = userOwnerRegistry.get(username);
              if (!existing || n > existing) userOwnerRegistry.set(username, n);
            }
          }
        }
      } catch {}
    }
    if (userOwnerRegistry.size > 0) {
      const maxKnownId = Math.max(0, ...Array.from(userOwnerRegistry.values()));
      nextId = Math.max(nextId, maxKnownId + 1);
    }
  } catch {}
}
initRooms();

// ---- helpers ----
const send = (c, msg) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); };
const roomOf  = c => (c && c.roomId != null) ? rooms.get(c.roomId) : null;
const roomClients = roomId => allClients.filter(c => c.roomId === roomId);
const lobbyClients = () => allClients.filter(c => c.roomId == null);

const broadcastRoom = (roomId, msg, excludeId = null) => {
  const r = JSON.stringify(msg);
  roomClients(roomId).forEach(c => { if (c.id !== excludeId && c.ws.readyState === 1) c.ws.send(r); });
};
const broadcastEveryone = msg => {
  const r = JSON.stringify(msg);
  allClients.forEach(c => { if (c.ws.readyState === 1) c.ws.send(r); });
};

function getRoomInfo(room) {
  const rc = roomClients(room.id);
  return {
    id: room.id,
    name: room.name,
    playerCount: rc.length,
    players: rc.map(c => ({ name: c.username || c.name, color: c.color })),
    worldConfig: room.worldConfig,
    saveName: room.saveName,
  };
}
function broadcastRoomList() {
  const list = Array.from(rooms.values()).map(getRoomInfo);
  const msg = JSON.stringify({ type: 'rooms_list', rooms: list });
  lobbyClients().forEach(c => { if (c.ws.readyState === 1) c.ws.send(msg); });
}
function sendRoomList(client) {
  send(client, { type: 'rooms_list', rooms: Array.from(rooms.values()).map(getRoomInfo) });
}

function broadcastPlayerList(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const rc = roomClients(roomId);
  const list = rc.map(c => ({
    id: c.id, name: c.name, color: c.color,
    isHost: c.id === room.hostId, isAdmin: !!c.isAdmin, username: c.username || null,
  }));
  broadcastRoom(roomId, { type: 'player_list', players: list });
}

function isPrivileged(c) {
  if (!c || c.roomId == null) return false;
  const room = rooms.get(c.roomId);
  return room && (c.id === room.hostId || c.isAdmin);
}
function requirePrivileged(c, errType = 'permission_err') {
  if (isPrivileged(c)) return true;
  send(c, { type: errType, msg: 'Action réservée à l\'hôte ou aux administrateurs' });
  return false;
}

function clientLabel(c) {
  return c?.username || c?.name || (c ? 'Joueur ' + c.id : 'Joueur inconnu');
}
function logClientJoin(c) {
  if (!c || c.joinLogged) return;
  c.joinLogged = true;
  console.log(`[+] ${clientLabel(c)} connecté (#${c.id}, ${allClients.length} connectés)`);
}

function replaceExistingAuthenticatedClient(username, replacement) {
  const old = allClients.find(c => c !== replacement && c.username === username);
  if (!old) return;
  old.replaced = true;
  allClients = allClients.filter(c => c !== old);
  if (old.roomId != null) {
    const room = rooms.get(old.roomId);
    if (room) {
      if (room.hostId === old.id) {
        room.hostId = replacement.id;
        send(replacement, { type: 'promoted_host', worldConfig: room.worldConfig });
        console.log(`[→] ${clientLabel(replacement)} promu hôte`);
      }
      broadcastRoom(old.roomId, { type: 'player_left', id: old.id, name: old.name, username: old.username });
      broadcastPlayerList(old.roomId);
      broadcastRoomList();
    }
  }
  try { old.ws.close(4000, 'replaced_by_new_session'); } catch {}
  console.log(`[~] ${clientLabel(old)} remplacé par une nouvelle connexion`);
}

function authenticateClient(client, { username, token, color, isAdmin = false }) {
  const prevOwnerId = userOwnerRegistry.get(username) ?? null;
  Object.assign(client, { username, token, name: username, color, isAdmin, announced: true });
  replaceExistingAuthenticatedClient(username, client);
  userOwnerRegistry.set(username, client.id);
  send(client, { type: 'auth_ok', username, color, token, prevOwnerId });
  logClientJoin(client);
  if (client.roomId != null) {
    const room = rooms.get(client.roomId);
    if (room && room.hostId === null) {
      // premier authentifié dans une room sans hôte → promouvoir
      room.hostId = client.id;
      send(client, { type: 'promoted_host', worldConfig: room.worldConfig });
      const saveToLoad = getSave(room.saveName, room.saveUsername);
      if (saveToLoad) {
        const state = saveToLoad.state;
        state.world = state.world ? sanitizeWorldConfig(state.world) : room.worldConfig;
        room.worldConfig = state.world;
        send(client, { type: 'game_loaded', state, name: saveToLoad.name, loadedBy: 'serveur' });
        console.log(`[autoload] "${saveToLoad.name}" → ${client.name} (promu hôte de "${room.name}")`);
      }
      console.log(`[→] ${username} promu hôte de "${room.name}" après authentification`);
    }
    broadcastPlayerList(client.roomId);
  }
  return prevOwnerId;
}

function clampInt(v, min, max, def) {
  v = Number(v);
  if (!Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, Math.round(v)));
}
function clampPercent(v, def) {
  v = Number(v);
  if (!Number.isFinite(v)) return def;
  return Math.max(0, Math.min(40, Math.round(v * 10) / 10));
}
function sanitizeWorldConfig(config = {}) {
  const base = DEFAULT_WORLD_CONFIG;
  const resources = config.resources || {};
  const baseRes = base.resources;
  return {
    size:       clampInt(config.size, 32, 128, base.size),
    maxPlayers: clampInt(config.maxPlayers, 1, 32, base.maxPlayers),
    resources: {
      tree:   clampPercent(resources.tree,   baseRes.tree),
      wheat:  clampPercent(resources.wheat,  baseRes.wheat),
      cotton: clampPercent(resources.cotton, baseRes.cotton),
      iron:   clampPercent(resources.iron,   baseRes.iron),
      coal:   clampPercent(resources.coal,   baseRes.coal),
    },
  };
}

const ALLOWED_ACTIONS = new Set([
  'road', 'bulldoze_road', 'rail_update', 'rail_signal_update', 'bulldoze_tree', 'terraform', 'fill_water', 'bulldoze_bld',
  'build', 'toggle_bld_pause', 'toggle_out_block', 'toggle_resid_upgrade_pause', 'clear_bld_stock', 'upgrade_plant',
  'buy_vehicle', 'sell_vehicle', 'route_vehicle', 'return_vehicle', 'pin_vehicle_res', 'configure_train', 'merge_towns',
  'zone_reassign', 'rename_bus_stop', 'owner_remap', 'depot_departure_flag', 'pause', 'speed',
]);
const ALLOWED_BUILD_TYPES = new Set([
  'road', 'rail', 'mine', 'lumber', 'farm', 'cotton_farm', 'weaver', 'pump', 'fisher', 'mill',
  'bakery', 'fishery', 'smelter', 'factory', 'plant', 'house', 'depot', 'market',
  'tank', 'garage', 'train_depot', 'train_station', 'boat_depot', 'plane_depot', 'bus_stop', 'terrassement',
]);
const ALLOWED_VEHICLE_TYPES = new Set([
  // types achetables actuels
  'minerai', 'plateau', 'cereale', 'marchandises', 'frigo', 'citerne', 'bus', 'train',
  // types hérités (sauvegardes existantes, plus achetables mais toujours routables)
  'bois', 'ble', 'coton', 'vetement', 'farine', 'pain', 'poisson', 'acier',
]);
const intInRange = (v, min = 0, max = 4096) => Number.isInteger(v) && v >= min && v <= max;
// Index de tuile = y*N+x : la grille vaut taille jouable (≤128) + marge d'expansion
// (48 par côté côté client), donc l'index peut largement dépasser 4096. On valide donc
// les indices de tuile avec une borne généreuse (le client revérifie i < N*N de toute façon).
const MAX_TILE_INDEX = 1 << 20; // 1 048 576, couvre toute grille plausible
const validTileIndex = i => Number.isInteger(i) && i >= 0 && i <= MAX_TILE_INDEX;
const numInRange = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
function validName(value, max = 64) {
  return value == null || (typeof value === 'string' && value.length <= max);
}
// Les IDs de véhicule sont normalisés en chaîne (out.id = String(act.id)) mais
// le client peut légitimement émettre un id numérique (vehicleIdSeed). On
// accepte donc chaîne (≤64) OU nombre fini — sinon un achat à id numérique est
// rejeté et n'atteint jamais l'hôte.
function validVehicleId(value, max = 64) {
  return (typeof value === 'string' && value.length <= max)
    || (typeof value === 'number' && Number.isFinite(value));
}
function sanitizeAction(client, msg) {
  const act = msg && msg.act;
  if (!act || typeof act !== 'object' || !ALLOWED_ACTIONS.has(act.type)) return null;
  const out = { type: act.type };
  switch (act.type) {
    case 'road':
    case 'bulldoze_road':
    case 'bulldoze_tree':
    case 'terraform':
      if (!validTileIndex(act.i)) return null;
      out.i = act.i; break;
    case 'rail_update':
      if (!intInRange(act.x) || !intInRange(act.y) || !intInRange(act.mask, 0, 255)) return null;
      if (act.costDelta != null && !numInRange(act.costDelta, -100000, 100000)) return null;
      Object.assign(out, { x:act.x, y:act.y, mask:act.mask, costDelta: act.costDelta || 0 }); break;
    case 'rail_signal_update':
      if (!intInRange(act.x) || !intInRange(act.y) || !intInRange(act.bit, 0, 255)) return null;
      if (typeof act.present !== 'boolean') return null;
      if (act.costDelta != null && !numInRange(act.costDelta, -100000, 100000)) return null;
      Object.assign(out, { x:act.x, y:act.y, bit:act.bit, present:act.present, costDelta: act.costDelta || 0 }); break;
    case 'fill_water':
      if (!validTileIndex(act.i) || !intInRange(act.depotX) || !intInRange(act.depotY)) return null;
      Object.assign(out, { i: act.i, depotX: act.depotX, depotY: act.depotY }); break;
    case 'bulldoze_bld':
      if (!intInRange(act.bx) || !intInRange(act.by)) return null;
      Object.assign(out, { bx: act.bx, by: act.by }); break;
    case 'build':
      if (!ALLOWED_BUILD_TYPES.has(act.btype) || !intInRange(act.x) || !intInRange(act.y)) return null;
      Object.assign(out, { btype: act.btype, x: act.x, y: act.y }); break;
    case 'toggle_bld_pause':
      if (!intInRange(act.x) || !intInRange(act.y)) return null;
      Object.assign(out, { x: act.x, y: act.y, paused: !!act.paused }); break;
    case 'toggle_out_block':
      if (!intInRange(act.x) || !intInRange(act.y) || typeof act.res !== 'string' || act.res.length > 32) return null;
      Object.assign(out, { x: act.x, y: act.y, res: act.res, blocked: !!act.blocked }); break;
    case 'toggle_resid_upgrade_pause':
      if (!intInRange(act.x) || !intInRange(act.y) || typeof act.res !== 'string' || act.res.length > 32) return null;
      Object.assign(out, { x: act.x, y: act.y, res: act.res, paused: !!act.paused }); break;
    case 'clear_bld_stock':
      if (!intInRange(act.x) || !intInRange(act.y)) return null;
      Object.assign(out, { x: act.x, y: act.y }); break;
    case 'upgrade_plant':
      if (!intInRange(act.x) || !intInRange(act.y) || !ALLOWED_BUILD_TYPES.has(act.targetType)) return null;
      Object.assign(out, { x: act.x, y: act.y, targetType: act.targetType }); break;
    case 'buy_vehicle':
      if (!validVehicleId(act.id) || !ALLOWED_VEHICLE_TYPES.has(act.vtype) || !intInRange(act.garageX) || !intInRange(act.garageY)) return null;
      Object.assign(out, { id: String(act.id), vtype: act.vtype, garageX: act.garageX, garageY: act.garageY }); break;
    case 'sell_vehicle':
    case 'return_vehicle':
      if (!validVehicleId(act.id)) return null;
      out.id = String(act.id); break;
    case 'depot_departure_flag':
      if (!validVehicleId(act.id) || typeof act.armed !== 'boolean') return null;
      out.id = String(act.id);
      out.armed = !!act.armed;
      break;
    case 'pin_vehicle_res':
      if (!validVehicleId(act.id)) return null;
      out.id = String(act.id);
      out.res = act.res == null ? null : String(act.res).slice(0, 32);
      break;
    case 'route_vehicle': {
      if (!validVehicleId(act.id)) return null;
      out.id = String(act.id);
      if (Array.isArray(act.orders)) {
        // Train : liste d'ordres (gares)
        const orders = [];
        for (const o of act.orders) {
          if (!o || !intInRange(o.x) || !intInRange(o.y)) return null;
          orders.push({ x: o.x, y: o.y });
        }
        out.orders = orders;
        if (Number.isInteger(act.orderIndex)) out.orderIndex = act.orderIndex;
        if (Array.isArray(act.orderModes)) {
          out.orderModes = act.orderModes
            .map(m => (typeof m === 'string' && m.length <= 16) ? m : null)
            .filter(m => m !== null);
        }
      } else {
        // Véhicule routier : source + destination
        if (!intInRange(act.sourceX) || !intInRange(act.sourceY) || !intInRange(act.destX) || !intInRange(act.destY)) return null;
        Object.assign(out, { sourceX: act.sourceX, sourceY: act.sourceY, destX: act.destX, destY: act.destY });
      }
      break;
    }
    case 'configure_train': {
      if (!validVehicleId(act.id)) return null;
      out.id = String(act.id);
      if (Array.isArray(act.wagons)) {
        const wagons = [];
        for (const w of act.wagons) {
          if (!w || typeof w !== 'object' || typeof w.type !== 'string' || w.type.length > 32) return null;
          const wagon = { type: w.type };
          if (w.resource != null) wagon.resource = String(w.resource).slice(0, 32);
          wagons.push(wagon);
        }
        out.wagons = wagons;
      }
      if (typeof act.engineMult === 'number' && act.engineMult >= 1 && act.engineMult <= 100) out.engineMult = act.engineMult;
      break;
    }
    case 'merge_towns':
      if (!intInRange(act.dstId, 0, 1000000) || !intInRange(act.srcId, 0, 1000000)) return null;
      Object.assign(out, { dstId: act.dstId, srcId: act.srcId }); break;
    case 'zone_reassign':
      if (!intInRange(act.dstId, 0, 1000000) || !intInRange(act.x1) || !intInRange(act.y1) || !intInRange(act.x2) || !intInRange(act.y2)) return null;
      Object.assign(out, { dstId: act.dstId, x1: act.x1, y1: act.y1, x2: act.x2, y2: act.y2 });
      if (act.owner == null) out.owner = null;
      else if (intInRange(act.owner, 0, 1000000)) out.owner = act.owner;
      else return null;
      if (act.newTown != null) {
        if (!intInRange(act.newTown.id, 0, 1000000) || !validName(act.newTown.name, 64) || !numInRange(act.newTown.cx, 0, 4096) || !numInRange(act.newTown.cy, 0, 4096)) return null;
        out.newTown = { id: act.newTown.id, name: act.newTown.name, cx: act.newTown.cx, cy: act.newTown.cy };
      }
      break;
    case 'rename_bus_stop':
      if (!intInRange(act.x) || !intInRange(act.y) || !validName(act.name, 64)) return null;
      Object.assign(out, { x: act.x, y: act.y, name: act.name || null }); break;
    case 'owner_remap':
      if (!intInRange(act.oldId, 0, 1000000) || !intInRange(act.newId, 0, 1000000) || act.newId !== client.id) return null;
      Object.assign(out, { oldId: act.oldId, newId: act.newId }); break;
    case 'pause': break;
    case 'speed':
      if (![0.5, 1, 2, 4].includes(Number(act.s))) return null;
      out.s = Number(act.s); break;
    default: return null;
  }
  return out;
}

// ---- connexion WebSocket ----
wss.on('connection', (ws) => {
  if (shuttingDown) {
    ws.send(JSON.stringify({ type: 'server_shutdown', msg: 'Serveur arrêté' }));
    ws.close(1001, 'server_shutdown');
    return;
  }

  const id    = nextId++;
  const color = COLORS[(id - 1) % COLORS.length];
  const name  = 'Joueur ' + id;
  const client = {
    ws, id, color, name,
    username: null, token: null, isAdmin: false,
    announced: false, joinLogged: false, replaced: false,
    roomId: null,
  };
  allClients.push(client);

  // heartbeat
  let pongTimeout = null;
  const pingInterval = setInterval(() => {
    if (ws.readyState !== 1) { clearInterval(pingInterval); return; }
    ws.ping();
    pongTimeout = setTimeout(() => ws.terminate(), 10000);
  }, 30000);
  ws.on('pong', () => clearTimeout(pongTimeout));

  // rate limiting
  let msgCount = 0, msgWindowStart = Date.now();
  const MAX_MSG_PER_SEC = 60;

  // Envoyer immédiatement la liste des rooms (lobby)
  sendRoomList(client);

  // Délai de grâce pour l'authentification avant d'annoncer le nom temporaire
  setTimeout(() => {
    if (allClients.find(c => c.id === id) && !client.announced) {
      client.announced = true;
      logClientJoin(client);
      if (client.roomId != null) broadcastPlayerList(client.roomId);
    }
  }, 1500);

  ws.on('message', (raw) => {
    const now = Date.now();
    if (now - msgWindowStart > 1000) { msgCount = 0; msgWindowStart = now; }
    if (++msgCount > MAX_MSG_PER_SEC) return;

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      /* ---- authentification ---- */
      case 'register': {
        const username = typeof msg.username === 'string' ? msg.username : '';
        const password = typeof msg.password === 'string' ? msg.password : '';
        if (username.length < 3 || password.length < 4)
          { send(client, { type:'auth_err', msg:'Nom (≥3 car.) et mot de passe (≥4 car.) requis' }); break; }
        if (!/^[a-zA-Z0-9_\-]{3,32}$/.test(username))
          { send(client, { type:'auth_err', msg:"Nom invalide — lettres, chiffres, _ -" }); break; }
        const users = loadUsers();
        if (users[username]) { send(client, { type:'auth_err', msg:'Ce nom est déjà pris' }); break; }
        const col = userColor(username);
        const ph = passwordHash(password);
        users[username] = { passwordAlgo: ph.algo, passwordSalt: ph.salt, passwordHash: ph.hash, color: col };
        saveUsers(users);
        const token = issueToken(users, username);
        authenticateClient(client, { username, token, color: col });
        console.log(`[register] ${username}`);
        break;
      }

      case 'login': {
        const username = typeof msg.username === 'string' ? msg.username : '';
        const password = typeof msg.password === 'string' ? msg.password : '';
        const users = loadUsers();
        if (!users[username]) { send(client, { type:'auth_err', msg:'Utilisateur inconnu' }); break; }
        if (!verifyPassword(password, users[username])) { send(client, { type:'auth_err', msg:'Mot de passe incorrect' }); break; }
        if (users[username].passwordAlgo !== 'scrypt') {
          const ph = passwordHash(password);
          Object.assign(users[username], { passwordAlgo: ph.algo, passwordSalt: ph.salt, passwordHash: ph.hash });
        }
        const token = issueToken(users, username);
        authenticateClient(client, { username, token, color: users[username].color });
        console.log(`[login] ${username}`);
        break;
      }

      case 'resume': {
        const user = validateToken(msg.token);
        if (!user) { send(client, { type:'auth_err', msg:'Session expirée, reconnectez-vous' }); break; }
        authenticateClient(client, { username: user.username, token: msg.token, color: user.color });
        console.log(`[resume] ${user.username}`);
        break;
      }

      case 'logout': {
        Object.assign(client, {
          username: null, token: null,
          name: 'Joueur ' + client.id,
          color: COLORS[(client.id - 1) % COLORS.length],
        });
        send(client, { type:'logout_ok', name: client.name, color: client.color });
        if (client.roomId != null) broadcastPlayerList(client.roomId);
        console.log(`[logout] joueur #${client.id}`);
        break;
      }

      /* ---- rooms ---- */
      case 'list_rooms':
        sendRoomList(client);
        break;

      case 'join_room': {
        if (client.roomId != null) { send(client, { type:'room_err', msg:'Déjà dans une partie' }); break; }
        const roomId = Number(msg.roomId);
        const room = rooms.get(roomId);
        if (!room) { send(client, { type:'room_err', msg:'Monde introuvable' }); break; }

        client.roomId = room.id;

        if (room.hostId === null && client.username) {
          // seul un utilisateur authentifié peut devenir hôte
          room.hostId = id;
          send(client, { type:'hello', id, color, name: client.name, role:'host', isAdmin: false, worldConfig: room.worldConfig, roomId: room.id, roomName: room.name, saveName: room.saveName });
          const saveToLoad = getSave(room.saveName, room.saveUsername);
          if (saveToLoad) {
            const state = saveToLoad.state;
            state.world = state.world ? sanitizeWorldConfig(state.world) : room.worldConfig;
            room.worldConfig = state.world;
            send(client, { type:'game_loaded', state, name: saveToLoad.name, loadedBy:'serveur' });
            console.log(`[autoload] "${saveToLoad.name}" → ${client.name} (hôte de "${room.name}")`);
          }
        } else {
          send(client, { type:'hello', id, color, name: client.name, role:'guest', isAdmin: false, worldConfig: room.worldConfig, roomId: room.id, roomName: room.name, saveName: room.saveName });
          const host = room.hostId !== null ? allClients.find(c => c.id === room.hostId) : null;
          if (host) {
            room.pendingSnapshots.set(id, host.id);
            send(host, { type:'snapshot_request', forId: id });
          } else {
            // pas d'hôte : charger la save pour que le guest voie la carte, puis mettre en pause
            const saveToLoad = getSave(room.saveName, room.saveUsername);
            if (saveToLoad) {
              const state = saveToLoad.state;
              state.world = state.world ? sanitizeWorldConfig(state.world) : room.worldConfig;
              send(client, { type:'game_loaded', state, name: saveToLoad.name, loadedBy:'serveur' });
            }
            send(client, { type:'host_absent' });
          }
        }

        broadcastPlayerList(room.id);
        broadcastRoomList();
        console.log(`[room] ${clientLabel(client)} rejoint "${room.name}" (#${room.id})`);
        break;
      }

      case 'create_room': {
        if (!client.username) { send(client, { type:'room_err', msg:'Authentification requise pour créer un monde' }); break; }
        if (client.roomId != null) { send(client, { type:'room_err', msg:'Quitte ta partie en cours avant de créer un monde' }); break; }
        const rName = typeof msg.name === 'string' ? msg.name.trim().slice(0, 64) : '';
        if (!rName) { send(client, { type:'room_err', msg:'Nom du monde requis' }); break; }
        const room = createRoom({ name: rName, worldConfig: sanitizeWorldConfig(msg.worldConfig || {}) });
        // Auto-rejoindre comme hôte
        client.roomId = room.id;
        room.hostId = id;
        send(client, { type:'hello', id, color, name: client.name, role:'host', isAdmin: false, worldConfig: room.worldConfig, roomId: room.id, roomName: room.name, saveName: room.saveName });
        broadcastRoomList();
        console.log(`[room] ${client.username} crée "${room.name}" (#${room.id})`);
        break;
      }

      case 'leave_room': {
        if (client.roomId == null) break;
        const room = rooms.get(client.roomId);
        if (room) {
          room.pendingSnapshots.delete(client.id);
          if (room.hostId === client.id) {
            const remaining = roomClients(room.id).filter(c => c.id !== client.id);
            const nextHost = remaining.find(c => c.username);
            if (nextHost) {
              room.hostId = nextHost.id;
              send(nextHost, { type:'promoted_host', worldConfig: room.worldConfig });
              console.log(`[→] ${clientLabel(nextHost)} promu hôte de "${room.name}"`);
            } else {
              room.hostId = null;
              if (remaining.length > 0)
                broadcastRoom(room.id, { type:'host_absent' }, client.id);
            }
          }
          broadcastRoom(room.id, { type:'player_left', id, name: client.name, username: client.username }, id);
          client.roomId = null;
          broadcastPlayerList(room.id);
          broadcastRoomList();
          console.log(`[room] ${clientLabel(client)} quitte "${room.name}"`);
        } else {
          client.roomId = null;
        }
        send(client, { type:'left_room' });
        sendRoomList(client);
        break;
      }

      /* ---- sauvegardes ---- */
      case 'list_saves': {
        const user = validateToken(msg.token);
        if (!user) { send(client, { type:'save_err', msg:'Non authentifié' }); break; }
        const room = roomOf(client);
        send(client, { type:'saves_list', saves: room ? listRoomSaves(room) : [] });
        break;
      }

      case 'save_game': {
        if (!requirePrivileged(client, 'save_err')) break;
        const user = validateToken(msg.token);
        if (!user) { send(client, { type:'save_err', msg:'Non authentifié' }); break; }
        const room = roomOf(client);
        if (!room) break;
        const sName = (msg.name || '').trim();
        if (!sName) { send(client, { type:'save_err', msg:'Nom de sauvegarde requis' }); break; }
        try {
          const p = resolveRoomSavePath(room, sName);
          const stateWithRegistry = Object.assign({}, msg.state, {
            playerRegistry: Object.fromEntries(userOwnerRegistry),
          });
          fs.writeFileSync(p, JSON.stringify({
            meta: { room: room.name, username: user.username, name: sName, date: new Date().toISOString() },
            state: stateWithRegistry,
          }));
          if (!isAutoSaveName(sName)) {
            room.saveName = sName;
            room.saveUsername = user.username;
          }
          send(client, { type:'save_ok', name: sName });
          broadcastRoom(room.id, { type:'game_saved', name: sName, savedBy: user.username });
          send(client, { type:'saves_list', saves: listRoomSaves(room) });
          console.log(`[save] ${user.username} → "${sName}" (monde "${room.name}")`);
        } catch(e) { send(client, { type:'save_err', msg:'Erreur: ' + e.message }); }
        break;
      }

      case 'load_game': {
        if (!requirePrivileged(client, 'save_err')) break;
        const user = validateToken(msg.token);
        if (!user) { send(client, { type:'save_err', msg:'Non authentifié' }); break; }
        const room = roomOf(client);
        if (!room) break;
        const lName = (msg.name || '').trim();
        try {
          const p = resolveRoomSavePath(room, lName, { mustExist: true });
          if (!p || !fs.existsSync(p)) { send(client, { type:'save_err', msg:'Sauvegarde introuvable' }); break; }
          const data = JSON.parse(fs.readFileSync(p, 'utf8'));
          room.saveName = lName;
          room.saveUsername = user.username;
          broadcastRoom(room.id, { type:'game_loaded', state: data.state, name: lName, loadedBy: user.username });
          console.log(`[load] ${user.username} ← "${lName}" (monde "${room.name}")`);
        } catch(e) { send(client, { type:'save_err', msg:'Erreur: ' + e.message }); }
        break;
      }

      case 'delete_save': {
        if (!requirePrivileged(client, 'save_err')) break;
        const user = validateToken(msg.token);
        if (!user) { send(client, { type:'save_err', msg:'Non authentifié' }); break; }
        const room = roomOf(client);
        if (!room) break;
        const dName = (msg.name || '').trim();
        try {
          const p = resolveRoomSavePath(room, dName, { mustExist: true });
          if (!p || !fs.existsSync(p)) { send(client, { type:'save_err', msg:'Sauvegarde introuvable' }); break; }
          fs.unlinkSync(p);
          send(client, { type:'save_deleted', name: dName });
          send(client, { type:'saves_list', saves: listRoomSaves(room) });
          console.log(`[delete] ${user.username} ✕ "${dName}"`);
        } catch(e) { send(client, { type:'save_err', msg:'Erreur: ' + e.message }); }
        break;
      }

      /* ---- jeu (dans une room) ---- */
      case 'snapshot': {
        const room = roomOf(client);
        if (!room) break;
        if (client.id !== room.hostId || room.pendingSnapshots.get(Number(msg.forId)) !== client.id) break;
        const target = allClients.find(c => c.id === msg.forId);
        if (target) {
          if (msg.state) msg.state.playerRegistry = Object.fromEntries(userOwnerRegistry);
          room.pendingSnapshots.delete(Number(msg.forId));
          send(target, msg);
        }
        break;
      }

      case 'new_world': {
        if (!requirePrivileged(client, 'permission_err')) break;
        if (!client.username) { send(client, { type:'permission_err', msg:'Authentification requise' }); break; }
        const room = roomOf(client);
        if (!room) break;
        room.worldConfig = sanitizeWorldConfig(msg.config);
        const state = msg.state || {};
        state.world = room.worldConfig;
        broadcastRoom(room.id, { type:'game_new_world', state, config: room.worldConfig, createdBy: client.username || client.name });
        broadcastPlayerList(room.id);
        broadcastRoomList();
        console.log(`[world] ${client.username || client.name} → ${room.worldConfig.size}x${room.worldConfig.size} (monde "${room.name}")`);
        break;
      }

      case 'promote_admin': {
        if (!requirePrivileged(client, 'permission_err')) break;
        const room = roomOf(client);
        if (!room) break;
        const targetId = Number(msg.playerId);
        if (targetId === room.hostId) { send(client, { type:'permission_err', msg:'L\'hôte a déjà tous les droits' }); break; }
        const target = roomClients(room.id).find(c => c.id === targetId);
        if (!target) { send(client, { type:'permission_err', msg:'Joueur introuvable' }); break; }
        target.isAdmin = true;
        send(target, { type:'admin_promoted' });
        broadcastRoom(room.id, { type:'admin_changed', playerId: target.id, isAdmin: true, by: client.username || client.name });
        broadcastPlayerList(room.id);
        console.log(`[admin] ${target.name} promu par ${client.name}`);
        break;
      }

      case 'demote_admin': {
        if (!requirePrivileged(client, 'permission_err')) break;
        const room = roomOf(client);
        if (!room) break;
        const targetId = Number(msg.playerId);
        if (targetId === room.hostId) { send(client, { type:'permission_err', msg:'L\'hôte ne peut pas être rétrogradé' }); break; }
        const target = roomClients(room.id).find(c => c.id === targetId);
        if (!target) { send(client, { type:'permission_err', msg:'Joueur introuvable' }); break; }
        if (!target.isAdmin) { send(client, { type:'permission_err', msg:'Ce joueur n\'est pas administrateur' }); break; }
        target.isAdmin = false;
        send(target, { type:'admin_demoted' });
        broadcastRoom(room.id, { type:'admin_changed', playerId: target.id, isAdmin: false, by: client.username || client.name });
        broadcastPlayerList(room.id);
        console.log(`[admin] ${target.name} rétrogradé par ${client.name}`);
        break;
      }

      case 'action': {
        if (!client.username) break;
        const room = roomOf(client);
        if (!room) break;
        const act = sanitizeAction(client, msg);
        if (!act) break;
        if ((act.type === 'pause' || act.type === 'speed') && !isPrivileged(client)) break;
        broadcastRoom(room.id, { type:'action', act, from:id, fromUsername: client.username || null }, id);
        break;
      }

      case 'state_sync': {
        const room = roomOf(client);
        if (!room || client.id !== room.hostId || !msg.state) break;
        msg.state.playerRegistry = Object.fromEntries(userOwnerRegistry);
        broadcastRoom(room.id, { type:'state_sync', state: msg.state }, id);
        break;
      }

      // Flux « mouvement » léger (positions des entités mobiles) relayé tel quel.
      case 'move_sync': {
        const room = roomOf(client);
        if (!room || client.id !== room.hostId || !msg.state) break;
        broadcastRoom(room.id, { type:'move_sync', state: msg.state }, id);
        break;
      }

      case 'cursor': {
        const room = roomOf(client);
        if (room) broadcastRoom(room.id, msg, id);
        break;
      }

      case 'chat': {
        const room = roomOf(client);
        if (!room) break;
        msg.from = id;
        msg.name = client.name;
        broadcastRoom(room.id, msg);
        break;
      }

      default: break;
    }
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    clearTimeout(pongTimeout);
    allClients = allClients.filter(c => c.id !== id);
    if (client.replaced) return;

    console.log(`[-] ${clientLabel(client)} déconnecté (${allClients.length} connectés)`);

    if (client.roomId != null) {
      const room = rooms.get(client.roomId);
      if (room) {
        room.pendingSnapshots.delete(id);
        if (room.hostId === id) {
          const remaining = roomClients(room.id);
          const nextHost = remaining.find(c => c.username);
          if (nextHost) {
            room.hostId = nextHost.id;
            send(nextHost, { type:'promoted_host', worldConfig: room.worldConfig });
            console.log(`[→] ${clientLabel(nextHost)} promu hôte de "${room.name}"`);
          } else {
            room.hostId = null;
            if (remaining.length > 0)
              broadcastRoom(room.id, { type:'host_absent' });
          }
        }
        broadcastRoom(room.id, { type:'player_left', id, name: client.name, username: client.username });
        broadcastPlayerList(room.id);
        broadcastRoomList();
      }
    }
  });
});

// ---- console serveur ----
function printConsoleHelp() {
  console.log('Commandes console:');
  console.log('  help                         Affiche cette aide');
  console.log('  rooms                        Liste les mondes actifs');
  console.log('  players [roomId]             Liste les joueurs connectés');
  console.log('  saves [username]             Liste les sauvegardes');
  console.log('  say <message>                Envoie un message système à tous');
  console.log('  kick <id> [raison]           Déconnecte un joueur');
  console.log('  promote <id>                 Donne les droits admin à un joueur');
  console.log('  demote <id>                  Retire les droits admin d\'un joueur');
  console.log('  setmoney <nom> <montant>     Fixe le solde d\'un joueur');
  console.log('  regenexpansions              Régénère les zones d\'expansion');
  console.log('  spawnfields <type> [count]   Génère des champs (wheat/cotton)');
  console.log('  stop                         Arrête proprement le serveur');
}

function handleConsoleCommand(line) {
  const input = String(line || '').trim();
  if (!input) return;
  const [cmdRaw, ...args] = input.split(/\s+/);
  const cmd = cmdRaw.toLowerCase();
  const rest = input.slice(cmdRaw.length).trim();

  switch (cmd) {
    case 'help': case '?':
      printConsoleHelp();
      break;

    case 'rooms':
      if (!rooms.size) { console.log('Aucun monde.'); break; }
      rooms.forEach(r => {
        const rc = roomClients(r.id);
        console.log(`#${r.id} "${r.name}" — ${rc.length} joueurs${r.hostId ? '' : ' (vide)'}`);
        rc.forEach(c => {
          const flags = [c.id === r.hostId ? 'hôte' : '', c.isAdmin ? 'admin' : '', c.username ? `compte:${c.username}` : ''].filter(Boolean).join(', ');
          console.log(`  #${c.id} ${c.name}${flags ? ' (' + flags + ')' : ''}`);
        });
      });
      break;

    case 'players': {
      const roomId = args[0] ? Number(args[0]) : null;
      const list = roomId != null ? roomClients(roomId) : allClients;
      if (!list.length) { console.log('Aucun joueur.'); break; }
      list.forEach(c => {
        const room = roomOf(c);
        const flags = [
          room ? `monde:${room.name}` : 'lobby',
          c.id === room?.hostId ? 'hôte' : '',
          c.isAdmin ? 'admin' : '',
          c.username ? `compte:${c.username}` : '',
        ].filter(Boolean).join(', ');
        console.log(`#${c.id} ${c.name}${flags ? ' (' + flags + ')' : ''}`);
      });
      break;
    }

    case 'saves': {
      const username = args[0] || 'Fabrice';
      const saves = listUserSaves(username);
      if (!saves.length) { console.log(`Aucune sauvegarde pour ${username}.`); break; }
      saves.forEach(s => console.log(`${s.date}  ${s.owned ? ' ' : '*'} ${s.name}`));
      break;
    }

    case 'say': case 'system':
      if (!rest) { console.log('Usage: say <message>'); break; }
      broadcastEveryone({ type:'chat', from:0, name:'Système', text:rest });
      console.log(`[système] ${rest}`);
      break;

    case 'kick': {
      const kId = Number(args[0]);
      const target = allClients.find(c => c.id === kId);
      if (!target) { console.log('Joueur introuvable.'); break; }
      const reason = args.slice(1).join(' ') || 'Déconnecté par le serveur';
      send(target, { type:'server_shutdown', msg:reason });
      target.ws.close(1000, 'kicked');
      console.log(`[kick] #${target.id} ${target.name}: ${reason}`);
      break;
    }

    case 'promote': {
      const pId = Number(args[0]);
      const target = allClients.find(c => c.id === pId);
      if (!target) { console.log('Joueur introuvable.'); break; }
      target.isAdmin = true;
      send(target, { type:'admin_promoted' });
      if (target.roomId != null) {
        broadcastRoom(target.roomId, { type:'admin_changed', playerId: target.id, isAdmin: true, by:'console serveur' });
        broadcastPlayerList(target.roomId);
      }
      console.log(`[admin] ${target.name} promu depuis la console`);
      break;
    }

    case 'demote': {
      const pId = Number(args[0]);
      const target = allClients.find(c => c.id === pId);
      if (!target) { console.log('Joueur introuvable.'); break; }
      const room = target.roomId != null ? rooms.get(target.roomId) : null;
      if (room && target.id === room.hostId) { console.log('L\'hôte ne peut pas être rétrogradé.'); break; }
      if (!target.isAdmin) { console.log(`${target.name} n'est pas administrateur.`); break; }
      target.isAdmin = false;
      send(target, { type:'admin_demoted' });
      if (target.roomId != null) {
        broadcastRoom(target.roomId, { type:'admin_changed', playerId: target.id, isAdmin: false, by:'console serveur' });
        broadcastPlayerList(target.roomId);
      }
      console.log(`[admin] ${target.name} rétrogradé depuis la console`);
      break;
    }

    case 'setmoney': {
      const nameArg = args[0], amountArg = args[1];
      if (!nameArg || amountArg === undefined) { console.log('Usage: setmoney <nom> <montant>'); break; }
      const amount = Number(amountArg);
      if (!Number.isFinite(amount)) { console.log('Montant invalide.'); break; }
      const nameLower = nameArg.toLowerCase();
      const target = allClients.find(c => c.name.toLowerCase() === nameLower || (c.username || '').toLowerCase() === nameLower);
      if (!target) {
        console.log(`Joueur "${nameArg}" introuvable. Connectés :`);
        allClients.forEach(c => console.log(`  #${c.id} ${c.name}${c.username ? ' ('+c.username+')' : ''}`));
        break;
      }
      send(target, { type:'server_cmd', cmd:'set_money', amount: Math.round(amount) });
      console.log(`[setmoney] ${target.name} → ${Math.round(amount).toLocaleString()} $`);
      break;
    }

    case 'regenexpansions': case 'regenexp':
      if (!allClients.length) { console.log('Aucun joueur connecté.'); break; }
      broadcastEveryone({ type:'server_cmd', cmd:'regen_expansions' });
      console.log('[regenExpansions] Commande envoyée.');
      break;

    case 'spawnfields': case 'spawnfield': {
      const ALIASES = { ble:'wheat', blé:'wheat', coton:'cotton' };
      const rawType = (args[0] || '').toLowerCase();
      const fieldType = ALIASES[rawType] || rawType;
      const count = Math.max(1, Math.round(Number(args[1]) || 3));
      if (!['wheat','cotton'].includes(fieldType)) { console.log('Types acceptés : wheat (ble/blé), cotton (coton)'); break; }
      if (!allClients.length) { console.log('Aucun joueur connecté.'); break; }
      broadcastEveryone({ type:'server_cmd', cmd:'spawn_fields', fieldType, count });
      console.log(`[spawnFields] ${count} patch(s) de ${fieldType} envoyés.`);
      break;
    }

    case 'stop': case 'exit': case 'quit':
      shutdown('console');
      break;

    default:
      console.log(`Commande inconnue: ${cmd}. Tape "help".`);
  }
}

function startConsole() {
  if (!process.stdin.isTTY || consoleRl) return;
  consoleRl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'factopolis> ' });
  console.log('Console serveur prête. Tape "help" pour les commandes.');
  consoleRl.prompt();
  consoleRl.on('line', line => { handleConsoleCommand(line); if (!shuttingDown) consoleRl.prompt(); });
  consoleRl.on('SIGINT', () => shutdown('SIGINT'));
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} reçu, déconnexion des joueurs...`);
  if (consoleRl) { consoleRl.close(); consoleRl = null; }
  const notice = JSON.stringify({ type:'server_shutdown', msg:'Serveur arrêté' });
  for (const client of allClients) {
    if (client.ws.readyState === 1) { client.ws.send(notice); client.ws.close(1001, 'server_shutdown'); }
  }
  wss.close(() => httpServer.close(() => { console.log('[shutdown] serveur arrêté'); process.exit(0); }));
  setTimeout(() => { console.log('[shutdown] arrêt forcé'); process.exit(0); }, 1000).unref();
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Factopolis serveur lancé — http://0.0.0.0:${PORT}`);
  console.log(`WebSocket sur ws://0.0.0.0:${PORT}`);
  console.log(`${rooms.size} monde(s) chargé(s) : ${Array.from(rooms.values()).map(r => `"${r.name}"`).join(', ')}`);
  startConsole();
});
