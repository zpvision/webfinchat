import test from 'node:test';
import assert from 'node:assert/strict';
import { CallController } from './calls.js';
import { canJoinGroup } from './groupCalls.js';

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


test('video start uses existing Tinode aonly contract and call model', async (t) => {
  const x = setup(t);
  await x.controller.initialize();
  const started = x.controller.start({ topic: 'usrPeer' }, 'video');
  await nextTurn();
  const id = x.sent[0].pub.id;
  assert.equal(x.sent[0].pub.head.aonly, false);
  x.ack(id);
  x.deliver(x.token(id));
  await started;
  assert.equal(x.controller.state.call.type, 'video');
});

test('incoming video uses existing invite and join flow', async (t) => {
  const x = setup(t);
  await x.controller.initialize();
  x.notify('invite', 1, { audioOnly: false });
  await nextTurn();
  assert.equal(x.controller.state.call.type, 'video');
  x.ack(x.sent[0].note.payload.requestId);
  const accepted = x.controller.accept();
  await nextTurn();
  x.deliver(x.token(x.sent[1].note.payload.requestId));
  await accepted;
  assert.equal(x.media.length, 1);
});

for (const name of ['NotAllowedError', 'NotFoundError']) {
  test('camera ' + name + ' preserves audio call and room', async (t) => {
    const x = setup(t);
    const call = { callId: 'same', type: 'audio', phase: 'active' };
    x.controller.update({ call });
    const room = { localParticipant: { setCameraEnabled: async () => { throw Object.assign(new Error(), { name }); } },
      removeAllListeners() {}, disconnect() {} };
    x.controller.room = room;
    await x.controller.setCamera(true);
    assert.equal(x.controller.room, room);
    assert.equal(x.controller.state.call, call);
    assert.equal(x.controller.state.cameraBusy, false);
    assert.match(x.controller.state.error, /без видео/);
    assert.equal(x.sent.length, 0);
  });
}

test('camera toggles in same room without signaling; late capture is stopped', async (t) => {
  const x = setup(t);
  const enabled = [];
  let finishCapture;
  let stopped = false;
  const track = { stop() { stopped = true; }, detach() { return []; } };
  const room = { localParticipant: {
    setCameraEnabled(value) { enabled.push(value); return value ? new Promise((resolve) => { finishCapture = resolve; }) : Promise.resolve(); },
    getTrackPublication() { return { track }; }, trackPublications: new Map([['camera', { track }]]),
  }, removeAllListeners() {}, disconnect() {} };
  x.controller.room = room;
  const pending = x.controller.setCamera(true);
  x.controller.stopMedia();
  finishCapture();
  await pending;
  assert.deepEqual(enabled, [true, false]);
  assert.equal(stopped, true);
  assert.equal(x.controller.state.localVideo, null);
  assert.equal(x.sent.length, 0);
});


test('media events restore video after reconnect and clear muted or departed participants', async (t) => {
  const { RoomEvent } = await import('livekit-client');
  const x = setup(t);
  const handlers = new Map();
  const localPublication = { isMuted: false, track: { detach: () => [], stop() {} } };
  const remotePublication = { isSubscribed: true, isMuted: false, track: { kind: 'video', detach: () => [] } };
  const remote = { identity: 'peer', getTrackPublication: () => remotePublication, audioTrackPublications: new Map() };
  const cameras = [];
  const room = {
    on(event, handler) { handlers.set(event, [...handlers.get(event) || [], handler]); },
    remoteParticipants: new Map([['peer', remote]]),
    localParticipant: { getTrackPublication: () => localPublication, setMicrophoneEnabled: async () => {},
      setCameraEnabled: async (enabled) => { cameras.push(enabled); localPublication.isMuted = !enabled; } },
    connect: async () => {}, startAudio: async () => {}, disconnect() {}, removeAllListeners() {},
  };
  x.controller.createRoom = () => room;
  const call = { type: 'audio', phase: 'connecting' };
  x.controller.update({ call });
  await CallController.prototype.connectMedia.call(x.controller, call, x.token('id').info);
  assert.deepEqual(cameras, []);
  assert.equal(x.controller.state.remoteVideos.length, 1);
  const emit = (event, ...args) => handlers.get(event)?.forEach((handler) => handler(...args));
  remotePublication.isMuted = true;
  emit(RoomEvent.TrackMuted);
  assert.equal(x.controller.state.remoteVideos.length, 0);
  remotePublication.isMuted = false;
  emit(RoomEvent.Reconnecting);
  emit(RoomEvent.Reconnected);
  assert.equal(x.controller.state.remoteVideos.length, 1);
  await x.controller.setCamera(false);
  assert.equal(x.controller.state.cameraEnabled, false);
  emit(RoomEvent.Reconnected);
  assert.equal(x.controller.state.cameraEnabled, false);
  room.remoteParticipants.clear();
  emit(RoomEvent.ParticipantDisconnected, remote);
  assert.equal(x.controller.state.remoteVideos.length, 0);
  assert.equal(x.sent.length, 0);
});

