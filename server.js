'use strict';
/* ===================== Factopolis — Serveur multijoueur =====================
   Lancer : node server.js [port]   (défaut : 8765)

   Données persistantes :
     data/users.json          → comptes joueurs
     data/saves/<user>_<nom>.json  → sauvegardes
   =========================================================================== */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { WebSocketServer } = require('ws');

const PORT      = process.env.PORT || process.argv[2] || 8765;
const STATIC    = __dirname;
const DATA_DIR  = path.join(__dirname, 'data');
const SAVES_DIR = path.join(DATA_DIR, 'saves');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// création des répertoires si absents
if (!fs.existsSync(DATA_DIR))  fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(SAVES_DIR)) fs.mkdirSync(SAVES_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');

// ---- utilitaires ----
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const makeToken = (username, pwHash) => sha256('token:' + username + ':' + pwHash);

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return {}; }
}
function saveUsers(u) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2));
}
function validateToken(token) {
  if (!token) return null;
  const users = loadUsers();
  for (const [username, u] of Object.entries(users)) {
    if (makeToken(username, u.passwordHash) === token)
      return { username, color: u.color };
  }
  return null;
}

// nom de fichier sûr
const safeName = s => s.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 64);
const saveFileName = (username, name) =>
  safeName(username) + '_' + safeName(name) + '.json';
const savePath = (username, name) =>
  path.join(SAVES_DIR, saveFileName(username, name));

function resolveSavePath(username, name) {
  const wanted = saveFileName(username, name);
  const exact = path.join(SAVES_DIR, wanted);
  if (fs.existsSync(exact)) return exact;

  const wantedLower = wanted.toLowerCase();
  try {
    const match = fs.readdirSync(SAVES_DIR)
      .find(f => f.endsWith('.json') && f.toLowerCase() === wantedLower);
    if (match) return path.join(SAVES_DIR, match);
  } catch {}

  const wantedNameLower = String(name || '').toLowerCase();
  try {
    const byMetaName = fs.readdirSync(SAVES_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const fullPath = path.join(SAVES_DIR, f);
        const stat = fs.statSync(fullPath);
        try {
          const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          return { file: f, path: fullPath, mtimeMs: stat.mtimeMs, name: data.meta?.name || null };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter(s => String(s.name || '').toLowerCase() === wantedNameLower)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (byMetaName) return byMetaName.path;
  } catch {}

  return exact;
}

function listUserSaves(username) {
  const prefix = safeName(username) + '_';
  const prefixLower = prefix.toLowerCase();
  const userLower = String(username || '').toLowerCase();
  try {
    const files = fs.readdirSync(SAVES_DIR).filter(f => f.endsWith('.json'));
    const readSave = f => {
      const fullPath = path.join(SAVES_DIR, f);
      const stat = fs.statSync(fullPath);
      let data = null;
      try { data = JSON.parse(fs.readFileSync(fullPath, 'utf8')); } catch {}
      const owned =
        f.toLowerCase().startsWith(prefixLower)
        || String(data?.meta?.username || '').toLowerCase() === userLower;
      const name = data?.meta?.name || f.replace(/\.json$/, '');
      return { name, date: stat.mtime.toISOString(), owned };
    };

    const saves = files
      .filter(f => {
        if (!f.endsWith('.json')) return false;
        if (f.toLowerCase().startsWith(prefixLower)) return true;
        try {
          const data = JSON.parse(fs.readFileSync(path.join(SAVES_DIR, f), 'utf8'));
          return String(data.meta?.username || '').toLowerCase() === userLower;
        } catch {
          return false;
        }
      })
      .map(readSave);
    const visible = saves.length ? saves : files.map(readSave);
    return visible.sort((a, b) => b.date.localeCompare(a.date));
  } catch { return []; }
}

function getLatestSave() {
  try {
    const latest = fs.readdirSync(SAVES_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const fullPath = path.join(SAVES_DIR, f);
        const stat = fs.statSync(fullPath);
        return { file: f, path: fullPath, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (!latest) return null;
    const data = JSON.parse(fs.readFileSync(latest.path, 'utf8'));
    if (!data || !data.state) return null;
    return {
      name: data.meta?.name || latest.file.replace(/\.json$/, ''),
      username: data.meta?.username || null,
      date: data.meta?.date || new Date(latest.mtimeMs).toISOString(),
      state: data.state,
    };
  } catch (e) {
    console.warn('[autoload] impossible de lire la dernière sauvegarde:', e.message);
    return null;
  }
}

// couleur déterministe par username
const COLORS = ['#e25e4c','#4ca3e2','#58c470','#e2a93f','#b06fd8','#f0a040','#40d0c0','#e0e0e0'];
const userColor = username => COLORS[parseInt(sha256(username).slice(0,2), 16) % COLORS.length];

// ---- serveur HTTP (fichiers statiques) ----
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css',   '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};
const httpServer = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const p = path.join(STATIC, urlPath === '/' ? 'index.html' : urlPath);
  if (!p.startsWith(STATIC + path.sep) && p !== path.join(STATIC, 'index.html')) {
    res.writeHead(403); res.end(); return;
  }
  if (!fs.existsSync(p)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain', 'Cache-Control': 'no-cache' });
  fs.createReadStream(p).pipe(res);
});

// ---- WebSocket ----
const wss = new WebSocketServer({ server: httpServer });

let nextId  = 1;
let clients = [];   // { ws, id, color, name, username, token, isAdmin }
let hostId  = null;
let worldConfig = { size: 64, maxPlayers: 8, resources: { tree: 8, wheat: 4, cotton: 1, iron: 2, coal: 2 } };
const startupSave = getLatestSave();
let startupSaveLoaded = false;
if (startupSave?.state?.world) worldConfig = sanitizeWorldConfig(startupSave.state.world);
if (startupSave) {
  console.log(`[autoload] dernière sauvegarde prête: "${startupSave.name}"${startupSave.username ? ' (' + startupSave.username + ')' : ''}`);
}

const send = (c, msg) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); };
const broadcastAll  = msg => { const r = JSON.stringify(msg); clients.forEach(c => { if(c.ws.readyState===1) c.ws.send(r); }); };
const broadcast     = (msg, excludeId) => { const r = JSON.stringify(msg); clients.forEach(c => { if(c.id!==excludeId && c.ws.readyState===1) c.ws.send(r); }); };
// Mémorise le dernier id de connexion de chaque joueur authentifié (persiste les reconnexions)
const userOwnerRegistry = new Map(); // username → last connection id
if (startupSave?.state?.playerRegistry && typeof startupSave.state.playerRegistry === 'object') {
  for (const [username, id] of Object.entries(startupSave.state.playerRegistry)) {
    const n = Number(id);
    if (username && Number.isFinite(n)) userOwnerRegistry.set(username, n);
  }
  const maxKnownId = Math.max(0, ...Array.from(userOwnerRegistry.values()));
  nextId = Math.max(nextId, maxKnownId + 1);
}
let shuttingDown = false;
let consoleRl = null;

