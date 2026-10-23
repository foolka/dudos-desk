const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Twitch, rewardFields, twitchFields } = require('../core/twitch.cjs');

// Isolated API fixtures never contact Twitch or run desktop effects.
function fixture(t) {
  const meta = new Map(), calls = [], claims = [];
  const auth = new EventEmitter();
  auth.saved = { user: { id: '100' }, clientId: 'test-client' };
  auth.validate = async () => {};
  const f = { meta, calls, claims, decision: 'accepted', failPatch: false, pending: [] };
  auth.getProvider = async () => ({ getAccessTokenForUser: async () => ({ accessToken: 'fake' }), refreshAccessTokenForUser: async () => ({ accessToken: 'renewed' }) });
  f.auth = auth;
  f.controller = new Twitch({ auth, store: {
    meta: key => meta.get(key), setMeta: (key, value) => meta.set(key, structuredClone(value)), backup() {}
  }, engine: { redeem: async e => { claims.push(e); await f.wait; return { decision: f.decision, reason: 'obsNotReady' }; } },
  fetchImpl: async (url, options) => {
    const u = new URL(url), body = options.body && JSON.parse(options.body);
    calls.push({ url: u, ...options, body });
    if (f.respond) return f.respond(u, options, body);
    if (options.method === 'PATCH' && f.failPatch) throw Error('offline');
    return Response.json({ data: u.searchParams.has('status') ? f.pending : [{ id: 'purchase', status: 'UNFULFILLED' }], pagination: {} });
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
  f.controller.save('normal', { ...r, remoteId: 'foreign', account: 'other' });
  assert.equal(f.controller.rewards()[0].remoteId, 'reward');
  assert.equal(f.controller.rewards()[0].account, '100');
  assert.throws(() => rewardFields('normal', { cost: 0 }));
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
