import test from 'node:test';
import assert from 'node:assert/strict';
import { CallSounds } from './callSounds.js';
import { CallNotifications } from './callNotifications.js';

function setup(t, initialState = 'running') {
  const oscillators = [];
  const blocked = [];
  const context = {
    state: initialState, currentTime: 10, destination: {},
    resume: async () => { context.state = 'running'; context.onstatechange?.(); },
    close: async () => { context.state = 'closed'; },
    createOscillator() {
      const oscillator = {
        frequency: {}, stops: [], connect() {}, disconnect() {},
        start(time) { this.started = time; }, stop(time) { this.stops.push(time); },
      };
      oscillators.push(oscillator);
      return oscillator;
    },
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; },
  };
  const sounds = new CallSounds({ createContext: () => context, onBlocked: (value) => blocked.push(value) });
  t.after(() => sounds.dispose());
  return { sounds, context, oscillators, blocked };
}

test('group invitation plays one short chime per call and never starts a repeat timer', async (t) => {
  const x = setup(t);
  x.sounds.setMode('notice', 'call-one');
  assert.equal(x.oscillators.length, 3);
  assert.equal(x.sounds.timer, null);
  x.sounds.sync();
  await x.sounds.unlock();
  assert.equal(x.oscillators.length, 3);
  x.sounds.setMode('notice', 'call-two');
  assert.equal(x.oscillators.length, 6);
  x.sounds.setMode('notice', 'call-one');
  assert.equal(x.oscillators.length, 6);
});

test('dismissed invitation cannot chime after a late autoplay unlock', async (t) => {
  const x = setup(t, 'suspended');
  let resume;
  x.context.resume = () => new Promise((resolve) => { resume = resolve; });
  x.sounds.setMode('notice', 'call-one');
  x.sounds.setMode(null);
  x.context.state = 'running';
  resume();
  await Promise.resolve();
  assert.equal(x.oscillators.length, 0);
});

function notifications(t, permission = 'default') {
  const shown = [];
  let requests = 0;
  let focuses = 0;
  class API {
    static permission = permission;
    static async requestPermission() { requests++; API.permission = 'granted'; return 'granted'; }
    constructor(title, options) { this.title = title; this.options = options; shown.push(this); }
    close() { this.closed = true; this.onclose?.(); }
  }
  const manager = new CallNotifications({ getAPI: () => API, focus: () => { focuses++; } });
  t.after(() => manager.dispose());
  return { manager, shown, API, requests: () => requests, focuses: () => focuses };
}

test('browser notice never requests permission automatically; explicit opt-in enables it', async (t) => {
  const x = notifications(t);
  x.manager.show({ callId: 'call', title: 'Team' });
  assert.equal(x.shown.length, 0);
  assert.equal(x.requests(), 0);
  assert.equal(await x.manager.requestPermission(), 'granted');
  x.manager.show({ callId: 'call', title: 'Team' });
  x.manager.show({ callId: 'call', title: 'Team' });
  assert.equal(x.shown.length, 1);
  assert.match(x.shown[0].options.body, /Team/);
  assert.equal(x.shown[0].options.silent, true);
});

test('clicking system notification focuses invitation; dismissed notices cannot reopen it', (t) => {
  const x = notifications(t, 'granted');
  let opened = 0;
  x.manager.show({ callId: 'call', title: 'Team' }, () => { opened++; });
  const click = x.shown[0].onclick;
  click();
  assert.equal(opened, 1);
  assert.equal(x.focuses(), 1);
  assert.equal(x.shown[0].closed, true);
  click();
  assert.equal(opened, 1);
  x.manager.show({ callId: 'other', title: 'Team' });
  x.manager.retain([]);
  assert.equal(x.shown[1].closed, true);
});

test('denied and unavailable browser notifications leave in-app invitation usable', async (t) => {
  const x = notifications(t, 'denied');
  await x.manager.requestPermission();
  x.manager.show({ callId: 'call', title: 'Team' });
  assert.equal(x.requests(), 0);
  assert.equal(x.shown.length, 0);
  const unsupported = new CallNotifications({ getAPI: () => undefined });
  assert.equal(unsupported.permission, 'unsupported');
  assert.equal(await unsupported.requestPermission(), 'unsupported');
  assert.doesNotThrow(() => unsupported.show({ callId: 'call' }));
  unsupported.dispose();
});

