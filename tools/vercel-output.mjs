/**
 * Erzeugt die Vercel "Build Output API v3"-Struktur unter .vercel/output:
 *
 *   static/                        ← der Web-Build (apps/web/dist)
 *   functions/api/<name>.func/     ← je API-Route ein eigenständig gebündelter Node-Handler
 *   config.json                    ← Routing (Dateien zuerst, /api/*, SPA-Fallback)
 *
 * Vorteil gegenüber einem Ordner api/: Vercel übernimmt das fertige Ergebnis, statt Funktionen aus
 * dem Quellcode zu erkennen und selbst zu kompilieren (Workspace-Pakete wären dabei ein Risiko).
 * Aufruf: node tools/vercel-output.mjs   (nach dem Web-Build)
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

export const RUNTIME = 'nodejs22.x';

/** Höchstlaufzeit je Funktion in Sekunden. KI-Auswertungen brauchen länger (Modellaufruf, ggf. Anbieterwechsel). */
export const MAX_DURATION = { default: 30, analysis: 60, 'news-analysis': 60 };

export async function buildVercelOutput({ outDir = '.vercel/output', staticDir = 'apps/web/dist', functionsDir = 'apps/api/functions' } = {}) {
  if (!existsSync(staticDir)) throw new Error(`Web-Build fehlt: ${staticDir}. Erst "npm run build:web" ausführen.`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  cpSync(staticDir, join(outDir, 'static'), { recursive: true });

  const entries = readdirSync(functionsDir).filter((f) => f.endsWith('.ts'));
  for (const file of entries) {
    const name = basename(file, '.ts');
    const dir = join(outDir, 'functions', 'api', `${name}.func`);
    mkdirSync(dir, { recursive: true });
    await build({
      entryPoints: [join(functionsDir, file)],
      outfile: join(dir, 'index.mjs'),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
      logLevel: 'warning',
    });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(
      join(dir, '.vc-config.json'),
      JSON.stringify({ runtime: RUNTIME, handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: MAX_DURATION[name] ?? MAX_DURATION.default }, null, 2),
    );
  }

  writeFileSync(
    join(outDir, 'config.json'),
    JSON.stringify(
      {
        version: 3,
        routes: [
          { src: '/sw.js', headers: { 'cache-control': 'public, max-age=0, must-revalidate' }, continue: true },
          { src: '/index.html', headers: { 'cache-control': 'public, max-age=0, must-revalidate' }, continue: true },
          { handle: 'filesystem' },
          { src: '/api/.*', status: 404 },
          { src: '/(.*)', dest: '/index.html' },
        ],
      },
      null,
      2,
    ),
  );
  return { outDir, functions: entries.map((f) => basename(f, '.ts')) };
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  const { functions } = await buildVercelOutput();
  console.log(`Vercel-Ausgabe erzeugt: .vercel/output (Funktionen: ${functions.join(', ')})`);
}
