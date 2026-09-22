/**
 * Erzeugt die Vercel "Build Output API v3"-Struktur unter .vercel/output:
 *
 *   static/                 ← der Web-Build (apps/web/dist)
 *   functions/api.func/     ← EIN gebündelter Node-Handler für alle /api/*-Routen
 *   config.json             ← Routing (Dateien zuerst, /api/* → die eine Funktion, SPA-Fallback)
 *
 * Warum eine einzige Funktion: `createApi()` (packages/server/src/api.ts) dispatcht selbst anhand des
 * Pfads auf alle Routen (health, quote, candles, …), jede der bisherigen Dateien in apps/api/functions
 * enthielt also denselben Code. Der Hobby-Plan erlaubt höchstens 12 Serverless Functions je Deployment
 * (https://vercel.com/docs/limits#serverless-function-limits) – bei einer Funktion je Route wäre das
 * mit jeder neuen Route knapper geworden (13 Routen haben das Limit bereits gerissen). Eine Funktion für
 * alle Routen bleibt beliebig erweiterbar und startet insgesamt seltener kalt.
 *
 * Vorteil des Build-Output-Ansatzes gegenüber einem Ordner api/: Vercel übernimmt das fertige Ergebnis,
 * statt Funktionen aus dem Quellcode zu erkennen und selbst zu kompilieren (Workspace-Pakete wären dabei
 * ein Risiko).
 * Aufruf: node tools/vercel-output.mjs   (nach dem Web-Build)
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

export const RUNTIME = 'nodejs22.x';

/** Höchstlaufzeit der einen Funktion in Sekunden. KI-Auswertungen brauchen länger (Modellaufruf, ggf. Anbieterwechsel). */
export const MAX_DURATION = 60;

export async function buildVercelOutput({ outDir = '.vercel/output', staticDir = 'apps/web/dist', entry = 'apps/api/functions/api.ts' } = {}) {
  if (!existsSync(staticDir)) throw new Error(`Web-Build fehlt: ${staticDir}. Erst "npm run build:web" ausführen.`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  cpSync(staticDir, join(outDir, 'static'), { recursive: true });

  const funcDir = join(outDir, 'functions', 'api.func');
  mkdirSync(funcDir, { recursive: true });
  await build({
    entryPoints: [entry],
    outfile: join(funcDir, 'index.mjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    logLevel: 'warning',
  });
  writeFileSync(join(funcDir, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(funcDir, '.vc-config.json'), JSON.stringify({ runtime: RUNTIME, handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: MAX_DURATION }, null, 2));

  writeFileSync(
    join(outDir, 'config.json'),
    JSON.stringify(
      {
        version: 3,
        routes: [
          { src: '/sw.js', headers: { 'cache-control': 'public, max-age=0, must-revalidate' }, continue: true },
          { src: '/index.html', headers: { 'cache-control': 'public, max-age=0, must-revalidate' }, continue: true },
          { handle: 'filesystem' },
          // Alle API-Routen laufen über die eine Funktion; sie liefert selbst ein sauberes 404-JSON für unbekannte Pfade.
          { src: '/api/(.*)', dest: '/api' },
          { src: '/(.*)', dest: '/index.html' },
        ],
      },
      null,
      2,
    ),
  );
  return { outDir, functions: ['api'] };
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  const { functions } = await buildVercelOutput();
  console.log(`Vercel-Ausgabe erzeugt: .vercel/output (Funktionen: ${functions.join(', ')})`);
}
