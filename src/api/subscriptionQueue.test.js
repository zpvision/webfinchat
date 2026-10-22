import test from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionQueue } from './subscriptionQueue.js';
import { FinchatRealtimeClient } from './finchat.js';
import { CallController } from './calls.js';

const pause = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, timeout = 5000) {
  const end = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > end) throw new Error('Condition timed out'); await pause(5); }
}

test('100 topics: six workers, deduplication, event-loop yields and continuation after error', async () => {
  const started = [];
  let active = 0, peak = 0, yields = 0;
  const queue = new SubscriptionQueue(async (topic) => {
    started.push(topic); active++; peak = Math.max(peak, active);
    await pause(1); active--;
    if (topic === 'usr13') throw new Error('permission denied');
  }, { yieldTask: async () => { yields++; await pause(); } });
  const topics = Array.from({ length: 100 }, (_, i) => `usr${i}`);
  const cancel = queue.replace([...topics, ...topics, '', null]);
  queue.resume();
  await until(() => started.length === 100 && queue.inFlight.size === 0);
  assert.equal(peak, 6);
  assert.equal(new Set(started).size, 100);
  assert.ok(yields >= 17);
  cancel();
});

test('replacing React leases shares in-flight slots; stale cleanup cannot cancel the new queue', async () => {
  const pending = [];
  const started = [];
  const queue = new SubscriptionQueue((topic) => {
    started.push(topic);
    return new Promise((resolve) => pending.push(resolve));
  });
  const topics = Array.from({ length: 100 }, (_, i) => `usr${i}`);
  const oldCancel = queue.replace(topics); queue.resume();
  await until(() => started.length === 6);
  const cancel = queue.replace(topics); oldCancel();
  await pause(5);
  assert.equal(started.length, 6);
  cancel();
  pending.forEach((resolve) => resolve());
  await until(() => queue.inFlight.size === 0);
  await pause(5);
  assert.equal(started.length, 6);
});

test('pause/resume refills unchanged topics and cancellation before first batch starts nothing', async () => {
  const started = [];
  const queue = new SubscriptionQueue(async (topic) => started.push(topic));
  const cancelled = queue.replace(['cancelled']); queue.resume(); cancelled();
  await pause(10);
  assert.equal(started.length, 0);
  const cleanup = queue.replace(['one', 'two']);
  await until(() => started.length === 2);
  queue.pause(); queue.resume();
  await until(() => started.length === 4);
  assert.deepEqual(started, ['one', 'two', 'one', 'two']);
  cleanup();
});

function fakeNetwork(t) {
  const sockets = [];
  class Socket extends EventTarget {
    static OPEN = 1; static CONNECTING = 0; static CLOSED = 3;
    constructor() {
      super(); this.readyState = 0; this.sent = []; sockets.push(this);
      setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); }, 0);
    }
    packet(packet) { if (this.readyState === 1) this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(packet) })); }
    send(json) {
      const packet = JSON.parse(json); this.sent.push(packet);
      if (packet.hi) setTimeout(() => this.packet({ ctrl: { id: packet.hi.id, code: 201, params: { calls: { provider: 'livekit' }, callTimeout: 30 } } }), 0);
      else if (packet.login) setTimeout(() => this.packet({ ctrl: { id: packet.login.id, code: 200 } }), 0);
      else if (packet.sub && !this.holdSubscriptions) setTimeout(() => this.packet({ ctrl: { id: packet.sub.id, code: 200 } }), 3);
      else if (packet.note?.payload?.requestId) setTimeout(() => this.packet({ ctrl: { id: packet.note.payload.requestId, code: 200 } }), 0);
    }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  const previousSocket = globalThis.WebSocket;
  const previousWindow = globalThis.window;
  globalThis.WebSocket = Socket;
  globalThis.window = { setTimeout, clearTimeout, location: { protocol: 'https:', host: 'test.invalid' } };
  t.after(() => { globalThis.WebSocket = previousSocket; globalThis.window = previousWindow; });
  return sockets;
}

