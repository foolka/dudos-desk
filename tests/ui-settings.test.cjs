const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Reproduce a status poll replacing state while a settings save is pending.
test('a concurrent status poll cannot discard the saved interface language', async () => {
	const handlers = new Map();
	const context = vm.createContext({
		document: { addEventListener: (name, handler) => handlers.set(name, handler) },
		window: { desk: { state: () => new Promise(() => {}) } },
		addEventListener: () => {},
		setTimeout: () => 0,
		clearTimeout: () => {},
	});
	vm.runInContext(fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8'), context);
	vm.runInContext(`
		state = { settings: { language: 'ru' } };
		call = () => new Promise(resolve => { globalThis.finishSettings = resolve; });
		render = () => { globalThis.renderedLanguage = state.settings.language; };
	`, context);
	const change = handlers.get('change')({ target: { id: 'language', value: 'en' } });
	vm.runInContext("state = { settings: { language: 'ru' } };", context);
	context.finishSettings({ language: 'en' });
	await change;
	assert.equal(context.renderedLanguage, 'en');
	vm.runInContext(`
		call = name => new Promise(resolve => {
			if (name === 'state') globalThis.finishPoll = resolve;
			else globalThis.finishSettings = resolve;
		});
		updateStatus = () => {};
	`, context);
	const polling = vm.runInContext('refresh()', context);
	const nextChange = handlers.get('change')({ target: { id: 'language', value: 'uk' } });
	context.finishSettings({ language: 'uk' });
	await nextChange;
	context.finishPoll({ settings: { language: 'en' } });
	await polling;
	assert.equal(vm.runInContext('state.settings.language', context), 'uk');
});