test('unsupported notification constructor fails once and logout closes every native notice', (t) => {
  let attempts = 0;
  class MobileAPI {
    static permission = 'granted';
    constructor() { attempts++; throw new TypeError('Constructor unsupported'); }
  }
  const unavailable = new CallNotifications({ getAPI: () => MobileAPI });
  assert.match(unavailable.show({ callId: 'call', title: 'Team' }), /Браузер/);
  unavailable.show({ callId: 'call', title: 'Team' });
  assert.equal(attempts, 1);
  unavailable.dispose();
  const x = notifications(t, 'granted');
  x.manager.show({ callId: 'one', title: 'Team' });
  x.manager.show({ callId: 'two', title: 'Team' });
  x.manager.dispose();
  assert.equal(x.shown.every((notice) => notice.closed), true);
  x.manager.show({ callId: 'three', title: 'Team' });
  assert.equal(x.shown.length, 2);
});

test('incoming and outgoing use different patterns; switching stops every old note', async (t) => {
  const x = setup(t);
  x.sounds.setMode('incoming');
  const incomingNotes = [...x.oscillators];
  assert.ok(incomingNotes.length > 1);
  assert.ok(x.oscillators.every((oscillator) => oscillator.started >= 10));
  x.sounds.setMode('outgoing');
  assert.ok(incomingNotes.every((oscillator) => oscillator.stops.includes(undefined)));
  assert.equal(x.oscillators.length, incomingNotes.length + 1);
  assert.equal(x.oscillators.at(-1).frequency.value, 425);
});

test('answering or ending cancels both the repeat timer and scheduled notes', async (t) => {
  const x = setup(t);
  x.sounds.setMode('incoming');
  assert.ok(x.sounds.timer);
  x.sounds.setMode(null);
  assert.equal(x.sounds.timer, null);
  assert.equal(x.sounds.nodes.size, 0);
  assert.ok(x.oscillators.every((oscillator) => oscillator.stops.includes(undefined)));
  assert.equal(x.blocked.at(-1), false);
});

test('blocked autoplay exposes a fallback and user activation retries it', async (t) => {
  const x = setup(t, 'suspended');
  x.context.resume = async () => { throw new Error('User gesture required'); };
  x.sounds.setMode('incoming');
  await Promise.resolve();
  assert.equal(x.blocked.at(-1), true);
  assert.equal(x.oscillators.length, 0);
  x.context.resume = async () => { x.context.state = 'running'; };
  await x.sounds.unlock();
  assert.equal(x.blocked.at(-1), false);
  assert.ok(x.oscillators.length > 1);
});

test('a late autoplay permission does not restart an answered call ringtone', async (t) => {
  const x = setup(t, 'suspended');
  let resume;
  x.context.resume = () => new Promise((resolve) => { resume = resolve; });
  x.sounds.setMode('outgoing');
  x.sounds.setMode(null);
  x.context.state = 'running';
  resume();
  await Promise.resolve();
  assert.equal(x.oscillators.length, 0);
  assert.equal(x.sounds.timer, null);
});

test('repeated unlock gestures do not overlap ringtone patterns', async (t) => {
  const x = setup(t);
  x.sounds.setMode('incoming');
  const noteCount = x.oscillators.length;
  await x.sounds.unlock();
  await x.sounds.unlock();
  assert.equal(x.oscillators.length, noteCount);
});

test('unmount closes audio and prevents late sounds', async (t) => {
  const x = setup(t);
  x.sounds.setMode('outgoing');
  x.sounds.dispose();
  await x.sounds.unlock();
  x.sounds.setMode('incoming');
  assert.equal(x.context.state, 'closed');
  assert.equal(x.oscillators.length, 1);
  assert.equal(x.sounds.nodes.size, 0);
});
