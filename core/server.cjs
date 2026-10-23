const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { timingSafeEqual } = require('node:crypto');
const PORT = 18778;

function equal(value, expected) {
  return typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

// OBS uses a separate read-only key; no public endpoint changes app settings.
function createServer({ store, engine, root, port = PORT }) {
  let lastObs = 0;
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
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return reply(403, { error: 'origin' });
    const url = new URL(req.url, `http://${host}`);
    const bearer = req.headers.authorization?.replace(/^Bearer /, '') || '';
    try {
      if (req.method === 'GET' && ['/overlay', '/overlay.css', '/overlay.js'].includes(url.pathname)) {
        const name = url.pathname === '/overlay' ? 'index.html' : url.pathname.slice(1);
        const type = name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html';
        return reply(200, fs.readFileSync(path.join(root, 'overlay', name)), type + '; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/api/state' && equal(bearer, store.meta('overlayKey'))) {
        lastObs = Date.now();
        return reply(200, { active: engine.active, now: Date.now() });
      }
      if (req.method === 'GET' && url.pathname === '/api/sound' && equal(bearer, store.meta('overlayKey'))) {
        const active = engine.active;
        if (!active || url.searchParams.get('event') !== active.eventId || !active.sound) return reply(404, {});
        const file = path.join(store.root, 'media', active.sound);
        const types = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4' };
        return reply(200, fs.readFileSync(file), types[path.extname(file)] || 'application/octet-stream');
      }
      if (req.method === 'POST' && url.pathname === '/api/redeem' && equal(bearer, store.meta('botKey'))) {
        if (!String(req.headers['content-type']).startsWith('application/json')) return reply(415, {});
        if (Number(req.headers['content-length']) > 4096) return reply(413, {});
        const chunks = []; let length = 0;
        for await (const chunk of req) { length += chunk.length; if (length > 4096) return reply(413, {}); chunks.push(chunk); }
        const result = await engine.redeem(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        return reply(200, result);
      }
      return reply(403, { error: 'unauthorized' });
    } catch { return reply(400, { error: 'requestFailed' }); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 1500;
  return {
    server,
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); }); }),
    connected: () => lastObs > Date.now() - 3500,
    close: () => { server.closeAllConnections(); server.close(); }
  };
}
module.exports = { createServer, PORT, equal };
