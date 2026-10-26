const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Twitch, rewardFields, twitchFields } = require('../core/twitch.cjs');
const { Store } = require('../core/store.cjs');
const { Engine } = require('../core/engine.cjs');

// Isolated API fixtures never contact Twitch or run desktop effects.
function fixture(t) {
  const meta = new Map(), calls = [], claims = [], logs = [], receipts = new Map();
  const auth = new EventEmitter();
  auth.saved = { user: { id: '100' }, clientId: 'test-client' };
  auth.validate = async () => {};
  const f = { meta, calls, claims, logs, receipts, decision: 'accepted', failPatch: false, pending: [] };
  auth.getProvider = async () => ({ getAccessTokenForUser: async () => ({ accessToken: 'fake' }), refreshAccessTokenForUser: async () => ({ accessToken: 'renewed' }) });
  f.auth = auth;
  f.controller = new Twitch({ auth, store: {
    meta: key => meta.get(key), setMeta: (key, value) => meta.set(key, structuredClone(value)), backup() {}, log: (code, data) => logs.push({ code, data }),
    settings: () => ({ language: 'ru' }), redemption: key => receipts.get(key), remember: (key, value) => receipts.set(key, value)
  }, engine: { redeem: async e => { claims.push(e); await f.wait; return { decision: f.decision, reason: 'obsNotReady' }; } },
  fetchImpl: async (url, options) => {
    const u = new URL(url), body = options.body && JSON.parse(options.body);
    calls.push({ url: u, ...options, body });
    if (f.respond) return f.respond(u, options, body);
    if (options.method === 'PATCH' && f.failPatch) throw Error('offline');
    return Response.json({ data: u.searchParams.has('status') ? f.pending : [{ id: 'purchase', status: options.method === 'PATCH' ? body.status : 'UNFULFILLED' }], pagination: {} });
  } });
  f.reward = { ...rewardFields('normal'), remoteId: 'reward', account: '100', clientId: 'test-client' };
  f.controller.put(f.reward);
  f.event = { account: '100', rewardId: 'reward', id: 'purchase', user: 'Viewer', status: 'UNFULFILLED' };
  t.after(() => f.controller.close());
  return f;
}

