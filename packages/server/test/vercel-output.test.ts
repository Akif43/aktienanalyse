import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildVercelOutput, MAX_DURATION, RUNTIME } from '../../../tools/vercel-output.mjs';

/**
 * Prüft das eigentliche Deployment-Artefakt: Struktur der Vercel-Ausgabe (Build Output API v3) und dass
 * jede gebündelte Funktion eigenständig lauffähig ist, also genau das, was Vercel später ausführt.
 */
const RUNNER = fileURLToPath(new URL('./run-function.mjs', import.meta.url));

describe('Vercel-Ausgabe (Build Output API v3)', () => {
  let dir: string;
  let result: { outDir: string; functions: string[] };
  const ROUTES = ['analysis', 'candles', 'fund', 'fund-benchmark', 'fund-history', 'fund-search', 'health', 'history', 'news', 'news-analysis', 'news-item', 'quote', 'search'];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vercel-out-'));
    const staticDir = join(dir, 'dist');
    mkdirSync(join(staticDir, 'assets'), { recursive: true });
    writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>x</title>');
    writeFileSync(join(staticDir, 'sw.js'), '// sw');
    result = await buildVercelOutput({ outDir: join(dir, 'out'), staticDir });
  }, 60_000);

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('erzeugt je API-Route eine Funktion', () => {
    expect(result.functions.sort()).toEqual(ROUTES);
  });

  it('kopiert die statischen Dateien', () => {
    expect(readFileSync(join(result.outDir, 'static', 'index.html'), 'utf-8')).toContain('<title>x</title>');
    expect(readFileSync(join(result.outDir, 'static', 'sw.js'), 'utf-8')).toBe('// sw');
  });

  it('schreibt gültige Funktionskonfiguration (Node-Runtime, ESM, Handler vorhanden)', () => {
    for (const name of ROUTES) {
      const fn = join(result.outDir, 'functions', 'api', `${name}.func`);
      const cfg = JSON.parse(readFileSync(join(fn, '.vc-config.json'), 'utf-8'));
      expect(cfg).toMatchObject({ runtime: RUNTIME, handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false });
      expect(cfg.maxDuration).toBe(MAX_DURATION[name] ?? MAX_DURATION.default);
      expect(JSON.parse(readFileSync(join(fn, 'package.json'), 'utf-8'))).toEqual({ type: 'module' });
    }
    expect(RUNTIME).toMatch(/^nodejs\d+\.x$/);
  });

  it('config.json: Dateien vor API vor SPA-Fallback, kein Fallback für /api', () => {
    const cfg = JSON.parse(readFileSync(join(result.outDir, 'config.json'), 'utf-8'));
    expect(cfg.version).toBe(3);
    const order = cfg.routes.map((r: { handle?: string; src?: string }) => r.handle ?? r.src);
    expect(order.indexOf('filesystem')).toBeLessThan(order.indexOf('/api/.*'));
    expect(order.indexOf('/api/.*')).toBeLessThan(order.indexOf('/(.*)'));
    expect(cfg.routes.find((r: { src?: string }) => r.src === '/api/.*')).toMatchObject({ status: 404 });
    // Service Worker und index.html dürfen nicht dauerhaft gecacht werden, sonst kommen Updates nie an
    const sw = cfg.routes.find((r: { src?: string }) => r.src === '/sw.js');
    expect(sw.headers['cache-control']).toContain('max-age=0');
    expect(sw.continue).toBe(true);
  });

  it('jede gebündelte Funktion läuft eigenständig in einem frischen Node-Prozess', () => {
    for (const name of ROUTES) {
      const file = join(result.outDir, 'functions', 'api', `${name}.func`, 'index.mjs');
      const out = JSON.parse(execFileSync(process.execPath, [RUNNER, file, name], { encoding: 'utf-8', timeout: 30_000 }));
      // Ohne Parameter und ohne API-Keys liefert jede Route eine definierte Antwort statt zu crashen:
      // health 200, KI-Routen 503 (nicht eingerichtet), alle anderen 400 (Parameter fehlt)
      const expected = name === 'health' ? 200 : name === 'analysis' || name === 'news-analysis' || name === 'news-item' ? 503 : 400;
      expect(out).toEqual({
        handlerType: 'function',
        status: expected,
        contentType: 'application/json; charset=utf-8',
        cacheControl: 'no-store',
      });
    }
  }, 120_000);

  it('bricht mit klarer Meldung ab, wenn der Web-Build fehlt', async () => {
    await expect(buildVercelOutput({ outDir: join(dir, 'x'), staticDir: join(dir, 'gibtsnicht') })).rejects.toThrow(/Web-Build fehlt/);
  });
});
