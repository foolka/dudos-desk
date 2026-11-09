const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { EFFECTS, INPUT_EFFECTS, normalizeEffect, normalizeSettings } = require('./model.cjs');
const { ID } = require('./fullscreen.cjs');

// Replace complete files only after their contents have reached disk.
function atomic(file, data) {
  const tmp = file + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(tmp, data, { flag: 'wx', flush: true });
  fs.renameSync(tmp, file);
}

function selectProfile(production, test, override) {
  if (!test) return production;
  if (!override) throw Error('testProfileRequired');
  const resolve = p => fs.existsSync(p) ? fs.realpathSync.native(p) : path.resolve(p);
  const relative = path.relative(resolve(production), resolve(override));
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw Error('unsafeTestProfile');
  return path.resolve(override);
}

class Store {
  constructor(root) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
    const file = path.join(root, 'dudos.sqlite');
    const marker = path.join(root, 'profile-identity.json');
    for (const name of [root, file, marker, path.join(root, 'obs.bin')]) {
      if (fs.existsSync(name) && fs.realpathSync.native(name).toLowerCase() !== path.resolve(name).toLowerCase()) throw Error('profileRedirected');
    }
    const exists = fs.existsSync(file);
    if (!exists && ['profile-identity.json', 'obs.bin', 'backups', 'media', 'dudos.sqlite-wal'].some(n => fs.existsSync(path.join(root, n)))) throw Error('profileMissing');
    this.db = new DatabaseSync(file);
    try {
      if (exists) {
        if (this.db.prepare('PRAGMA user_version').get().user_version !== 1) throw Error('profileVersion');
        if (Object.values(this.db.prepare('PRAGMA quick_check').get())[0] !== 'ok') throw Error('profileDamaged');
        const id = this.meta('id');
        if (!id || (fs.existsSync(marker) && JSON.parse(fs.readFileSync(marker, 'utf8')).id !== id)) throw Error('profileMissing');
      }
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS effects(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY, at INTEGER, code TEXT, data TEXT);
        CREATE TABLE IF NOT EXISTS redemptions(id TEXT PRIMARY KEY, at INTEGER, result TEXT NOT NULL);`);
      if (!exists) {
        this.db.exec('BEGIN IMMEDIATE');
        this.setMeta('id', randomUUID());
        this.setMeta('settings', normalizeSettings());
        this.setMeta('overlayKey', randomBytes(32).toString('hex'));
        for (const id of Object.keys(EFFECTS)) this.writeEffect(normalizeEffect(id));
        this.db.exec('PRAGMA user_version=1; COMMIT');
      }
      // Add only introduced effects; missing legacy rows remain profile errors.
      const additions = exists ? INPUT_EFFECTS.filter(id => !this.db.prepare('SELECT id FROM effects WHERE id=?').get(id)) : [];
      if (additions.length) {
        this.backup();
        this.db.exec('BEGIN IMMEDIATE');
        try { for (const id of additions) this.writeEffect(normalizeEffect(id)); this.db.exec('COMMIT'); }
        catch (error) { this.db.exec('ROLLBACK'); throw error; }
      }
      this.settings(); this.effects();
      if (!fs.existsSync(marker)) atomic(marker, JSON.stringify({ version: 1, id: this.meta('id') }));
      fs.mkdirSync(path.join(root, 'media'), { recursive: true });
    } catch (error) { this.db.close(); throw error; }
  }
  meta(key) { const r = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key); return r ? JSON.parse(r.value) : null; }
  setMeta(key, value) { this.db.prepare('INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  settings() { return normalizeSettings(this.meta('settings')); }
  effects() {
    const rows = this.db.prepare('SELECT id,data FROM effects ORDER BY rowid').all();
    if (Object.keys(EFFECTS).some(id => !rows.some(row => row.id === id))) throw Error('profileDamaged');
    return rows.map(row => normalizeEffect(row.id, JSON.parse(row.data)));
  }
  writeEffect(effect) { this.db.prepare('INSERT INTO effects VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(effect.id, JSON.stringify(effect)); }
  saveEffect(id, input) { const effect = normalizeEffect(id, input); this.backup(); this.writeEffect(effect); return effect; }
  removeMedia(id) {
    if (!ID.test(id)) throw Error('unknownEffect');
    this.backup();
    this.db.prepare('DELETE FROM effects WHERE id=?').run(id);
    // Files stay available to queued events and database backups.
  }
  saveSettings(input) { const value = normalizeSettings({ ...this.settings(), ...input }); this.backup(); this.setMeta('settings', value); return value; }
  backup() {
    const folder = path.join(this.root, 'backups');
    fs.mkdirSync(folder, { recursive: true });
    const target = path.join(folder, `${Date.now()}-${randomUUID()}.sqlite`);
    this.db.prepare('VACUUM INTO ?').run(target);
    const names = fs.readdirSync(folder).filter(n => /^\d+-[a-f0-9-]+\.sqlite$/.test(n)).sort();
    for (const name of names.slice(0, -20)) fs.unlinkSync(path.join(folder, name));
    return target;
  }
  redemption(id) { const row = this.db.prepare('SELECT result FROM redemptions WHERE id=?').get(id); return row ? JSON.parse(row.result) : null; }
  remember(id, result) { this.db.prepare('INSERT OR REPLACE INTO redemptions VALUES(?,?,?)').run(id, Date.now(), JSON.stringify(result)); }
  log(code, data = {}) {
    try {
      this.db.prepare('INSERT INTO history(at,code,data) VALUES(?,?,?)').run(Date.now(), code, JSON.stringify(data));
      this.db.exec('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 300)');
    } catch {
      // History must never prevent the emergency stop from dismissing a window.
      this.historyUnavailable = true;
    }
  }
  history() { return this.db.prepare('SELECT * FROM history ORDER BY id DESC LIMIT 100').all().map(r => ({ ...r, data: JSON.parse(r.data) })); }
  close() { this.db.close(); }
}
module.exports = { Store, atomic, selectProfile };
