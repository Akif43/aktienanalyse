// Hilfsskript für vercel-output.test.ts: lädt eine gebündelte Funktion in einem frischen Node-Prozess
// (wie Vercel), startet sie als HTTP-Server, ruft sie einmal auf und gibt das Ergebnis als JSON aus.
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const [file, route] = process.argv.slice(2);
const mod = await import(pathToFileURL(file).href);
const server = createServer(mod.default);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const res = await fetch(`http://127.0.0.1:${server.address().port}/api/${route}`);
console.log(
  JSON.stringify({
    handlerType: typeof mod.default,
    status: res.status,
    contentType: res.headers.get('content-type'),
    cacheControl: res.headers.get('cache-control'),
  }),
);
server.close();
