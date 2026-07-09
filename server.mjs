import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import tls from 'node:tls';

function loadDotEnv() {
  if (!existsSync('.env')) {
    return;
  }

  const lines = readFileSync('.env', 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');

    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const PORT = Number(process.env.PORT || 4173);
const FINCHAT_HOST = process.env.FINCHAT_HOST || 'api.dev.finchat.club';
const FINCHAT_API_KEY = process.env.FINCHAT_API_KEY || '';
const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES || 50 * 1024 * 1024);
const DIST_DIR = resolve('dist');

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

function singleHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}

function setSecurityHeaders(response) {
  const connectSrc = [
    "'self'",
    `https://${FINCHAT_HOST}`,
    `wss://${FINCHAT_HOST}`,
  ].join(' ');

  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      `connect-src ${connectSrc}`,
      "font-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' blob: data:",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      'upgrade-insecure-requests',
    ].join('; '),
  );
}

function send(response, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  setSecurityHeaders(response);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', contentType);
  response.end(body);
}

function readBody(request, maxBytes = MAX_FILE_BYTES) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;

    request.on('data', (chunk) => {
      size += chunk.length;

      if (size > maxBytes) {
        reject(new Error('File is too large'));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on('error', reject);
    request.on('end', () => resolveBody(Buffer.concat(chunks)));
  });
}

function normalizeFileRef(ref) {
  if (!ref) {
    return '';
  }

  if (ref.startsWith('http')) {
    const url = new URL(ref);

    if (url.protocol !== 'https:' || url.hostname !== FINCHAT_HOST) {
      return '';
    }

    return `${url.pathname}${url.search}`;
  }

  if (!ref.startsWith('/')) {
    return `/v0/file/s/${ref}`;
  }

  if (!ref.startsWith('/v0/')) {
    return `/v0/file/s${ref}`;
  }

  return ref;
}

async function handleUpload(request, response) {
  if (request.method !== 'POST') {
    send(response, 405, 'Method not allowed');
    return;
  }

  const token = singleHeader(request.headers['x-finchat-token']);
  const mime = singleHeader(request.headers['x-file-mime']) || 'application/octet-stream';
  const extension = singleHeader(request.headers['x-file-ext']) || '';
  const declaredLength = Number(singleHeader(request.headers['content-length']) || 0);

  if (!token) {
    send(response, 401, 'Missing FinChat token');
    return;
  }

  if (declaredLength > MAX_FILE_BYTES) {
    send(response, 413, 'File is too large');
    return;
  }

  const fileBody = await readBody(request);
  const presignUrl = new URL('/v0/file/u', `https://${FINCHAT_HOST}`);

  presignUrl.searchParams.set('direct', 'true');

  if (extension) {
    presignUrl.searchParams.set('ext', extension);
  } else {
    presignUrl.searchParams.set('mime', mime);
  }

  const presignResponse = await fetch(presignUrl, {
    method: 'POST',
    headers: {
      ...(FINCHAT_API_KEY ? { 'X-Finchat-APIKey': FINCHAT_API_KEY } : {}),
      'X-Finchat-Auth': `Token ${token}`,
    },
  });
  const presignText = await presignResponse.text();

  if (!presignResponse.ok) {
    send(response, presignResponse.status, presignText);
    return;
  }

  const presignPacket = JSON.parse(presignText);
  const params = presignPacket?.ctrl?.params;

  if (
    presignPacket?.ctrl?.code !== 200 ||
    !params?.upload_url ||
    !params?.url ||
    !params?.content_type ||
    !params?.cache_control
  ) {
    send(response, 502, presignText);
    return;
  }

  const uploadUrl = new URL(params.upload_url);

  if (uploadUrl.protocol !== 'https:') {
    send(response, 502, 'Invalid upload URL');
    return;
  }

  const uploadResponse = await fetch(params.upload_url, {
    method: params.upload_method || 'PUT',
    headers: {
      'Content-Type': params.content_type,
      'Cache-Control': params.cache_control,
      'Content-Length': String(fileBody.length),
    },
    body: fileBody,
  });
  const uploadText = await uploadResponse.text();

  if (!uploadResponse.ok) {
    send(response, uploadResponse.status, uploadText);
    return;
  }

  send(
    response,
    200,
    JSON.stringify({
      url: params.url,
      content_type: params.content_type,
      cache_control: params.cache_control,
    }),
    'application/json; charset=utf-8',
  );
}