function broadcastPlayerList() {
  const list = clients.map(c => ({
    id: c.id, name: c.name, color: c.color,
    isHost: c.id === hostId, isAdmin: !!c.isAdmin, username: c.username || null,
  }));
  broadcastAll({ type: 'player_list', players: list });
}

function isPrivileged(c) {
  return c && (c.id === hostId || c.isAdmin);
}

function requirePrivileged(c, errType = 'permission_err') {
  if (isPrivileged(c)) return true;
  send(c, { type: errType, msg: 'Action réservée à l’hôte ou aux administrateurs' });
  return false;
}

function clientLabel(c) {
  return c?.username || c?.name || (c ? 'Joueur ' + c.id : 'Joueur inconnu');
}

function logClientJoin(c) {
  if (!c || c.joinLogged) return;
  c.joinLogged = true;
  console.log(`[+] ${clientLabel(c)} connecté (#${c.id}, ${clients.length} joueurs)`);
}

function replaceExistingAuthenticatedClient(username, replacement) {
  const old = clients.find(c => c !== replacement && c.username === username);
  if (!old) return;

  old.replaced = true;
  clients = clients.filter(c => c !== old);
  if (hostId === old.id) {
    hostId = replacement.id;
    send(replacement, { type: 'promoted_host', worldConfig });
    console.log(`[→] ${clientLabel(replacement)} promu hôte`);
  }
  broadcastAll({ type:'player_left', id: old.id, name: old.name, username: old.username });
  try { old.ws.close(4000, 'replaced_by_new_session'); } catch {}
  console.log(`[~] ${clientLabel(old)} remplacé par une nouvelle connexion`);
}

