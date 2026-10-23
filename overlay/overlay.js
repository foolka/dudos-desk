(() => {
  const stage = document.getElementById('stage');
  const desktop = !!window.dudosEffect;
  const preview = new URLSearchParams(location.search).has('preview');
  if (preview) document.documentElement.classList.add('is-preview');
  const key = location.hash.slice(1);
  const copy = {
    ru: ['На вашем стриме возникла проблема. Ему нужно немножко пострадать.', 'Собираем немного хаоса. Скоро отпустим игру.', 'Проверка на стримера', 'Введите код и нажмите Enter', 'Клавиатура подозревается', 'Нажмите стрелки в указанном порядке', 'Не тот код', 'Игровой процесс временно не найден. Попробуйте пережить это.'],
    uk: ['На вашому стрімі виникла проблема. Йому потрібно трішки постраждати.', 'Збираємо трохи хаосу. Скоро відпустимо гру.', 'Перевірка на стримера', 'Введіть код і натисніть Enter', 'Клавіатура під підозрою', 'Натисніть стрілки у вказаному порядку', 'Неправильний код', 'Ігровий процес тимчасово не знайдено. Спробуйте це пережити.'],
    en: ['Your stream ran into a problem. It needs a little dramatic moment.', 'Collecting a little chaos. Your game will be released shortly.', 'Streamer verification', 'Enter the code and press Enter', 'Suspicious keyboard', 'Press the arrows in this order', 'Incorrect code', 'Game process temporarily not found. Please try to survive this.']
  };
  let current = null, timers = [], audio = null, audioUrl = null, audioContext = null, lastSuccess = Date.now(), progress = 0, generation = 0;

  // Keep the OBS canvas and in-app preview geometrically identical.
  function resize() { stage.style.transform = `scale(${innerWidth / 1920}, ${innerHeight / 1080})`; }
  addEventListener('resize', resize); resize();
  function node(tag, className, text) {
    const el = document.createElement(tag); el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function clear() {
    generation++;
    timers.forEach(clearTimeout); timers = [];
    if (audio) { audio.pause(); audio.src = ''; audio = null; }
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
    if (audioContext) { void audioContext.close().catch(() => {}); audioContext = null; }
    stage.replaceChildren(); current = null; progress = 0;
  }
  async function sound(active) {
    if (preview || !active.volume || active.audioTarget === 'off' || (desktop && active.audioTarget === 'obs') || (!desktop && active.audioTarget === 'local')) return;
    const version = generation;
    if (active.sound) {
      try {
        let bytes;
        if (desktop) bytes = await window.dudosEffect.sound(active.eventId);
        else {
          const response = await fetch('/api/sound?event=' + encodeURIComponent(active.eventId), { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(2500) });
          if (!response.ok) return;
          bytes = await response.arrayBuffer();
        }
        if (version !== generation || !bytes) return;
        audioUrl = URL.createObjectURL(new Blob([bytes]));
        audio = new Audio(audioUrl); audio.volume = active.volume / 100;
        await audio.play();
      } catch {}
      return;
    }
    try {
      audioContext = new AudioContext(); await audioContext.resume();
      if (version !== generation || !audioContext) return;
      const ctx = audioContext;
      [440, 330, 220].forEach((frequency, i) => {
        const oscillator = ctx.createOscillator(), gain = ctx.createGain();
        oscillator.frequency.value = frequency;
        const at = ctx.currentTime + i * .1;
        gain.gain.setValueAtTime(active.volume / 100 * .16, at);
        gain.gain.exponentialRampToValueAtTime(.001, at + .1);
        oscillator.connect(gain).connect(ctx.destination); oscillator.start(at); oscillator.stop(at + .11);
      });
    } catch {}
  }
  function render(active) {
    if (!active) { if (current) clear(); return; }
    if (active.eventId === current?.eventId) return;
    clear(); current = active;
    const t = copy[active.language] || copy.en;
    document.documentElement.lang = active.language || 'en';
    void sound(active);
    if (active.id === 'bsod') {
      const el = node('div', 'bsod');
      el.append(node('div', 'bsod__face', ':('), node('div', 'bsod__title', t[0]), node('div', 'bsod__detail', t[1]), node('div', 'bsod__detail', 'Stop code: DUDOS_DESK_INTERRUPTED'));
      stage.append(el);
    } else if (active.id === 'vignette') {
      const el = node('div', 'vignette');
      el.style.background = `radial-gradient(circle at ${active.x}% ${active.y}%, transparent 8%, #0006 12%, #000e 19%, #000f 28%)`;
      stage.append(el);
    } else if (active.id === 'error_flood') {
      let seed = active.seed || 1;
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      const elapsed = preview ? 0 : Math.max(0, Date.now() - active.startedAt);
      for (let i = 0; i < active.errorCount; i++) {
        const left = Math.round(random() * 1280), top = Math.round(random() * 840);
        const at = Math.min(95, active.duration * 800 / active.errorCount) * i;
        const draw = () => {
          if (current?.eventId !== active.eventId) return;
          const el = node('div', 'error'); el.style.left = left + 'px'; el.style.top = top + 'px';
          const body = node('div', 'error__body'); body.append(node('div', 'error__icon', '!'), node('div', '', t[7]));
          el.append(node('div', 'error__bar', 'Dudos Desk'), body, node('div', 'error__ok', 'OK'));
          stage.append(el);
        };
        if (at <= elapsed) draw(); else timers.push(setTimeout(draw, at - elapsed));
      }
    } else {
      const arrows = active.id === 'arrow_captcha';
      const card = node('div', 'captcha');
      card.append(node('div', 'captcha__title', t[arrows ? 4 : 2]), node('div', 'captcha__hint', t[arrows ? 5 : 3]));
      if (arrows) {
        const row = node('div', 'arrows');
        const symbols = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
        active.arrows.forEach(key => row.append(node('div', 'arrow', symbols[key]))); card.append(row);
      } else {
        card.append(node('div', 'captcha__code', active.code));
        const input = node('input', ''); input.maxLength = 6; input.autocomplete = 'off'; input.spellcheck = false; input.setAttribute('aria-label', t[2]);
        input.readOnly = !desktop;
        input.addEventListener('keydown', event => {
          if (event.key !== 'Enter') return;
          if (input.value.trim().toUpperCase() === active.code) void window.dudosEffect?.complete(active.eventId);
          else { input.value = ''; card.querySelector('.captcha__error').textContent = t[6]; }
        });
        card.append(input, node('div', 'captcha__error', ''));
        if (desktop) timers.push(setTimeout(() => input.focus(), 100));
      }
      if (!preview) {
        const timer = node('div', 'countdown'); card.append(timer);
        const tick = () => { timer.textContent = Math.max(0, Math.ceil((active.endsAt - Date.now()) / 1000)) + ' s'; if (current?.eventId === active.eventId) timers.push(setTimeout(tick, 500)); };
        tick();
      }
      stage.append(card);
    }
    if (!preview) timers.push(setTimeout(() => { if (current?.eventId === active.eventId) clear(); }, Math.max(0, active.endsAt - Date.now()) + 150));
  }
  addEventListener('keydown', event => {
    if (!desktop || !current) return;
    if (event.key === 'Escape') { void window.dudosEffect.stop(); return; }
    if (current.id !== 'arrow_captcha' || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const tiles = [...stage.querySelectorAll('.arrow')];
    if (event.key === current.arrows[progress]) { tiles[progress++].classList.add('arrow--done'); if (progress === current.arrows.length) void window.dudosEffect.complete(current.eventId); }
    else { progress = 0; tiles.forEach(el => el.classList.remove('arrow--done')); }
  });
  if (desktop) { window.dudosEffect.onState(render); void window.dudosEffect.state().then(render); }
  else if (preview) {
    addEventListener('message', event => {
      if (event.source !== parent || event.data?.type !== 'preview') return;
      render(event.data.active);
    });
    parent.postMessage({ type: 'previewReady' }, '*');
  } else {
    // Polling reconnects after app or network restarts, without reloading OBS by hand.
    const tick = async () => {
      try {
        const response = await fetch('/api/state', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(2000) });
        if (!response.ok) throw Error('offline');
        const data = await response.json(); lastSuccess = Date.now(); render(data.active);
      } catch { if (Date.now() - lastSuccess > 3000) clear(); }
      setTimeout(tick, 350);
    };
    void tick();
  }
})();
