const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Engine } = require('../core/engine.cjs');

// Use an in-memory store and clock; never open desktop windows or real profiles.
function fixture(t, id = 'arrow_captcha') {
  let now = 1000, nextTimer = 0;
  const timers = new Map(), logs = [];
  const store = { settings: () => ({ paused: false }), log: (...args) => logs.push(args) };
  const engine = new Engine(store, {
    now: () => now,
    setTimer: (fn, delay) => { const key = ++nextTimer; timers.set(key, { fn, at: now + delay }); return key; },
    clearTimer: key => timers.delete(key)
  });
  const enqueue = (kind = id) => {
    engine.enqueue({ id: kind, eventId: randomUUID(), duration: 10, code: 'ABC234', arrows: ['ArrowUp', 'ArrowDown'], user: 'TEST' });
    return engine.active.eventId;
  };
  const eventId = enqueue();
  t.after(() => engine.dispose());
  return { engine, eventId, enqueue, logs, timers, advance: ms => { now += ms; } };
}

test('arrow progress and wrong-key resets change only the current in-memory captcha', t => {
  const { engine, eventId, logs } = fixture(t);
  const deadline = engine.active.endsAt, timer = engine.timer, logCount = logs.length;
  let changes = 0; engine.on('change', () => changes++);
  for (const progress of [1, 0, 2]) {
    assert.equal(engine.updateCaptcha({ eventId, progress }), true);
    assert.equal(engine.view().active.captcha.progress, progress);
  }
  assert.equal(changes, 3);
  assert.equal(engine.updateCaptcha({ eventId, progress: 2 }), true);
  assert.equal(changes, 3);
  assert.equal(engine.active.endsAt, deadline); assert.equal(engine.timer, timer);
  assert.equal(logs.length, logCount);
});

test('text typing, deletion and error feedback are bounded and never logged', t => {
  const { engine, eventId, logs } = fixture(t, 'text_captcha');
  const logCount = logs.length;
  for (const [text, error] of [['Ab2', false], ['Ab', false], ['', true], ['<img>', false]]) {
    assert.equal(engine.updateCaptcha({ eventId, text, error, ignored: 'not mirrored' }), true);
    assert.deepEqual(engine.active.captcha, { text, error, progress: 0, solved: false });
  }
  for (const input of [{ text: '1234567', error: false }, { text: 1, error: false }, { text: 'A', error: 'false' }]) {
    assert.equal(engine.updateCaptcha({ eventId, ...input }), false);
  }
  assert.equal(logs.length, logCount);
});

test('invalid, stale, stopped and non-captcha progress is ignored', t => {
  const { engine, eventId, enqueue } = fixture(t);
  for (const progress of [-1, 3, 1.5, '1', null, NaN, Infinity]) assert.equal(engine.updateCaptcha({ eventId, progress }), false);
  assert.equal(engine.updateCaptcha(null), false);
  engine.stop(); const fresh = enqueue();
  assert.equal(engine.updateCaptcha({ eventId, progress: 1 }), false);
  assert.equal(engine.solveCaptcha(eventId), false);
  assert.equal(engine.active.eventId, fresh);
  assert.equal(engine.active.captcha.progress, 0);
  engine.stop();
  assert.equal(engine.updateCaptcha({ eventId: fresh, progress: 1 }), false);
  const passive = enqueue('bsod');
  assert.equal(engine.updateCaptcha({ eventId: passive, progress: 1 }), false);
  assert.equal(engine.solveCaptcha(passive), false);
});

test('solved state remains for two mirror polls, then finishes exactly once', t => {
  const { engine, eventId, timers, logs } = fixture(t);
  assert.equal(engine.solveCaptcha(eventId), false);
  engine.updateCaptcha({ eventId, progress: 2 });
  assert.equal(engine.solveCaptcha(eventId), true);
  assert.equal(engine.active.captcha.solved, true);
  assert.equal(timers.size, 1);
  const completion = timers.get(engine.timer);
  assert.equal(completion.at, 1750);
  assert.equal(engine.solveCaptcha(eventId), false);
  assert.equal(engine.updateCaptcha({ eventId, progress: 0 }), false);
  completion.fn(); completion.fn();
  assert.equal(engine.active, null);
  assert.equal(logs.filter(([code]) => code === 'solved').length, 1);
});

test('text completion validates the actual typed code', t => {
  const { engine, eventId } = fixture(t, 'text_captcha');
  engine.updateCaptcha({ eventId, text: 'wrong', error: false });
  assert.equal(engine.solveCaptcha(eventId), false);
  engine.updateCaptcha({ eventId, text: 'abc234', error: false });
  assert.equal(engine.solveCaptcha(eventId), true);
  assert.equal(engine.active.captcha.text, 'abc234');
});

test('success hold never extends the deadline and rejects expired input', t => {
  const { engine, eventId, timers, advance, enqueue } = fixture(t);
  engine.updateCaptcha({ eventId, progress: 2 }); advance(9900);
  assert.equal(engine.solveCaptcha(eventId), true);
  assert.equal(timers.get(engine.timer).at, engine.active.endsAt);
  engine.stop(); const fresh = enqueue(); advance(10000);
  assert.equal(engine.updateCaptcha({ eventId: fresh, progress: 2 }), false);
  assert.equal(engine.solveCaptcha(fresh), false);
});

test('stop cancels completion and a stale callback cannot finish the next effect', t => {
  const { engine, eventId, timers, enqueue } = fixture(t);
  engine.updateCaptcha({ eventId, progress: 2 }); engine.solveCaptcha(eventId);
  const stale = timers.get(engine.timer).fn;
  engine.stop(); assert.equal(timers.size, 0);
  const fresh = enqueue(); stale();
  assert.equal(engine.active.eventId, fresh);
  assert.deepEqual(engine.active.captcha, { text: '', progress: 0, error: false, solved: false });
});