test('switching camera reuses room and LiveKit device switch', async (t) => {
  const x = setup(t);
  const switches = [];
  const room = { localParticipant: { getTrackPublication: () => ({ track: { getDeviceId: async () => 'front' } }) },
    switchActiveDevice: async (...args) => { switches.push(args); return true; },
    removeAllListeners() {}, disconnect() {} };
  x.controller.room = room;
  x.controller.update({ cameraEnabled: true, cameras: [{ deviceId: 'front' }, { deviceId: 'back' }] });
  await x.controller.switchCamera();
  assert.deepEqual(switches, [['videoinput', 'back']]);
  assert.equal(x.controller.room, room);
  assert.equal(x.sent.length, 0);
});

test('audio call can publish its first camera and toggle it without another invite or room', async (t) => {
  const { RoomEvent } = await import('livekit-client');
  const x = setup(t);
  const handlers = new Map();
  const track = { detach: () => [], stop() {} };
  let publication;
  let connects = 0;
  const emit = (event) => handlers.get(event)?.forEach((handler) => handler());
  const room = {
    on(event, handler) { handlers.set(event, [...handlers.get(event) || [], handler]); },
    remoteParticipants: new Map(),
    localParticipant: {
      getTrackPublication: () => publication,
      setMicrophoneEnabled: async () => {},
      async setCameraEnabled(enabled) {
        if (!publication && enabled) {
          publication = { track, isMuted: false };
          emit(RoomEvent.LocalTrackPublished);
        } else if (publication) {
          publication.isMuted = !enabled;
          emit(enabled ? RoomEvent.TrackUnmuted : RoomEvent.TrackMuted);
        }
        return publication;
      },
    },
    connect: async () => { connects++; }, startAudio: async () => {},
    disconnect() {}, removeAllListeners() {},
  };
  x.controller.createRoom = () => room;
  const call = { callId: 'original-call', type: 'audio', phase: 'active' };
  x.controller.update({ call });
  await CallController.prototype.connectMedia.call(x.controller, call, x.token('id').info);
  assert.equal(publication, undefined);
  await x.controller.toggleCamera();
  assert.equal(x.controller.state.localVideo, track);
  assert.equal(x.controller.state.cameraEnabled, true);
  await x.controller.toggleCamera();
  assert.equal(x.controller.state.localVideo, null);
  await x.controller.toggleCamera();
  assert.equal(x.controller.state.localVideo, track);
  assert.equal(x.controller.state.call, call);
  assert.equal(x.controller.room, room);
  assert.equal(connects, 1);
  assert.equal(x.sent.length, 0);
});

test('LiveKit publication denial is distinguished from browser camera permission denial', async (t) => {
  const x = setup(t);
  const call = { type: 'audio', phase: 'active' };
  x.controller.update({ call });
  x.controller.room = {
    localParticipant: { async setCameraEnabled() {
      throw Object.assign(new Error('insufficient permissions'), { name: 'PublishTrackError', status: 403 });
    } }, removeAllListeners() {}, disconnect() {},
  };
  await x.controller.toggleCamera();
  assert.match(x.controller.state.error, /Сервер не разрешил/);
  assert.equal(x.controller.state.call, call);
  assert.equal(x.controller.state.cameraBusy, false);
});