async function handleDownload(request, response) {
  if (request.method !== 'GET') {
    send(response, 405, 'Method not allowed');
    return;
  }

  const token = singleHeader(request.headers['x-finchat-token']);
  const requestUrl = new URL(request.url || '', 'http://localhost');
  const normalizedRef = normalizeFileRef(requestUrl.searchParams.get('ref') || '');

  if (!token) {
    send(response, 401, 'Missing FinChat token');
    return;
  }

  if (!normalizedRef) {
    send(response, 400, 'Missing or invalid file ref');
    return;
  }

  const fileUrl = new URL(normalizedRef, `https://${FINCHAT_HOST}`);

  if (FINCHAT_API_KEY) {
    fileUrl.searchParams.set('apikey', FINCHAT_API_KEY);
  }

  fileUrl.searchParams.set('auth', 'token');
  fileUrl.searchParams.set('secret', token);

  const fileResponse = await fetch(fileUrl, {
    headers: {
      ...(FINCHAT_API_KEY ? { 'X-Finchat-APIKey': FINCHAT_API_KEY } : {}),
      'X-Finchat-Auth': `Token ${token}`,
    },
    redirect: 'follow',
  });
  const fileBody = Buffer.from(await fileResponse.arrayBuffer());
  const contentType = fileResponse.headers.get('content-type') || 'application/octet-stream';

  if (!fileResponse.ok) {
    send(response, fileResponse.status, fileBody, contentType);
    return;
  }

  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(fileBody.toString('utf8'));
      const errorText =
        parsed?.error || parsed?.err || parsed?.ctrl?.text || 'Server returned JSON instead of file';

      send(response, 502, errorText);
      return;
    } catch {
      // If it is not a FinChat error JSON, pass it through as a file.
    }
  }

  setSecurityHeaders(response);
  response.statusCode = 200;
  response.setHeader('Content-Type', contentType);
  response.setHeader('Content-Length', fileResponse.headers.get('content-length') || String(fileBody.length));
  response.end(fileBody);
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url || '/', 'http://localhost');
  const pathname = decodeURIComponent(requestUrl.pathname);
  const requestedPath = normalize(pathname === '/' ? '/index.html' : pathname);
  const filePath = resolve(join(DIST_DIR, requestedPath));
  const fallbackPath = join(DIST_DIR, 'index.html');
  const safePath = filePath.startsWith(DIST_DIR) && existsSync(filePath) && statSync(filePath).isFile()
    ? filePath
    : fallbackPath;

  setSecurityHeaders(response);
  response.statusCode = 200;
  response.setHeader('Content-Type', MIME_TYPES[extname(safePath)] || 'application/octet-stream');

  createReadStream(safePath).pipe(response);
}

function proxyWebSocket(request, socket, head) {
  const requestUrl = new URL(request.url || '', 'http://localhost');

  if (requestUrl.pathname !== '/finchat-channels') {
    socket.destroy();
    return;
  }

  const upstreamPath = new URL('/v0/channels', `https://${FINCHAT_HOST}`);

  if (FINCHAT_API_KEY) {
    upstreamPath.searchParams.set('apikey', FINCHAT_API_KEY);
  }

  const upstream = tls.connect(443, FINCHAT_HOST, { servername: FINCHAT_HOST }, () => {
    const headers = [
      `GET ${upstreamPath.pathname}${upstreamPath.search} HTTP/1.1`,
      `Host: ${FINCHAT_HOST}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      `Sec-WebSocket-Key: ${request.headers['sec-websocket-key']}`,
      `Sec-WebSocket-Version: ${request.headers['sec-websocket-version'] || '13'}`,
      request.headers.origin ? `Origin: ${request.headers.origin}` : '',
      request.headers['user-agent'] ? `User-Agent: ${request.headers['user-agent']}` : '',
      request.headers['accept-language'] ? `Accept-Language: ${request.headers['accept-language']}` : '',
      request.headers['sec-websocket-extensions']
        ? `Sec-WebSocket-Extensions: ${request.headers['sec-websocket-extensions']}`
        : '',
      request.headers['sec-websocket-protocol']
        ? `Sec-WebSocket-Protocol: ${request.headers['sec-websocket-protocol']}`
        : '',
    ].filter(Boolean).join('\r\n') + '\r\n\r\n';

    upstream.write(headers);

    if (head?.length) {
      upstream.write(head);
    }

    socket.pipe(upstream);
    upstream.pipe(socket);
  });

  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', 'http://localhost');

    if (requestUrl.pathname === '/file-upload-proxy') {
      await handleUpload(request, response);
      return;
    }

    if (requestUrl.pathname === '/file-download-proxy') {
      await handleDownload(request, response);
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    send(response, 502, error.message || 'Server error');
  }
});

server.on('upgrade', proxyWebSocket);
server.listen(PORT, () => {
  process.stdout.write(`webfinchat server listening on http://localhost:${PORT}\n`);
});
