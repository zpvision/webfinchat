import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const cleanup = await readFile('src/retireLegacyWorker.js', 'utf8');
const retirement = await readFile('public/service-worker.js', 'utf8');
const oldHtml = '<!doctype html><title>Tinode legacy fixture</title><h1>Tinode fixture</h1><script src="/register.js"></script>';
const oldWorker = `self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(Promise.resolve(new Response(${JSON.stringify(oldHtml)},{headers:{'Content-Type':'text/html'}})));});`;
let fresh = false, retirementEnabled = false;
const server = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/service-worker.js' || req.url === '/other/worker.js') {
    res.setHeader('Content-Type', 'application/javascript');
    res.end(req.url.startsWith('/other/') ? "self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));" : retirementEnabled ? retirement : oldWorker);
  } else if (req.url === '/cleanup.js') {
    res.setHeader('Content-Type', 'application/javascript'); res.end(cleanup);
  } else if (req.url === '/register.js') {
    res.setHeader('Content-Type', 'application/javascript'); res.end("navigator.serviceWorker.register('/service-worker.js');");
  } else {
    res.setHeader('Content-Type', 'text/html');
    res.end(fresh ? '<!doctype html><title>FinChat fixture</title><h1>FinChat fixture</h1><script type="module">import {retireLegacyWorker} from "/cleanup.js"; await retireLegacyWorker(); window.cleanupFinished=true;</script>' : oldHtml);
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const executable = process.env.FINCHAT_TEST_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync);
if (!executable) { await new Promise((resolve) => server.close(resolve)); throw new Error('Set FINCHAT_TEST_BROWSER to Chrome/Chromium.'); }
const profile = await mkdtemp(join(tmpdir(), 'finchat-legacy-worker-'));
const browser = spawn(executable, ['--headless=new', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
let ws;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await pause(100); }
  }
  assert.ok(port, 'Chrome debugging port');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map(), errors = [];
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, replMode: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async (expression) => {
    const until = Date.now() + 15000;
    while (!await evaluate(expression)) { if (Date.now() > until) throw new Error('Timed out: ' + expression); await pause(); }
  };
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.navigate', { url: base });
  await wait('Boolean(navigator.serviceWorker?.controller)');
  await evaluate(`localStorage.setItem('finchatSession','session-fixture'); sessionStorage.setItem('draft','draft-fixture'); document.cookie='finchat_fixture=keep; SameSite=Lax'; await (await caches.open('keep-fixture')).put('/marker',new Response('keep'));`);

  // Reproduce: network serves FinChat while an old worker keeps showing Tinode.
  fresh = true;
  await send('Page.navigate', { url: base + '/?old-worker-repro' });
  await wait(`document.title === 'Tinode legacy fixture'`);
  console.log('Reproduced old Tinode page despite fresh FinChat HTTP response');

  // Simulate the user getting the new frontend once via a refresh that bypasses SW.
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Page.navigate', { url: base + '/?fresh' });
  await wait('window.cleanupFinished === true');
  assert.equal(await evaluate(`Boolean(await navigator.serviceWorker.getRegistration(location.origin+'/'))`), false);
  await send('Network.setBypassServiceWorker', { bypass: false });
  await send('Page.navigate', { url: base + '/?next-visit' });
  await wait(`window.cleanupFinished && document.title === 'FinChat fixture'`);

  // An old page which never runs our frontend can still update its old script URL.
  await evaluate(`await navigator.serviceWorker.register('/service-worker.js')`);
  await wait('Boolean(navigator.serviceWorker.controller)');
  retirementEnabled = true;
  await evaluate(`await (await navigator.serviceWorker.getRegistration(location.origin+'/')).update()`);
  await wait(`(await navigator.serviceWorker.getRegistrations()).length === 0`);
  await send('Page.navigate', { url: base + '/?after-worker-update' });
  await wait(`window.cleanupFinished && document.title === 'FinChat fixture'`);

  // Other registrations and user data must survive the migration.
  await evaluate(`await navigator.serviceWorker.register('/other/worker.js',{scope:'/other/'}); await (await import('/cleanup.js')).retireLegacyWorker();`);
  assert.equal(await evaluate(`Boolean(await navigator.serviceWorker.getRegistration(location.origin+'/other/'))`), true);
  assert.equal(await evaluate(`localStorage.getItem('finchatSession')`), 'session-fixture');
  assert.equal(await evaluate(`sessionStorage.getItem('draft')`), 'draft-fixture');
  assert.equal(await evaluate(`document.cookie.includes('finchat_fixture=keep')`), true);
  assert.equal(await evaluate(`Boolean(await (await caches.open('keep-fixture')).match('/marker'))`), true);
  assert.deepEqual(errors, []);
  console.log('PASS: startup cleanup and legacy worker update; next visit opens FinChat; sessions, drafts, cookies, caches and unrelated workers preserved');
} finally {
  ws?.close();
  browser.kill();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
