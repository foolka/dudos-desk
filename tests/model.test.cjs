const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { EFFECTS, normalizeEffect, normalizeSettings, choose, payload } = require('../core/model.cjs');

test('all legacy effect types have bounded editable settings', () => {
  assert.equal(Object.keys(EFFECTS).length, 7);
  for (const id of Object.keys(EFFECTS)) {
    const e = normalizeEffect(id); assert.ok(e.duration > 0 && e.duration <= 120);
    assert.throws(() => normalizeEffect(id, { duration: 0 }));
    assert.throws(() => normalizeEffect(id, { duration: 121 }));
    assert.throws(() => normalizeEffect(id, { weight: -1 }));
    assert.throws(() => normalizeEffect(id, { volume: '' }));
    assert.throws(() => normalizeEffect(id, { sound: '../../secret.wav' }));
  }
});

test('input effects default to twenty seconds in the strong roulette', () => {
  for (const id of ['invert_wasd', 'invert_mouse']) {
    const effect = normalizeEffect(id);
    assert.equal(effect.category, 'strong');
    assert.equal(effect.duration, 20);
    assert.equal(normalizeEffect(id, { duration: 37 }).duration, 37);
    assert.equal(choose([effect], 'strong').id, id);
    assert.throws(() => choose([effect], 'normal'));
  }
});
test('captcha size defaults to the original size and accepts only bounded integers', () => {
  for (const id of ['text_captcha', 'arrow_captcha']) {
    assert.equal(normalizeEffect(id).captchaScale, 100);
    for (const captchaScale of [50, 75, 100, 135, 200]) assert.equal(normalizeEffect(id, { captchaScale }).captchaScale, captchaScale);
    for (const captchaScale of [0, 49, 201, 75.5, null, '', '100', NaN, Infinity]) assert.throws(() => normalizeEffect(id, { captchaScale }));
  }
  assert.equal(normalizeEffect('bsod', { captchaScale: 200 }).captchaScale, undefined);
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
  e.volume = 0; e.captchaScale = 50;
  assert.equal(a.captchaScale, 100); assert.equal(a.volume, 35); assert.notEqual(a.eventId, b.eventId);
  assert.match(a.code, /^[A-Z0-9]{6}$/); assert.equal(a.arrows.length, 6);
});
test('all interface messages exist in three languages', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../ui/i18n.js'), 'utf8') + ';globalThis.result=messages;', context);
  const keys = Object.keys(context.result.ru).sort();
  for (const language of ['uk', 'en']) assert.deepEqual(Object.keys(context.result[language]).sort(), keys);
  for (const language of ['ru', 'uk', 'en']) assert.ok(context.result[language].focusBody.length > 100);
});
