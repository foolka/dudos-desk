(() => {
  const copy = {
    ru: {
      title: 'Панель задач Windows', pin: 'Закрепить на панели задач', check: 'Проверить статус',
      checking: 'Проверка…', pending: 'Подтверди закрепление в окне Windows.', pinned: 'Закреплено',
      notPinned: 'Не закреплено', cancelled: 'Закрепление отменено.', busy: 'Запрос уже открыт.',
      manual: 'Нажми правой кнопкой на значок запущенного приложения внизу → «Закрепить на панели задач».',
      testMode: 'В тестовом режиме панель задач не изменяется.',
      notAllowed: 'Windows сейчас не разрешает запрос. Проверь системные уведомления или закрепи значок вручную.',
      foreground: 'Открой окно приложения на переднем плане и повтори.',
      unavailable: 'Не удалось получить подтверждение Windows. Можно закрепить значок вручную.',
      differentCopy: 'Ярлык «Пуск» указывает на другую копию. Открой установленную версию; старый ярлык не изменён.',
      help: 'Обновление в той же папке сохраняет путь значка. После переноса portable-папки закрепи приложение заново. Открепление: правой кнопкой по значку → «Открепить от панели задач».'
    },
    uk: {
      title: 'Панель завдань Windows', pin: 'Закріпити на панелі завдань', check: 'Перевірити статус',
      checking: 'Перевірка…', pending: 'Підтвердь закріплення у вікні Windows.', pinned: 'Закріплено',
      notPinned: 'Не закріплено', cancelled: 'Закріплення скасовано.', busy: 'Запит уже відкрито.',
      manual: 'Натисни правою кнопкою на значок запущеної програми внизу → «Закріпити на панелі завдань».',
      testMode: 'У тестовому режимі панель завдань не змінюється.',
      notAllowed: 'Windows зараз не дозволяє запит. Перевір системні сповіщення або закріпи значок вручну.',
      foreground: 'Відкрий вікно програми на передньому плані та повтори.',
      unavailable: 'Не вдалося отримати підтвердження Windows. Можна закріпити значок вручну.',
      differentCopy: 'Ярлик «Пуск» указує на іншу копію. Відкрий установлену версію; старий ярлик не змінено.',
      help: 'Оновлення в тій самій папці зберігає шлях значка. Після перенесення portable-папки закріпи програму знову. Відкріплення: правою кнопкою по значку → «Відкріпити від панелі завдань».'
    },
    en: {
      title: 'Windows taskbar', pin: 'Pin to taskbar', check: 'Check status',
      checking: 'Checking…', pending: 'Confirm pinning in the Windows prompt.', pinned: 'Pinned',
      notPinned: 'Not pinned', cancelled: 'Pinning cancelled.', busy: 'A request is already open.',
      manual: 'Right-click the running app’s icon on the taskbar → Pin to taskbar.',
      testMode: 'Test mode does not change the taskbar.',
      notAllowed: 'Windows is not allowing the request now. Check system notifications or pin the icon manually.',
      foreground: 'Bring the application window to the foreground and try again.',
      unavailable: 'Windows could not confirm the result. You can pin the icon manually.',
      differentCopy: 'The Start shortcut points to another copy. Open the installed version; the old shortcut was not changed.',
      help: 'Updating in the same folder preserves the icon path. Pin again after moving a portable folder. To unpin, right-click the taskbar icon → Unpin from taskbar.'
    }
  };

  // This element is included only in each standalone app's settings page.
  class DeskTaskbar extends HTMLElement {
    connectedCallback() {
      this.classList.add('b-taskbar');
      this.state ||= 'checking';
      this.paint();
      this.onFocus = () => { if (!this.pending && this.getClientRects().length) void this.check(); };
      window.addEventListener('focus', this.onFocus);
      this.languageObserver = new MutationObserver(() => this.paint());
      this.languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
      void this.check();
    }
    disconnectedCallback() {
      window.removeEventListener('focus', this.onFocus);
      this.languageObserver?.disconnect();
    }
    // Refresh text without changing the outstanding Windows operation.
    paint() {
      const t = copy[document.documentElement.lang.split('-')[0]] || copy.en;
      this.replaceChildren();
      const heading = document.createElement('h3'); heading.className = 'b-taskbar__title'; heading.textContent = t.title;
      const row = document.createElement('div'); row.className = 'b-taskbar__controls';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'b-taskbar__button';
      button.textContent = this.state === 'pinned' ? t.pinned : t.pin;
      button.disabled = this.pending || ['pinned', 'manual', 'testMode', 'differentCopy', 'checking'].includes(this.state);
      button.addEventListener('click', () => void this.pin());
      const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'b-taskbar__refresh';
      refresh.title = t.check; refresh.setAttribute('aria-label', t.check); refresh.disabled = !!this.pending;
      const icon = document.createElement('i'); icon.dataset.lucide = 'refresh-cw'; refresh.append(icon);
      refresh.addEventListener('click', () => void this.check());
      const hint = document.createElement('span'); hint.className = 'b-taskbar__help'; hint.tabIndex = 0;
      hint.title = t.help; hint.setAttribute('aria-label', t.help);
      const question = document.createElement('i'); question.dataset.lucide = 'circle-help'; hint.append(question);
      const status = document.createElement('div'); status.className = 'b-taskbar__status'; status.setAttribute('role', 'status');
      status.textContent = t[this.state] || t.unavailable;
      row.append(button, refresh, hint); this.append(heading, row, status);
      globalThis.lucide?.createIcons();
    }
    // Merely opening settings must never pin or create shortcuts.
    async check() {
      if (this.pending) return;
      this.pending = true;
      try { this.state = (await window.desk.taskbarStatus()).state; }
      catch { this.state = 'unavailable'; }
      finally { this.pending = false; if (this.isConnected) this.paint(); }
    }
    // The Windows consent prompt is invoked only by this explicit click.
    async pin() {
      if (this.pending) return;
      this.pending = true; this.state = 'pending'; this.paint();
      try { this.state = (await window.desk.taskbarPin()).state; }
      catch { this.state = 'unavailable'; }
      finally { this.pending = false; if (this.isConnected) this.paint(); }
    }
  }
  customElements.define('desk-taskbar', DeskTaskbar);
  const target = document.currentScript?.dataset.taskbarTarget;
  if (target) document.querySelector(target)?.append(document.createElement('desk-taskbar'));
})();
