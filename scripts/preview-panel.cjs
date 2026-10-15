'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = fs.realpathSync(path.resolve(__dirname, '../dist/AE Browse/cep'));
const port = Number(process.argv[2] || 4311);
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const requested = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    const actual = fs.realpathSync(requested), relative = path.relative(root, actual);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(actual).isFile()) { res.writeHead(403); res.end(); return; }
    const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.pdf': 'application/pdf' }[path.extname(actual)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); fs.createReadStream(actual).pipe(res);
  } catch (_) { res.writeHead(404); res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log('UI demo only (no AE): http://127.0.0.1:' + port + '/?demo=1'));