function authenticateClient(client, { username, token, color, isAdmin = false }) {
  const prevOwnerId = userOwnerRegistry.get(username) ?? null;
  Object.assign(client, { username, token, name: username, color, isAdmin, announced: true });
  replaceExistingAuthenticatedClient(username, client);
  userOwnerRegistry.set(username, client.id);
  send(client, { type:'auth_ok', username, color, token, prevOwnerId });
  logClientJoin(client);
  broadcastPlayerList();
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
  const resources = config.resources || {};
  return {
    size: clampInt(config.size, 32, 128, worldConfig.size),
    maxPlayers: clampInt(config.maxPlayers, 1, 32, worldConfig.maxPlayers),
    resources: {
      tree: clampPercent(resources.tree, worldConfig.resources.tree),
      wheat: clampPercent(resources.wheat, worldConfig.resources.wheat),
      cotton: clampPercent(resources.cotton, worldConfig.resources.cotton),
      iron: clampPercent(resources.iron, worldConfig.resources.iron),
      coal: clampPercent(resources.coal, worldConfig.resources.coal),
    },
  };
}

wss.on('connection', (ws) => {
  if (shuttingDown) {
    ws.send(JSON.stringify({ type: 'server_shutdown', msg: 'Serveur arrêté' }));
    ws.close(1001, 'server_shutdown');
    return;
  }

  if (clients.length >= worldConfig.maxPlayers) {
    ws.send(JSON.stringify({ type: 'server_full', msg: 'Serveur complet' }));
    ws.close();
    return;
  }
  const id    = nextId++;
  const color = COLORS[(id - 1) % COLORS.length];
  const name  = 'Joueur ' + id;
  const client = { ws, id, color, name, username: null, token: null, isAdmin: false, announced: false, joinLogged: false, replaced: false };
  clients.push(client);

  if (hostId === null) {
    hostId = id;
    send(client, { type: 'hello', id, color, name, role: 'host', isAdmin: false, worldConfig });
    if (startupSave && !startupSaveLoaded) {
      startupSaveLoaded = true;
      const state = startupSave.state;
      state.world = state.world ? sanitizeWorldConfig(state.world) : worldConfig;
      // Ne pas écraser state.size : pour le nouveau format, state.size est la taille COMPLÈTE
      // de la carte (N_FULL), alors que state.world.size est la taille jouable (N_PLAY).
      // Écraser avec world.size causerait une corruption visuelle dans applySnapshot.
      worldConfig = state.world;
      send(client, {
        type: 'game_loaded',
        state,
        name: startupSave.name,
        loadedBy: 'serveur',
      });
      console.log(`[autoload] "${startupSave.name}" envoyée au premier hôte`);
    }
  } else {
    send(client, { type: 'hello', id, color, name, role: 'guest', isAdmin: false, worldConfig });
    const host = clients.find(c => c.id === hostId);
    if (host) send(host, { type: 'snapshot_request', forId: id });
  }
  // Délai de grâce : si le joueur s'authentifie (resume/login), cet handler évite
  // d'annoncer un nom temporaire du type "Joueur 4".
  // la liste avec le bon nom/couleur. Sinon on annonce après 1,5 s.
  setTimeout(() => {
    if (clients.find(c => c.id === id) && !client.announced) {
      client.announced = true;
      logClientJoin(client);
      broadcastPlayerList();
    }
  }, 1500);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      /* ---- authentification ---- */
      case 'register': {
        const { username = '', password = '' } = msg;
        if (username.length < 3 || password.length < 4)
          { send(client, { type:'auth_err', msg:'Nom (≥3 car.) et mot de passe (≥4 car.) requis' }); break; }
        if (!/^[a-zA-Z0-9_\-]{3,32}$/.test(username))
          { send(client, { type:'auth_err', msg:"Nom invalide — lettres, chiffres, _ -" }); break; }
        const users = loadUsers();
        if (users[username])
          { send(client, { type:'auth_err', msg:'Ce nom est déjà pris' }); break; }
        const passwordHash = sha256(password);
        const color = userColor(username);
        users[username] = { passwordHash, color };
        saveUsers(users);
        const token = makeToken(username, passwordHash);
        authenticateClient(client, { username, token, color });
        console.log(`[register] ${username}`);
        break;
      }

      case 'login': {
        const { username = '', password = '' } = msg;
        const users = loadUsers();
        if (!users[username])
          { send(client, { type:'auth_err', msg:'Utilisateur inconnu' }); break; }
        const passwordHash = sha256(password);
        if (users[username].passwordHash !== passwordHash)
          { send(client, { type:'auth_err', msg:'Mot de passe incorrect' }); break; }
        const token = makeToken(username, passwordHash);
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
          username: null,
          token: null,
          name: 'Joueur ' + client.id,
          color: COLORS[(client.id - 1) % COLORS.length],
        });
        send(client, { type:'logout_ok', name: client.name, color: client.color });
        broadcastPlayerList();
        console.log(`[logout] joueur #${client.id}`);
        break;
      }

      /* ---- sauvegardes ---- */
      case 'list_saves': {
        const user = validateToken(msg.token);
        if (!user) { send(client, { type:'save_err', msg:'Non authentifié' }); break; }
        send(client, { type:'saves_list', saves: listUserSaves(user.username) });
        break;
      }

      case 'save_game': {
        if (!requirePrivileged(client, 'save_err')) break;
        const user = validateToken(msg.token);
        if (!user) { send(client, { type:'save_err', msg:'Non authentifié' }); break; }
        const name = (msg.name || '').trim();
        if (!name) { send(client, { type:'save_err', msg:'Nom de sauvegarde requis' }); break; }
        try {
          const p = resolveSavePath(user.username, name);
          // Injecter le mapping username→id pour permettre la récupération après redémarrage serveur
          const stateWithRegistry = Object.assign({}, msg.state, {
            playerRegistry: Object.fromEntries(userOwnerRegistry),
          });
          fs.writeFileSync(p, JSON.stringify({
            meta: { username: user.username, name, date: new Date().toISOString() },
            state: stateWithRegistry,
          }));
          send(client, { type:'save_ok', name });
          broadcastAll({ type:'game_saved', name, savedBy: user.username });
          // rafraîchir la liste pour ce joueur
          send(client, { type:'saves_list', saves: listUserSaves(user.username) });
          console.log(`[save] ${user.username} → "${name}"`);
        } catch(e) { send(client, { type:'save_err', msg:'Erreur: ' + e.message }); }
        break;
      }

      case 'load_game': {
        if (!requirePrivileged(client, 'save_err')) break;
        const user = validateToken(msg.token);
        if (!user) { send(client, { type:'save_err', msg:'Non authentifié' }); break; }
        const name = (msg.name || '').trim();
        try {
          const p = resolveSavePath(user.username, name);
          if (!fs.existsSync(p)) { send(client, { type:'save_err', msg:'Sauvegarde introuvable' }); break; }
          const data = JSON.parse(fs.readFileSync(p, 'utf8'));
          // diffuser l'état à TOUS les joueurs connectés
          broadcastAll({ type:'game_loaded', state: data.state, name, loadedBy: user.username });
          console.log(`[load] ${user.username} ← "${name}"`);
        } catch(e) { send(client, { type:'save_err', msg:'Erreur: ' + e.message }); }
        break;
      }

      case 'delete_save': {
        if (!requirePrivileged(client, 'save_err')) break;
        const user = validateToken(msg.token);
        if (!user) { send(client, { type:'save_err', msg:'Non authentifié' }); break; }
        const name = (msg.name || '').trim();
        try {
          const p = resolveSavePath(user.username, name);
          if (fs.existsSync(p)) fs.unlinkSync(p);
          send(client, { type:'save_deleted', name });
          send(client, { type:'saves_list', saves: listUserSaves(user.username) });
          console.log(`[delete] ${user.username} ✕ "${name}"`);
        } catch(e) { send(client, { type:'save_err', msg:'Erreur: ' + e.message }); }
        break;
      }

      /* ---- jeu ---- */
      case 'snapshot': {
        const target = clients.find(c => c.id === msg.forId);
        if (target) {
          // Injecter le registry courant du serveur dans le snapshot
          if (msg.state) msg.state.playerRegistry = Object.fromEntries(userOwnerRegistry);
          send(target, msg);
        }
        break;
      }
      case 'new_world': {
        if (!requirePrivileged(client, 'permission_err')) break;
        worldConfig = sanitizeWorldConfig(msg.config);
        const state = msg.state || {};
        state.world = worldConfig;
        // Ne pas écraser state.size : le client sérialise la taille COMPLÈTE (N_FULL = N_PLAY + 2*EXP_MARGIN)
        // Écraser avec worldConfig.size (= N_PLAY) provoquerait une corruption chez tous les clients.
        broadcastAll({
          type: 'game_new_world',
          state,
          config: worldConfig,
          createdBy: client.username || client.name,
        });
        broadcastPlayerList();
        console.log(`[world] ${client.username || client.name} → ${worldConfig.size}x${worldConfig.size}, max ${worldConfig.maxPlayers}`);
        break;
      }
      case 'promote_admin': {
        if (!requirePrivileged(client, 'permission_err')) break;
        const targetId = Number(msg.playerId);
        if (targetId === hostId) { send(client, { type:'permission_err', msg:'L’hôte a déjà tous les droits' }); break; }
        const target = clients.find(c => c.id === targetId);
        if (!target) { send(client, { type:'permission_err', msg:'Joueur introuvable' }); break; }
        target.isAdmin = true;
        send(target, { type:'admin_promoted' });
        broadcastAll({ type:'admin_changed', playerId: target.id, isAdmin: true, by: client.username || client.name });
        broadcastPlayerList();
        console.log(`[admin] ${target.name} promu par ${client.name}`);
        break;
      }
      case 'action':  msg.from = id; msg.fromUsername = client.username || null; broadcast(msg, id); break;
      case 'cursor':  broadcast(msg, id); break;
      case 'chat':
        msg.from = id;
        msg.name = client.name;
        broadcastAll(msg);
        break;

      default: break;
    }
  });

  ws.on('close', () => {
    clients = clients.filter(c => c.id !== id);
    if (client.replaced) return;
    console.log(`[-] ${clientLabel(client)} déconnecté (${clients.length} joueurs)`);
    if (hostId === id) {
      if (clients.length > 0) {
        hostId = clients[0].id;
        send(clients[0], { type: 'promoted_host', worldConfig });
        console.log(`[→] ${clientLabel(clients[0])} promu hôte`);
      } else { hostId = null; }
    }
    broadcastAll({ type:'player_left', id, name: client.name, username: client.username });
    broadcastPlayerList();
  });
});

