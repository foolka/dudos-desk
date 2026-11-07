const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ControlsInput } = require('../core/controls-input.cjs');

// Every child and clock is fake: this suite never loads native hooks or sends input.
function fixture() {
	const children = [], timers = new Set(), pulses = new Set(), ended = [];
	const guard = new ControlsInput({ file: 'fake-controls.exe', now: () => 1000,
		spawnImpl: (file, args, options) => {
			const child = new EventEmitter();
			child.stdin = Object.assign(new EventEmitter(), {
				writes: [], write(value) { this.writes.push(value); },
				end(value) { this.endValue = value; }, destroy() { this.destroyed = true; }
			});
			child.stdout = new EventEmitter();
			child.kill = () => { child.killed = true; };
			children.push({ child, file, args, options }); return child;
		},
		setTimer: (fn, ms) => { const timer = { fn, ms }; timers.add(timer); return timer; },
		clearTimer: timer => timers.delete(timer),
		setPulse: (fn, ms) => { const timer = { fn, ms }; pulses.add(timer); return timer; },
		clearPulse: timer => pulses.delete(timer), ended: (...args) => ended.push(args)
	});
	const active = (eventId = 'first', id = 'invert_wasd', endsAt = 21000) => ({ eventId, id, endsAt });
	return { guard, children, timers, pulses, ended, active };
}

test('input helper uses a fixed bounded deadline and duplicate events never extend it', async () => {
	const f = fixture();
	await f.guard.start(f.active()); await f.guard.start(f.active());
	assert.equal(f.children.length, 1);
	assert.deepEqual(f.children[0].args, [String(process.pid), 'invert_wasd', '21000']);
	assert.equal(f.children[0].options.windowsHide, true);
	assert.equal([...f.timers][0].ms, 20000);
	assert.deepEqual(f.children[0].child.stdin.writes, ['ping\n']);
	[...f.timers][0].fn();
	assert.equal(f.children[0].child.stdin.endValue, 'stop\n');
	assert.equal(f.children[0].child.killed, undefined);
	f.children[0].child.emit('close', 0);
	await f.guard.pending;
	assert.equal(f.timers.size, 0); assert.equal(f.pulses.size, 0);
	assert.deepEqual(f.ended, []);
});

test('replacement waits for old cleanup and stale stop/close cannot touch a new effect', async () => {
	const f = fixture(); await f.guard.start(f.active());
	const replacement = f.guard.start(f.active('second', 'invert_mouse'));
	await Promise.resolve();
	assert.equal(f.children.length, 1);
	assert.equal(f.children[0].child.stdin.endValue, 'stop\n');
	f.children[0].child.emit('close', 0); await replacement;
	assert.equal(f.children.length, 2);
	void f.guard.stop('first'); f.children[0].child.emit('close', 1);
	assert.equal(f.children[1].child.stdin.endValue, undefined);
	assert.equal(f.children[1].child.killed, undefined);
	const stop = f.guard.stop(); f.children[1].child.emit('close', 0); await stop;
	assert.deepEqual(f.ended, []);
});

test('rapid start then stop cannot spawn a cancelled helper', async () => {
	const f = fixture();
	const start = f.guard.start(f.active()); await f.guard.stop(); await start;
	assert.equal(f.children.length, 0);
	for (const value of [f.active('old', 'invert_mouse', 999), f.active('bad', 'bsod'), f.active('nan', 'invert_mouse', NaN)]) await f.guard.start(value);
	assert.equal(f.children.length, 0);
	await f.guard.start(f.active('long', 'invert_mouse', 999999));
	assert.equal(f.children[0].args[2], '121000');
	const stopped = f.guard.stop(); f.children[0].child.emit('close', 0); await stopped;
});

test('focus loss and emergency cancellation are reported only for the current event', async () => {
	for (const reason of ['inputFocusLost', 'inputEmergency', 'inputTargetUnavailable', 'inputSendFailed']) {
		const f = fixture(); await f.guard.start(f.active());
		f.children[0].child.stdout.emit('data', Buffer.from('ready\n' + reason.slice(0, 5)));
		f.children[0].child.stdout.emit('data', Buffer.from(reason.slice(5) + '\n'));
		f.children[0].child.emit('close', 0); await f.guard.pending;
		assert.deepEqual(f.ended, [['first', reason]]);
		assert.equal(f.guard.job, null);
		assert.equal(f.timers.size, 0); assert.equal(f.pulses.size, 0);
	}
});

test('a forced keyboard-helper exit releases keys before allowing another helper', async () => {
	const f = fixture(); await f.guard.start(f.active());
	const replacement = f.guard.start(f.active('next', 'invert_mouse'));
	[...f.timers].find(timer => timer.ms === 1500).fn();
	assert.equal(f.children[0].child.killed, true);
	f.children[0].child.emit('close', null, 'SIGTERM');
	assert.deepEqual(f.children[1].args, ['--release-keys']);
	assert.equal(f.children.length, 2);
	f.children[1].child.emit('exit', 0); await replacement;
	assert.equal(f.children.length, 3);
	assert.equal(f.children[2].args[1], 'invert_mouse');
	const stop = f.guard.stop(); f.children[2].child.emit('close', 0); await stop;
	assert.deepEqual(f.ended, []);
});

test('spawn errors and a broken parent pipe cannot leave an input helper requested', async () => {
	const f = fixture(); await f.guard.start(f.active('broken', 'invert_mouse'));
	f.children[0].child.emit('error', Error('missing executable')); await f.guard.pending;
	assert.deepEqual(f.ended, [['broken', 'inputUnavailable']]);
	await f.guard.start(f.active('pipe', 'invert_mouse'));
	f.children[1].child.stdin.emit('error', Error('closed pipe'));
	assert.equal(f.children[1].child.stdin.endValue, 'stop\n');
	f.children[1].child.emit('close', 0); await f.guard.pending;
	assert.equal(f.guard.job, null);
	assert.equal(f.timers.size, 0); assert.equal(f.pulses.size, 0);
});
