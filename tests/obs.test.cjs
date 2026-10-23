const test = require('node:test');
const assert = require('node:assert/strict');
const { sourceGuard } = require('../core/obs.cjs');
const { normalizeSettings } = require('../core/model.cjs');

function mock(states, auth = false) {
  return class extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.message(0, auth ? { authentication: { salt: 'salt', challenge: 'challenge' } } : {})); }
    message(op, d) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ op, d }) })); }
    send(text) {
      const { op, d } = JSON.parse(text);
      if (op === 1) queueMicrotask(() => this.message(2, {}));
      if (op === 6) {
        assert.equal(d.requestType, 'GetSourceActive');
        const value = states[d.requestData.sourceName];
        queueMicrotask(() => this.message(7, { requestId: d.requestId, requestStatus: { result: typeof value === 'boolean' }, responseData: { videoActive: value } }));
      }
    }
    close() {}
  };
}
const settings = normalizeSettings({ guard: true, pcSources: ['Game'], blockedSources: ['Console', 'VR'] });
test('active blocked source takes precedence over PC capture', async () => {
  assert.equal((await sourceGuard(settings, '', mock({ Game: true, Console: false, VR: true }))).reason, 'blockedSource');
});
test('PC source permits only when blocked sources are inactive', async () => {
  assert.equal((await sourceGuard(settings, '', mock({ Game: true, Console: false, VR: false }))).decision, 'allow');
  assert.equal((await sourceGuard(settings, '', mock({ Game: false, Console: false, VR: false }))).reason, 'noPcSource');
});
test('missing source or missing OBS password is held, not guessed as refund', async () => {
  assert.equal((await sourceGuard(settings, '', mock({ Game: true }))).decision, 'hold');
  assert.equal((await sourceGuard(settings, '', mock({}, true))).decision, 'hold');
});
test('authenticated OBS flow still uses read-only source requests', async () => {
  assert.equal((await sourceGuard(settings, 'test-only', mock({ Game: true, Console: false, VR: false }, true))).decision, 'allow');
});
