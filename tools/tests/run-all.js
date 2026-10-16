#!/usr/bin/env node
// ===================== Factopolis — tests automatisés =====================
// Lance un serveur de test isolé (données dans un dossier temporaire, jamais
// dans data/), puis exécute dans Chromium headless :
//   - tools/tests/solo/*.js : code évalué dans la page, doit retourner
//     { ok:boolean, ... } (scénarios trains, économie, interface, sauvegardes…) ;
//   - tools/tests/mp/*.js   : modules async ({ host, guest, waitFor }) → { ok, ... }
//     joués avec deux navigateurs (hôte + invité).
// Prérequis : `npm i -D playwright` puis `npx playwright install chromium`.
// Usage : npm test            (tout)
//         npm test -- trains  (filtre sur le nom de fichier)
// ===========================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

let chromium;
try { ({ chromium } = require('playwright')); }
catch(e){
  console.error('Playwright est requis : npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = +(process.env.TEST_PORT || 8799);
const URL = 'http://localhost:' + PORT + '/';
const filter = process.argv[2] || '';
const LIB = fs.readFileSync(path.join(__dirname, 'lib.js'), 'utf8');
const LAUNCH = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };

function startServer(){
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factopolis-test-'));
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), String(PORT)], {
    cwd: ROOT, env: { ...process.env, FACTOPOLIS_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let stderr = '';
    const t = setTimeout(() => reject(new Error('serveur de test : démarrage trop long')), 10000);
    proc.stdout.on('data', d => { if(String(d).includes('serveur lancé')){ clearTimeout(t); resolve({ proc, dataDir }); } });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('exit', code => {
      clearTimeout(t);
      const hint = /EADDRINUSE/.test(stderr) ? ' — port ' + PORT + ' déjà pris : TEST_PORT=8797 npm test' : '';
      reject(new Error('serveur arrêté (' + code + ')' + hint + (stderr ? '\n' + stderr.trim().split('\n').slice(-3).join('\n') : '')));
    });
  });
}

async function openGame(browser, errors, tag){
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(tag + ' ' + e.message));
  page.on('console', m => { if(m.type() === 'error') errors.push(tag + ' ' + m.text()); });
  await page.goto(URL);
  await page.waitForTimeout(800);
  await page.click('#sSplashGo').catch(() => {});
  await page.addScriptTag({ content: LIB });
  await page.evaluate(() => { paused = true; });
  return page;
}

async function waitFor(page, fn, arg, timeout = 15000){
  const t0 = Date.now();
  while(Date.now() - t0 < timeout){
    if(await page.evaluate(fn, arg)) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

async function login(page, user){
  await page.evaluate(() => mpConnect('ws://' + location.host + '/ws'));
  await waitFor(page, () => MP.connected);
  await page.evaluate(u => MP.ws.send(JSON.stringify({ type:'register', username:u, password:'pass1234' })), user);
  await waitFor(page, () => !!MP.username, null, 5000);
}

async function runSolo(browser, file){
  const errors = [];
  const page = await openGame(browser, errors, '');
  let res;
  try { res = await page.evaluate('(async()=>{' + fs.readFileSync(file, 'utf8') + '})()'); }
  catch(e){ res = { ok:false, error:e.message }; }
  await page.context().close();
  if(errors.length) res = { ...(res || {}), ok:false, pageErrors:errors.slice(0, 5) };
  return res;
}

async function runMp(browser, file){
  const errors = [];
  const host = await openGame(browser, errors, 'HÔTE');
  const guest = await openGame(browser, errors, 'INVITÉ');
  const tag = Date.now().toString(36).slice(-5);
  await login(host, 'h' + tag);
  await login(guest, 'g' + tag);
  await host.evaluate(n => MP.ws.send(JSON.stringify({ type:'create_room', name:n })), 'R' + tag);
  await waitFor(host, () => MP.role === 'host');
  const roomId = await host.evaluate(() => MP.roomId);
  await guest.evaluate(id => mpJoinRoom(id), roomId);
  await waitFor(guest, () => MP.role === 'guest' && !MP.awaitingSnapshot);
  let res;
  try { res = await require(file)({ host, guest, waitFor }); }
  catch(e){ res = { ok:false, error:e.message }; }
  await host.context().close();
  await guest.context().close();
  if(errors.length) res = { ...(res || {}), ok:false, pageErrors:errors.slice(0, 5) };
  return res;
}

(async () => {
  const list = d => fs.readdirSync(path.join(__dirname, d)).filter(f => f.endsWith('.js') && f.includes(filter)).map(f => path.join(__dirname, d, f));
  const solo = list('solo'), mp = list('mp');
  const { proc, dataDir } = await startServer();
  const browser = await chromium.launch(LAUNCH);
  let failed = 0;
  const report = (file, res, ms) => {
    const name = path.relative(__dirname, file).replace(/\\/g, '/');
    const ok = !!res?.ok;
    if(!ok) failed++;
    console.log((ok ? '✅' : '❌') + ' ' + name + ' (' + (ms / 1000).toFixed(1) + ' s)' + (ok ? '' : '\n   ' + JSON.stringify(res)));
  };
  try {
    for(const f of solo){ const t = Date.now(); report(f, await runSolo(browser, f), Date.now() - t); }
    for(const f of mp){ const t = Date.now(); report(f, await runMp(browser, f), Date.now() - t); }
  } finally {
    await browser.close();
    proc.kill();
    fs.rmSync(dataDir, { recursive:true, force:true });
  }
  console.log(failed ? '\n' + failed + ' test(s) en échec' : '\nTous les tests passent');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
