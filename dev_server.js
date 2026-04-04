const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8888;
const BACKEND = 'http://localhost:8889';
const STATIC = path.join(__dirname, 'static');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

function proxyToBackend(req, res) {
  var opts = {
    hostname: 'localhost',
    port: 8889,
    path: req.url,
    method: req.method,
    headers: { 'content-type': 'application/json' },
  };
  var proxy = http.request(opts, function(pRes) {
    res.writeHead(pRes.statusCode, pRes.headers);
    pRes.pipe(res);
  });
  proxy.on('error', function() {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end('{"detail":"Backend unavailable. Start FastAPI on port 8889."}');
  });
  req.pipe(proxy);
}

function serveFile(filePath, res) {
  var ext = path.extname(filePath);
  var ct = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, function(err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + filePath);
    } else {
      res.writeHead(200, { 'Content-Type': ct });
      res.end(data);
    }
  });
}

http.createServer(function(req, res) {
  var url = req.url.split('?')[0];

  // API calls -> proxy to FastAPI backend
  if (url.startsWith('/api/')) {
    return proxyToBackend(req, res);
  }

  // Static files
  if (url.startsWith('/static/')) {
    return serveFile(path.join(STATIC, url.slice(8)), res);
  }

  // SPA fallback -> serve index.html
  serveFile(path.join(STATIC, 'index.html'), res);

}).listen(PORT, function() {
  console.log('Dev server running on http://localhost:' + PORT);
});
