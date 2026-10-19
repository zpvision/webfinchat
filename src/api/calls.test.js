import test from 'node:test';
import assert from 'node:assert/strict';
import { CallController } from './calls.js';

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
function setup(t, supported = true) {
  const sent = [];
  const attached = [];
  let listener;
  let counter = 0;
  const client = {
    socket: { readyState: 1, finchatParams: supported ? { calls: { provider: 'livekit' }, callTimeout: 30 } : {},
      send: (json) => sent.push(JSON.parse(json)) },
    connect: async () => {}, attach: async (topic) => attached.push(topic),
    nextId: () => `request-${++counter}`,
    onPacket: (fn) => { listener = fn; return () => { listener = null; }; },
  };
  const controller = new CallController(client);
  controller.checkMicrophone = async () => {};
  const media = [];
  controller.connectMedia = async (call, info) => media.push({ call, info });
  t.after(() => controller.dispose());
  const deliver = (packet) => listener?.(packet);
  const token = (id, seq = 7, callId = 'call-1') => ({ info: {
    topic: 'usrPeer', what: 'call', seq,
    payload: { type: 'token', requestId: id, callId, provider: 'livekit', url: 'wss://call.example', token: 'private-jwt' },
  } });
  const notify = (event, version = 1, extra = {}) => deliver({ info: {
    topic: 'me', src: 'usrPeer', what: 'call', seq: 7, event,
    payload: { callId: 'call-1', event, version, topic: 'usrPeer', seq: 7, audioOnly: true,
      expiresAt: new Date(Date.now() + 30000).toISOString(), ...extra },
  } });
  const ack = (id) => deliver({ ctrl: { id, code: 200, params: { seq: 7 } } });
  return { controller, client, sent, attached, deliver, token, notify, ack, media };
}

test('does not enable calls on a server without the capability', async (t) => {
  const x = setup(t, false);
  await x.controller.initialize();
  await x.controller.start({ topic: 'usrPeer' });
  assert.equal(x.controller.state.ready, false);
  assert.match(x.controller.state.reason, /LiveKit/);
  assert.deepEqual(x.sent, []);
});

for (const tokenFirst of [true, false]) {
  test(`outgoing call waits for ctrl and token (${tokenFirst ? 'token' : 'ctrl'} first)`, async (t) => {
    const x = setup(t);
    await x.controller.initialize();
    assert.deepEqual(x.attached, ['me']);
    const started = x.controller.start({ topic: 'usrPeer', title: 'Peer' });
    await nextTurn();
    const id = x.sent[0].pub.id;
    assert.equal(x.sent[0].pub.head.aonly, true);
    if (tokenFirst) x.deliver(x.token(id)); else x.ack(id);
    await nextTurn();
    assert.equal(x.media.length, 0);
    if (tokenFirst) x.ack(id); else x.deliver(x.token(id));
    await started;
    assert.equal(x.media.length, 1);
    assert.equal(x.controller.state.call.callId, 'call-1');
    assert.equal(x.controller.state.call.phase, 'outgoing');
    // JWT is never part of the UI state.
    assert.equal(JSON.stringify(x.controller.state).includes('private-jwt'), false);
  });
}

test('accepted notification between start replies is preserved', async (t) => {
  const x = setup(t);
  await x.controller.initialize();
  const started = x.controller.start({ topic: 'usrPeer' });
  await nextTurn();
  const id = x.sent[0].pub.id;
  x.ack(id);
  x.notify('accepted', 2);
  x.deliver(x.token(id));
  await started;
  assert.equal(x.controller.state.call.phase, 'connecting');
});

test('incoming invite is deduplicated and a closed call cannot reopen', async (t) => {
  const x = setup(t);
  await x.controller.initialize();
  x.notify('invite');
  const call = x.controller.state.call;
  x.notify('invite');
  await nextTurn();
  assert.equal(x.controller.state.call, call);
  assert.equal(x.sent.length, 1);
  assert.equal(x.sent[0].note.event, 'ringing');
  x.ack(x.sent[0].note.payload.requestId);
  x.notify('ended', 3);
  x.notify('invite', 4);
  assert.equal(x.controller.state.call, null);
});

