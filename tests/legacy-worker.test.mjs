import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { retireLegacyWorker } from '../src/retireLegacyWorker.js';

function registration(path = '/service-worker.js', scope = '/', origin = 'https://app.test') {
  return { scope: origin + scope, active: { scriptURL: origin + path }, count: 0,
    async unregister() { this.count++; return true; } };
}

test('startup retires only the root-scoped legacy Tinode worker', async () => {
  const legacy = registration('/service-worker.js?v=old');
  const other = registration('/push-worker.js');
  const nested = registration('/service-worker.js', '/another-app/');
  const external = registration('/service-worker.js', '/', 'https://other.test');
  const future = registration();
  future.waiting = { scriptURL: 'https://app.test/finchat-worker.js' };
  await retireLegacyWorker({ origin: 'https://app.test', serviceWorker: { getRegistrations: async () => [legacy, other, nested, external, future] } });
  assert.equal(legacy.count, 1);
  for (const item of [other, nested, external, future]) assert.equal(item.count, 0);
});

test('missing or denied service workers cannot block application startup', async () => {
  await assert.doesNotReject(retireLegacyWorker({ serviceWorker: {}, origin: 'https://app.test' }));
  await assert.doesNotReject(retireLegacyWorker({ get serviceWorker() { throw new Error('Denied getter'); } }));
  await assert.doesNotReject(retireLegacyWorker({ serviceWorker: { getRegistrations: async () => { throw new Error('Denied'); } }, origin: 'https://app.test' }));
  const failing = registration();
  failing.unregister = async () => { throw new Error('Denied'); };
  const next = registration();
  await retireLegacyWorker({ origin: 'https://app.test', serviceWorker: { getRegistrations: async () => [failing, next] } });
  assert.equal(next.count, 1);
});

test('retirement script activates immediately and unregisters without fetch interception or client reload', async () => {
  const events = {};
  let skipped = 0, unregistered = 0;
  const source = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');
  runInNewContext(source, { self: { addEventListener: (event, listener) => { events[event] = listener; },
    skipWaiting: async () => { skipped++; }, registration: { unregister: async () => { unregistered++; } } } });
  const promises = [];
  const event = { waitUntil: (promise) => promises.push(promise) };
  events.install(event);
  events.activate(event);
  await Promise.all(promises);
  assert.deepEqual(Object.keys(events).sort(), ['activate', 'install']);
  assert.equal(skipped, 1);
  assert.equal(unregistered, 1);
});
