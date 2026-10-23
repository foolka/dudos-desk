const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { EFFECTS, normalizeEffect, normalizeSettings, choose, payload } = require('../core/model.cjs');

test('all legacy effect types have bounded editable settings', () => {
  assert.equal(Object.keys(EFFECTS).length, 5);
  for (const id of Object.keys(EFFECTS)) {
    const e = normalizeEffect(id); assert.ok(e.duration > 0 && e.duration <= 120);
    assert.throws(() => normalizeEffect(id, { duration: 0 }));
    assert.throws(() => normalizeEffect(id, { duration: 121 }));
    assert.throws(() => normalizeEffect(id, { weight: -1 }));
    assert.throws(() => normalizeEffect(id, { volume: '' }));
    assert.throws(() => normalizeEffect(id, { sound: '../../secret.wav' }));
  }
});
test('weighted draw visits exactly the intended buckets', () => {
  const e = ['bsod', 'error_flood', 'vignette'].map((id, i) => normalizeEffect(id, { weight: i + 1 }));
  const result = [0, 1, 2, 3, 4, 5].map(n => choose(e, 'normal', () => n).id);
  assert.deepEqual(result, ['bsod', 'error_flood', 'error_flood', 'vignette', 'vignette', 'vignette']);
  assert.throws(() => choose(e.map(x => ({ ...x, weight: 0 })), 'normal'));
  assert.equal(choose(e.map(x => ({ ...x, enabled: x.id === 'bsod' })), 'normal').id, 'bsod');
});
test('settings reject unsupported modes and invalid guard configuration', () => {
  assert.equal(normalizeSettings().acknowledged, false);
  assert.throws(() => normalizeSettings({ guard: true }));
  assert.throws(() => normalizeSettings({ language: 'xx' }));
  assert.throws(() => normalizeSettings({ pcSources: [''] }));
  assert.deepEqual(normalizeSettings({ guard: true, pcSources: [' Game ', 'Game'] }).pcSources, ['Game']);
});
test('each payload has a new identity and frozen settings', () => {
  const e = normalizeEffect('text_captcha'); const settings = normalizeSettings();
  const a = payload(e, '<viewer>', settings); const b = payload(e, '<viewer>', settings);
  e.volume = 0; assert.equal(a.volume, 35); assert.notEqual(a.eventId, b.eventId);
  assert.match(a.code, /^[A-Z0-9]{6}$/); assert.equal(a.arrows.length, 6);
});
test('all interface messages exist in three languages', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../ui/i18n.js'), 'utf8') + ';globalThis.result=messages;', context);
  const keys = Object.keys(context.result.ru).sort();
  for (const language of ['uk', 'en']) assert.deepEqual(Object.keys(context.result[language]).sort(), keys);
  for (const language of ['ru', 'uk', 'en']) assert.ok(context.result[language].focusBody.length > 100);
});
