import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { flightWanted, fetchedFlight, flightConfig } from './sim/tools/flight-library.mjs'
import { recordedSounds } from './sim/tools/codex-sounds.mjs'
import { BRAND } from './src/brand.js'
import en from './src/i18n/en.js'
import es from './src/i18n/es.js'
import MarkdownIt from 'markdown-it'

// CodeAIR flight (sim/tools/flight-library.mjs): with SIM_FLIGHT=1 the build
// bundles the flight library fetched into sim/build/flight/, and stops if it
// was not fetched; without, it bundles none of it and CodeAIR is not offered.
const FLIGHT = flightWanted()
const flightLib = FLIGHT ? fetchedFlight() : null
const flight = () => ({
  name: 'sim-flight',
  buildStart() {
    if (FLIGHT && !flightLib) {
      const { url, commit } = flightConfig()
      this.error(`SIM_FLIGHT=1, but CodeAIR's flight library (${url} at ${commit || 'no commit pinned'}) is not fetched: run npm run sim:flight`)
    }
  },
  resolveId(id) { return id === 'virtual:sim-flight' ? '\0virtual:sim-flight' : null },
  load(id) {
    if (id !== '\0virtual:sim-flight') return null
    return `export const FLIGHT = ${FLIGHT}\nexport const files = ${JSON.stringify(flightLib?.files ?? {})}\n`
  },
})

// A CodeX's sound files (sim/tools/codex-sounds.mjs): which the simulator has a
// recording of, and how long each plays, for the simulated CodeX's drive.
const codexSoundsModule = () => ({
  name: 'codex-sounds',
  resolveId(id) { return id === 'virtual:codex-sounds' ? '\0virtual:codex-sounds' : null },
  load(id) {
    if (id !== '\0virtual:codex-sounds') return null
    return `export const sounds = ${JSON.stringify(recordedSounds())}\n`
  },
})

// The site carries code under other licenses (THIRD_PARTY_NOTICES.md), so it
// serves the notices at licenses/, and with CodeAIR flight the GPL's text for
// its library. Without it, the notices' flight section (between the
// <!-- flight --> markers) is left out, as the library is.
const licenses = {
  name: 'licenses',
  generateBundle() {
    let notices = fs.readFileSync('THIRD_PARTY_NOTICES.md', 'utf8')
    if (FLIGHT) notices = notices.replace('{flight-source}', `, for this build <${flightLib.source.url.replace(/\.git$/, '')}/tree/${flightLib.source.commit}>`)
    else notices = notices.replace(/<!-- flight -->[\s\S]*?<!-- \/flight -->\n*/g, '')
    this.emitFile({ type: 'asset', fileName: 'licenses/THIRD_PARTY_NOTICES.md', source: notices })
    if (FLIGHT) this.emitFile({ type: 'asset', fileName: 'licenses/GPL-2.0.txt', source: flightLib.license })
    this.emitFile({ type: 'asset', fileName: 'licenses/LICENSE.txt', source: fs.readFileSync('LICENSE') })
    // An index, so licenses/ (linked from About) is a page and not a missing one. It is also
    // what the offline app's service worker serves there, in place of the app itself.
    this.emitFile({ type: 'asset', fileName: 'licenses/index.html', source: licensesPage() })
  },
}

