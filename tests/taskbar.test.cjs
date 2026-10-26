const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskbar, attachTaskbar } = require('../core/taskbar.cjs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

// All shell and WinRT operations are mocked; tests never alter real shortcuts.
function fixture(options = {}) {
  const calls = [];
  const exe = 'C:\\Test\\Desk.exe';
  const app = { isPackaged: true, getPath: key => key === 'exe' ? exe : 'C:\\Test\\AppData' };
  const win = { isDestroyed: () => false, isFocused: () => true, getNativeWindowHandle: () => Buffer.alloc(8) };
  const native = { begin: request => { calls.push(request ? 'pin' : 'status'); return request ? 'pinned' : 'notPinned'; }, poll: () => 'pinned', cancel: () => calls.push('cancel') };
  const shell = { readShortcutLink: () => ({ target: exe, appUserModelId: 'test.desk' }), writeShortcutLink: (...args) => { calls.push(args); return true; } };
  const service = createTaskbar({ app, shell, window: () => win, native, platform: 'win32', name: 'Desk', appId: 'test.desk', exists: () => true, mkdir: () => calls.push('mkdir'), ...options });
  return { service, calls, native, shell, win };
}

test('status is read from Windows and never writes shortcuts or pins', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.status(), { state: 'notPinned' });
  assert.deepEqual(f.calls, ['status']);
  f.native.begin = () => 'pinned';
  assert.equal((await f.service.status()).state, 'pinned');
});
test('only an explicit pin request creates the missing Start shortcut with a stable identity', async () => {
  const f = fixture({ exists: () => false });
  await f.service.status(); assert.deepEqual(f.calls, ['status']);
  assert.equal((await f.service.pin()).state, 'pinned');
  const write = f.calls.find(Array.isArray);
  assert.equal(write[1], 'create');
  assert.equal(write[2].target, 'C:\\Test\\Desk.exe');
  assert.equal(write[2].icon, write[2].target);
  assert.equal(write[2].appUserModelId, 'test.desk');
});
test('a different installed or portable copy is never silently retargeted', async () => {
  const f = fixture(); f.shell.readShortcutLink = () => ({ target: 'C:\\Old\\Desk.exe' });
  assert.equal((await f.service.status()).state, 'differentCopy');
  assert.equal((await f.service.pin()).state, 'differentCopy');
  assert.deepEqual(f.calls, []);
});
test('repairing a same-path shortcut preserves stable app identity', async () => {
  const f = fixture(); f.shell.readShortcutLink = () => ({ target: 'c:\\test\\desk.exe' });
  await f.service.pin();
  assert.equal(f.calls.find(Array.isArray)[1], 'update');
});
test('cancelled, unsupported and failed operations never claim success', async () => {
  const f = fixture();
  for (const state of ['cancelled', 'manual', 'notAllowed']) {
    f.native.begin = () => state;
    assert.equal((await f.service.pin()).state, state);
  }
  f.native.begin = () => { throw Error('Unavailable'); };
  assert.equal((await f.service.pin()).state, 'unavailable');
});
test('test mode and background windows cannot pin or write shortcuts', async () => {
  const f = fixture({ test: true });
  assert.equal((await f.service.pin()).state, 'testMode'); assert.deepEqual(f.calls, []);
  const background = fixture(); background.win.isFocused = () => false;
  assert.equal((await background.service.pin()).state, 'foreground'); assert.deepEqual(background.calls, []);
});
test('pending clicks are deduplicated and async Windows result is awaited', async () => {
  const f = fixture(); f.native.begin = request => { f.calls.push(request); return 'pending'; };
  const pending = f.service.pin();
  assert.equal((await f.service.pin()).state, 'busy');
  assert.equal((await pending).state, 'pinned');
  assert.deepEqual(f.calls, [true]);
});

test('non-Windows installations use manual instructions without native calls', async () => {
  const f = fixture({ platform: 'linux' });
  assert.equal((await f.service.status()).state, 'manual');
  assert.equal((await f.service.pin()).state, 'manual');
  assert.deepEqual(f.calls, []);
});
test('taskbar IPC refuses subframes, other windows and changed top-level URLs', async () => {
  const handlers = {};
  const frame = { url: pathToFileURL(path.resolve(__dirname, '../ui/index.html')).href };
  const contents = { mainFrame: frame };
  attachTaskbar({ ipcMain: { handle: (name, fn) => handlers[name] = fn }, win: { webContents: contents },
    app: { getPath: () => 'C:\\Test', isPackaged: true }, shell: {}, name: 'Desk', appId: 'test.desk', test: true });
  const handler = handlers['desk:taskbarPin'];
  assert.throws(() => handler({ sender: {}, senderFrame: frame }));
  assert.throws(() => handler({ sender: contents, senderFrame: { ...frame } }));
  assert.equal((await handler({ sender: contents, senderFrame: frame })).state, 'testMode');
  frame.url = 'https://example.com';
  assert.throws(() => handler({ sender: contents, senderFrame: frame }));
});
