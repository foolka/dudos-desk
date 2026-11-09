const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { timingSafeEqual } = require('node:crypto');
const { FILE, TYPES } = require('./fullscreen.cjs');
const PORT = 18778;
const OVERLAY_VERSION = '0.5.0';

function equal(value, expected) {
  return typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

// OBS is read-only; redemptions arrive exclusively from authenticated Twitch.
function createServer({ store, engine, root, port = PORT }) {
  let lastObs = 0;
  const mediaUrl = name => `http://127.0.0.1:${server.address().port}/media/${name}?key=${store.meta('overlayKey')}`;
  const present = active => active?.kind === 'fullscreen' ? { ...active, mediaUrl: mediaUrl(active.file), soundUrl: active.sound ? mediaUrl(active.sound) : '' } : active;
  const server = http.createServer(async (req, res) => {
    const reply = (code, value, type = 'application/json; charset=utf-8') => {
      if (res.destroyed) return;
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'" });
      res.end(Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value));
    };
    const host = req.headers.host;
    const actualPort = server.address()?.port;
    if (host !== `127.0.0.1:${actualPort}` && host !== `localhost:${actualPort}`) return reply(403, { error: 'host' });
    const url = new URL(req.url, `http://${host}`);
    const mediaRequest = url.pathname.startsWith('/media/') && equal(url.searchParams.get('key'), store.meta('overlayKey'));
    if (req.headers.origin && req.headers.origin !== `http://${host}` && !(mediaRequest && req.headers.origin === 'null')) return reply(403, { error: 'origin' });
    const bearer = req.headers.authorization?.replace(/^Bearer /, '') || '';
    try {
      if (['GET', 'HEAD'].includes(req.method) && mediaRequest) {
        const name = url.pathname.slice(7);
        if (!FILE.test(name)) return reply(404, {});
        const file = path.join(store.root, 'media', name), size = fs.statSync(file).size;
        if (path.dirname(fs.realpathSync(file)).toLowerCase() !== fs.realpathSync(path.join(store.root, 'media')).toLowerCase()) return reply(403, {});
        let start = 0, end = size - 1;
        if (req.headers.range) {
          const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
          if (!match) return reply(416, {});
          start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end >= size) return reply(416, {});
        }
        res.writeHead(req.headers.range ? 206 : 200, { 'Content-Type': TYPES[path.extname(name)][1], 'Content-Length': end - start + 1,
          'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
          ...(req.headers.range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
        if (req.method === 'HEAD') return res.end();
        const stream = fs.createReadStream(file, { start, end });
        stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); return;
      }
      if (req.method === 'GET' && ['/overlay', '/overlay.css', '/overlay.js', '/fullscreen-player.js', '/fullscreen.css'].includes(url.pathname)) {
        const name = url.pathname === '/overlay' ? 'index.html' : url.pathname.slice(1);
        const type = name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html';
        return reply(200, fs.readFileSync(path.join(root, 'overlay', name)), type + '; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/api/state' && equal(bearer, store.meta('overlayKey'))) {
        if (url.searchParams.get('version') !== OVERLAY_VERSION) return reply(409, { error: 'reload', version: OVERLAY_VERSION });
        lastObs = Date.now();
        return reply(200, { active: present(engine.active), now: Date.now(), version: OVERLAY_VERSION });
      }
      if (req.method === 'GET' && url.pathname === '/api/sound' && equal(bearer, store.meta('overlayKey'))) {
        const active = engine.active;
        if (!active || url.searchParams.get('event') !== active.eventId || !active.sound) return reply(404, {});
        const file = path.join(store.root, 'media', active.sound);
        const types = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4' };
        return reply(200, fs.readFileSync(file), types[path.extname(file)] || 'application/octet-stream');
      }
      return reply(403, { error: 'unauthorized' });
    } catch { return reply(400, { error: 'requestFailed' }); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 1500;
  return {
    server,
    present,
    mediaUrl,
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); }); }),
    connected: () => lastObs > Date.now() - 3500,
    close: () => { server.closeAllConnections(); server.close(); }
  };
}
module.exports = { createServer, PORT, equal, OVERLAY_VERSION };
