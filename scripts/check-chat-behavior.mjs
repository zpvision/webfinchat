import { createServer, transformWithOxc } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const baseline = process.env.FINCHAT_REVIEW_BASELINE || '27cc83d';
const beforeApp = execFileSync('git', ['show', `${baseline}:src/App.jsx`], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
const beforeAPI = execFileSync('git', ['show', `${baseline}:src/api/finchat.js`], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
const fixtureAPI = await readFile('scripts/fixtures/chat-review-api.js', 'utf8');
const fixture = await readFile('scripts/fixtures/chat-review.jsx', 'utf8');
const rewrite = (source) => source.replace(/from '(\.\.?\/[^']+)'/g, (_, path) => `from '${path.startsWith('../') ? '/' + path.slice(3) : '/src/' + path.slice(2)}'`);
const plugin = {
  name: 'finchat-local-review',
  resolveId(id) { if (id.startsWith('/__review/')) return '\0' + id; },
  async load(id) {
    if (!id.startsWith('\0/__review/')) return;
    const mode = id.includes('before') ? 'before' : 'after';
    if (id.includes('/App-')) {
      const source = mode === 'before' ? beforeApp : await readFile('src/App.jsx', 'utf8');
      const code = rewrite(source).replace("from '/src/api/finchat.js'", `from '/__review/api-${mode}.js'`) + '\nexport { MessengerScreen, Conversation };';
      return (await transformWithOxc(code, id, { lang: 'jsx', jsx: { runtime: 'automatic' } })).code;
    }
    if (id.includes('/real-')) return (mode === 'before' ? beforeAPI : await readFile('src/api/finchat.js', 'utf8')).replace("'./subscriptionQueue.js'", "'/src/api/subscriptionQueue.js'");
    if (id.includes('/api-')) return fixtureAPI.replaceAll('__REAL_API__', `/__review/real-${mode}.js`);
    if (id.includes('/fixture-')) return (await transformWithOxc(fixture.replace('__APP__', `/__review/App-${mode}.jsx`), id, { lang: 'jsx', jsx: { runtime: 'automatic' } })).code;
  },
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (request.url.startsWith('/chat-review?')) {
        const mode = request.url.includes('before') ? 'before' : 'after';
        const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chat review</title><div id="root"></div><script type="module" src="/__review/fixture-${mode}.jsx"></script></html>`;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(await server.transformIndexHtml(request.url, html));
      } else if (request.url.startsWith('/late-image.svg')) {
        setTimeout(() => { response.setHeader('Content-Type', 'image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="220" height="320"><rect width="220" height="320" fill="#ac91d0"/></svg>'); }, 120);
      } else next();
    });
  },
};
const server = await createServer({ configFile: false, plugins: [plugin, react()], server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browserPath = process.env.FINCHAT_TEST_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync);
if (!browserPath) { await server.close(); throw new Error('Set FINCHAT_TEST_BROWSER to a Chromium executable.'); }
const profile = await mkdtemp(join(tmpdir(), 'finchat-chat-review-'));
const browser = spawn(browserPath, ['--headless=new', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws;
const results = { baseline, environment: { browser: browserPath, viewport: '1280x900', cpuSlowdown: 4, transport: 'mock, 120ms subscription ACK, 200 presence frames of 1KB', account: '100 fixture chats, no real FinChat access' }, runs: [], checks: [] };
const pause = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  let port;
  for (let i = 0; i < 100; i++) { try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await pause(100); } }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    const item = pending.get(message.id);
    if (item) { pending.delete(message.id); message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const wait = async (expression, timeout = 15000) => { const end = Date.now() + timeout; while (!await evaluate(expression)) { if (Date.now() > end) throw new Error('Timed out: ' + expression + '\n' + JSON.stringify(errors)); await pause(); } };
  const frames = () => evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const navigate = async (mode) => {
    await send('Page.navigate', { url: `http://127.0.0.1:${server.httpServer.address().port}/chat-review?${mode}` });
    await wait('Boolean(window.__review?.metrics.listPaintMs && document.querySelector(".message-list-visible"))');
    await wait('window.__review.metrics.trafficDone && window.__review.client.subscribedTopics.size >= 101 && window.__review.metrics.pending === 0');
    await pause(150);
  };
  await send('Runtime.enable');
  results.environment.version = (await send('Browser.getVersion')).product;
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setCPUThrottlingRate', { rate: 4 });
  // Warm module/ICU caches equally before measured runs; alternate before/after order.
  await navigate('before'); await navigate('after');
  for (let run = 0; run < 3; run++) {
    for (const mode of run % 2 ? ['after', 'before'] : ['before', 'after']) {
      await navigate(mode);
      const measured = { mode, ...await evaluate(`(() => { const m=window.__review.metrics; return { listPaintMs:m.listPaintMs, peakPending:m.peakPendingMap, framesParsed:m.framesParsed, longTaskCount:m.longTasks.length, longTaskTotalMs:m.longTasks.reduce((a,t)=>a+t.duration,0), longestTaskMs:Math.max(0,...m.longTasks.map(t=>t.duration)) }; })()`) };
      results.runs.push(measured);
      console.log('Measured:', JSON.stringify(measured));
    }
  }
  await mkdir('test-results/chat-review', { recursive: true });
  await writeFile('test-results/chat-review/results.json', JSON.stringify(results, null, 2));
  await send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await navigate('after');
  const readPosition = () => evaluate('window.__review.capture()');
  const samePosition = async (position, label) => { const now = await readPosition(); assert.equal(now.seq, position.seq, label); assert.ok(Math.abs(now.offset - position.offset) <= 2, label + ': offset ' + JSON.stringify({ position, now })); };
  for (let page = 0; page < 8; page++) {
    await evaluate(`(() => { const a=document.querySelector('.message-area'); a.scrollTop=0; a.dispatchEvent(new Event('scroll',{bubbles:true})); })()`);
    await wait('window.__review.history.length > 0');
    await evaluate(`(() => { const a=document.querySelector('.message-area'); a.scrollTop=220; a.dispatchEvent(new Event('scroll',{bubbles:true})); })()`);
    await frames();
    const position = await readPosition();
    await evaluate(`(() => { const request=window.__review.history[0]; window.__review.packet(request.topic,request.beforeSeq-1,'Потоковая история'); })()`);
    await frames(); await samePosition(position, 'stream history page ' + page);
    await evaluate('window.__review.history.shift().resolve()');
    await wait('!document.querySelector(".history-loader")'); await frames();
    await samePosition(position, 'history page ' + page);
  }
  results.checks.push('8 history loads: current user scroll and streamed history keep visible seq/offset');
  const reading = await readPosition();
  await evaluate(`window.__review.packet('usr000',401,'Входящее при чтении истории')`); await frames();
  await samePosition(reading, 'incoming while reading');
  await evaluate(`new Promise(resolve=>{const img=document.createElement('img');img.style.width='220px';img.onload=resolve;img.src='/late-image.svg';document.querySelector('[data-message-seq]').appendChild(img);})`);
  await frames(); await samePosition(reading, 'late image');
  results.checks.push('Incoming message and real delayed image load preserve reading anchor');
  await evaluate(`document.querySelector('.message-jump-bottom').click()`); await frames();
  await evaluate(`window.__review.packet('usr000',402,'Новое внизу')`); await frames();
  assert.ok(await evaluate(`(()=>{const a=document.querySelector('.message-area');return a.scrollHeight-a.scrollTop-a.clientHeight<2})()`));
  results.checks.push('Explicit bottom button and following incoming messages at bottom');
  await evaluate(`(()=>{const a=document.querySelector('.message-area');a.scrollTop=200;a.dispatchEvent(new Event('scroll',{bubbles:true}));const input=document.querySelector('.composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Отправка из истории');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await frames();
  await evaluate(`document.querySelector('.composer').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);
  await wait(`Boolean(document.querySelector('[data-message-seq="900"]'))`); await frames();
  assert.ok(await evaluate(`(()=>{const a=document.querySelector('.message-area');return a.scrollHeight-a.scrollTop-a.clientHeight<2})()`));
  results.checks.push('Explicitly sending a message from history returns to bottom');
  await evaluate(`(()=>{const a=document.querySelector('.message-area');a.scrollTop=0;a.dispatchEvent(new Event('scroll',{bubbles:true}));})()`);
  await wait('window.__review.history.length > 0');
  await evaluate(`document.querySelectorAll('.chat-item')[1].click()`);
  await wait(`document.querySelector('.message-list')?.textContent.includes('usr001')`);
  await evaluate('window.__review.history.shift().resolve()'); await pause(150); await frames();
  assert.equal(await evaluate(`document.querySelector('.message-list').textContent.includes('usr000')`), false);
  assert.equal(await evaluate(`document.querySelectorAll('[data-message-seq]').length`), 10);
  results.checks.push('Chat switch ignores old history result and scheduled scrolling');
  await evaluate('window.__review.reconnect()');
  await wait('window.__review.client.subscribedTopics.size >= 101'); await pause(3200);
  await evaluate(`window.__review.packet('usr050',450,'Сообщение после восстановления')`); await frames();
  assert.equal(await evaluate(`([...document.querySelectorAll('.chat-item')].find(b=>b.textContent.includes('Чат 050'))?.querySelector('.unread-badge')?.textContent)`), '50');
  await evaluate(`window.__review.client.socket.packet({info:{topic:'me',src:'usrPeer',what:'call',seq:7,payload:{event:'invite',callId:'review-call',version:1,topic:'usrPeer',seq:7,audioOnly:true,expiresAt:new Date(Date.now()+30000).toISOString()}}})`);
  await wait(`Boolean(document.querySelector('button[aria-label="Ответить на звонок"]'))`);
  results.checks.push('Unchanged topics resubscribed after reconnect; unread message and incoming call delivered');
  assert.deepEqual(errors, []);
  results.checks.push('No unhandled browser runtime exceptions');
  await evaluate('window.__review.unmount()');
  await mkdir('test-results/chat-review', { recursive: true });
  await writeFile('test-results/chat-review/results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { ws?.close(); browser.kill(); await server.close(); }
