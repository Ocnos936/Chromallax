// Minimal static file server for local development (Node built-ins only).
// ES modules can't load from file://, so the app has to be served over http.
// Usage: node scripts/serve.mjs [--port 5173] [--root .]
// Without --port / PORT, a busy 5173 falls back to the next free port.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const requestedPort = option('port', process.env.PORT);
let port = Number(requestedPort ?? 5173);
const root = resolve(option('root', '.'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const server = createServer(async (req, res) => {
  try {
    let path = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname)));
    if (path !== root && !path.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
    const body = await readFile(path);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*', // lets ?src= load images from another local server
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' }).end('Not found');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && requestedPort === undefined && port < 5173 + 20) {
    console.log(`Port ${port} is in use, trying ${port + 1}…`);
    server.listen(++port);
    return;
  }
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use; pass --port <n> to use another.` : err.message);
  process.exit(1);
});
server.listen(port, () => console.log(`Serving ${root} at http://localhost:${port}`));
