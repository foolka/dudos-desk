const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Store, selectProfile } = require('../core/store.cjs');
const { Engine } = require('../core/engine.cjs');

function fixture(t, options = {}) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dudos-test-')));
  const store = new Store(root); const engine = new Engine(store, options);
  t.after(() => { engine.dispose(); store.close(); });
  return { root, store, engine };
}
function redemption() { return { category: 'normal', rewardId: randomUUID(), redemptionId: randomUUID(), user: 'Viewer' }; }

test('missing OBS holds without consuming a redemption and resumes queued work only when healthy', async t => {
  let ready = false;
  const { store, engine } = fixture(t, { ready: () => ready });
  store.saveSettings({ acknowledged: true });
  const r = redemption();
  assert.equal((await engine.redeem(r)).reason, 'obsNotReady');
  assert.equal(store.redemption(r.rewardId + ':' + r.redemptionId), null);
  ready = true;
  assert.equal((await engine.redeem(r)).decision, 'accepted');
  await engine.redeem(redemption());
  ready = false;
  engine.finish(engine.active.eventId);
  assert.equal(engine.active, null); assert.equal(engine.queue.length, 1);
  ready = true; engine.pump();
  assert.ok(engine.active); assert.equal(engine.queue.length, 0);
});

test('profile, source keys and effect settings survive a restart', t => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dudos-store-')));
  let s = new Store(root);
  const id = s.meta('id'), key = s.meta('overlayKey');
  s.saveEffect('bsod', { duration: 17, volume: 0 }); s.saveSettings({ theme: 'dark', language: 'uk' }); s.close();
  s = new Store(root); t.after(() => s.close());
  assert.equal(s.meta('id'), id); assert.equal(s.meta('overlayKey'), key);
  assert.equal(s.effects()[0].duration, 17); assert.equal(s.effects()[0].volume, 0); assert.equal(s.settings().theme, 'dark');
  assert.ok(fs.readdirSync(path.join(root, 'backups')).some(n => n.endsWith('.sqlite')));
});
test('missing existing database never silently creates an empty profile', () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dudos-missing-')));
  const s = new Store(root); s.close();
  fs.renameSync(path.join(root, 'dudos.sqlite'), path.join(root, 'saved-original.sqlite'));
  assert.throws(() => new Store(root), /profileMissing/);
  assert.equal(fs.existsSync(path.join(root, 'dudos.sqlite')), false);
});
test('damaged database is preserved instead of reset', () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dudos-damaged-')));
  const file = path.join(root, 'dudos.sqlite'); fs.writeFileSync(file, 'preserve this corrupt data');
  assert.throws(() => new Store(root)); assert.equal(fs.readFileSync(file, 'utf8'), 'preserve this corrupt data');
});
test('test profile cannot be the real profile or its child', () => {
  const root = path.join(os.tmpdir(), 'DudosDesk');
  assert.throws(() => selectProfile(root, true, root));
  assert.throws(() => selectProfile(root, true, path.join(root, 'child')));
  assert.throws(() => selectProfile(root, true));
  assert.equal(selectProfile(root, false, 'ignored'), root);
});

test('a redirected profile is refused without creating a database', () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dudos-redirect-')));
  const target = path.join(root, 'target'), redirected = path.join(root, 'redirected');
  fs.mkdirSync(target);
  fs.symlinkSync(target, redirected, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    assert.throws(() => new Store(redirected), /profileRedirected/);
    assert.equal(fs.existsSync(path.join(target, 'dudos.sqlite')), false);
  } finally { fs.unlinkSync(redirected); }
});
test('warning gates real redemptions and tests', async t => {
  const { engine } = fixture(t);
  assert.equal((await engine.redeem(redemption())).reason, 'acknowledgeFirst');
  assert.throws(() => engine.test('bsod'), /acknowledgeFirst/); assert.equal(engine.active, null);
});
test('concurrent duplicate redemption is played once', async t => {
  const { store, engine } = fixture(t); store.saveSettings({ acknowledged: true });
  const r = redemption(); const results = await Promise.all([engine.redeem(r), engine.redeem(r), engine.redeem(r)]);
  assert.equal(results.filter(v => v.duplicate).length, 2); assert.equal(engine.queue.length, 0);
  assert.equal(store.history().filter(v => v.code === 'started').length, 1);
});
test('deduplication survives process restart', async () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dudos-dedupe-')));
  let s = new Store(root); s.saveSettings({ acknowledged: true }); let e = new Engine(s); const r = redemption();
  await e.redeem(r); e.dispose(); s.close();
  s = new Store(root); e = new Engine(s);
  try { assert.equal((await e.redeem(r)).duplicate, true); assert.equal(e.active, null); }
  finally { e.dispose(); s.close(); }
});
test('pause retains queue while stop clears active queue and delayed test', async t => {
  const { store, engine } = fixture(t); store.saveSettings({ acknowledged: true });
  await engine.redeem(redemption()); await engine.redeem(redemption()); engine.test('bsod');
  engine.pause(true); const id = engine.active.eventId;
  engine.finish(id); assert.equal(engine.active, null); assert.equal(engine.queue.length, 1);
  assert.equal((await engine.redeem(redemption())).reason, 'paused');
  engine.stop(); assert.equal(engine.queue.length, 0); assert.equal(engine.delayed, null);
  engine.pause(false); assert.equal(engine.active, null);
});
test('old completion cannot finish a new effect', async t => {
  const { store, engine } = fixture(t); store.saveSettings({ acknowledged: true });
  await engine.redeem(redemption()); const old = engine.active.eventId;
  engine.stop(); await engine.redeem(redemption()); const fresh = engine.active.eventId;
  assert.equal(engine.finish(old), false); assert.equal(engine.active.eventId, fresh);
});
test('stop during asynchronous OBS guard prevents the later launch', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const { store, engine } = fixture(t, { guard: () => gate });
  store.saveSettings({ acknowledged: true, guard: true, pcSources: ['Game'] });
  const pending = engine.redeem(redemption()); await new Promise(resolve => setImmediate(resolve));
  engine.stop(); release({ decision: 'allow' });
  assert.equal((await pending).reason, 'stopped'); assert.equal(engine.active, null);
});
test('guard refunds unsupported modes but holds failures', async t => {
  let decision = 'refund';
  const { store, engine } = fixture(t, { guard: async () => ({ decision, reason: 'mock' }) });
  store.saveSettings({ acknowledged: true, guard: true, pcSources: ['Game'] });
  const r = redemption(); assert.equal((await engine.redeem(r)).decision, 'refund');
  assert.equal((await engine.redeem(r)).duplicate, true);
  decision = 'hold'; assert.equal((await engine.redeem(redemption())).decision, 'hold'); assert.equal(engine.active, null);
});
test('active effects have bounded timers and queue limits', async t => {
  const { store, engine } = fixture(t); store.saveSettings({ acknowledged: true });
  for (let i = 0; i < 21; i++) assert.equal((await engine.redeem(redemption())).decision, 'accepted');
  assert.equal(engine.queue.length, 20); assert.equal((await engine.redeem(redemption())).reason, 'queueFull');
  assert.ok(engine.active.endsAt - engine.active.startedAt <= 120000);
});
test('a slow OBS check never launches after the request deadline', async t => {
  let now = 1000;
  const { store, engine } = fixture(t, { now: () => now, guard: async () => { now += 11000; return { decision: 'allow' }; } });
  store.saveSettings({ acknowledged: true, guard: true, pcSources: ['Game'] });
  assert.equal((await engine.redeem(redemption())).reason, 'requestExpired'); assert.equal(engine.active, null);
});