function setupGroup(t, mode = 'notify') {
  const x = setup(t);
  Object.assign(x.client.socket.finchatParams.calls, { group: true, groupNotifications: mode, maxParticipants: 50 });
  x.groupStatus = (id, extra = {}, seq = 7) => x.deliver({ info: {
    topic: 'grpTeam', what: 'call', seq, payload: { type: 'status', requestId: id,
      active: true, state: 'active', callId: 'call-1', group: true, audioOnly: false,
      participation: 'not-joined', expiresAt: new Date(Date.now() - 60000).toISOString(), ...extra },
  } });
  x.groupToken = (id) => { const packet = x.token(id); packet.info.topic = 'grpTeam'; x.deliver(packet); };
  x.groupNotify = (event, version = 1, extra = {}) => x.notify(event, version,
    { group: true, topic: 'grpTeam', audioOnly: false, ...extra });
  return x;
}

test('group notifications advertise a call without taking over UI or sending ringing', async (t) => {
  const x = setupGroup(t);
  await x.controller.initialize();
  x.groupNotify('invite', 1, { ring: false });
  await nextTurn();
  assert.equal(x.controller.state.groupReady, true);
  assert.equal(x.controller.state.maxParticipants, 50);
  assert.equal(x.controller.state.call, null);
  assert.equal(canJoinGroup(x.controller.state.groupCalls.grpTeam), true);
  assert.equal(x.sent.length, 0);
  x.groupNotify('ended', 2);
  assert.equal(canJoinGroup(x.controller.state.groupCalls.grpTeam), false);
});

test('group ringing is shown only when requested and supported', async (t) => {
  const x = setupGroup(t, 'ring');
  await x.controller.initialize();
  x.groupNotify('invite', 1, { ring: true });
  await nextTurn();
  assert.equal(x.controller.state.call.group, true);
  assert.equal(x.controller.state.call.phase, 'incoming');
  assert.equal(x.sent[0].note.event, 'ringing');
  x.ack(x.sent[0].note.payload.requestId);
});

test('group capability is required and unsupported invites never open a call', async (t) => {
  const x = setup(t);
  await x.controller.initialize();
  await x.controller.start({ topic: 'grpTeam' }, 'video');
  x.notify('invite', 1, { group: true, topic: 'grpTeam', ring: true });
  assert.equal(x.controller.state.call, null);
  assert.equal(x.sent.length, 0);
});

test('group creation checks status first and uses the existing pub/token flow', async (t) => {
  const x = setupGroup(t);
  await x.controller.initialize();
  const started = x.controller.start({ topic: 'grpTeam', title: 'Team' }, 'video');
  await nextTurn();
  assert.equal(x.sent[0].note.seq, 0);
  assert.equal(x.sent[0].note.payload.action, 'status');
  x.groupStatus(x.sent[0].note.payload.requestId, { active: false, state: 'idle', callId: null, participation: 'none' }, 0);
  await nextTurn();
  const pub = x.sent[1].pub;
  assert.equal(pub.topic, 'grpTeam');
  assert.equal(pub.head.aonly, false);
  x.ack(pub.id);
  x.groupToken(pub.id);
  await started;
  assert.equal(x.media.length, 1);
  assert.equal(x.controller.state.call.group, true);
});

test('late join to accepted group ignores original invite expiry and creates no pub', async (t) => {
  const x = setupGroup(t);
  await x.controller.initialize();
  const joined = x.controller.joinGroup({ topic: 'grpTeam', title: 'Team' });
  await nextTurn();
  x.groupStatus(x.sent[0].note.payload.requestId, { canEnd: true });
  await nextTurn();
  assert.equal(x.sent[1].note.payload.action, 'join');
  assert.equal(x.sent[1].note.seq, 7);
  x.groupToken(x.sent[1].note.payload.requestId);
  await joined;
  assert.equal(x.controller.state.call.callId, 'call-1');
  assert.equal(x.controller.state.call.canEnd, true);
  assert.equal(x.media.length, 1);
  assert.equal(x.sent.some((packet) => packet.pub), false);
});