test('zero disables limits and incoming identifiers cannot alter the saved reward binding', t => {
  const f = fixture(t), r = rewardFields('normal');
  const payload = twitchFields(r);
  assert.equal(payload.is_max_per_stream_enabled, false);
  assert.equal(payload.is_max_per_user_per_stream_enabled, false);
  assert.equal(payload.is_global_cooldown_enabled, false);
  assert.equal(payload.should_redemptions_skip_request_queue, false);
  for (const creating of [false, true]) {
    const fields = twitchFields(r, creating);
    for (const key of ['max_per_stream', 'max_per_user_per_stream', 'global_cooldown_seconds']) assert.equal(Object.hasOwn(fields, key), false);
  }
  f.controller.save('normal', { ...r, remoteId: 'foreign', account: 'other' });
  assert.equal(f.controller.rewards()[0].remoteId, 'reward');
  assert.equal(f.controller.rewards()[0].account, '100');
  assert.throws(() => rewardFields('normal', { cost: 0 }));
});
test('enabled limits preserve the exact configured values for create and update', () => {
  const reward = rewardFields('normal', { perStream: 5, perUser: 2, cooldown: 180 });
  for (const creating of [true, false]) {
    const fields = twitchFields(reward, creating);
    assert.equal(fields.max_per_stream, 5);
    assert.equal(fields.max_per_user_per_stream, 2);
    assert.equal(fields.global_cooldown_seconds, 180);
    assert.equal(fields.is_max_per_stream_enabled, true);
    assert.equal(fields.is_max_per_user_per_stream_enabled, true);
    assert.equal(fields.is_global_cooldown_enabled, true);
  }
});
test('waiting reason is recorded once per purchase and retries when OBS is ready', async t => {
  const f = fixture(t);
  f.decision = 'hold';
  await f.controller.receive(f.event);
  await f.controller.receive(f.event);
  assert.deepEqual(f.logs, [{ code: 'hold', data: { reason: 'obsNotReady', user: 'Viewer' } }]);
  assert.equal(f.calls.length, 0);
  assert.equal(f.meta.has('twitchSettlements'), false);
  f.decision = 'accepted';
  await f.controller.receive(f.event);
  assert.equal(f.controller.waiting.size, 0);
  assert.equal(f.calls.at(-1).body.status, 'FULFILLED');
});
test('concurrent EventSub and poll delivery launches and fulfills once', async t => {
  const f = fixture(t); let release;
  f.wait = new Promise(resolve => { release = resolve; });
  const a = f.controller.receive(f.event), b = f.controller.receive(f.event);
  assert.equal(a, b); release(); await a;
  assert.equal(f.claims.length, 1);
  assert.deepEqual(f.calls.filter(c => c.method === 'PATCH').map(c => c.body), [{ status: 'FULFILLED' }]);
  assert.deepEqual(f.meta.get('twitchSettlements'), {});
});
test('held redemptions remain pending, denied modes cancel, other accounts and rewards are ignored', async t => {
  const f = fixture(t);
  for (const change of [{ account: 'other' }, { rewardId: 'other' }, { status: 'FULFILLED' }]) await f.controller.receive({ ...f.event, ...change });
  assert.equal(f.claims.length, 0);
  f.decision = 'hold'; await f.controller.receive(f.event);
  assert.equal(f.calls.length, 0);
  f.decision = 'refund'; await f.controller.receive(f.event);
  assert.equal(f.calls.at(-1).body.status, 'CANCELED');
});
test('failed settlement remains durable and retries without another effect', async t => {
  const f = fixture(t); f.failPatch = true;
  await f.controller.receive(f.event);
  assert.equal(Object.keys(f.meta.get('twitchSettlements')).length, 1);
  f.failPatch = false; await f.controller.tick();
  assert.equal(f.claims.length, 1);
  assert.deepEqual(f.meta.get('twitchSettlements'), {});
});
test('polling discovers missed unfulfilled purchases', async t => {
  const f = fixture(t);
  f.pending = [{ id: 'missed', user_name: 'MissedViewer', status: 'UNFULFILLED' }];
  await f.controller.tick();
  assert.equal(f.claims[0].redemptionId, 'missed');
});
test('account switch during request cannot publish a stale response', async t => {
  const f = fixture(t);
  f.respond = async () => { f.auth.saved.user.id = 'different'; return Response.json({ data: [] }); };
  await assert.rejects(f.controller.request('GET', 'channel_points/custom_rewards'), /accountChanged/);
});
test('lost create response is reconciled without a duplicate and preserves pause', async t => {
  const f = fixture(t);
  f.controller.put({ ...rewardFields('strong', { paused: true }), account: '100', clientId: 'test-client', sync: 'creating', createTitle: 'Dudos Plus', knownIds: ['old'] });
  f.respond = async (_u, options) => Response.json({ data: options.method === 'GET' ? [{ id: 'created', title: 'Dudos Plus' }] : [] });
  await f.controller.publish('strong');
  assert.equal(f.calls.some(c => c.method === 'POST'), false);
  assert.equal(f.calls.at(-1).body.is_paused, true);
  assert.equal(f.controller.rewards()[1].remoteId, 'created');
});
test('delete refuses a reward with unresolved purchases', async t => {
  const f = fixture(t); f.pending = [{ id: 'pending' }];
  await assert.rejects(f.controller.remove('normal'), /rewardHasPending/);
  assert.equal(f.calls.some(c => c.method === 'DELETE'), false);
});

test('real engine holds a Twitch purchase until the source connects and deduplicates replay', async t => {
  const f = fixture(t);
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dudos-twitch-engine-')));
  const store = new Store(root);
  let ready = false;
  const engine = new Engine(store, { ready: () => ready });
  t.after(() => { f.controller.close(); engine.dispose(); store.close(); });
  store.saveSettings({ acknowledged: true });
  f.controller.store = store;
  f.controller.engine = engine;
  const event = { ...f.event, rewardId: randomUUID(), id: randomUUID() };
  f.controller.put({ ...f.reward, remoteId: event.rewardId });
  await f.controller.receive(event);
  await f.controller.receive(event);
  assert.equal(engine.active, null);
  assert.equal(store.history().filter(e => e.code === 'hold').length, 1);
  assert.equal(store.redemption(event.rewardId + ':' + event.id), null);
  assert.equal(f.calls.length, 0);
  ready = true;
  f.pending = [{ id: event.id, user_name: event.user, status: event.status }];
  await f.controller.tick();
  assert.ok(engine.active);
  assert.equal(f.controller.status, 'twitchConnected');
  await f.controller.receive(event);
  assert.equal(engine.queue.length, 0);
  assert.equal(store.history().filter(e => e.code === 'started').length, 1);
  assert.equal(store.redemption(event.rewardId + ':' + event.id).decision, 'accepted');
});

