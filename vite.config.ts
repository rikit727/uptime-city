import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { GAME_NAME, GAME_SHORT_NAME, GAME_DESCRIPTION } from './src/config.ts';

// BASE_PATH lets the site live on a GitHub Pages subpath, e.g. "/uptime-city/".
const rawBase = process.env.BASE_PATH ?? '/';
const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // Three.js in its own chunk: it changes far less often than the game, so
        // browsers and the service worker keep it cached across updates.
        manualChunks: (id: string) => (id.includes('node_modules/three/') ? 'three' : undefined),
      },
    },
  },
  plugins: [
    {
      // Keeps the game name in src/config.ts only.
      name: 'inject-game-name',
      transformIndexHtml: (html) => html.replaceAll('%GAME_NAME%', GAME_NAME),
    },
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/favicon.svg'],
      manifest: {
        name: GAME_NAME,
        short_name: GAME_SHORT_NAME,
        description: GAME_DESCRIPTION,
        lang: 'en-GB',
        theme_color: '#1d2b36',
        background_color: '#1d2b36',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,webmanifest}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
});
