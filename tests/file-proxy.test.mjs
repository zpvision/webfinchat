import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';

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
    if (url.pathname.startsWith('/v0/file/')) {
      const secret = (req.headers['x-finchat-auth'] || '').split(' ')[1] || '';
      // Match the HTTP auth decoder: unlike base64url, standard Base64 requires
      // +/ and padding. Before normalization URL-safe sessions return malformed.
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(secret) || secret.length % 4 !== 0) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ctrl: { code: 400, text: 'malformed' } }));
        return;
      }
    }
    if (url.pathname === '/v0/file/u') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ctrl: { code: 200, params: {
        upload_url: 'https://files.test/upload', url: '/v0/file/s/new',
        content_type: 'application/octet-stream', cache_control: 'private',
      } } }));
      return;
    }
    if (url.pathname === '/upload') { res.end(''); return; }
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
  const download = (name, headers = { 'X-Finchat-Token': 'dGVzdC11c2VyLXRva2Vu' }) => new Promise((resolveResponse, reject) => {
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
        assert.equal(last.headers['x-finchat-auth'], 'Token dGVzdC11c2VyLXRva2Vu');
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
        headers: { 'X-Finchat-Token': 'dGVzdC11c2VyLXRva2Vu', 'Content-Type': 'application/json' },
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
        headers: { 'X-Finchat-Token': 'dGVzdC11c2VyLXRva2Vu' }, body: contents.tiny,
      });
      assert.equal(result.status, 200);
      const upload = requests.find((req) => req.url === '/upload');
      assert.deepEqual(upload.body, contents.tiny);
      assert.equal(Number(upload.headers['content-length']), contents.tiny.length);
    });
    await t.test('presign receives server API key, user token and extension; storage receives no credentials', async () => {
      const result = await fetch(`${base}/file-upload-proxy`, { method: 'POST',
        headers: { 'X-Finchat-Token': 'dGVzdC11c2VyLXRva2Vu', 'X-File-Ext': 'pdf', 'X-File-Mime': 'application/pdf' },
        body: contents.tiny,
      });
      assert.equal(result.status, 200);
      const presign = requests.findLast((req) => req.url.startsWith('/v0/file/u'));
      const query = new URL(presign.url, 'http://files.test').searchParams;
      assert.equal(query.get('direct'), 'true');
      assert.equal(query.get('ext'), 'pdf');
      assert.equal(query.has('mime'), false);
      assert.equal(presign.headers['x-finchat-apikey'], 'environment-test-key');
      assert.equal(presign.headers['x-finchat-auth'], 'Token dGVzdC11c2VyLXRva2Vu');
      const storage = requests.findLast((req) => req.url === '/upload');
      assert.equal(storage.headers['x-finchat-apikey'], undefined);
      assert.equal(storage.headers['x-finchat-auth'], undefined);
    });
    await t.test('base64url and unpadded session tokens upload with standard Base64 HTTP auth', async () => {
      const standard = Buffer.alloc(64, 255).toString('base64');
      for (const token of [Buffer.alloc(64, 255).toString('base64url'), standard.replace(/=+$/, '')]) {
        const result = await fetch(`${base}/file-upload-proxy`, { method: 'POST',
          headers: { 'X-Finchat-Token': token, 'X-File-Mime': 'application/octet-stream' }, body: contents.tiny,
        });
        assert.equal(result.status, 200, await result.text());
        const presign = requests.findLast((req) => req.url.startsWith('/v0/file/u'));
        assert.equal(presign.headers['x-finchat-auth'], `Token ${standard}`);
        assert.equal(presign.headers['x-finchat-apikey'], 'environment-test-key');
        assert.equal(new URL(presign.url, 'http://files.test').searchParams.get('mime'), 'application/octet-stream');
      }
    });
    await t.test('download and PDF proxy normalize the same session token', async () => {
      const token = Buffer.alloc(64, 255).toString('base64url');
      const standard = Buffer.alloc(64, 255).toString('base64');
      assert.equal((await download('plain', { 'X-Finchat-Token': token })).status, 200);
      assert.equal(requests.at(-1).headers['x-finchat-auth'], `Token ${standard}`);
      assert.equal(new URL(requests.at(-1).url, 'http://files.test').searchParams.get('secret'), standard);
      const ticket = await fetch(`${base}/pdf-view-proxy`, { method: 'POST',
        headers: { 'X-Finchat-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: 'pdf-gzip' }),
      });
      assert.equal(ticket.status, 200);
      const pdf = await fetch(base + (await ticket.json()).url);
      assert.equal(pdf.status, 200);
      await pdf.arrayBuffer();
      assert.equal(requests.at(-1).headers['x-finchat-auth'], `Token ${standard}`);
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
  });
}

test('explicitly empty runtime API key is not overwritten by .env', async (t) => {
  const { download, requests } = await startFixture(t, 'production', '');
  assert.equal((await download('tiny')).status, 200);
  assert.equal(requests.at(-1).headers['x-finchat-apikey'], undefined);
  assert.equal(new URL(requests.at(-1).url, 'http://files.test').searchParams.has('apikey'), false);
});
