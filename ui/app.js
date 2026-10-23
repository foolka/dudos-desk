let state, selected = 'bsod', view = 'effects', draft = null, dirty = false, previewReady = false, toastTimer;
const icons = { bsod: 'monitor-x', error_flood: 'panels-top-left', vignette: 'scan-eye', text_captcha: 'text-cursor-input', arrow_captcha: 'move' };
const $ = selector => document.querySelector(selector);
const t = key => messages[state?.settings.language || 'ru'][key] || key;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const help = key => `<span class="b-help" tabindex="0" aria-label="${esc(t(key))}">${icon('circle-help')}<span role="tooltip">${esc(t(key))}</span></span>`;
const button = (action, name, symbol, cls = '') => `<button type="button" data-action="${action}" class="${cls}">${icon(symbol)}<span>${esc(t(name))}</span></button>`;
const iconButton = (action, name, symbol) => `<button type="button" data-action="${action}" class="b-icon" title="${esc(t(name))}" aria-label="${esc(t(name))}">${icon(symbol)}</button>`;
const field = (name, label, value, attrs = '', hint = '') => `<label class="b-field"><span>${esc(t(label))}${hint ? help(hint) : ''}</span><input data-field="${name}" value="${esc(value)}" ${attrs}></label>`;

// Keep errors visible without leaking raw internal exceptions or private keys.
function toast(message) {
  const el = $('#toast'); el.textContent = message; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 5500);
}
async function call(name, input) {
  const response = await window.desk[name](input);
  if (!response.ok) { toast(messages[state?.settings.language || 'ru'][response.error] || t('operationFailed')); throw Error(response.error); }
  return response.value;
}
function paintIcons() { lucide.createIcons({ attrs: { 'stroke-width': 1.7 } }); }
function effectDraft() { if (!draft) draft = { ...state.effects.find(e => e.id === selected) }; return draft; }
function options(values, current) { return values.map(value => `<option value="${value}"${value === current ? ' selected' : ''}>${esc(t(value))}</option>`).join(''); }