test('processing errors are recorded without secrets and do not falsely fulfill purchases', async t => {
  const f = fixture(t);
  f.controller.engine.redeem = async () => { throw Error('secret-token-and-private-url'); };
  await f.controller.receive(f.event);
  await f.controller.receive(f.event);
  assert.deepEqual(f.logs, [{ code: 'hold', data: { reason: 'twitchRetry', user: 'Viewer' } }]);
  assert.equal(f.calls.length, 0);
});

// Refund tests use fake HTTP responses and never post to a real chat.
function refundFixture(t) {
  const f = fixture(t);
  f.auth.saved.token = { scope: ['channel:manage:redemptions', 'user:write:chat'] };
  f.controller.engine.redeem = async e => {
    const key = e.rewardId + ':' + e.redemptionId;
    const receipt = f.receipts.get(key) || { decision: 'refund', reason: 'noPcSource' };
    f.receipts.set(key, receipt);
    return receipt;
  };
  f.remote = 'UNFULFILLED';
  f.respond = async (url, options, body) => {
    if (url.pathname.endsWith('/chat/messages')) {
      assert.equal(f.remote, 'CANCELED');
      return Response.json({ data: [{ is_sent: f.sent !== false }] });
    }
    if (options.method === 'PATCH') {
      if (f.failPatch) throw Error('offline');
      if (!f.unconfirmed) f.remote = body.status;
    }
    return Response.json({ data: url.searchParams.has('status') ? [] : [{ id: 'purchase', status: f.remote }], pagination: {} });
  };
  return f;
}

test('mode refund posts once, from the broadcaster, only after Twitch confirms cancellation', async t => {
  const f = refundFixture(t);
  await f.controller.receive(f.event);
  await f.controller.receive(f.event);
  const messages = f.calls.filter(c => c.url.pathname.endsWith('/chat/messages'));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].url.search, '');
  assert.equal(messages[0].body.broadcaster_id, '100');
  assert.equal(messages[0].body.sender_id, '100');
  assert.match(messages[0].body.message, /@Viewer.*баллы возвращены.*не активен/);
  assert.equal(f.logs.filter(e => e.code === 'refunded').length, 1);
  assert.equal(f.logs.filter(e => e.code === 'refundChatSent').length, 1);
});

test('failed or unconfirmed refund never posts chat; durable retry sends after confirmation', async t => {
  for (const failure of ['failPatch', 'unconfirmed']) {
    const f = refundFixture(t); f[failure] = true;
    await f.controller.receive(f.event);
    assert.equal(f.calls.some(c => c.url.pathname.endsWith('/chat/messages')), false);
    const job = Object.values(f.meta.get('twitchSettlements'))[0];
    assert.equal(job.reason, 'noPcSource'); assert.equal(job.user, 'Viewer');
    f[failure] = false;
    await f.controller.tick();
    assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/chat/messages')).length, 1);
    assert.deepEqual(f.meta.get('twitchSettlements'), {});
  }
});

test('legacy login still refunds points and records why the chat announcement was unavailable', async t => {
  const f = refundFixture(t); f.auth.saved.token.scope = ['channel:manage:redemptions'];
  await f.controller.receive(f.event);
  assert.equal(f.remote, 'CANCELED');
  assert.equal(f.calls.some(c => c.url.pathname.endsWith('/chat/messages')), false);
  assert.ok(f.logs.some(e => e.code === 'refundChatFailed' && e.data.reason === 'chatPermissionRequired'));
});

test('dropped chat response is logged without retrying an ambiguous announcement', async t => {
  const f = refundFixture(t); f.sent = false;
  await f.controller.receive(f.event);
  await f.controller.receive(f.event);
  assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/chat/messages')).length, 1);
  assert.ok(f.logs.some(e => e.code === 'refundChatFailed' && e.data.reason === 'chatSendUnconfirmed'));
  assert.equal(f.logs.some(e => e.code === 'refundChatSent'), false);
});

test('refund text supports three languages without control characters or internal source names', () => {
  const { refundText } = require('../core/refund-chat.cjs');
  for (const language of ['ru', 'uk', 'en']) for (const reason of ['noPcSource', 'blockedSource']) {
    const message = refundText({ language, reason, user: '@Viewer\n\u202e' });
    assert.match(message, /@Viewer/); assert.ok(message.length < 500);
    assert.equal(/[\n\u202e]/.test(message), false);
    assert.equal(message.includes(reason), false);
  }
  assert.equal(refundText({ reason: 'obsUnavailable' }), '');
});
