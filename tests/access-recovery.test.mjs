import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { execFileSync } from 'node:child_process';
import { confirmWordcolorResetSMS, normalizePhone, RecoveryError, requestWordcolorResetSMS } from "../src/api/accessRecovery.js";

const config = { url: "wss://example.invalid/v0/channels", apiKey: "public-test-key" };
const phone = "+375291234567";
const originalWebSocket = globalThis.WebSocket;
let sockets;
let onCommand;

class FakeWebSocket {
  constructor(url) {
    this.url = url.toString();
    this.messages = [];
    this.closed = false;
    sockets.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  send(value) {
    const message = JSON.parse(value);
    this.messages.push(message);
    if (message.hi) this.reply({ ctrl: { id: message.hi.id, code: 201 } });
    else onCommand?.(message, this);
  }

  reply(message) {
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(message) }));
  }

  close() { this.closed = true; }
}

beforeEach(() => {
  sockets = [];
  onCommand = undefined;
  globalThis.WebSocket = FakeWebSocket;
});

afterEach(() => { globalThis.WebSocket = originalWebSocket; });

test("phone formatting is normalized and invalid numbers are rejected", () => {
  assert.equal(normalizePhone("+375 (29) 123-45-67"), phone);
  for (const invalid of ["", "375291234567", "+0123456789", "+375foo291234567", "+123", "+1234567890123456"]) {
    assert.equal(normalizePhone(invalid), null);
  }
});

test("SMS request waits for hi, sends the documented reset payload and accepts 301", async () => {
  onCommand = ({ login }, socket) => {
    assert.equal(socket.messages[0].hi.ver, "0.22");
    assert.equal(login.scheme, "reset");
    assert.equal(atob(login.secret), `wordcolor:tel:${phone}`);
    socket.reply({ ctrl: { id: "unrelated", code: 500 } });
    socket.reply({ ctrl: { id: login.id, code: 301 } });
  };
  await requestWordcolorResetSMS(phone, config, new AbortController().signal);
  assert.equal(new URL(sockets[0].url).searchParams.get("apikey"), config.apiKey);
  assert.equal(sockets[0].messages.length, 2);
  assert.equal(sockets[0].closed, true);
});

test("confirmation uses temporary credentials and preserves all eight digits including zeros", async () => {
  const credentials = { word1: "река", word2: "лес", digits: "00123456" };
  onCommand = ({ acc }, socket) => {
    assert.equal(acc.scheme, "wordcolor");
    assert.equal(acc.tmpscheme, "code");
    assert.equal(atob(acc.tmpsecret), `123456:tel:${phone}`);
    assert.equal("secret" in acc, false);
    assert.equal("user" in acc, false);
    socket.reply({ ctrl: { id: acc.id, code: 200, params: credentials } });
  };
  assert.deepEqual(await confirmWordcolorResetSMS(phone, "123456", config, new AbortController().signal), credentials);
});

test("SMS limit exposes the server retry interval without retrying the operation", async () => {
  onCommand = ({ login }, socket) => socket.reply({ ctrl: { id: login.id, code: 429, params: { retry_after: 3600 } } });
  await assert.rejects(requestWordcolorResetSMS(phone, config, new AbortController().signal), (error) => {
    assert.ok(error instanceof RecoveryError);
    assert.equal(error.code, 429);
    assert.equal(error.retryAfter, 3600);
    return true;
  });
  assert.equal(sockets[0].messages.length, 2);
});

test("incorrect SMS codes are rejected and return no credentials", async () => {
  onCommand = ({ acc }, socket) => socket.reply({ ctrl: { id: acc.id, code: 401 } });
  await assert.rejects(confirmWordcolorResetSMS(phone, "000000", config, new AbortController().signal), (error) => error.code === 401);
});

test("incomplete success responses are rejected instead of inventing password parts", async () => {
  for (const digits of [12345678, "1234567", "123456789", undefined]) {
    onCommand = ({ acc }, socket) => socket.reply({ ctrl: { id: acc.id, code: 200, params: { word1: "река", word2: "лес", digits } } });
    await assert.rejects(confirmWordcolorResetSMS(phone, "123456", config, new AbortController().signal), /данные получены не полностью/);
  }
});

test("connection loss during confirmation explains that the result is unknown and never retries", async () => {
  onCommand = (_, socket) => socket.onclose();
  await assert.rejects(confirmWordcolorResetSMS(phone, "123456", config, new AbortController().signal), /результат проверки неизвестен/);
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].messages.length, 2);
});