test('group leave preserves discoverability and permits intentional rejoin to same call', async (t) => {
  const x = setupGroup(t);
  await x.controller.initialize();
  const join = async () => {
    const result = x.controller.joinGroup({ topic: 'grpTeam' });
    await nextTurn();
    x.groupStatus(x.sent.at(-1).note.payload.requestId);
    await nextTurn();
    x.groupToken(x.sent.at(-1).note.payload.requestId);
    await result;
  };
  await join();
  const ended = x.controller.hangUp();
  await nextTurn();
  assert.equal(x.sent.at(-1).note.payload.action, 'leave');
  x.ack(x.sent.at(-1).note.payload.requestId);
  await ended;
  assert.equal(x.controller.state.call, null);
  assert.equal(canJoinGroup(x.controller.state.groupCalls.grpTeam), true);
  await join();
  assert.equal(x.media.length, 2);
  assert.equal(x.controller.state.call.callId, 'call-1');
});

test('another device invite dismissal does not close an accepted group participation', async (t) => {
  const x = setupGroup(t);
  await x.controller.initialize();
  const call = { group: true, callId: 'call-1', topic: 'grpTeam', accepted: true, phase: 'active' };
  x.controller.update({ call });
  x.groupNotify('answered_elsewhere', 1);
  x.groupNotify('declined', 2);
  assert.equal(x.controller.state.call, call);
  x.groupNotify('ended', 3);
  assert.equal(x.controller.state.call, null);
});

test('end for everyone requires canEnd and sends end instead of leave', async (t) => {
  const x = setupGroup(t);
  await x.controller.initialize();
  const call = { group: true, callId: 'call-1', topic: 'grpTeam', seq: 7, phase: 'active' };
  x.controller.update({ call });
  await x.controller.hangUp('end');
  assert.equal(x.sent.length, 0);
  call.canEnd = true;
  const ended = x.controller.hangUp('end');
  await nextTurn();
  assert.equal(x.sent[0].note.payload.action, 'end');
  x.ack(x.sent[0].note.payload.requestId);
  await ended;
  assert.equal(x.controller.state.call, null);
});

test('group status arriving after ended cannot resurrect a joinable call', async (t) => {
  const x = setupGroup(t);
  await x.controller.initialize();
  const joining = x.controller.joinGroup({ topic: 'grpTeam' });
  await nextTurn();
  x.groupNotify('ended', 2);
  x.groupStatus(x.sent[0].note.payload.requestId);
  await joining;
  assert.equal(x.media.length, 0);
  assert.equal(canJoinGroup(x.controller.state.groupCalls.grpTeam), false);
  assert.equal(x.sent.some((packet) => packet.note?.payload.action === 'join'), false);
});

test('expired ringing is not joinable; accepted group remains joinable after expiresAt', () => {
  const base = { active: true, callId: 'call', seq: 7, expiresAt: new Date(Date.now() - 60000).toISOString() };
  assert.equal(canJoinGroup({ ...base, state: 'ringing' }), false);
  assert.equal(canJoinGroup({ ...base, state: 'active' }), true);
  assert.equal(canJoinGroup({ ...base, state: 'ending' }), false);
});