test('real client deduplicates foreground attach and parses each frame once during background subscriptions', async (t) => {
  const sockets = fakeNetwork(t);
  const client = new FinchatRealtimeClient('test-token');
  t.after(() => client.close());
  await client.connect();
  const a = client.attach('usrA'); const b = client.attach('usrA');
  await Promise.all([a, b]);
  assert.equal(sockets[0].sent.filter((packet) => packet.sub?.topic === 'usrA').length, 1);
  const cleanup = client.subscribeInBackground(Array.from({ length: 100 }, (_, i) => `usr${i}`));
  await until(() => client.pendingSubscriptions.size >= 6);
  const raw = JSON.stringify({ data: { topic: 'usrOther', seq: 3, content: 'message' } });
  const parse = JSON.parse;
  let parses = 0;
  JSON.parse = (value, ...args) => { if (value === raw) parses++; return parse(value, ...args); };
  try { sockets[0].dispatchEvent(new MessageEvent('message', { data: raw })); } finally { JSON.parse = parse; }
  assert.equal(parses, 1);
  const foreground = client.attach('me');
  assert.equal(client.backgroundSubscriptions.inFlight.size, 6);
  await foreground;
  assert.ok(client.subscribedTopics.has('me'));
  cleanup();
});

test('unchanged topic list resubscribes after real reconnect; messages and incoming call signaling survive', async (t) => {
  const sockets = fakeNetwork(t);
  const client = new FinchatRealtimeClient('test-token');
  const controller = new CallController(client);
  t.after(() => { controller.dispose(); client.close(); });
  await controller.initialize();
  client.subscribeInBackground(Array.from({ length: 100 }, (_, i) => `usr${i}`));
  await until(() => client.subscribedTopics.size === 101);
  sockets[0].close();
  await until(() => sockets.length === 2 && controller.state.ready && client.subscribedTopics.size === 101);
  let received;
  const unsubscribe = client.onPacket((packet) => { if (packet.data) received = packet.data; });
  sockets[1].packet({ data: { topic: 'usr42', seq: 8, content: 'after reconnect' } });
  assert.equal(received.content, 'after reconnect');
  sockets[1].packet({ info: { topic: 'me', src: 'usrPeer', what: 'call', seq: 7, payload: {
    event: 'invite', callId: 'reconnected-call', version: 1, topic: 'usrPeer', seq: 7,
    audioOnly: true, expiresAt: new Date(Date.now() + 30000).toISOString(),
  } } });
  assert.equal(controller.state.call.phase, 'incoming');
  assert.equal(controller.state.call.callId, 'reconnected-call');
  await pause(20);
  unsubscribe();
});

test('old socket response and cleanup cannot overwrite a new subscription for the same topic', async (t) => {
  const sockets = fakeNetwork(t);
  const client = new FinchatRealtimeClient('test-token');
  t.after(() => client.close());
  await client.connect();
  sockets[0].holdSubscriptions = true;
  const old = client.attach('usrRace');
  const rejected = assert.rejects(old, /закрыто/);
  await until(() => sockets[0].sent.some((packet) => packet.sub));
  const oldId = sockets[0].sent.find((packet) => packet.sub).sub.id;
  sockets[0].close();
  await client.connect();
  sockets[1].holdSubscriptions = true;
  const current = client.attach('usrRace');
  await until(() => sockets[1].sent.some((packet) => packet.sub));
  const pending = client.pendingSubscriptions.get('usrRace');
  let delivered = false;
  client.onPacket((packet) => { if (packet.data) delivered = true; });
  sockets[0].dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ ctrl: { id: oldId, code: 200 }, data: { topic: 'usrRace' } }) }));
  await rejected;
  assert.equal(client.pendingSubscriptions.get('usrRace'), pending);
  assert.equal(client.subscribedTopics.has('usrRace'), false);
  assert.equal(delivered, false);
  const id = sockets[1].sent.find((packet) => packet.sub).sub.id;
  sockets[1].packet({ ctrl: { id, code: 200 } });
  await current;
  assert.equal(client.subscribedTopics.has('usrRace'), true);
});
