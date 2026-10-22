import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const configUrl = pathToFileURL(resolve('vite.config.js')).href;
async function readDefines(t, values) {
  const cwd = await mkdtemp(join(tmpdir(), 'finchat-config-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(VITE_|FINCHAT_)/.test(key)) delete env[key];
  Object.assign(env, values);
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    `const {default: config} = await import(${JSON.stringify(configUrl)}); console.log(JSON.stringify(config({mode: 'production'}).define));`,
  ], { cwd, env, encoding: 'utf8', windowsHide: true }));
}

test('default build uses existing same-origin proxy', async (t) => {
  const defines = await readDefines(t, {});
  assert.equal(JSON.parse(defines.__FINCHAT_HOST__), '');
  assert.equal(JSON.parse(defines.__FINCHAT_API_KEY__), '');
});

test('server host and secret never fall through into browser defines', async (t) => {
  const defines = await readDefines(t, { FINCHAT_HOST: 'private-backend.test', FINCHAT_API_KEY: 'server-only-test-marker' });
  assert.equal(JSON.parse(defines.__FINCHAT_HOST__), '');
  assert.equal(JSON.parse(defines.__FINCHAT_API_KEY__), '');
  assert.ok(!JSON.stringify(defines).includes('server-only-test-marker'));
});

test('explicit public VITE variables retain direct browser connection', async (t) => {
  const defines = await readDefines(t, { FINCHAT_HOST: 'private-backend.test', FINCHAT_API_KEY: 'server-only-test-marker',
    VITE_FINCHAT_HOST: 'public-backend.test', VITE_FINCHAT_API_KEY: 'public-test-key' });
  assert.equal(JSON.parse(defines.__FINCHAT_HOST__), 'public-backend.test');
  assert.equal(JSON.parse(defines.__FINCHAT_API_KEY__), 'public-test-key');
});
