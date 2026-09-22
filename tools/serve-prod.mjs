/**
 * Lokaler "Produktionsserver": liefert den Build (.vercel/output/static) und die gebündelte API-Funktion
 * (.vercel/output/functions/api.func) genau so aus, wie Vercel es später tut (eine Funktion für alle
 * /api/*-Routen, siehe tools/vercel-output.mjs). Zum Testen von Service Worker, Manifest und API vor dem Deployment.
 *
 *   npm run build && npm start        # http://localhost:4173
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

if (existsSync('.env')) process.loadEnvFile('.env');

const port = Number(process.env.PORT ?? 4173);
const dist = resolve('.vercel/output/static');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

let apiHandler;
async function loadApiHandler() {
  const file = resolve('.vercel/output/functions/api.func', 'index.mjs');
  if (!existsSync(file)) throw new Error(`API-Funktion fehlt: ${file}. Erst "npm run build" ausführen.`);
  return (await import(pathToFileURL(file).href)).default;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname.startsWith('/api/')) {
    apiHandler ??= await loadApiHandler();
    return apiHandler(req, res);
  }

  // Statische Datei, sonst SPA-Fallback auf index.html. Pfad darf das dist-Verzeichnis nicht verlassen.
  let file = normalize(join(dist, decodeURIComponent(url.pathname)));
  if (file !== dist && !file.startsWith(dist + sep)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
  const headers = { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' };
  if (file.endsWith('sw.js') || file.endsWith('index.html')) headers['cache-control'] = 'no-cache';
  res.writeHead(200, headers).end(readFileSync(file));
}).listen(port, () => console.log(`Produktionsserver: http://localhost:${port}`));
