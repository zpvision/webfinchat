// Serve the actual production build. Replace WebSocket/clipboard before app startup;
// additionally block every non-local HTTP request. No real SMS or account changes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const dist = resolve('dist');
assert.ok(existsSync(join(dist, 'index.html')), 'Run npm run build first');
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(dist + '/') && !file.startsWith(dist + '\\')) { res.writeHead(403).end(); return; }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const executable = process.env.FINCHAT_TEST_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync);
if (!executable) { server.close(); throw new Error('Set FINCHAT_TEST_BROWSER to Chrome/Chromium.'); }
const profile = await mkdtemp(join(tmpdir(), 'finchat-recovery-'));
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
  const requests = new Map(), errors = [];
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    const request = requests.get(message.id);
    if (request) { requests.delete(message.id); message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id; requests.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, replMode: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async (expression) => {
    const deadline = Date.now() + 10000;
    while (!await evaluate(expression)) { if (Date.now() > deadline) throw new Error('Timed out: ' + expression); await pause(); }
  };
  const click = async (selector) => {
    const { x, y } = await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const key = async (key, code = key, modifiers = 0) => {
    const virtualKey = { Enter: 13, Tab: 9, Escape: 27 }[key];
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey, ...(key === 'Enter' ? { text: '\r' } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey });
  };
  const fill = async (value) => {
    await evaluate(`(() => { const e=document.querySelector('#recovery-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await pause();
  };
  const open = async () => { await click('.recovery-link'); await wait(`document.querySelector('.recovery-dialog')?.open`); };
  const close = async () => { await click('.recovery-close'); await wait(`!document.querySelector('.recovery-dialog')`); };
  const screenshot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(`test-results/recovery-${name}.png`, Buffer.from(data, 'base64'));
  };
  await mkdir('test-results', { recursive: true });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['https://*', 'http://mc.*', 'wss://*', 'ws://*'] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.fixture={sockets:[],commands:[],mode:'ok',delay:15,offset:0,clipboard:null,copyFail:false};
    const realNow=Date.now.bind(Date); Date.now=()=>realNow()+fixture.offset;
    Object.defineProperty(navigator,'clipboard',{value:{async writeText(text){if(fixture.copyFail)throw Error('Denied');fixture.clipboard=text;}}});
    window.WebSocket=class {
      constructor(url){this.url=String(url);this.messages=[];this.closed=false;fixture.sockets.push(this);setTimeout(()=>this.onopen?.(),0);}
      send(value){
        const packet=JSON.parse(value);this.messages.push(packet);
        if(packet.hi){this.reply({ctrl:{id:packet.hi.id,code:201}});return;}
        fixture.commands.push(packet);
        const command=packet.login||packet.acc;
        if(fixture.mode==='drop'){setTimeout(()=>this.onclose?.(),fixture.delay);return;}
        if(fixture.mode==='malformed'){setTimeout(()=>this.onmessage?.({data:'{broken'}),fixture.delay);return;}
        if(fixture.mode==='limit'){this.reply({ctrl:{id:command.id,code:429,params:{retry_after:120}}});return;}
        if(packet.login){this.reply({ctrl:{id:command.id,code:301}});return;}
        if(atob(command.tmpsecret).startsWith('000000:')){this.reply({ctrl:{id:command.id,code:401}});return;}
        this.reply({ctrl:{id:command.id,code:200,params:{word1:'река',word2:'лес',digits:'00123456'}}});
      }
      reply(packet){setTimeout(()=>this.onmessage?.({data:JSON.stringify(packet)}),fixture.delay);}
      close(){this.closed=true;}
    };
  ` });
  await send('Page.navigate', { url: base });
  await wait(`Boolean(document.querySelector('.recovery-link'))`);
  await send('Page.bringToFront');
  const initialStorage = await evaluate(`JSON.stringify({local:{...localStorage},session:{...sessionStorage}})`);
  // Existing, valid login fields must remain untouched and must never be submitted
  // by the recovery portal's form events.
  await evaluate(`Array.from(document.querySelectorAll('.auth-form .field input')).forEach((e,i)=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,['+375291234567','река','лес','12345678'][i]);
    e.dispatchEvent(new Event('input',{bubbles:true}));
  })`);
  await wait(`!document.querySelector('.auth-form .submit-button').disabled`);

  // Keyboard activation, native focus containment, Escape and focus restoration.
  await evaluate(`document.querySelector('.recovery-link').focus()`);
  await key('Enter');
  await wait(`document.activeElement?.id==='recovery-input'`);
  for (let i = 0; i < 8; i++) {
    await key('Tab');
    assert.equal(await evaluate(`document.querySelector('.recovery-dialog').contains(document.activeElement)`), true);
  }
  await key('Tab', 'Tab', 8);
  assert.equal(await evaluate(`document.querySelector('.recovery-dialog').contains(document.activeElement)`), true);
  await key('Escape');
  await wait(`!document.querySelector('.recovery-dialog')`);
  assert.equal(await evaluate(`document.activeElement===document.querySelector('.recovery-link')`), true);
  await open();
  await screenshot('desktop-phone');
  await fill('123');
  await click('.recovery-primary');
  await wait(`Boolean(document.querySelector('#recovery-error'))`);
  assert.equal(await evaluate('fixture.sockets.length'), 0);
  assert.equal(await evaluate(`document.querySelectorAll('.auth-form .field small').length`), 0, 'Recovery submit does not bubble to login');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 8, y: 8, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 8, y: 8, button: 'left', clickCount: 1 });
  assert.equal(await evaluate(`document.querySelector('.recovery-dialog').open`), true);

  await fill('+375 (29) 123-45-67');
  await evaluate('fixture.delay=400');
  await click('.recovery-primary');
  await wait(`document.querySelector('form[aria-busy="true"]')!==null`);
  await key('Escape');
  assert.equal(await evaluate(`document.querySelector('.recovery-close').disabled`), true);
  assert.equal(await evaluate(`document.querySelector('.recovery-dialog').open`), true);
  await evaluate(`document.querySelector('.recovery-dialog form').requestSubmit()`);
  await wait(`document.querySelector('input[name="sms-code"]') && !document.querySelector('.recovery-close').disabled`);
  assert.equal(await evaluate('fixture.commands.length'), 1);
  assert.equal(await evaluate(`atob(fixture.commands[0].login.secret)`), 'wordcolor:tel:+375291234567');
  assert.equal(await evaluate(`fixture.commands[0].login.scheme`), 'reset');
  assert.equal(await evaluate(`document.querySelector('.recovery-secondary button').disabled`), true);
  await evaluate('fixture.delay=15');
  await fill('000000');
  await click('.recovery-primary');
  await wait(`document.querySelector('#recovery-input')?.getAttribute('aria-invalid')==='true'`);
  assert.equal(await evaluate(`Boolean(document.querySelector('.recovery-credentials'))`), false);
  assert.equal(await evaluate(`Boolean(document.querySelector('.recovery-preparing'))`), false, 'Invalid code does not enter preparation');
  await screenshot('desktop-invalid-code');
  await fill('001234');
  await click('.recovery-primary');
  await wait(`Boolean(document.querySelector('.recovery-preparing'))`);
  const preparationStarted = Date.now();
  assert.equal(await evaluate(`document.querySelector('#recovery-title').textContent`), 'Готовим для вас данные');
  assert.equal(await evaluate(`Boolean(document.querySelector('.recovery-credentials'))`), false);
  await key('Escape');
  await key('Tab');
  assert.equal(await evaluate(`document.querySelector('.recovery-dialog').open && document.querySelector('.recovery-close').disabled`), true);
  await screenshot('desktop-preparing');
  await pause(1000);
  assert.equal(await evaluate(`Boolean(document.querySelector('.recovery-preparing'))`), true, 'Credentials stay hidden during preparation');
  await wait(`Boolean(document.querySelector('.recovery-credentials'))`);
  assert.ok(Date.now() - preparationStarted >= 1900, 'Preparation lasts two seconds (polling tolerance 100ms)');
  assert.equal(await evaluate(`document.querySelector('.recovery-success > p').textContent`), 'Ваши новые секретные слова. Сохраните их!');
  assert.equal(await evaluate(`document.activeElement===document.querySelector('[data-copy-password]')`), true);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.recovery-digits span'),e=>e.textContent).join('')`), '00123456');
  assert.equal(await evaluate(`atob(fixture.commands.at(-1).acc.tmpsecret)`), '001234:tel:+375291234567');
  assert.equal(await evaluate(`'user' in fixture.commands.at(-1).acc || 'secret' in fixture.commands.at(-1).acc`), false);
  assert.equal(await evaluate(`fixture.sockets.every(s=>s.closed && s.messages.length===2 && s.messages[0].hi.ver==='0.22')`), true);
  assert.equal(await evaluate(`JSON.stringify({local:{...localStorage},session:{...sessionStorage}})`), initialStorage);
  await screenshot('desktop-success');
  await evaluate('fixture.copyFail=true');
  await click('[data-copy-password]');
  await wait(`Boolean(document.querySelector('#recovery-error'))`);
  await evaluate('fixture.copyFail=false');
  await click('[data-copy-password]');
  await wait(`fixture.clipboard!==null`);
  assert.equal(await evaluate('fixture.clipboard'), 'рекалес00123456');
  assert.equal(await evaluate(`Boolean(document.querySelector('#recovery-error'))`), false);

  for (const [width, height] of [[390, 844], [320, 568], [320, 380]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    const fits = await evaluate(`(() => {const d=document.querySelector('.recovery-dialog'),r=d.getBoundingClientRect();return d.scrollWidth<=d.clientWidth+1&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;})()`);
    assert.equal(fits, true, `Success dialog fits ${width}x${height}`);
    await screenshot(`mobile-success-${width}x${height}`);
  }
  await click('.recovery-saved');
  await wait(`!document.querySelector('.recovery-dialog')`);
  await open();
  assert.equal(await evaluate(`document.querySelector('#recovery-input').value`), '');
  assert.equal(await evaluate(`Boolean(document.querySelector('.recovery-credentials'))`), false);
  await fill('+375291234567');
  assert.equal(await evaluate(`document.querySelector('.recovery-primary').disabled`), true, 'Cooldown survives close');
  await screenshot('mobile-phone');
  await evaluate('fixture.offset+=61000');
  await wait(`!document.querySelector('.recovery-primary').disabled`);
  await click('.recovery-primary');
  await wait(`Boolean(document.querySelector('input[name="sms-code"]'))`);
  await screenshot('mobile-code');
  await evaluate('fixture.offset+=61000');
  await wait(`!document.querySelector('.recovery-secondary button').disabled`);
  const beforeResend = await evaluate('fixture.commands.length');
  await click('.recovery-secondary button');
  await wait(`fixture.commands.length===${beforeResend + 1} && !document.querySelector('.recovery-close').disabled`);

  await evaluate(`fixture.mode='drop'`);
  await fill('123456');
  await click('.recovery-primary');
  await wait(`document.querySelector('#recovery-error')?.textContent.includes('результат проверки неизвестен')`);
  const afterDrop = await evaluate('fixture.commands.length');
  await pause(300);
  assert.equal(await evaluate('fixture.commands.length'), afterDrop, 'No automatic retries');
  await close();
  await open();
  await fill('+375291234568');
  await evaluate(`fixture.mode='limit'`);
  await click('.recovery-primary');
  await wait(`document.querySelector('#recovery-error')?.textContent.includes('лимит')`);
  await close();
  await open();
  await fill('+375291234568');
  await evaluate('fixture.offset+=61000');
  await pause(1100);
  assert.equal(await evaluate(`document.querySelector('.recovery-primary').disabled`), true, 'Server 120s limit survives reopening and 61s');
  await evaluate('fixture.offset+=61000');
  await wait(`!document.querySelector('.recovery-primary').disabled`);
  await evaluate(`fixture.mode='malformed'`);
  await click('.recovery-primary');
  await wait(`document.querySelector('#recovery-error')?.textContent.includes('некорректный ответ')`);
  await close();
  assert.equal(await evaluate(`fixture.sockets.every(s=>s.closed)`), true);
  assert.equal(await evaluate(`JSON.stringify({local:{...localStorage},session:{...sessionStorage}})`), initialStorage);
  assert.deepEqual(errors, []);
  console.log('PASS: production login + recovery; validation, payloads, invalid code, leading zeros, copy success/failure, cooldown/reopen/resend/429, lost response, malformed response, pending dismissal guard, keyboard/focus, desktop/mobile. All WebSockets mocked; no real SMS.');
} finally {
  ws?.close();
  browser.kill();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
