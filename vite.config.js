import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Relative base so the built app can be dropped in any sub-path of an
// HTTPS host (Web Serial requires a secure context; file:// will not work).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.svg', 'blockly-media/*'],
      workbox: {
        // Everything the app needs is bundled: once loaded, it runs offline.
        globPatterns: ['**/*.{js,css,html,svg,png,gif,cur,mp3,woff,woff2,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
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
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
