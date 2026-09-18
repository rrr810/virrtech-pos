// VirrTech Duka POS — zero-dependency static dev/preview server.
// Correct MIME types (module scripts + webmanifest), no-store for the
// service worker so updates propagate, immutable caching for assets.
//
//   node server.mjs            # http://0.0.0.0:8080
//   PORT=3000 node server.mjs  # custom port

import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(join(fileURLToPath(import.meta.url), '..'));
const port = Number(process.env.PORT ?? 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const filePath = normalize(join(root, path));
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const st = await stat(filePath).catch(() => null);
    if (!st || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }

    const ext = extname(filePath).toLowerCase();
    const type = MIME[ext] ?? 'application/octet-stream';
    const headers = {
      'content-type': type,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    };
    if (filePath.endsWith('sw.js') || filePath.endsWith('index.html') || filePath.endsWith('manifest.webmanifest')) {
      headers['cache-control'] = 'no-store';
    } else if (filePath.startsWith(join(root, 'vendor')) || filePath.startsWith(join(root, 'icons'))) {
      headers['cache-control'] = 'public, max-age=31536000, immutable';
    } else {
      headers['cache-control'] = 'no-cache';
    }

    res.writeHead(200, headers);
    res.end(await readFile(filePath));
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('Internal server error');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`VirrTech Duka POS running at http://localhost:${port} (bound 0.0.0.0)`);
});
