import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
const PORT = process.env.PORT ?? 4321;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
};

http.createServer((req, res) => {
  const url = req.url?.split('?')[0] ?? '/';
  const filePath = path.join(DIST, url === '/' ? 'index.html' : url);

  const tryPaths = [filePath, filePath + '.html', path.join(filePath, 'index.html')];

  for (const p of tryPaths) {
    try {
      const stat = fs.statSync(p);
      if (stat.isFile()) {
        const ext = path.extname(p);
        res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
        fs.createReadStream(p).pipe(res);
        return;
      }
    } catch { /* not found, try next */ }
  }

  const notFound = path.join(DIST, '404.html');
  try {
    fs.statSync(notFound);
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(notFound).pipe(res);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Landing page live on http://0.0.0.0:${PORT}`);
});
