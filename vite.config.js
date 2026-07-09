import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tls from 'node:tls';

const MAX_FILE_BYTES = 50 * 1024 * 1024;

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

function normalizeFileRef(ref, finchatHost) {
  if (!ref) {
    return '';
  }

  if (ref.startsWith('http')) {
    const url = new URL(ref);

    if (url.protocol !== 'https:' || url.hostname !== finchatHost) {
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

function fileProxyPlugin(env) {
  const finchatHost = env.FINCHAT_HOST || 'api.dev.finchat.club';
  const apiKey = env.FINCHAT_API_KEY || '';

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
          const fileBody = Buffer.from(await fileResponse.arrayBuffer());
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
