const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { Store } = require('../core/store.cjs');
const { Engine } = require('../core/engine.cjs');
const { createServer, OVERLAY_VERSION } = require('../core/server.cjs');

test('loopback API is read-only and rejects every legacy trigger credential', async () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dudos-server-')));
  const store = new Store(root); store.saveSettings({ acknowledged: true });
  store.setMeta('botKey', 'retired-credential-test-only');
  const engine = new Engine(store);
  const server = createServer({ store, engine, root: path.join(__dirname, '..'), port: 0 });
  const port = await server.listen(), base = `http://127.0.0.1:${port}`;
  const overlay = { Authorization: 'Bearer ' + store.meta('overlayKey') };
  const bot = { Authorization: 'Bearer ' + store.meta('botKey'), 'Content-Type': 'application/json' };
  const body = JSON.stringify({ category: 'normal', user: 'Test', rewardId: randomUUID(), redemptionId: randomUUID() });
  try {
    assert.equal((await fetch(base + '/overlay')).status, 200);
    assert.equal((await fetch(base + '/api/state')).status, 403);
    assert.equal((await fetch(base + '/api/state', { headers: bot })).status, 403);
    assert.equal((await fetch(base + '/api/state', { headers: overlay })).status, 409);
    assert.equal(server.connected(), false);
    assert.equal((await fetch(base + '/api/state?version=0.3.4', { headers: overlay })).status, 409);
    assert.equal(server.connected(), false);
    assert.equal((await fetch(base + '/api/state?version=' + OVERLAY_VERSION, { headers: overlay })).status, 200);
    assert.equal(server.connected(), true);
    assert.equal((await fetch(base + '/api/redeem', { method: 'POST', headers: { ...overlay, 'Content-Type': 'application/json' }, body })).status, 403);
    assert.equal((await fetch(base + '/api/redeem', { method: 'POST', headers: { ...bot, Origin: 'https://example.com' }, body })).status, 403);
    const badHost = await new Promise((resolve, reject) => {
      http.get(base + '/api/state', { headers: { ...overlay, Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(badHost, 403);
    assert.equal((await fetch(base + '/api/redeem', { method: 'POST', headers: bot, body })).status, 403);
    assert.equal((await fetch(base + '/api/redeem', { method: 'POST', headers: bot, body: '{broken' })).status, 403);
    assert.equal(engine.active, null);
    assert.equal(engine.queue.length, 0);
    assert.equal((await fetch(base + '/api/sound?event=wrong', { headers: overlay })).status, 404);
    engine.enqueue({ id: 'text_captcha', eventId: randomUUID(), duration: 30, code: 'ABC234', user: 'TEST' });
    const eventId = engine.active.eventId;
    engine.updateCaptcha({ eventId, text: 'AB', error: false });
    const snapshot = await (await fetch(base + '/api/state?version=' + OVERLAY_VERSION, { headers: overlay })).json();
    assert.equal(snapshot.version, OVERLAY_VERSION);
    assert.deepEqual(snapshot.active.captcha, { text: 'AB', progress: 0, error: false, solved: false });
    for (const endpoint of ['/api/state', '/api/progress', '/api/complete', '/api/stop']) {
      assert.equal((await fetch(base + endpoint, { method: 'POST', headers: { ...overlay, 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId, text: 'ABC234' }) })).status, 403);
    }
    assert.equal(engine.active.captcha.text, 'AB');
    assert.equal(engine.active.captcha.solved, false);
  } finally { server.close(); engine.dispose(); store.close(); }
});
