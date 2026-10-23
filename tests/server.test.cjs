const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { Store } = require('../core/store.cjs');
const { Engine } = require('../core/engine.cjs');
const { createServer } = require('../core/server.cjs');

test('loopback API separates OBS reads and authenticated triggers', async () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dudos-server-')));
  const store = new Store(root); store.saveSettings({ acknowledged: true });
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
    assert.equal((await fetch(base + '/api/state', { headers: overlay })).status, 200);
    assert.equal(server.connected(), true);
    assert.equal((await fetch(base + '/api/redeem', { method: 'POST', headers: { ...overlay, 'Content-Type': 'application/json' }, body })).status, 403);
    assert.equal((await fetch(base + '/api/redeem', { method: 'POST', headers: { ...bot, Origin: 'https://example.com' }, body })).status, 403);
    const badHost = await new Promise((resolve, reject) => {
      http.get(base + '/api/state', { headers: { ...overlay, Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(badHost, 403);
    const result = await (await fetch(base + '/api/redeem', { method: 'POST', headers: bot, body })).json();
    assert.equal(result.decision, 'accepted');
    const duplicate = await (await fetch(base + '/api/redeem', { method: 'POST', headers: bot, body })).json();
    assert.equal(duplicate.duplicate, true);
    assert.equal((await fetch(base + '/api/redeem', { method: 'POST', headers: bot, body: '{broken' })).status, 400);
    assert.equal((await fetch(base + '/api/redeem', { method: 'POST', headers: bot, body: ' '.repeat(5000) })).status, 413);
    assert.equal((await fetch(base + '/api/sound?event=wrong', { headers: overlay })).status, 404);
  } finally { server.close(); engine.dispose(); store.close(); }
});