// Header and navigation stay outside both independently scrolling columns.
function render() {
  document.documentElement.lang = state.settings.language;
  document.documentElement.dataset.theme = state.settings.theme;
  previewReady = false;
  $('#app').innerHTML = `<header class="b-header">
    <div class="b-header__brand"><img src="../assets/icon.png" alt="" width="34" height="34"><strong>Dudos Desk</strong><span class="b-header__version">PRIVATE ${esc(state.version)}</span></div>
    <div class="b-header__tools">${iconButton('theme', 'theme', state.settings.theme === 'dark' ? 'sun' : 'moon')}
      <select id="language" aria-label="${esc(t('language'))}"><option value="ru"${state.settings.language === 'ru' ? ' selected' : ''}>Русский</option><option value="uk"${state.settings.language === 'uk' ? ' selected' : ''}>Українська</option><option value="en"${state.settings.language === 'en' ? ' selected' : ''}>English</option></select>
      ${iconButton('tray', 'tray', 'panel-top-close')}</div>
  </header>
  <nav class="b-nav" aria-label="Dudos Desk"><div class="b-nav__tabs">${['effects', 'connection', 'history'].map((name, index) => `<button type="button" data-view="${name}" aria-current="${view === name ? 'page' : 'false'}">${icon(['wand-sparkles', 'plug', 'history'][index])}${esc(t(name))}</button>`).join('')}</div>
    <div class="b-nav__controls"><span id="runtime" role="status"></span>${help('queueHelp')}${button('pause', state.runtime.paused ? 'resume' : 'pause', state.runtime.paused ? 'play' : 'pause')}${button('stop', 'stop', 'square', 'b-danger')}</div>
  </nav>
  <section class="b-notice" aria-labelledby="focus-title">${icon('triangle-alert')}<div><strong id="focus-title">${esc(t('focusTitle'))}</strong><div>${esc(t('focusBody'))}</div>${!state.settings.acknowledged ? `<label class="b-check"><input id="acknowledge" type="checkbox">${esc(t('acknowledge'))}</label>` : ''}</div></section>
  <div class="b-workspace">${view === 'effects' ? sidebar() : ''}<main id="main" class="b-main"></main></div>
  <footer class="b-footer"><span>${esc(t(state.shortcut || state.test ? 'emergency' : 'shortcutMissing'))}</span><button type="button" data-action="guide">${icon('book-open')}${esc(t('guide'))}</button></footer>`;
  if (view === 'effects') renderEffect();
  else if (view === 'connection') renderConnection();
  else renderHistory();
  paintIcons(); updateStatus();
}
function sidebar() {
  return `<aside class="b-sidebar">${['normal', 'strong'].map(category => `<div class="b-sidebar__group"><h2>${esc(t(category))}</h2>${state.effects.filter(e => e.category === category).map(e => `<button type="button" data-effect="${e.id}" class="b-sidebar__effect${e.id === selected ? ' is-active' : ''}" aria-pressed="${e.id === selected}">${icon(icons[e.id])}<span>${esc(t(e.id))}<small>${e.enabled && e.weight > 0 ? `${e.weight} · ${esc(t('weight'))}` : esc(t('off'))}</small></span><span class="b-sidebar__dot${e.enabled ? ' is-on' : ''}"></span></button>`).join('')}</div>`).join('')}<div class="b-sidebar__note">${esc(t('copyright'))}</div></aside>`;
}
function renderEffect() {
  const e = effectDraft();
  $('#main').innerHTML = `<div class="b-editor__heading"><div><h1>${esc(t(selected))}</h1><div class="b-muted">${esc(t(selected + 'Detail'))}</div></div><label class="b-check"><input type="checkbox" data-field="enabled"${e.enabled ? ' checked' : ''}>${esc(t('enabled'))}${help('enabledHelp')}</label></div>
    <form id="effect-form" class="b-editor"><div class="b-editor__settings b-form">
      <div class="b-form__row"><label class="b-field"><span>${esc(t('category'))}</span><select data-field="category">${options(['normal', 'strong'], e.category)}</select></label>
      ${field('weight', 'weight', e.weight, 'type="number" min="0" max="1000" step="1" required', 'weightHelp')}</div>
      <div class="b-editor__chance"><span>${esc(t('chance'))}</span><strong id="chance"></strong></div>
      <div class="b-form__row">${field('duration', selected.endsWith('captcha') ? 'timeout' : 'duration', e.duration, 'type="number" min="1" max="120" step="1" required', 'durationHelp')}
      ${selected === 'error_flood' ? field('errorCount', 'count', e.errorCount, 'type="number" min="1" max="100" step="1" required') : ''}</div>
      <label class="b-field"><span>${esc(t('volume'))}<output id="volume-value">${e.volume}%</output></span><input type="range" data-field="volume" min="0" max="100" value="${e.volume}"></label>
      <div class="b-field"><span>${esc(t('sound'))}</span><div class="b-inline"><span id="sound-name">${esc(t(e.sound ? 'customSound' : 'defaultSound'))}</span>${iconButton('sound', 'chooseSound', 'folder-open')}${iconButton('resetSound', 'resetSound', 'rotate-ccw')}</div></div>
      <div class="b-editor__actions"><button type="submit" class="b-primary">${icon('save')}${esc(t('save'))}</button><span id="save-status" class="b-muted">${esc(t(dirty ? 'unsaved' : 'saved'))}</span></div>
    </div><div class="b-preview"><div class="b-preview__heading"><h2>${esc(t('preview'))}</h2>${iconButton('replay', 'replay', 'rotate-cw')}</div><div class="b-preview__canvas"><iframe id="preview" src="../overlay/index.html?preview=1" title="${esc(t('preview'))}"></iframe></div>
      <div class="b-preview__test">${button('test', 'test', 'timer')}${help('testHelp')}</div>
    </div></form>`;
  updateChance();
}
function renderConnection() {
  const s = state.settings;
  $('#main').innerHTML = `<div class="b-connection"><section><h1>${esc(t('obsSource'))}</h1>
    <div class="b-inline b-url"><input id="source-url" readonly value="${esc(state.overlayUrl)}" aria-label="${esc(t('obsSource'))}">${iconButton('copyUrl', 'copy', 'copy')}</div>
    <div class="b-inline b-connection__meta"><span class="b-muted">${esc(t('dimensions'))}</span><span id="obs-status"></span>${help('sourceHelp')}</div><div class="b-muted">${esc(t('recovery'))}</div>
    <div class="b-form__row b-connection__spacing"><label class="b-field"><span>${esc(t('monitor'))}</span><select id="display-id"><option value="">${esc(t('primary'))}</option>${state.displays.map(d => `<option value="${esc(d.id)}"${s.displayId === d.id ? ' selected' : ''}>${esc(d.label)} · ${d.width} × ${d.height}</option>`).join('')}</select></label>
    <label class="b-field"><span>${esc(t('audioTarget'))}${help('audioHelp')}</span><select id="audio-target">${options(['local', 'obs', 'both', 'off'], s.audioTarget)}</select></label></div></section>
    <section><h2>${esc(t('botTitle'))}</h2><div class="b-text"><p>${esc(t('botBody'))}</p></div><div class="b-inline">${button('copyNormal', 'copyNormal', 'copy')}${button('copyStrong', 'copyStrong', 'copy')}</div><div class="b-muted b-connection__spacing">${esc(t('botPrivate'))}</div></section>
    <section><h2>${esc(t('guardTitle'))}${help('guardHelp')}</h2><form id="guard-form" class="b-form">
      <label class="b-check"><input id="guard-enabled" type="checkbox"${s.guard ? ' checked' : ''}>${esc(t('guard'))}</label>
      <div class="b-form__row"><label class="b-field"><span>${esc(t('pcSources'))}</span><textarea id="pc-sources" rows="3">${esc(s.pcSources.join('\n'))}</textarea></label><label class="b-field"><span>${esc(t('blockedSources'))}</span><textarea id="blocked-sources" rows="3">${esc(s.blockedSources.join('\n'))}</textarea></label></div>
      <div class="b-form__row"><label class="b-field"><span>${esc(t('obsPort'))}</span><input id="obs-port" type="number" min="1024" max="65535" value="${s.obsPort}" required></label><div class="b-field"><span>${esc(t('password'))}</span><div class="b-inline"><input id="obs-password" type="password" autocomplete="new-password" maxlength="500" placeholder="${state.hasPassword ? '••••••••' : ''}" aria-label="${esc(t('password'))}">${iconButton('password', 'passwordSave', 'save')}</div></div></div>
      <div class="b-inline"><button type="submit" class="b-primary">${icon('save')}${esc(t('save'))}</button>${button('checkGuard', 'checkGuard', 'radio')}<span id="guard-result" role="status"></span></div>
    </form></section></div>`;
}
function renderHistory() {
  $('#main').innerHTML = `<div class="b-editor__heading"><h1>${esc(t('history'))}</h1><div class="b-inline">${button('backup', 'backup', 'archive')}${button('openProfile', 'openProfile', 'folder-open')}</div></div>
    <div class="b-profile"><span>${esc(t('profile'))}</span><code>${esc(state.profile)}</code></div>
    <table class="b-history"><thead><tr><th>${esc(t('when'))}</th><th>${esc(t('event'))}</th><th>${esc(t('effects'))}</th><th>${esc(t('viewer'))}</th></tr></thead><tbody id="history-rows"></tbody></table>`;
  updateHistory();
}
function updateHistory() {
  if (!$('#history-rows')) return;
  $('#history-rows').innerHTML = state.history.length ? state.history.map(item => `<tr><td>${esc(new Date(item.at).toLocaleTimeString(state.settings.language))}</td><td>${esc(t(item.code === 'timeout' ? 'finished' : item.code))}${item.data.reason ? `<small>${esc(t(item.data.reason))}</small>` : ''}</td><td>${esc(item.data.effect ? t(item.data.effect) : '')}</td><td>${esc(item.data.user || '')}</td></tr>`).join('') : `<tr><td colspan="4" class="b-muted">${esc(t('emptyHistory'))}</td></tr>`;
}
function updateStatus() {
  if (!state) return;
  const r = state.runtime;
  if ($('#runtime')) $('#runtime').textContent = r.delayed ? `${t('delayed')} ${Math.max(0, Math.ceil((r.delayed.at - Date.now()) / 1000))} ${t('seconds')}` : r.paused ? t('paused') : r.active ? `${t('active')}: ${t(r.active.id)} · ${r.queue.length}` : `${t('ready')} · ${t('queued')}: ${r.queue.length}`;
  if ($('#obs-status')) { $('#obs-status').textContent = t(state.obsConnected ? 'connected' : 'disconnected'); $('#obs-status').className = state.obsConnected ? 'b-status is-connected' : 'b-status'; }
}
function updateChance() {
  if (!draft || !$('#chance')) return;
  const sum = state.effects.filter(e => e.id !== selected && e.category === draft.category && e.enabled).reduce((n, e) => n + e.weight, 0) + (draft.enabled ? Number(draft.weight) : 0);
  $('#chance').textContent = (sum && draft.enabled ? 100 * Number(draft.weight) / sum : 0).toFixed(1) + '%';
}
function preview() {
  if (!previewReady || !draft) return;
  $('#preview')?.contentWindow.postMessage({ type: 'preview', active: { ...draft, eventId: crypto.randomUUID(), language: state.settings.language, audioTarget: 'off', seed: 512, x: 58, y: 48, code: 'A7DK3H', arrows: ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'] } }, '*');
}
addEventListener('message', event => { if (event.source === $('#preview')?.contentWindow && event.data?.type === 'previewReady') { previewReady = true; preview(); } });

// Poll status without replacing form fields while the user types.
async function refresh() {
  try { state = await call('state'); updateStatus(); if (view === 'history') updateHistory(); }
  catch {}
  setTimeout(refresh, 750);
}
document.addEventListener('input', event => {
  const key = event.target.dataset.field;
  if (!key || !draft) return;
  draft[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.type === 'number' || event.target.type === 'range' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value;
  dirty = true; $('#save-status').textContent = t('unsaved');
  if ($('#volume-value')) $('#volume-value').textContent = draft.volume + '%';
  updateChance();
  if (key === 'errorCount') preview();
});
document.addEventListener('change', async event => {
  try {
    if (event.target.id === 'language') { state.settings = await call('settings', { language: event.target.value }); render(); }
    else if (event.target.id === 'acknowledge') { state.settings = await call('settings', { acknowledged: event.target.checked }); render(); }
    else if (event.target.id === 'display-id') state.settings = await call('settings', { displayId: event.target.value });
    else if (event.target.id === 'audio-target') state.settings = await call('settings', { audioTarget: event.target.value });
  } catch {}
});
document.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    if (event.target.id === 'effect-form') {
      draft = await call('saveEffect', { id: selected, effect: draft });
      state = await call('state'); dirty = false; render(); toast(t('saved'));
    } else if (event.target.id === 'guard-form') {
      const lines = id => $(id).value.split('\n').map(s => s.trim()).filter(Boolean);
      state.settings = await call('settings', { guard: $('#guard-enabled').checked, pcSources: lines('#pc-sources'), blockedSources: lines('#blocked-sources'), obsPort: Number($('#obs-port').value) });
      toast(t('saved'));
    }
  } catch {}
});
document.addEventListener('click', async event => {
  const target = event.target.closest('button'); if (!target) return;
  try {
    if (target.dataset.effect || target.dataset.view) {
      if (dirty) { toast(t('saveFirst')); return; }
      if (target.dataset.effect) { selected = target.dataset.effect; draft = null; }
      if (target.dataset.view) view = target.dataset.view;
      render(); return;
    }
    const action = target.dataset.action;
    if (action === 'theme') { state.settings = await call('settings', { theme: state.settings.theme === 'dark' ? 'light' : 'dark' }); render(); }
    else if (action === 'pause') { await call('pause', !state.runtime.paused); state = await call('state'); render(); }
    else if (action === 'stop') { await call('stop'); state = await call('state'); updateStatus(); }
    else if (action === 'replay') preview();
    else if (action === 'test') { if (dirty) return toast(t('saveFirst')); await call('test', selected); state = await call('state'); updateStatus(); }
    else if (action === 'sound') { const name = await call('sound', selected); if (name) { draft.sound = name; dirty = true; renderEffect(); paintIcons(); } }
    else if (action === 'resetSound') { draft.sound = ''; dirty = true; renderEffect(); paintIcons(); }
    else if (action === 'copyUrl') { await call('copyUrl'); toast(t('copied')); }
    else if (['copyNormal', 'copyStrong'].includes(action)) { await call('copyScript', action === 'copyNormal' ? 'normal' : 'strong'); toast(t('copied')); }
    else if (action === 'password') { await call('password', $('#obs-password').value); $('#obs-password').value = ''; toast(t('passwordSaved')); }
    else if (action === 'checkGuard') { const result = await call('checkGuard'); $('#guard-result').textContent = `${t(result.decision)}: ${t(result.reason)}`; }
    else if (action === 'backup') { await call('backup'); toast(t('backupDone')); }
    else if (['openProfile', 'tray', 'guide'].includes(action)) await call(action);
  } catch {}
});
call('state').then(value => { state = value; render(); void refresh(); }).catch(() => {});