test('group media keeps all participants when cameras are muted or one person leaves', async (t) => {
  const { RoomEvent } = await import('livekit-client');
  const x = setupGroup(t);
  const handlers = new Map();
  const camera = { isMuted: false, isSubscribed: true, track: { detach: () => [] } };
  const participant = (identity, video) => ({ identity, name: identity, audioTrackPublications: new Map(),
    getTrackPublication: (source) => source === 'camera' ? video : undefined });
  const anna = participant('usrAnna:session', camera);
  const boris = participant('usrBoris:session', null);
  const room = {
    on(event, handler) { handlers.set(event, [...handlers.get(event) || [], handler]); },
    remoteParticipants: new Map([[anna.identity, anna], [boris.identity, boris]]),
    localParticipant: { getTrackPublication: () => undefined, setMicrophoneEnabled: async () => {} },
    connect: async () => {}, startAudio: async () => {}, removeAllListeners() {}, disconnect() {},
  };
  x.controller.createRoom = () => room;
  const call = { group: true, type: 'audio', accepted: true, phase: 'connecting', topic: 'grpTeam' };
  x.controller.update({ call });
  await CallController.prototype.connectMedia.call(x.controller, call, x.token('id').info);
  await nextTurn();
  x.groupStatus(x.sent.at(-1).note.payload.requestId);
  await nextTurn();
  assert.equal(x.controller.state.remoteParticipants.length, 2);
  assert.equal(x.controller.state.remoteVideos.length, 1);
  assert.equal(call.phase, 'active');
  const emit = (event) => handlers.get(event)?.forEach((handler) => handler());
  camera.isMuted = true;
  emit(RoomEvent.TrackMuted);
  assert.equal(x.controller.state.remoteVideos.length, 0);
  assert.equal(x.controller.state.remoteParticipants.length, 2);
  room.remoteParticipants.delete(anna.identity);
  emit(RoomEvent.ParticipantDisconnected);
  assert.equal(x.controller.state.remoteParticipants.length, 1);
  assert.equal(x.controller.state.call, call);
});

test('notify invite creates one nonblocking notice; dismissal sends no signaling', async (t) => {
  const x = setupGroup(t);
  await x.controller.initialize();
  x.groupNotify('invite', 1, { ring: false, title: 'Team' });
  x.groupNotify('invite', 1, { ring: false });
  assert.equal(x.controller.state.groupNotices.length, 1);
  assert.equal(x.controller.state.groupNotices[0].title, 'Team');
  assert.equal(x.controller.state.call, null);
  x.controller.dismissGroupNotice('call-1');
  x.groupNotify('invite', 2, { ring: false });
  assert.equal(x.controller.state.groupNotices.length, 0);
  assert.equal(x.sent.length, 0);
  assert.equal(canJoinGroup(x.controller.state.groupCalls.grpTeam), true);
  x.groupNotify('invite', 1, { callId: 'new-call', ring: false });
  assert.equal(x.controller.state.groupNotices[0].callId, 'new-call');
});

test('expired, ringing and self-started invites do not create floating notices', async (t) => {
  const x = setupGroup(t);
  await x.controller.initialize();
  x.groupNotify('invite', 1, { ring: false, expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(x.controller.state.groupNotices.length, 0);
  x.groupNotify('invite', 2, { ring: true });
  await nextTurn();
  assert.equal(x.controller.state.groupNotices.length, 0);
  x.ack(x.sent[0].note.payload.requestId);
  x.groupNotify('invite', 3, { ring: false });
  assert.equal(x.controller.state.groupNotices.length, 0);
});

for (const event of ['ended', 'cancelled', 'left', 'declined', 'answered_elsewhere']) {
  test('group notice is removed on ' + event, async (t) => {
    const x = setupGroup(t);
    await x.controller.initialize();
    x.groupNotify('invite', 1, { ring: false });
    assert.equal(x.controller.state.groupNotices.length, 1);
    x.groupNotify(event, 2);
    assert.equal(x.controller.state.groupNotices.length, 0);
  });
}

test('authoritative idle status removes a notice even if ended notification was lost', async (t) => {
  const x = setupGroup(t);
  await x.controller.initialize();
  x.groupNotify('invite', 1, { ring: false });
  const refreshed = x.controller.refreshGroup({ topic: 'grpTeam' });
  await nextTurn();
  x.groupStatus(x.sent.at(-1).note.payload.requestId, { active: false, state: 'idle' }, 0);
  await refreshed;
  assert.equal(x.controller.state.groupNotices.length, 0);
});

test('joining a notification never silently joins a newer call in the same group', async (t) => {
  const x = setupGroup(t);
  await x.controller.initialize();
  const joined = x.controller.joinGroup({ topic: 'grpTeam' }, 'old-call');
  await nextTurn();
  x.groupStatus(x.sent[0].note.payload.requestId, { callId: 'new-call' });
  await joined;
  assert.equal(x.media.length, 0);
  assert.equal(x.sent.length, 1);
  assert.equal(x.controller.state.call, null);
});

function mediaDevices(t, value) {
  const previous = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(navigator, 'mediaDevices', previous);
    else delete navigator.mediaDevices;
  });
}

