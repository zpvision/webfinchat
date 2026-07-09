import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { randomUUID } from 'node:crypto';
import tls from 'node:tls';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = MAX_FILE_BYTES;
const PDF_VIEW_TTL_MS = 5 * 60 * 1000;

function readBody(request, maxBytes = MAX_FILE_BYTES) {
  return new Promise((resolve, reject) => {
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
    request.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function singleHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}

function safeHeaderValue(value) {
  const header = singleHeader(value);

  if (typeof header !== 'string') {
    return '';
  }

  return /^[\t\x20-\x7e]*$/.test(header) && !/[\r\n]/.test(header) ? header : '';
}

function isAllowedOrigin(request, allowedOrigins = []) {
  const origin = safeHeaderValue(request.headers.origin);

  if (!origin) {
    return true;
  }

  if (allowedOrigins.includes(origin)) {
    return true;
  }

  try {
    const originUrl = new URL(origin);
    const host = safeHeaderValue(request.headers.host);

    return Boolean(host && originUrl.host === host && ['http:', 'https:'].includes(originUrl.protocol));
  } catch {
    return false;
  }
}

async function readResponseBody(response, maxBytes = MAX_DOWNLOAD_BYTES) {
  const contentLength = Number(response.headers.get('content-length') || 0);

  if (contentLength > maxBytes) {
    throw new Error('File is too large');
  }

  if (!response.body?.getReader) {
    const body = Buffer.from(await response.arrayBuffer());

    if (body.length > maxBytes) {
      throw new Error('File is too large');
    }

    return body;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      return Buffer.concat(chunks);
    }

    size += value.byteLength;

    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('File is too large');
    }

    chunks.push(Buffer.from(value));
  }
}

function normalizeFileRef(ref, finchatHost) {
  if (!ref) {
    return '';
  }

  if (ref.startsWith('http')) {
    let url;

    try {
      url = new URL(ref);
    } catch {
      return '';
    }

    if (url.protocol !== 'https:' || url.hostname !== finchatHost) {
      return '';
    }

    ref = `${url.pathname}${url.search}`;
  }

  if (!ref.startsWith('/')) {
    return `/v0/file/s/${ref}`;
  }

  if (!ref.startsWith('/v0/')) {
    ref = `/v0/file/s${ref}`;
  }

  if (!ref.startsWith('/v0/file/')) {
    return '';
  }

  return ref;
}

