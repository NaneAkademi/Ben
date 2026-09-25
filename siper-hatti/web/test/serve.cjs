// Test için küçük statik sunucu: node test/serve.cjs [port]
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/json' };
function start(port = 8181) {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(root, path.normalize(p));
    if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (e, d) => {
      if (e) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
      res.end(d);
    });
  });
  return new Promise(r => srv.listen(port, () => r(srv)));
}
module.exports = start;
if (require.main === module) start(+process.argv[2] || 8181).then(() => console.log('serving'));
