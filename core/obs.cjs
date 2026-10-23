const { createHash, randomUUID } = require('node:crypto');

// Query only source activity; never change scenes, sources, recordings or streams.
function sourceGuard(settings, password, Socket = WebSocket) {
  return new Promise(resolve => {
    let settled = false;
    let socket;
    const pending = new Map();
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const { reject } of pending.values()) reject(Error('obsUnavailable'));
      pending.clear();
      try { socket?.close(); } catch {}
      resolve(result);
    };
    const timer = setTimeout(() => finish({ decision: 'hold', reason: 'obsUnavailable' }), 5000);
    const request = name => new Promise((resolveRequest, reject) => {
      const requestId = randomUUID();
      pending.set(requestId, { resolve: resolveRequest, reject });
      socket.send(JSON.stringify({ op: 6, d: { requestType: 'GetSourceActive', requestId, requestData: { sourceName: name } } }));
    });
    try {
      socket = new Socket(`ws://127.0.0.1:${settings.obsPort}`);
      socket.addEventListener('error', () => finish({ decision: 'hold', reason: 'obsUnavailable' }));
      socket.addEventListener('close', () => finish({ decision: 'hold', reason: 'obsUnavailable' }));
      socket.addEventListener('message', async event => {
        if (settled) return;
        try {
          const { op, d = {} } = JSON.parse(event.data);
          if (op === 0) {
            const identity = { rpcVersion: 1 };
            if (d.authentication) {
              if (!password) throw Error('obsPassword');
              const secret = createHash('sha256').update(password + d.authentication.salt).digest('base64');
              identity.authentication = createHash('sha256').update(secret + d.authentication.challenge).digest('base64');
            }
            socket.send(JSON.stringify({ op: 1, d: identity }));
          } else if (op === 2) {
            for (const name of settings.blockedSources) {
              const state = await request(name);
              if (state.videoActive) return finish({ decision: 'refund', reason: 'blockedSource' });
            }
            let active = false;
            for (const name of settings.pcSources) active = (await request(name)).videoActive || active;
            finish(active ? { decision: 'allow', reason: 'pcSource' } : { decision: 'refund', reason: 'noPcSource' });
          } else if (op === 7) {
            const item = pending.get(d.requestId);
            if (!item) return;
            pending.delete(d.requestId);
            if (!d.requestStatus?.result || typeof d.responseData?.videoActive !== 'boolean') item.reject(Error('obsUnavailable'));
            else item.resolve(d.responseData);
          }
        } catch { finish({ decision: 'hold', reason: 'obsUnavailable' }); }
      });
    } catch { finish({ decision: 'hold', reason: 'obsUnavailable' }); }
  });
}
module.exports = { sourceGuard };
