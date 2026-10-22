import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageNotifications } from './messageNotifications.js';
import { CallSounds } from './callSounds.js';

function setup(t, permission = 'granted') {
  const notices = [], native = [], modes = [], opened = [];
  let focused = 0, time = 1000;
  class API {
    static permission = permission;
    static requestPermission() { throw new Error('Must not request automatically'); }
    constructor(title, options) { Object.assign(this, { title, options }); native.push(this); }
    close() { this.closed = true; }
  }
  const sounds = { setMode: (...args) => modes.push(args), dispose() { this.disposed = true; } };
  const manager = new MessageNotifications({ user: 'usrMe', sounds, getAPI: () => API,
    focus: () => focused++, onNotice: (notice) => notices.push(notice), onOpen: (notice) => opened.push(notice), now: () => time });
  const chat = { id: 'grp1', topic: 'grp1', title: 'Коллеги', raw: { seq: 10 } };
  manager.seed([chat]);
  const receive = (data = {}, state = {}) => {
    const packet = { topic: 'grp1', seq: 11, from: 'usrPeer', ...data };
    manager.receive(packet, { preview: 'Привет', deletedAt: packet.deletedAt, replaceSeq: packet.head?.replace }, chat, { focused: true, selectedId: 'usrOther', ...state });
  };
  t.after(() => manager.dispose());
  return { manager, receive, chat, native, notices, modes, opened, sounds, API,
    focusCount: () => focused, advance: () => { time += 2000; } };
}

test('message from another chat shows popup, native notification and one chime', (t) => {
  const x = setup(t);
  x.receive(); x.receive();
  assert.equal(x.notices.length, 1);
  assert.equal(x.native.length, 1);
  assert.equal(x.native[0].title, 'Коллеги · FinChat');
  assert.equal(x.native[0].options.body, 'Привет');
  assert.equal(x.native[0].options.silent, true);
  assert.deepEqual(x.modes, [['notice', 'grp1:11']]);
});

test('visible selected chat stays quiet; hidden or unfocused selected chat alerts', (t) => {
  const x = setup(t);
  x.receive({}, { selectedId: 'grp1' });
  assert.equal(x.notices.length, 0);
  x.receive({ seq: 12 }, { selectedId: 'grp1', focused: false });
  assert.equal(x.notices.length, 1);
});

test('history, initial unread, own messages, edits, deletions and call records stay quiet', (t) => {
  const x = setup(t);
  x.receive({ seq: 9 });
  x.receive({ id: 'get-data-1' });
  x.receive({ from: 'usrMe' });
  x.receive({ seq: 12, head: { replace: ':10' } });
  x.receive({ seq: 13, deletedAt: 'now' });
  x.receive({ seq: 14, head: { webrtc: 'started' } });
  assert.equal(x.notices.length, 0);
  assert.equal(x.native.length, 0);
  assert.equal(x.modes.length, 0);
});

test('history does not consume a new live sequence; reconnect replay is deduplicated', (t) => {
  const x = setup(t);
  x.receive({ id: 'get-data-1' });
  x.receive();
  x.manager.seed([x.chat]);
  x.receive();
  assert.equal(x.notices.length, 1);
});

test('message bursts replace native notice per topic and throttle chimes', (t) => {
  const x = setup(t);
  x.receive(); x.receive({ seq: 12 });
  assert.equal(x.native[0].closed, true);
  assert.equal(x.manager.active.size, 1);
  assert.equal(x.modes.length, 1);
  x.advance(); x.receive({ seq: 13 });
  assert.equal(x.modes.length, 2);
});

test('click focuses FinChat, opens the correct chat, and closes the notice', (t) => {
  const x = setup(t);
  x.receive();
  x.native[0].onclick();
  assert.equal(x.focusCount(), 1);
  assert.equal(x.opened[0].chatId, 'grp1');
  assert.equal(x.native[0].closed, true);
});

for (const permission of ['default', 'denied']) test(`${permission} permission preserves in-app notice and sound without asking`, (t) => {
  const x = setup(t, permission);
  x.receive();
  assert.equal(x.notices.length, 1);
  assert.equal(x.native.length, 0);
  assert.equal(x.modes.length, 1);
});

test('unsupported Notification constructor does not interrupt message handling', (t) => {
  const x = setup(t);
  x.manager.getAPI = () => class { static permission = 'granted'; constructor() { throw new TypeError('Unsupported'); } };
  assert.doesNotThrow(() => x.receive());
  assert.equal(x.notices.length, 1);
});

test('missing Notification API leaves popup and sound available', (t) => {
  const x = setup(t);
  x.manager.getAPI = () => undefined;
  x.receive();
  assert.equal(x.notices.length, 1);
  assert.equal(x.modes.length, 1);
});

test('autoplay unlock after message expiry does not play a stale chime', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const x = setup(t);
  let tones = 0;
  const context = { state: 'suspended', resume: () => new Promise(() => {}),
    close: async () => {}, createOscillator: () => { tones++; throw new Error('Stale sound'); } };
  const audio = new CallSounds({ createContext: () => context });
  x.manager.sounds = audio;
  x.receive();
  t.mock.timers.tick(1201);
  context.state = 'running';
  audio.sync();
  assert.equal(tones, 0);
  assert.equal(audio.mode, null);
});

test('reading and logout close notifications, cancel pending chime and release audio', (t) => {
  const x = setup(t);
  x.receive();
  x.manager.read(x.chat);
  assert.equal(x.native[0].closed, true);
  assert.deepEqual(x.modes.at(-1), [null]);
  x.manager.dispose();
  x.receive({ seq: 12 });
  assert.equal(x.notices.length, 1);
  assert.equal(x.sounds.disposed, true);
});