function createContentDispositionFilename(name) {
  const fallback = String(name || 'document.pdf')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
    .slice(0, 120) || 'document.pdf';
  const encoded = encodeURIComponent(String(name || 'document.pdf')).replace(/['()]/g, escape);

  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function fileProxyPlugin(env) {
  const finchatHost = env.FINCHAT_HOST || 'api.dev.finchat.club';
  const apiKey = env.FINCHAT_API_KEY || '';
  const pdfViewTokens = new Map();
  const allowedOrigins = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const cleanupPdfViewTokens = () => {
    const now = Date.now();

    for (const [id, item] of pdfViewTokens.entries()) {
      if (item.expiresAt <= now) {
        pdfViewTokens.delete(id);
      }
    }
  };

  const fetchFinchatFile = (normalizedRef, token) => {
    const fileUrl = new URL(normalizedRef, `https://${finchatHost}`);

    if (apiKey) {
      fileUrl.searchParams.set('apikey', apiKey);
    }

    fileUrl.searchParams.set('auth', 'token');
    fileUrl.searchParams.set('secret', token);

    return fetch(fileUrl, {
      headers: {
        ...(apiKey ? { 'X-Finchat-APIKey': apiKey } : {}),
        'X-Finchat-Auth': `Token ${token}`,
      },
      redirect: 'follow',
    });
  };

  return {
    name: 'file-proxy',
    configureServer(server) {
      server.middlewares.use('/file-upload-proxy', async (request, response) => {
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.end('Method not allowed');
          return;
        }

        try {
          const token = singleHeader(request.headers['x-finchat-token']);
          const mime = singleHeader(request.headers['x-file-mime']) || 'application/octet-stream';
          const extension = singleHeader(request.headers['x-file-ext']) || '';
          const declaredLength = Number(singleHeader(request.headers['content-length']) || 0);

          if (declaredLength > MAX_FILE_BYTES) {
            response.statusCode = 413;
            response.end('File is too large');
            return;
          }

          const fileBody = await readBody(request);

          if (!token) {
            response.statusCode = 401;
            response.end('Missing FinChat token');
            return;
          }

          const presignUrl = new URL('/v0/file/u', `https://${finchatHost}`);

          presignUrl.searchParams.set('direct', 'true');

          if (extension) {
            presignUrl.searchParams.set('ext', extension);
          } else {
            presignUrl.searchParams.set('mime', mime);
          }

          const presignResponse = await fetch(presignUrl, {
            method: 'POST',
            headers: {
              ...(apiKey ? { 'X-Finchat-APIKey': apiKey } : {}),
              'X-Finchat-Auth': `Token ${token}`,
            },
          });
          const presignText = await presignResponse.text();

          if (!presignResponse.ok) {
            response.statusCode = presignResponse.status;
            response.end(presignText);
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
            response.statusCode = 502;
            response.end(presignText);
            return;
          }

          const objectStorageUrl = new URL(params.upload_url);

          if (objectStorageUrl.protocol !== 'https:') {
            response.statusCode = 502;
            response.end('Invalid upload URL');
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
            response.statusCode = uploadResponse.status;
            response.end(uploadText);
            return;
          }

          response.setHeader('Content-Type', 'application/json');
          response.end(
            JSON.stringify({
              url: params.url,
              content_type: params.content_type,
              cache_control: params.cache_control,
            }),
          );
        } catch (error) {
          response.statusCode = 502;
          response.end(error.message || 'File upload failed');
        }
      });

      server.middlewares.use('/pdf-view-proxy', async (request, response) => {
        cleanupPdfViewTokens();

        if (request.method === 'POST') {
          try {
            const token = singleHeader(request.headers['x-finchat-token']);

            if (!token) {
              response.statusCode = 401;
              response.end('Missing FinChat token');
              return;
            }

            const payload = JSON.parse((await readBody(request, 8 * 1024)).toString('utf8'));
            const normalizedRef = normalizeFileRef(payload?.ref || '', finchatHost);

            if (!normalizedRef) {
              response.statusCode = 400;
              response.end('Missing or invalid file ref');
              return;
            }

            const id = randomUUID();

            pdfViewTokens.set(id, {
              token,
              ref: normalizedRef,
              name: String(payload?.name || 'document.pdf').replace(/[\r\n"]/g, ''),
              expiresAt: Date.now() + PDF_VIEW_TTL_MS,
            });

            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ url: `/pdf-view-proxy?id=${encodeURIComponent(id)}` }));
          } catch (error) {
            response.statusCode = 400;
            response.end(error.message || 'Invalid request body');
          }

          return;
        }

        if (request.method !== 'GET') {
          response.statusCode = 405;
          response.end('Method not allowed');
          return;
        }

        try {
          const requestUrl = new URL(request.url || '', 'http://localhost');
          const id = requestUrl.searchParams.get('id') || '';
          const item = pdfViewTokens.get(id);

          if (!item || item.expiresAt <= Date.now()) {
            pdfViewTokens.delete(id);
            response.statusCode = 404;
            response.end('PDF link expired');
            return;
          }

          const fileResponse = await fetchFinchatFile(item.ref, item.token);
          let fileBody;

          try {
            fileBody = await readResponseBody(fileResponse);
          } catch (error) {
            response.statusCode = 413;
            response.end(error.message || 'File is too large');
            return;
          }

          if (!fileResponse.ok) {
            response.statusCode = fileResponse.status;
            response.setHeader('Content-Type', fileResponse.headers.get('content-type') || 'text/plain');
            response.end(fileBody);
            return;
          }

          if (!fileBody.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
            const contentType = fileResponse.headers.get('content-type') || '';
            let errorText = fileBody.toString('utf8', 0, Math.min(fileBody.length, 500));

            if (contentType.includes('application/json')) {
              try {
                const parsed = JSON.parse(fileBody.toString('utf8'));
                errorText = parsed?.error || parsed?.err || parsed?.ctrl?.text || errorText;
              } catch {
                // Keep text preview.
              }
            }

            response.statusCode = 502;
            response.end(errorText || 'Server returned a non-PDF response');
            return;
          }

          response.statusCode = 200;
          response.setHeader('X-Content-Type-Options', 'nosniff');
          response.setHeader('Referrer-Policy', 'no-referrer');
          response.setHeader('X-Frame-Options', 'SAMEORIGIN');
          response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'");
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('Content-Type', 'application/pdf');
          response.setHeader('Content-Disposition', createContentDispositionFilename(item.name));
          response.setHeader('Content-Length', String(fileBody.length));
          response.end(fileBody);
        } catch (error) {
          response.statusCode = 502;
          response.end(error.message || 'PDF view failed');
        }
      });

      server.middlewares.use('/file-download-proxy', async (request, response) => {
        if (request.method !== 'GET') {
          response.statusCode = 405;
          response.end('Method not allowed');
          return;
        }

        try {
          const token = singleHeader(request.headers['x-finchat-token']);
          const requestUrl = new URL(request.url || '', 'http://localhost');
          const ref = requestUrl.searchParams.get('ref') || '';
          const normalizedRef = normalizeFileRef(ref, finchatHost);

          if (!token) {
            response.statusCode = 401;
            response.end('Missing FinChat token');
            return;
          }

          if (!normalizedRef) {
            response.statusCode = 400;
            response.end('Missing file ref');
            return;
          }

          const fileUrl = new URL(normalizedRef, `https://${finchatHost}`);

          if (apiKey) {
            fileUrl.searchParams.set('apikey', apiKey);
          }

          fileUrl.searchParams.set('auth', 'token');
          fileUrl.searchParams.set('secret', token);

          const fileResponse = await fetch(fileUrl, {
            headers: {
              ...(apiKey ? { 'X-Finchat-APIKey': apiKey } : {}),
              'X-Finchat-Auth': `Token ${token}`,
            },
            redirect: 'follow',
          });
          let fileBody;

          try {
            fileBody = await readResponseBody(fileResponse);
          } catch (error) {
            response.statusCode = 413;
            response.end(error.message || 'File is too large');
            return;
          }
          const contentType = fileResponse.headers.get('content-type') || 'application/octet-stream';

          if (!fileResponse.ok) {
            response.statusCode = fileResponse.status;
            response.setHeader('Content-Type', contentType);
            response.end(fileBody);
            return;
          }

          if (contentType.includes('application/json')) {
            try {
              const parsed = JSON.parse(fileBody.toString('utf8'));
              const errorText =
                parsed?.error || parsed?.err || parsed?.ctrl?.text || 'Server returned JSON instead of file';

              response.statusCode = 502;
              response.end(errorText);
              return;
            } catch {
              // If it is not a FinChat error JSON, pass it through as a file.
            }
          }

          const contentLength = fileResponse.headers.get('content-length') || String(fileBody.length);

          response.statusCode = 200;
          response.setHeader('Content-Type', contentType);
          response.setHeader('Content-Length', contentLength);
          response.end(fileBody);
        } catch (error) {
          response.statusCode = 502;
          response.end(error.message || 'File download failed');
        }
      });

      server.httpServer?.on('upgrade', (request, socket, head) => {
        const requestUrl = new URL(request.url || '', 'http://localhost');

        if (requestUrl.pathname !== '/finchat-channels') {
          return;
        }

        if (!isAllowedOrigin(request, allowedOrigins)) {
          socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
          return;
        }

        const websocketKey = safeHeaderValue(request.headers['sec-websocket-key']);
        const websocketVersion = safeHeaderValue(request.headers['sec-websocket-version']) || '13';

        if (!websocketKey || !/^[A-Za-z0-9+/=]{16,128}$/.test(websocketKey) || !/^\d+$/.test(websocketVersion)) {
          socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
          return;
        }

        const upstreamPath = new URL('/v0/channels', `https://${finchatHost}`);

        if (apiKey) {
          upstreamPath.searchParams.set('apikey', apiKey);
        }

        const upstream = tls.connect(443, finchatHost, { servername: finchatHost }, () => {
          const headers = [
            `GET ${upstreamPath.pathname}${upstreamPath.search} HTTP/1.1`,
            `Host: ${finchatHost}`,
            'Connection: Upgrade',
            'Upgrade: websocket',
            `Sec-WebSocket-Key: ${websocketKey}`,
            `Sec-WebSocket-Version: ${websocketVersion}`,
            safeHeaderValue(request.headers.origin) ? `Origin: ${safeHeaderValue(request.headers.origin)}` : '',
            safeHeaderValue(request.headers['user-agent'])
              ? `User-Agent: ${safeHeaderValue(request.headers['user-agent'])}`
              : '',
            safeHeaderValue(request.headers['accept-language'])
              ? `Accept-Language: ${safeHeaderValue(request.headers['accept-language'])}`
              : '',
            safeHeaderValue(request.headers['sec-websocket-extensions'])
              ? `Sec-WebSocket-Extensions: ${safeHeaderValue(request.headers['sec-websocket-extensions'])}`
              : '',
            safeHeaderValue(request.headers['sec-websocket-protocol'])
              ? `Sec-WebSocket-Protocol: ${safeHeaderValue(request.headers['sec-websocket-protocol'])}`
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
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), fileProxyPlugin(env)],
  };
});
