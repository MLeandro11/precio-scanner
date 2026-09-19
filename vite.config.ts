import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/precio-scanner/',
  build: {
    rollupOptions: {
      output: {
        // The Firebase SDK is reached only through a dynamic import (the account screen), so
        // it must stay a lazily-fetched chunk. Naming it is what lets the service worker
        // exclude it below: Vite's default `index.esm-<hash>.js` name gives the precache
        // nothing stable to match on.
        manualChunks(id) {
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
            return 'firebase'
          }
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',

      includeAssets: [
        'favicon.ico',
        'favicon.svg',
        'apple-touch-icon.png',
        'icon-192.png',
        'icon-512.png',
        'icon-maskable-512.png',
      ],

      manifest: {
        id: '/precio-scanner/',
        name: 'Lupa — Buscador de precios de almacén',
        short_name: 'Lupa',
        description: 'Buscá productos por nombre o código EAN y armá tu lista de compras.',
        lang: 'es-AR',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f8fafc',
        theme_color: '#15803d',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        // `catalogo.json` (3.4 MB) and its index (2.1 MB) are deliberately NOT precached.
        // `catalogLoader` already caches them in the Cache API under keys versioned by the
        // catalog's sha256 (FR-4.2), and the catalog alone exceeds workbox's 2 MiB per-file
        // default. Precaching them would double ~5.5 MB of storage and leave the app with
        // two competing answers about which copy of the data is current. `globPatterns`
        // already excludes JSON, so this is the explicit guard, not the mechanism.
        //
        // The Firebase chunk is excluded for the opposite reason: it is small, but nothing
        // needs it unless someone opens the account screen, and `signInWithPopup` needs the
        // network anyway — so a precached copy would be downloaded by every visitor to no
        // purpose and could never be used offline. Without this line the service worker
        // quietly undoes the lazy import.
        globIgnores: ['**/data/**', '**/firebase-*.js'],
        // Build output only. The `public/` assets (icons, favicon) arrive through
        // `includeAssets`; listing them in both places precaches each of them twice.
        globPatterns: ['**/*.{js,css,html}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },

      // The service worker is a production artefact only; enabling it in dev makes
      // stale-asset debugging much harder than it needs to be.
      devOptions: { enabled: false },
    }),
  ],
})
