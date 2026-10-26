// Only confirmed OBS-mode refunds produce a public message; no private source names.
function refundText({ reason, user, language }) {
  const reasons = {
    ru: { noPcSource: 'игровой источник OBS не активен', blockedSource: 'в OBS активен запрещённый режим' },
    uk: { noPcSource: 'ігрове джерело OBS не активне', blockedSource: 'в OBS активний заборонений режим' },
    en: { noPcSource: 'the OBS game source is inactive', blockedSource: 'a blocked OBS mode is active' }
  };
  const lang = reasons[language] ? language : 'en';
  const why = reasons[lang][reason];
  if (!why) return '';
  const name = String(user || 'viewer').replace(/[\x00-\x1f\x7f-\x9f@\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 60);
  const text = {
    ru: `Dudos: @${name}, баллы возвращены: ${why}. Эффект не запускался.`,
    uk: `Dudos: @${name}, бали повернено: ${why}. Ефект не запускався.`,
    en: `Dudos: @${name}, your points were refunded: ${why}. No effect was started.`
  };
  return text[lang];
}
module.exports = { refundText };
