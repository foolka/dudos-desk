const { randomInt, randomUUID } = require('node:crypto');

const EFFECTS = {
  bsod: { category: 'normal', weight: 35, duration: 3 },
  error_flood: { category: 'normal', weight: 65, duration: 5 },
  vignette: { category: 'normal', weight: 35, duration: 4 },
  text_captcha: { category: 'strong', weight: 50, duration: 45 },
  arrow_captcha: { category: 'strong', weight: 50, duration: 45 }
};

// Validate values at the persistence and API boundary.
function integer(value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw Error('invalidValue');
  return value;
}

function normalizeEffect(id, input = {}) {
  const defaults = EFFECTS[id];
  if (!defaults) throw Error('unknownEffect');
  const effect = { ...defaults, enabled: true, volume: 35, sound: '', errorCount: 42, ...input };
  if (!['normal', 'strong'].includes(effect.category) || typeof effect.enabled !== 'boolean') throw Error('invalidValue');
  if (typeof effect.sound !== 'string' || !/^(?:[a-f0-9-]{36}\.(?:wav|mp3|ogg|flac|m4a))?$/.test(effect.sound)) throw Error('invalidSound');
  return {
    id, category: effect.category, enabled: effect.enabled, sound: effect.sound,
    weight: integer(effect.weight, 0, 1000), volume: integer(effect.volume, 0, 100),
    duration: integer(effect.duration, 1, 120), errorCount: integer(effect.errorCount, 1, 100)
  };
}

function normalizeSettings(input = {}) {
  const s = { language: 'ru', theme: 'light', acknowledged: false, paused: false,
    audioTarget: 'both', displayId: '', guard: false, pcSources: [], blockedSources: [], obsPort: 4455, ...input };
  if (!['ru', 'uk', 'en'].includes(s.language) || !['light', 'dark'].includes(s.theme) ||
      !['local', 'obs', 'both', 'off'].includes(s.audioTarget)) throw Error('invalidValue');
  for (const key of ['acknowledged', 'paused', 'guard']) if (typeof s[key] !== 'boolean') throw Error('invalidValue');
  for (const key of ['pcSources', 'blockedSources']) {
    if (!Array.isArray(s[key]) || s[key].length > 12 || s[key].some(x => typeof x !== 'string' || !x.trim() || x.length > 200)) throw Error('invalidSources');
    s[key] = [...new Set(s[key].map(x => x.trim()))];
  }
  if (s.guard && !s.pcSources.length) throw Error('pcSourceRequired');
  if (typeof s.displayId !== 'string' || s.displayId.length > 50) throw Error('invalidValue');
  return { language: s.language, theme: s.theme, acknowledged: s.acknowledged, paused: s.paused,
    audioTarget: s.audioTarget, displayId: s.displayId, guard: s.guard,
    pcSources: s.pcSources, blockedSources: s.blockedSources, obsPort: integer(s.obsPort, 1024, 65535) };
}

// Draw from integer weights without rounding or an inclusive upper bound.
function choose(effects, category, rng = randomInt) {
  const candidates = effects.filter(e => e.enabled && e.category === category && e.weight > 0);
  const total = candidates.reduce((n, e) => n + e.weight, 0);
  if (!total) throw Error('emptyCategory');
  let roll = rng(total);
  for (const effect of candidates) {
    if (roll < effect.weight) return effect;
    roll -= effect.weight;
  }
  throw Error('invalidRandom');
}

// Freeze effect settings when accepted so later edits cannot alter the queue.
function payload(effect, user, settings, now = Date.now()) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return { ...effect, eventId: randomUUID(), user: String(user || 'viewer').slice(0, 60),
    language: settings.language, audioTarget: settings.audioTarget, createdAt: now,
    code: Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''),
    arrows: Array.from({ length: 6 }, () => ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'][randomInt(4)]),
    x: randomInt(22, 79), y: randomInt(20, 79), seed: randomInt(1, 0x7fffffff) };
}

module.exports = { EFFECTS, normalizeEffect, normalizeSettings, choose, payload };