test('audio device selection reuses room, preserves mute and does not request camera', async (t) => {
  const x = setup(t);
  const devices = [
    { kind: 'audioinput', deviceId: 'mic-one', label: 'USB mic' },
    { kind: 'audioinput', deviceId: 'mic-two', label: 'Headset mic' },
    { kind: 'audiooutput', deviceId: 'headset', label: 'Headphones' },
  ];
  mediaDevices(t, { enumerateDevices: async () => devices,
    getUserMedia: () => { throw new Error('Unexpected permission prompt'); } });
  const selected = { audioinput: 'mic-one', audiooutput: 'default' };
  const switches = [];
  const room = { localParticipant: {}, getActiveDevice: (kind) => selected[kind],
    async switchActiveDevice(kind, id) { switches.push([kind, id]); selected[kind] = id; return true; },
    removeAllListeners() {}, disconnect() {} };
  x.controller.room = room;
  x.controller.update({ muted: true });
  await x.controller.refreshDevices();
  assert.equal(x.controller.state.audioInputs.length, 2);
  assert.equal(x.controller.state.audioOutputs.length, 1);
  await x.controller.switchAudioDevice('audioinput', 'mic-two');
  await x.controller.switchAudioDevice('audiooutput', 'headset');
  assert.deepEqual(switches, [['audioinput', 'mic-two'], ['audiooutput', 'headset']]);
  assert.equal(x.controller.state.muted, true);
  assert.equal(x.controller.state.microphoneDeviceId, 'mic-two');
  assert.equal(x.controller.state.speakerDeviceId, 'headset');
  assert.equal(x.controller.room, room);
  assert.equal(x.sent.length, 0);
});

test('failed audio device switch keeps previous selection and call connected', async (t) => {
  const x = setup(t);
  const call = { phase: 'active' };
  const room = { localParticipant: {}, async switchActiveDevice() { throw Object.assign(new Error(), { name: 'NotAllowedError' }); },
    removeAllListeners() {}, disconnect() {} };
  x.controller.room = room;
  x.controller.update({ call, microphoneDeviceId: 'old' });
  await x.controller.switchAudioDevice('audioinput', 'new');
  assert.equal(x.controller.state.microphoneDeviceId, 'old');
  assert.equal(x.controller.state.call, call);
  assert.equal(x.controller.room, room);
  assert.equal(x.controller.state.audioDeviceBusy, false);
  assert.match(x.controller.state.deviceError, /Нет разрешения/);
});

test('late microphone device switch is stopped after hangup', async (t) => {
  const x = setup(t);
  let finish;
  let stopped = false;
  const track = { stop() { stopped = true; } };
  let publication = { track };
  const room = { localParticipant: { getTrackPublication: () => publication },
    switchActiveDevice: () => new Promise((resolve) => { finish = resolve; }),
    removeAllListeners() {}, disconnect() {} };
  x.controller.room = room;
  const switched = x.controller.switchAudioDevice('audioinput', 'new');
  x.controller.stopMedia();
  publication = undefined;
  finish(true);
  await switched;
  assert.equal(stopped, true);
  assert.equal(x.controller.state.devicesReady, false);
});

test('speaker chooser starts in user gesture and does not apply selection after hangup', async (t) => {
  const x = setup(t);
  let choose;
  let requested = false;
  let switched = false;
  mediaDevices(t, { selectAudioOutput: () => { requested = true; return new Promise((resolve) => { choose = resolve; }); } });
  x.controller.room = { localParticipant: {}, switchActiveDevice() { switched = true; }, removeAllListeners() {}, disconnect() {} };
  const pending = x.controller.switchAudioDevice('audiooutput', '', true);
  assert.equal(requested, true);
  x.controller.stopMedia();
  choose({ deviceId: 'speaker' });
  await pending;
  assert.equal(switched, false);
});