test("aborting a pending operation closes its WebSocket", async () => {
  const controller = new AbortController();
  onCommand = () => controller.abort();
  await assert.rejects(requestWordcolorResetSMS(phone, config, controller.signal), { name: "AbortError" });
  assert.equal(sockets[0].closed, true);
});

test("missing configuration fails before opening any connection", async () => {
  await assert.rejects(requestWordcolorResetSMS(phone, {}, new AbortController().signal), /пока недоступно/);
  assert.equal(sockets.length, 0);
});

test('recovery shares login env configuration without adding another key or backend', () => {
  const script = `globalThis.__FINCHAT_HOST__='api.fixture.invalid';
    globalThis.__FINCHAT_API_KEY__='env-public-key';
    const {createSocketUrl}=await import('./src/api/finchat.js');
    const {recoveryConfig}=await import('./src/api/accessRecovery.js');
    console.log(JSON.stringify({login:createSocketUrl(),recovery:recoveryConfig()}));`;
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', windowsHide: true }));
  assert.equal(result.recovery.url, result.login);
  assert.equal(result.recovery.url, 'wss://api.fixture.invalid/v0/channels?apikey=env-public-key');
  assert.equal('apiKey' in result.recovery, false);
});

test('recovery supports the existing same-origin proxy with the API key only on the server', async () => {
  const script = `globalThis.window={location:{protocol:'https:',host:'app.fixture.invalid'}};
    const {recoveryConfig}=await import('./src/api/accessRecovery.js');
    console.log(JSON.stringify(recoveryConfig()));`;
  const { url } = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', windowsHide: true }));
  assert.equal(url, 'wss://app.fixture.invalid/finchat-channels');
  onCommand = ({ login }, socket) => socket.reply({ ctrl: { id: login.id, code: 301 } });
  await requestWordcolorResetSMS(phone, { url }, new AbortController().signal);
  assert.equal(new URL(sockets[0].url).search, '');
});

test('failed handshake never sends SMS or confirmation', async () => {
  FakeWebSocket.prototype.send = function(value) {
    const message = JSON.parse(value);
    this.messages.push(message);
    this.reply({ ctrl: { id: message.hi.id, code: 403 } });
  };
  try {
    await assert.rejects(requestWordcolorResetSMS(phone, config, new AbortController().signal), /временно недоступен/);
    assert.equal(sockets[0].messages.length, 1);
    assert.equal(sockets[0].closed, true);
  } finally { FakeWebSocket.prototype.send = originalSend; }
});

const originalSend = FakeWebSocket.prototype.send;

test('malformed response and synchronous send failure clean up instead of hanging', async () => {
  onCommand = (_, socket) => queueMicrotask(() => socket.onmessage?.({ data: '{broken' }));
  await assert.rejects(requestWordcolorResetSMS(phone, config, new AbortController().signal), /некорректный ответ/);
  assert.equal(sockets[0].closed, true);
  FakeWebSocket.prototype.send = function(value) {
    const message = JSON.parse(value);
    if (message.acc) throw new Error('Socket closed during send');
    originalSend.call(this, value);
  };
  try {
    await assert.rejects(confirmWordcolorResetSMS(phone, '001234', config, new AbortController().signal), /результат проверки неизвестен/);
    assert.equal(sockets[1].closed, true);
  } finally { FakeWebSocket.prototype.send = originalSend; }
});

test('already aborted operations do not connect', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(requestWordcolorResetSMS(phone, config, controller.signal), { name: 'AbortError' });
  assert.equal(sockets.length, 0);
});

test('rate limits without a usable retry_after fall back to 60 seconds', async () => {
  for (const retry_after of [undefined, -1, '3600', 0]) {
    onCommand = ({ login }, socket) => socket.reply({ ctrl: { id: login.id, code: 429, params: { retry_after } } });
    await assert.rejects(requestWordcolorResetSMS(phone, config, new AbortController().signal), (error) => error.retryAfter === 60);
  }
});

test('lost request response never resends SMS automatically', async () => {
  onCommand = (_, socket) => socket.onclose();
  await assert.rejects(requestWordcolorResetSMS(phone, config, new AbortController().signal), /Нет ответа/);
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].messages.length, 2);
});

test('confirmation timeout reports an unknown outcome and closes without retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  onCommand = () => queueMicrotask(() => t.mock.timers.tick(20_001));
  await assert.rejects(confirmWordcolorResetSMS(phone, '001234', config, new AbortController().signal), /результат проверки неизвестен/);
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].messages.length, 2);
  assert.equal(sockets[0].closed, true);
  assert.equal(sockets[0].onmessage, null);
  assert.equal(sockets[0].onclose, null);
});
