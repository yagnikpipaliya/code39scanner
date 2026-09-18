/**
 * Minimal static file server for local development (`npm start`) and for checking a build
 * (`npm run preview`). Uses only Node built-ins.
 *
 * Usage: node scripts/serve.js [directory] [port]   (defaults: repository root, 5173)
 */
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[3] ?? process.env.PORT ?? 5173);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** The file for a request path, or `null` if it is missing or outside `root`. */
function resolveFile(urlPath) {
  const path = normalize(join(root, decodeURIComponent(urlPath)));
  if (path !== root && !path.startsWith(root + sep)) return null;
  try {
    const stats = statSync(path);
    if (stats.isDirectory()) return resolveFile(join(urlPath, 'index.html'));
    return stats.isFile() ? path : null;
  } catch {
    return null;
  }
}

createServer((request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  const file = resolveFile(pathname);
  if (!file) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  createReadStream(file).pipe(response);
}).listen(port, () => {
  console.log(`Serving ${root} at http://localhost:${port}/`);
});