function printConsoleHelp() {
  console.log('Commandes console:');
  console.log('  help                         Affiche cette aide');
  console.log('  players                      Liste les joueurs connectés');
  console.log('  world                        Affiche la configuration du monde');
  console.log('  saves [username]             Liste les sauvegardes visibles');
  console.log('  system <message>             Envoie un message système dans le chat');
  console.log('  kick <id> [raison]           Déconnecte un joueur');
  console.log('  promote <id>                 Donne les droits admin à un joueur');
  console.log('  setmoney <nom> <montant>     Fixe le solde d\'un joueur connecté');
  console.log('  regenexpansions              Régénère le terrain des zones d\'expansion non achetées');
  console.log('  spawnfields <type> [count]   Génère des champs aléatoires (type: wheat/ble, cotton/coton)');
  console.log('  stop                         Arrête proprement le serveur');
}

function handleConsoleCommand(line) {
  const input = String(line || '').trim();
  if (!input) return;

  const [cmdRaw, ...args] = input.split(/\s+/);
  const cmd = cmdRaw.toLowerCase();
  const rest = input.slice(cmdRaw.length).trim();

  switch (cmd) {
    case 'help':
    case '?':
      printConsoleHelp();
      break;

    case 'players':
      if (!clients.length) {
        console.log('Aucun joueur connecté.');
        break;
      }
      clients.forEach(c => {
        const flags = [
          c.id === hostId ? 'hôte' : '',
          c.isAdmin ? 'admin' : '',
          c.username ? `compte:${c.username}` : '',
        ].filter(Boolean).join(', ');
        console.log(`#${c.id} ${c.name}${flags ? ' (' + flags + ')' : ''}`);
      });
      break;

    case 'world':
      console.log(JSON.stringify(worldConfig, null, 2));
      break;

    case 'saves': {
      const username = args[0] || 'Fabrice';
      const saves = listUserSaves(username);
      if (!saves.length) {
        console.log(`Aucune sauvegarde pour ${username}.`);
        break;
      }
      saves.forEach(s => console.log(`${s.date}  ${s.owned ? ' ' : '*'} ${s.name}`));
      break;
    }

    case 'say':
    case 'system':
      if (!rest) {
        console.log('Usage: system <message>');
        break;
      }
      broadcastAll({ type: 'chat', from: 0, name: 'Système', text: rest });
      console.log(`[système] ${rest}`);
      break;

    case 'kick': {
      const id = Number(args[0]);
      const target = clients.find(c => c.id === id);
      if (!target) {
        console.log('Joueur introuvable.');
        break;
      }
      const reason = args.slice(1).join(' ') || 'Déconnecté par le serveur';
      send(target, { type: 'server_shutdown', msg: reason });
      target.ws.close(1000, 'kicked');
      console.log(`[kick] #${target.id} ${target.name}: ${reason}`);
      break;
    }

    case 'promote': {
      const id = Number(args[0]);
      const target = clients.find(c => c.id === id);
      if (!target) {
        console.log('Joueur introuvable.');
        break;
      }
      if (target.id === hostId) {
        console.log('Ce joueur est déjà hôte.');
        break;
      }
      target.isAdmin = true;
      send(target, { type:'admin_promoted' });
      broadcastAll({ type:'admin_changed', playerId: target.id, isAdmin: true, by: 'console serveur' });
      broadcastPlayerList();
      console.log(`[admin] ${target.name} promu depuis la console`);
      break;
    }

    case 'setmoney': {
      const nameArg  = args[0];
      const amountArg = args[1];
      if (!nameArg || amountArg === undefined) {
        console.log('Usage: setmoney <nom_joueur> <montant>');
        break;
      }
      const amount = Number(amountArg);
      if (!Number.isFinite(amount)) {
        console.log('Montant invalide : doit être un nombre.');
        break;
      }
      const nameLower = nameArg.toLowerCase();
      const target = clients.find(c =>
        c.name.toLowerCase() === nameLower ||
        (c.username || '').toLowerCase() === nameLower
      );
      if (!target) {
        console.log(`Joueur "${nameArg}" introuvable. Joueurs connectés :`);
        clients.forEach(c => console.log(`  #${c.id} ${c.name}${c.username ? ' ('+c.username+')' : ''}`));
        break;
      }
      send(target, { type: 'server_cmd', cmd: 'set_money', amount: Math.round(amount) });
      console.log(`[setmoney] ${target.name} → ${Math.round(amount).toLocaleString()} $`);
      break;
    }

    case 'regenexpansions':
    case 'regenexp': {
      if (!clients.length) {
        console.log('Aucun joueur connecté — commande ignorée.');
        break;
      }
      broadcastAll({ type: 'server_cmd', cmd: 'regen_expansions' });
      console.log('[regenExpansions] Commande envoyée à tous les clients. Le terrain des zones d\'expansion sera régénéré.');
      break;
    }

    case 'spawnfields':
    case 'spawnfield': {
      const ALIASES = { ble: 'wheat', blé: 'wheat', coton: 'cotton' };
      const rawType = (args[0] || '').toLowerCase();
      const fieldType = ALIASES[rawType] || rawType;
      const count = Math.max(1, Math.round(Number(args[1]) || 3));

      if (!['wheat', 'cotton'].includes(fieldType)) {
        console.log('Type de champ invalide : "' + (args[0] || '') + '".');
        console.log('Types acceptés : wheat (ou ble/blé), cotton (ou coton)');
        break;
      }
      if (!clients.length) {
        console.log('Aucun joueur connecté — commande ignorée.');
        break;
      }
      broadcastAll({ type: 'server_cmd', cmd: 'spawn_fields', fieldType, count });
      console.log(`[spawnFields] ${count} patch(s) de ${fieldType} envoyés à tous les clients.`);
      break;
    }

    case 'stop':
    case 'exit':
    case 'quit':
      shutdown('console');
      break;

    default:
      console.log(`Commande inconnue: ${cmd}. Tape "help" pour la liste.`);
      break;
  }
}

