import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
import { FinchatRealtimeClient, uploadAttachmentFile } from '../src/api/finchat.js';

const root = resolve('.');
const contents = {
  plain: Buffer.from('FinChat attachment\n'.repeat(100)),
  tiny: Buffer.from([0, 255, 1]),
  empty: Buffer.alloc(0),
  pdf: Buffer.from('%PDF-1.7\n' + 'test PDF bytes\n'.repeat(100)),
  large: Buffer.alloc(4096, 'x'),
  error: Buffer.from('Нет доступа к файлу'),
};
const encoders = { gzip: gzipSync, deflate: deflateSync, br: brotliCompressSync };

async function startFixture(t, mode, apiKey = 'environment-test-key') {
  const requests = [];
  const sockets = new Set();
  const backend = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    const url = new URL(req.url, 'http://files.test');
    if (url.pathname === '/v0/file/u') {
      res.setHeader('Content-Type', 'application/json');
      if (url.searchParams.get('direct') !== 'true') {
        const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': req.headers['content-type'] } }).formData();
        const file = form.get('file');
        assert.ok(file instanceof File);
        requests.at(-1).multipartFile = { bytes: Buffer.from(await file.arrayBuffer()), type: file.type, name: file.name };
        if (file.name.endsWith('.reject')) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ctrl: { code: 400, text: 'malformed' } }));
          return;
        }
        res.end(JSON.stringify({ ctrl: { code: 200, params: { url: '/v0/file/s/multipart', content_type: file.type } } }));
        return;
      }
      const ext = url.searchParams.get('ext');
      if (/^http(401|403|413|500)$/.test(ext || '') || ext === 'badrequest') {
        res.statusCode = ext === 'badrequest' ? 400 : Number(ext.slice(4));
        res.end(JSON.stringify({ ctrl: { code: res.statusCode, text: 'rejected' } }));
        return;
      }
      if (['reject', 'legacy'].includes(ext) || url.searchParams.get('mime') === 'application/x-test-multipart') {
        res.statusCode = 400;
        res.end(JSON.stringify({ ctrl: { code: 400, text: 'malformed' } }));
        return;
      }
      res.end(JSON.stringify({ ctrl: { code: 200, params: {
        upload_url: url.searchParams.get('ext') === 'storagefail' ? 'https://files.test/upload-reject' : 'https://files.test/upload', url: '/v0/file/s/new',
        content_type: 'application/octet-stream', cache_control: 'private',
      } } }));
      return;
    }
    if (url.pathname === '/upload') { res.end(''); return; }
    if (url.pathname === '/upload-reject') { res.statusCode = 403; res.end('<Error>AccessDenied</Error>'); return; }
    const [name, encoding] = url.pathname.split('/').at(-1).split('-');
    const body = contents[name] ?? contents.plain;
    if (name === 'error') res.statusCode = 403;
    res.setHeader('Content-Type', name === 'pdf' ? 'application/pdf' : 'application/octet-stream');
    const wireBody = encoders[encoding]?.(body) ?? body;
    if (encoders[encoding]) res.setHeader('Content-Encoding', encoding);
    if (encoding !== 'chunked') res.setHeader('Content-Length', String(wireBody.length));
    if (encoding === 'chunked') res.write(wireBody.subarray(0, 3));
    res.end(encoding === 'chunked' ? wireBody.subarray(3) : wireBody);
  });
  backend.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  backend.on('upgrade', (req, socket, head) => {
    requests.push({ url: req.url, headers: req.headers });
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    if (head.length) socket.write(head);
    socket.on('data', (chunk) => socket.write(chunk));
  });
  await new Promise((resolveListen) => backend.listen(0, '127.0.0.1', resolveListen));
  const cwd = await mkdtemp(join(tmpdir(), 'finchat-proxy-test-'));
  await mkdir(join(cwd, 'dist'));
  await writeFile(join(cwd, 'dist/index.html'), '<!doctype html><title>Clean test</title>');
  await writeFile(join(cwd, 'dist/service-worker.js'), await readFile(join(root, 'public/service-worker.js')));
  await mkdir(join(cwd, 'dist/assets'));
  await writeFile(join(cwd, 'dist/assets/index-AbCd1234.js'), 'console.log("asset fixture");');
  await writeFile(join(cwd, 'dist/site.webmanifest'), '{}');
  await writeFile(join(cwd, '.env'), 'FINCHAT_API_KEY=file-must-not-override-environment\n');
  const env = { ...process.env, PORT: '0', FINCHAT_HOST: 'files.test',
    FINCHAT_API_KEY: apiKey, LIVEKIT_URL: 'wss://media.test',
    MAX_FILE_BYTES: '2048', MAX_DOWNLOAD_BYTES: '2048',
    ALLOWED_ORIGINS: 'https://allowed.test', TEST_MODE: mode,
    TEST_UPSTREAM: `http://127.0.0.1:${backend.address().port}`,
    TEST_SERVER: join(root, 'server.mjs'), TEST_CONFIG: join(root, 'vite.config.js'),
  };
  delete env.VITE_FINCHAT_HOST;
  delete env.VITE_FINCHAT_API_KEY;
  const child = spawn(process.execPath, [join(root, 'tests/fixtures/proxy-process.mjs')], {
    cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    backend.closeAllConnections();
    for (const socket of sockets) socket.destroy();
    await new Promise((done) => backend.close(done));
    await rm(cwd, { recursive: true, force: true });
  });
  const base = await new Promise((resolveReady, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Server startup timed out: ' + output)), 20000);
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/listening on http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolveReady(`http://127.0.0.1:${match[1]}`); }
    });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${output}`)); });
  });
  // node:http catches truncated framing independently of fetch's decompression.
  const download = (name, headers = { 'X-Finchat-Token': 'test-user-token' }) => new Promise((resolveResponse, reject) => {
    const req = get(`${base}/file-download-proxy?ref=${name}`, { headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolveResponse({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Download timed out')));
  });
  return { base, download, requests };
}

for (const mode of ['production', 'development']) {
  test(`${mode}: actual file proxy HTTP integration`, { timeout: 40000 }, async (t) => {
    const { base, download, requests } = await startFixture(t, mode);
    for (const name of ['plain', 'plain-gzip', 'plain-br', 'plain-deflate', 'tiny-gzip', 'empty', 'plain-chunked']) {
      await t.test(`complete bytes and correct length: ${name}`, async () => {
        const result = await download(name);
        assert.equal(result.status, 200);
        assert.deepEqual(result.body, contents[name.split('-')[0]]);
        assert.equal(Number(result.headers['content-length']), result.body.length);
        assert.equal(result.headers['content-encoding'], undefined);
        const last = requests.at(-1);
        assert.equal(last.headers['x-finchat-apikey'], 'environment-test-key');
        assert.equal(last.headers['x-finchat-auth'], 'Token test-user-token');
      });
    }
    await t.test('missing authentication never fetches upstream', async () => {
      const count = requests.length;
      assert.equal((await download('plain', {})).status, 401);
      assert.equal(requests.length, count);
    });
    await t.test('compressed upstream errors preserve status and bytes', async () => {
      const result = await download('error-gzip');
      assert.equal(result.status, 403);
      assert.deepEqual(result.body, contents.error);
    });
    await t.test('compressed PDF preview uses actual byte count', async () => {
      const ticket = await fetch(`${base}/pdf-view-proxy`, { method: 'POST',
        headers: { 'X-Finchat-Token': 'test-user-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: 'pdf-gzip', name: 'test.pdf' }),
      });
      assert.equal(ticket.status, 200);
      const pdf = await fetch(base + (await ticket.json()).url);
      const bytes = Buffer.from(await pdf.arrayBuffer());
      assert.deepEqual(bytes, contents.pdf);
      assert.equal(Number(pdf.headers.get('content-length')), bytes.length);
      assert.equal(pdf.headers.get('content-encoding'), null);
    });
    await t.test('upload length equals original binary bytes', async () => {
      const result = await fetch(`${base}/file-upload-proxy`, { method: 'POST',
        headers: { 'X-Finchat-Token': 'test-user-token' }, body: contents.tiny,
      });
      assert.equal(result.status, 200);
      assert.equal(result.headers.get('X-Finchat-Upload-Stage'), 'complete');
      const upload = requests.find((req) => req.url === '/upload');
      assert.deepEqual(upload.body, contents.tiny);
      assert.equal(Number(upload.headers['content-length']), contents.tiny.length);
      assert.equal(upload.headers['x-finchat-apikey'], undefined);
      assert.equal(upload.headers['x-finchat-auth'], undefined);
    });
    await t.test('multipart refusal and storage rejection do not create upload retry loops', async () => {
      for (const [ext, expectedStage, status] of [['reject', 'multipart', 400], ['storagefail', 'storage', 403]]) {
        const beforeRequests = requests.length;
        const before = requests.filter((req) => req.url === '/upload' || req.url === '/upload-reject').length;
        const result = await fetch(`${base}/file-upload-proxy`, { method: 'POST',
          headers: { 'X-Finchat-Token': 'test-user-token', 'X-File-Ext': ext }, body: contents.tiny,
        });
        assert.equal(result.status, status);
        assert.equal(result.headers.get('X-Finchat-Upload-Stage'), expectedStage);
        assert.match(result.headers.get('X-Finchat-Upload-Request-Id'), /^[0-9a-f-]{36}$/);
        await result.text();
        const after = requests.filter((req) => req.url === '/upload' || req.url === '/upload-reject').length;
        assert.equal(after - before, expectedStage === 'storage' ? 1 : 0);
        assert.equal(requests.length - beforeRequests, 2);
      }
    });
    await t.test('malformed presign falls back once with exact file bytes, MIME and original FinChat credentials', async () => {
      const before = requests.length;
      const result = await fetch(`${base}/file-upload-proxy`, { method: 'POST',
        headers: { 'X-Finchat-Token': 'test-user-token', 'X-File-Ext': 'legacy', 'X-File-Mime': 'application/pdf' }, body: contents.pdf,
      });
      assert.equal(result.status, 200);
      assert.equal(result.headers.get('X-Finchat-Upload-Mode'), 'multipart');
      assert.equal(result.headers.get('X-Finchat-Upload-Stage'), 'complete');
      assert.equal((await result.json()).url, '/v0/file/s/multipart');
      assert.equal(requests.length - before, 2);
      const upload = requests.at(-1);
      assert.equal(upload.url, '/v0/file/u');
      assert.match(upload.headers['content-type'], /^multipart\/form-data; boundary=/);
      assert.deepEqual(upload.multipartFile.bytes, contents.pdf);
      assert.equal(upload.multipartFile.type, 'application/pdf');
      assert.equal(upload.headers['x-finchat-apikey'], 'environment-test-key');
      assert.equal(upload.headers['x-finchat-auth'], 'Token test-user-token');
    });
    await t.test('file without extension uses the same multipart fallback', async () => {
      const result = await fetch(`${base}/file-upload-proxy`, { method: 'POST',
        headers: { 'X-Finchat-Token': 'test-user-token', 'X-File-Mime': 'application/x-test-multipart' }, body: contents.tiny,
      });
      assert.equal(result.status, 200);
      await result.json();
      assert.deepEqual(requests.at(-1).multipartFile.bytes, contents.tiny);
      assert.equal(requests.at(-1).multipartFile.name, 'attachment');
    });
    await t.test('authentication, size and other presign errors never send a multipart body', async () => {
      for (const ext of ['http401', 'http403', 'http413', 'http500', 'badrequest']) {
        const before = requests.length;
        const result = await fetch(`${base}/file-upload-proxy`, { method: 'POST',
          headers: { 'X-Finchat-Token': 'test-user-token', 'X-File-Ext': ext }, body: contents.tiny,
        });
        assert.equal(result.status, ext === 'badrequest' ? 400 : Number(ext.slice(4)));
        assert.equal(result.headers.get('X-Finchat-Upload-Stage'), 'presign');
        await result.text();
        assert.equal(requests.length - before, 1);
      }
    });
    await t.test('actual frontend upload returns the saved attachment reference after multipart fallback', async (t) => {
      const nativeFetch = globalThis.fetch;
      t.mock.method(globalThis, 'fetch', (url, options) => {
        assert.equal(url, '/file-upload-proxy');
        return nativeFetch(base + url, options);
      });
      const uploaded = await uploadAttachmentFile({ token: 'test-user-token', file: new File([contents.pdf], 'report.legacy', { type: 'application/pdf' }) });
      assert.equal(uploaded.ref, '/v0/file/s/multipart');
      assert.equal(uploaded.name, 'report.legacy');
      assert.equal(uploaded.mime, 'application/pdf');
      assert.equal(uploaded.size, contents.pdf.length);
    });
    await t.test('saved multipart file is published with the existing message and extra.attachments contract', async (t) => {
      const nativeFetch = globalThis.fetch;
      t.mock.method(globalThis, 'fetch', (url, options) => nativeFetch(base + url, options));
      const previousWindow = globalThis.window;
      globalThis.window = { location: { origin: base } };
      t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
      const client = new FinchatRealtimeClient('test-user-token');
      client.ensureAttached = async () => {};
      let publication;
      client.publish = async (topic, packet) => {
        publication = { topic, packet };
        return { ctrl: { code: 200, params: { seq: 42, user: 'usrMe' }, ts: new Date().toISOString() } };
      };
      const message = await client.sendFiles({ topic: 'usrPeer', files: [new File([contents.pdf], 'report.legacy', { type: 'application/pdf' })], text: 'Document' });
      assert.equal(publication.topic, 'usrPeer');
      assert.deepEqual(publication.packet.extra.attachments, ['/v0/file/s/multipart']);
      assert.equal(publication.packet.payload.content.ent[0].data.ref, '/v0/file/s/multipart');
      assert.equal(message.attachments[0].ref, '/v0/file/s/multipart');
      assert.equal(message.attachments[0].name, 'report.legacy');
      assert.equal(message.seq, 42);
    });
    await t.test('configured size limit checks plain and decompressed bytes', async () => {
      assert.equal((await download('large')).status, 413);
      assert.equal((await download('large-gzip')).status, 413);
    });
    await t.test('existing same-origin WebSocket proxy forwards handshake and bytes', async () => {
      const target = new URL(base);
      const socket = net.connect(Number(target.port), target.hostname);
      try {
        await once(socket, 'connect');
        const received = new Promise((resolveBytes, reject) => {
          let bytes = '';
          socket.on('data', (chunk) => { bytes += chunk; if (bytes.includes('test-probe')) resolveBytes(bytes); });
          socket.on('error', reject);
          socket.setTimeout(5000, () => reject(new Error('WebSocket proxy timed out')));
        });
        socket.write('GET /finchat-channels HTTP/1.1\r\nHost: ' + target.host +
          '\r\nOrigin: https://allowed.test\r\nConnection: Upgrade\r\nUpgrade: websocket' +
          '\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\ntest-probe');
        assert.match(await received, /^HTTP\/1.1 101/);
        assert.match(requests.at(-1).url, /^\/v0\/channels\?apikey=environment-test-key$/);
      } finally { socket.destroy(); }
    });
    if (mode === 'production') await t.test('runtime host and LiveKit CSP come from environment', async () => {
      const response = await fetch(base);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /Clean test/);
      assert.match(response.headers.get('content-security-policy'), /https:\/\/files.test/);
      assert.match(response.headers.get('content-security-policy'), /wss:\/\/media.test/);
      assert.equal(response.headers.get('permissions-policy'), 'camera=(self), microphone=(self), geolocation=()');
    });
    if (mode === 'production') await t.test('HTML cannot be cached; legacy worker is valid uncached JS; only hashed assets are immutable', async () => {
      for (const path of ['/', '/index.html', '/?check=fresh', '/chat/fixture', '/assets/missing.js']) {
        const response = await fetch(base + path);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /^text\/html/);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        await response.text();
      }
      const worker = await fetch(base + '/service-worker.js');
      assert.equal(worker.status, 200);
      assert.match(worker.headers.get('content-type'), /javascript/);
      assert.equal(worker.headers.get('cache-control'), 'no-store');
      assert.match(await worker.text(), /self\.registration\.unregister\(\)/);
      const asset = await fetch(base + '/assets/index-AbCd1234.js');
      assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      assert.match(await asset.text(), /asset fixture/);
      const manifest = await fetch(base + '/site.webmanifest');
      assert.equal(manifest.headers.get('cache-control'), 'no-cache');
      await manifest.text();
    });
  });
}

test('empty runtime API key falls back to .env as before the configuration change', async (t) => {
  const { download, requests } = await startFixture(t, 'production', '');
  assert.equal((await download('tiny')).status, 200);
  assert.equal(requests.at(-1).headers['x-finchat-apikey'], 'file-must-not-override-environment');
  assert.equal(new URL(requests.at(-1).url, 'http://files.test').searchParams.get('apikey'), 'file-must-not-override-environment');
});
