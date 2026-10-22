// Test process only: keep real fetch/decompression and both actual server entrypoints,
// but route the synthetic backend to a local HTTP fixture. No external traffic.
import tls from 'node:tls';
import net from 'node:net';
import { pathToFileURL } from 'node:url';

const nativeFetch = globalThis.fetch;
const upstream = new URL(process.env.TEST_UPSTREAM);
globalThis.fetch = (input, options) => {
  const url = new URL(input);
  if (url.hostname !== 'files.test') throw new Error('Unexpected test upstream');
  return nativeFetch(new URL(url.pathname + url.search, upstream), options);
};
tls.connect = (port, host, options, callback) => {
  if (port !== 443 || host !== 'files.test') throw new Error('Unexpected test socket');
  return net.connect(Number(upstream.port), upstream.hostname, callback);
};

if (process.env.TEST_MODE === 'production') {
  await import(pathToFileURL(process.env.TEST_SERVER));
} else {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: process.env.TEST_CONFIG,
    root: process.cwd(),
    envDir: process.cwd(),
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  console.log(`test dev listening on http://localhost:${server.httpServer.address().port}`);
}
