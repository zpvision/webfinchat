import test from 'node:test';
import assert from 'node:assert/strict';
import { CallSounds } from './callSounds.js';

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

test('incoming and outgoing use different patterns; switching stops every old note', async (t) => {
  const x = setup(t);
  x.sounds.setMode('incoming');
  assert.equal(x.oscillators.length, 6);
  assert.ok(x.oscillators.every((oscillator) => oscillator.started >= 10));
  x.sounds.setMode('outgoing');
  assert.ok(x.oscillators.slice(0, 6).every((oscillator) => oscillator.stops.includes(undefined)));
  assert.equal(x.oscillators.length, 7);
  assert.equal(x.oscillators[6].frequency.value, 425);
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
  assert.equal(x.oscillators.length, 6);
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
  await x.sounds.unlock();
  await x.sounds.unlock();
  assert.equal(x.oscillators.length, 6);
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