function startConsole() {
  if (!process.stdin.isTTY || consoleRl) return;
  consoleRl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'factopolis> ',
  });
  console.log('Console serveur prête. Tape "help" pour les commandes.');
  consoleRl.prompt();
  consoleRl.on('line', line => {
    handleConsoleCommand(line);
    if (!shuttingDown) consoleRl.prompt();
  });
  consoleRl.on('SIGINT', () => shutdown('SIGINT'));
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} reçu, déconnexion des joueurs...`);
  if (consoleRl) {
    consoleRl.close();
    consoleRl = null;
  }

  const notice = JSON.stringify({ type: 'server_shutdown', msg: 'Serveur arrêté' });
  for (const client of clients) {
    if (client.ws.readyState === 1) {
      client.ws.send(notice);
      client.ws.close(1001, 'server_shutdown');
    }
  }

  wss.close(() => {
    httpServer.close(() => {
      console.log('[shutdown] serveur arrêté');
      process.exit(0);
    });
  });

  setTimeout(() => {
    console.log('[shutdown] arrêt forcé');
    process.exit(0);
  }, 1000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Factopolis serveur lancé — http://0.0.0.0:${PORT}`);
  console.log(`WebSocket sur ws://0.0.0.0:${PORT}`);
  console.log(`Données dans : ${DATA_DIR}`);
  startConsole();
});
