import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Stellt /api/* im Dev-Server bereit, mit demselben Handler wie später auf Vercel. Env-Variablen
 * (FINNHUB_API_KEY, APP_TOKEN) kommen aus der .env im Repo-Wurzelverzeichnis.
 */
function devApi(): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, repoRoot, '');
      const load = async () => {
        const { createApi, toNodeHandler } = (await server.ssrLoadModule('@aktien/server')) as typeof import('@aktien/server');
        return toNodeHandler(createApi(env));
      };
      let handler: ReturnType<typeof load> | undefined;
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        (handler ??= load()).then((h) => h(req, res)).catch(next);
      });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: repoRoot,
  plugins: [
    react(),
    devApi(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'Borsa',
        short_name: 'Borsa',
        description: 'Hisseler sade dille / Aktien einfach erklärt (BIST, US, XETRA)',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'] },
      devOptions: { enabled: false },
    }),
  ],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: { host: true, port: 5173 },
});