/** licenses/index.html: what each part is licensed under, linking the texts, in English (en.js). */
function licensesPage() {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const say = (key) => esc(en[key].replaceAll('{app}', BRAND.name))
  const item = (href, key) => `<li><a href="${esc(href)}">${say(key)}</a></li>`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${say('licenses.title')}</title>
<link rel="icon" href="../icons/firia-bot-head.svg" type="image/svg+xml">
<style>
  body { font: 16px/1.6 system-ui, sans-serif; color: #2b2c2e; background: #fffdf7; max-width: 44rem; margin: 0 auto; padding: 1.5rem 1rem; }
  h1 { font-size: 1.5rem; line-height: 1.2; }
  a { color: #2f7d2b; }
  li { margin: 0.4rem 0; }
</style>
</head>
<body>
<p><a href="../">← ${say('licenses.back')}</a></p>
<h1>${say('licenses.title')}</h1>
<p>${say('licenses.intro')}</p>
<ul>
${[
    item('LICENSE.txt', 'licenses.code'),
    item('THIRD_PARTY_NOTICES.md', 'licenses.notices'),
    FLIGHT ? item('GPL-2.0.txt', 'licenses.gpl') : '',
    item('../learn/packs/LICENSE', 'licenses.packs'),
    item('https://creativecommons.org/licenses/by-nc/4.0/', 'licenses.art'),
    item(BRAND.source, 'licenses.source'),
  ].filter(Boolean).join('\n')}
</ul>
<p>${say('licenses.marks')}</p>
</body>
</html>
`
}

// Which build this is, for About and bug reports: package.json's version, and
// the commit it was built from (CI's GITHUB_SHA, else git, else "local").
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version
function commit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'local'
  }
}

// The pages' titles before the strings load, and the link preview tags, for
// anything that reads the HTML alone (crawlers, Slack, social sites): in
// index.html and boards.html, %BRAND_NAME% is the product's name, %BRAND_SITE%
// its address and %APP_DESCRIPTION% its English description (src/i18n/en.js).
const brandName = {
  name: 'brand-name',
  transformIndexHtml: {
    order: 'pre',
    handler: (html) => html
      .replaceAll('%BRAND_NAME%', BRAND.name)
      .replaceAll('%BRAND_SITE%', BRAND.site)
      .replaceAll('%APP_DESCRIPTION%', en['app.description']),
  },
}

// The privacy policy and the accessibility statement, each at its own address
// (privacy/, accessibility/), in English (index.html) and Spanish (es.html),
// made from src/i18n/pages/<page>.<lang>.md. About links them. Being pages of
// their own, the service worker serves them from its copy rather than the app.
const PAGES = ['privacy', 'accessibility']
const PAGE_LANGS = { en, es }
const pages = {
  name: 'pages',
  generateBundle() {
    const md = new MarkdownIt({ html: false, linkify: false, typographer: false })
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const fill = (s) => s.replaceAll('{app}', BRAND.name).replaceAll('{issues}', BRAND.issues)
    for (const page of PAGES) {
      for (const [lang, strings] of Object.entries(PAGE_LANGS)) {
        const text = fill(fs.readFileSync(`src/i18n/pages/${page}.${lang}.md`, 'utf8'))
        const title = text.match(/^# (.+)$/m)[1]
        const other = lang === 'en' ? { href: 'es.html', lang: 'es', name: es['pages.language'] } : { href: 'index.html', lang: 'en', name: en['pages.language'] }
        const body = md.render(text).replace(/<a href="(https?:[^"]+)">/g, '<a href="$1" target="_blank" rel="noreferrer">')
        this.emitFile({
          type: 'asset',
          fileName: `${page}/${lang === 'en' ? 'index' : lang}.html`,
          source: `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`${title} · ${BRAND.name}`)}</title>
<link rel="icon" href="../icons/firia-bot-head.svg" type="image/svg+xml">
<style>
  body { font: 16px/1.6 system-ui, sans-serif; color: #2b2c2e; background: #fffdf7; max-width: 44rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
  h1 { font-size: 1.6rem; line-height: 1.2; }
  h2 { font-size: 1.2rem; margin-top: 2rem; }
  a { color: #2f7d2b; }
  li { margin: 0.3rem 0; }
  nav { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
</style>
</head>
<body>
<nav><a href="../">← ${esc(fill(strings['pages.back']))}</a> <a href="${other.href}" lang="${other.lang}" hreflang="${other.lang}">${esc(other.name)}</a></nav>
<main>
${body}</main>
</body>
</html>
`,
        })
      }
    }
  },
}

// Relative base so the built app can be dropped in any sub-path of an
// HTTPS host (Web Serial requires a secure context; file:// will not work).
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_BUILD__: JSON.stringify(commit()),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    // The app, and the boards page (several simulated boards at once).
    rollupOptions: { input: { main: 'index.html', boards: 'boards.html' } },
  },
  // The multiline text field (@blockly/field-multilineinput) requires Blockly's
  // Dart, JavaScript, Lua and PHP generators, about 115 KB of the first visit,
  // only to give them its block when asked; the app asks for Python alone.
  resolve: {
    alias: [{ find: /^blockly\/(dart|javascript|lua|php)$/, replacement: fileURLToPath(new URL('./src/blocks/no-generator.js', import.meta.url)) }],
  },
  // The simulator's worker is a module (MicroPython's loader uses top-level await).
  worker: { format: 'es', plugins: () => [flight(), codexSoundsModule()] },
  plugins: [
    flight(),
    codexSoundsModule(),
    licenses,
    brandName,
    pages,
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.svg', 'blockly-media/*'],
      workbox: {
        // Everything the app needs is bundled: once loaded, it runs offline,
        // the simulator (its wasm, models and first room) included. The
        // other rooms are fetched when chosen, and kept from then on: a
        // class need not download three rooms it may never visit.
        globPatterns: ['**/*.{js,css,html,svg,png,gif,cur,mp3,woff,woff2,webmanifest,wasm,glb,json,webp}'],
        // Mission packs are fetched when opened, and kept by Learn itself
        // (IndexedDB); only their list comes with the app.
        // The simulator's Asyncify MicroPython is only for browsers without
        // JSPI (src/sim/support.js): fetched the first time one starts the
        // simulator, and kept from then on, so a browser with JSPI never
        // downloads or stores it.
        // The link preview picture is for other sites to fetch, never the app.
        globIgnores: ['**/sim-assets/env/!(gym)/**', '**/learn/packs/!(index).json', '**/*asyncify*', 'social-card.png'],
        runtimeCaching: [{
          urlPattern: /\/sim-assets\/env\//,
          handler: 'CacheFirst',
          options: { cacheName: 'sim-rooms', expiration: { maxEntries: 32 } },
        }, {
          urlPattern: /\/assets\/micropython-asyncify-[^/]*\.(js|wasm)$/,
          handler: 'CacheFirst',
          options: { cacheName: 'sim-asyncify', expiration: { maxEntries: 4 } },
        }],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // boards.html?boards=codex,codeair (or ?lang=es) is still boards.html,
        // not the app (the navigation fallback). A parameter missing here makes
        // a page it is on the app instead (tests/subpath.mjs).
        ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^boards$/, /^lang$/],
      },
      manifest: {
        name: BRAND.name,
        short_name: BRAND.shortName,
        description: en['app.description'],
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