test('expired invites and history messages never open an incoming call', async (t) => {
  const x = setup(t);
  await x.controller.initialize();
  x.notify('invite', 1, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  x.deliver({ data: { topic: 'usrPeer', head: { webrtc: 'started', livekit: { room: 'room' } } } });
  assert.equal(x.controller.state.call, null);
  assert.equal(x.sent.length, 0);
});

test('rejecting a call sends leave and releases media', async (t) => {
  const x = setup(t);
  await x.controller.initialize();
  x.notify('invite');
  await nextTurn();
  x.ack(x.sent[0].note.payload.requestId);
  let disconnected = false;
  x.controller.room = { removeAllListeners() {}, disconnect() { disconnected = true; } };
  const ended = x.controller.hangUp();
  await nextTurn();
  assert.equal(disconnected, true);
  assert.equal(x.sent[1].note.event, 'hang-up');
  assert.equal(x.sent[1].note.payload.action, 'leave');
  x.ack(x.sent[1].note.payload.requestId);
  await ended;
  assert.equal(x.controller.state.call, null);
});

test('late join token after ended does not connect media', async (t) => {
  const x = setup(t);
  await x.controller.initialize();
  x.notify('invite');
  await nextTurn();
  x.ack(x.sent[0].note.payload.requestId);
  const accepted = x.controller.accept();
  await nextTurn();
  const id = x.sent[1].note.payload.requestId;
  x.notify('ended', 2);
  x.deliver(x.token(id));
  await accepted;
  assert.equal(x.controller.state.call, null);
  assert.equal(x.media.length, 0);
});

test('a token with an older notification version still completes join', async (t) => {
  const x = setup(t);
  await x.controller.initialize();
  x.notify('invite', 10);
  await nextTurn();
  x.ack(x.sent[0].note.payload.requestId);
  const accepted = x.controller.accept();
  await nextTurn();
  const packet = x.token(x.sent[1].note.payload.requestId);
  packet.info.payload.version = 1;
  x.deliver(packet);
  await accepted;
  assert.equal(x.media.length, 1);
  assert.equal(x.controller.state.call.accepted, true);
});

test('answer on another device closes a pending incoming join without media', async (t) => {
  const x = setup(t);
  await x.controller.initialize();
  x.notify('invite');
  await nextTurn();
  x.ack(x.sent[0].note.payload.requestId);
  const accepted = x.controller.accept();
  await nextTurn();
  const id = x.sent[1].note.payload.requestId;
  x.notify('answered_elsewhere', 2);
  x.deliver(x.token(id));
  await accepted;
  assert.equal(x.controller.state.call, null);
  assert.equal(x.media.length, 0);
  assert.equal(x.sent.filter((packet) => packet.note?.payload.action === 'leave').length, 0);
});

test('microphone denial never publishes a call', async (t) => {
  const x = setup(t);
  await x.controller.initialize();
  x.controller.checkMicrophone = async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); };
  await x.controller.start({ topic: 'usrPeer' });
  assert.equal(x.sent.length, 0);
  assert.equal(x.controller.state.call, null);
  assert.match(x.controller.state.error, /микрофону/);
});

test('a lost leave result is reconciled through status without a second leave', async (t) => {
  const x = setup(t);
  await x.controller.initialize();
  x.notify('invite');
  await nextTurn();
  x.ack(x.sent[0].note.payload.requestId);
  const ended = x.controller.hangUp();
  await nextTurn();
  const id = x.sent[1].note.payload.requestId;
  x.controller.pending.get(id).finish(new Error('lost acknowledgement'));
  await nextTurn();
  assert.equal(x.sent[2].note.payload.action, 'status');
  x.deliver({ info: { topic: 'usrPeer', what: 'call', seq: 0, payload: {
    type: 'status', requestId: x.sent[2].note.payload.requestId, active: false, participation: 'none', state: 'idle',
  } } });
  await ended;
  assert.equal(x.controller.state.call, null);
  assert.equal(x.sent.filter((packet) => packet.note?.payload.action === 'leave').length, 1);
});
