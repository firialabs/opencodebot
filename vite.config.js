import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Relative base so the built app can be dropped in any sub-path of an
// HTTPS host (Web Serial requires a secure context; file:// will not work).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    // The app, and the boards page (several simulated boards at once).
    rollupOptions: { input: { main: 'index.html', boards: 'boards.html' } },
  },
  // The simulator's worker is a module (MicroPython's loader uses top-level await).
  worker: { format: 'es' },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.svg', 'blockly-media/*'],
      workbox: {
        // Everything the app needs is bundled: once loaded, it runs offline,
        // the simulator (its wasm, models and rooms) included.
        globPatterns: ['**/*.{js,css,html,svg,png,gif,cur,mp3,woff,woff2,webmanifest,wasm,glb,json}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // boards.html?boards=codex,codeair is still boards.html, not the app
        // (the navigation fallback).
        ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^boards$/],
      },
      manifest: {
        name: 'OpenCodeBot',
        short_name: 'OpenCodeBot',
        description: 'Friendly block coding for Firia Labs CodeBot, CodeX, and CodeAIR.',
        theme_color: '#4EB748',
        background_color: '#FFFDF7',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: 'icons/firia-bot-head.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'icons/firia-bot-head.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
