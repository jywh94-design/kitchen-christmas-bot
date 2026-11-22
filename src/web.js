// 极简网页服务：提供转盘页面和两个接口（查询状态、转一次）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { getSession, sessionState, spin } = require('./draw');

const PAGE_PATH = path.join(__dirname, '..', 'web', 'wheel.html');

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');

function startWebServer() {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (url.pathname === '/' || url.pathname === '/health') {
        return send(res, 200, 'ok', 'text/plain; charset=utf-8');
      }
      if (url.pathname === '/wheel') {
        return send(res, 200, fs.readFileSync(PAGE_PATH), 'text/html; charset=utf-8');
      }

      if (url.pathname === '/api/state' || url.pathname === '/api/spin') {
        const session = getSession(url.searchParams.get('s') || '');
        if (!session) return json(res, 404, { ok: false, error: 'NOT_FOUND' });

        if (url.pathname === '/api/state' && req.method === 'GET') {
          return json(res, 200, { ok: true, ...sessionState(session) });
        }
        if (url.pathname === '/api/spin' && req.method === 'POST') {
          return json(res, 200, spin(session));
        }
        return json(res, 405, { ok: false, error: 'METHOD' });
      }

      return send(res, 404, 'not found', 'text/plain; charset=utf-8');
    } catch (err) {
      console.error('网页服务异常:', err.message);
      return json(res, 500, { ok: false, error: 'SERVER' });
    }
  });

  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`🌐 转盘网页服务已启动，端口 ${port}`));
  return server;
}

module.exports = { startWebServer };
