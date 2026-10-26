const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { CaptchaInput } = require('../core/captcha-input.cjs');

// Fake children never install hooks or manipulate the user's mouse.
function fixture(t) {
  const children = [], timers = new Set(), pulses = new Set(), reports = [];
  const guard = new CaptchaInput({ file: 'fixture.exe', now: () => 1000,
    spawnImpl: (file, args, options) => {
      const child = new EventEmitter();
      child.stdin = Object.assign(new EventEmitter(), { writes: [], write(line) { this.writes.push(line); }, destroy() { this.destroyed = true; } });
      child.stdout = { resume() {} };
      child.kill = () => { child.killed = true; };
      children.push({ child, file, args, options }); return child;
    },
    setTimer: (fn, ms) => { const timer = { fn, ms }; timers.add(timer); return timer; },
    clearTimer: timer => timers.delete(timer),
    setPulse: (fn, ms) => { const timer = { fn, ms }; pulses.add(timer); return timer; },
    clearPulse: timer => pulses.delete(timer), report: code => reports.push(code)
  });
  t.after(() => guard.stop());
  const handle = Buffer.alloc(8); handle.writeBigUInt64LE(1234n);
  return { guard, children, timers, pulses, reports, handle };
}

test('native guard has a fixed five-second deadline and is never extended by duplicate ready messages', t => {
  const f = fixture(t);
  f.guard.start(f.handle, 'captcha'); f.guard.start(f.handle, 'captcha');
  assert.equal(f.children.length, 1);
  assert.deepEqual(f.children[0].args, [String(process.pid), '1234', '6000']);
  assert.equal(f.children[0].options.windowsHide, true);
  assert.equal([...f.timers][0].ms, 5000);
  [...f.timers][0].fn();
  assert.equal(f.children[0].child.killed, true);
  assert.equal(f.timers.size, 0); assert.equal(f.pulses.size, 0);
});

test('stop and replacement release the old child; stale close cannot unlock a new captcha', t => {
  const f = fixture(t);
  f.guard.start(f.handle, 'first');
  f.guard.start(f.handle, 'second');
  assert.equal(f.children[0].child.killed, true);
  f.children[0].child.emit('exit', 1);
  f.guard.stop('first');
  assert.equal(f.children[1].child.killed, undefined);
  assert.deepEqual(f.reports, []);
  f.guard.stop();
  assert.equal(f.children[1].child.killed, true);
  assert.equal(f.children[1].child.stdin.destroyed, true);
});

test('spawn failure and focus denial do not leave timers or hooks requested', t => {
  const f = fixture(t);
  f.guard.start(f.handle, 'denied'); f.children[0].child.emit('exit', 3);
  assert.deepEqual(f.reports, ['captchaFocusDenied']);
  assert.equal(f.guard.job, null);
  f.guard.start(f.handle, 'failed'); f.children[1].child.emit('error', Error('missing helper'));
  assert.deepEqual(f.reports, ['captchaFocusDenied', 'captchaInputUnavailable']);
  assert.equal(f.timers.size, 0); assert.equal(f.pulses.size, 0);
});
