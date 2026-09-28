import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/precio-scanner/',
  build: {
    rollupOptions: {
      output: {
        // The Firebase SDK is reached only through dynamic imports (the account screen and the
        // saved-lists pages), so it must stay lazily-fetched chunks. Naming them is what lets
        // the service worker exclude them below: Vite's default `index.esm-<hash>.js` name
        // gives the precache nothing stable to match on.
        //
        // Firestore gets its own name deliberately. Both SDKs used to share one `firebase`
        // chunk, and adding Firestore to it silently grew what `/perfil` downloads from
        // ~46 kB gzip to ~213 kB — the account screen would have pulled a database client it
        // never uses. Order matters: every firestore path also matches the test below it.
        manualChunks(id) {
          if (id.includes('node_modules/@firebase/firestore')) return 'firestore'
          if (id.includes('node_modules/firebase/firestore')) return 'firestore'
          // Firestore's WebChannel transport. It matches the generic `@firebase` test below, but
          // auth never uses it, and leaving it there is what kept `/perfil` at ~66 kB gzip
          // instead of its previous ~46 kB once Firestore joined the app.
          if (id.includes('node_modules/@firebase/webchannel-wrapper')) return 'firestore'
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
        // The SDK chunks are excluded for the opposite reason: nothing needs them unless
        // someone opens the account screen or the saved-lists page, and `signInWithPopup`
        // needs the network anyway — so a precached copy would be downloaded by every visitor
        // to no purpose and could never be used offline. Both names are listed because the
        // pattern has to match the chunk name: a `firestore` chunk that only matched
        // `firebase-*` would quietly join the precache and undo the lazy import.
        globIgnores: ['**/data/**', '**/firebase-*.js', '**/firestore-*.js'],
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
