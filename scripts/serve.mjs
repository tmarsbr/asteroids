// Minimal static file server with no external dependencies.
// Serves the project root on http://localhost:5173.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(__dirname, '..'));

const PORT = process.env.PORT ? Number(process.env.PORT) : 5173;
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';

    // Prevent path traversal: resolve and verify the path stays under ROOT.
    const safe = resolve(join(ROOT, pathname));
    if (safe !== ROOT && !safe.startsWith(ROOT + sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const s = await stat(safe);
    if (s.isDirectory()) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const data = await readFile(safe);
    const type = MIME[extname(safe)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  } catch (err) {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Asteroids dev server: http://${HOST}:${PORT}`);
});