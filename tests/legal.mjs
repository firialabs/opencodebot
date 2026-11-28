/**
 * The privacy policy and the accessibility statement: each a page of its own,
 * in English and Spanish, linked from About in the language in use, passing
 * the same automated WCAG check as the app, loading nothing from anywhere
 * else, and served by the offline app's service worker as the page itself,
 * not the app. Run after `npm run build`.
 */
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { BRAND } from '../src/brand.js'

const BASE = process.env.OCB_URL || 'http://localhost:4173/'
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
const problems = []
const check = (ok, label) => {
  console.log(`  ${ok ? 'ok' : 'FAIL'}  ${label}`)
  if (!ok) problems.push(label)
}

const PAGES = { privacy: ['Privacy policy', 'Política de privacidad'], accessibility: ['Accessibility statement', 'Declaración de accesibilidad'] }

for (const page of Object.keys(PAGES)) {
  for (const file of ['index.html', 'es.html']) {
    const path = `dist/${page}/${file}`
    check(existsSync(path), `${page}/${file} is built`)
    if (!existsSync(path)) continue
    const html = readFileSync(path, 'utf8')
    check(!html.includes('{app}') && !html.includes('{issues}') && html.includes(BRAND.name), `${page}/${file}: the name filled in, no placeholder left`)
    check(!/\[[A-Z][^\]]*\]\s*$/m.test(html) && !/Notes for David|Codacious/.test(html), `${page}/${file}: no drafting notes or old names`)
  }
}

let server
if (!process.env.OCB_URL) {
  server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' })
  for (let i = 0; i < 40; i++) {
    try { await fetch(BASE); break } catch { await new Promise((r) => setTimeout(r, 250)) }
  }
}

const browser = await chromium.launch()
try {
  for (const [lang, n] of [['en', 0], ['es', 1]]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await context.addInitScript(() => localStorage.setItem('opencodebot.welcome.v1', 'off'))
    const page = await context.newPage()
    const elsewhere = new Set()
    context.on('request', (r) => { if (!r.url().startsWith(new URL(BASE).origin) && !r.url().startsWith('data:')) elsewhere.add(r.url()) })
    await page.goto(`${BASE}?lang=${lang}`, { waitUntil: 'networkidle' })
    await page.evaluate(() => navigator.serviceWorker.ready)
    // From About, as a person would, past the service worker that now runs the site.
    await page.click('#btn-menu')
    await page.click('#app-menu [data-action="about"]')
    await page.waitForFunction(() => document.getElementById('modal')?.open)
    for (const key of Object.keys(PAGES)) {
      const link = page.locator(`#modal a[href^="${key}/"]`)
      check((await link.count()) === 1, `${lang}: About links ${key}`)
      const [tab] = await Promise.all([context.waitForEvent('page'), link.click()])
      await tab.waitForLoadState('networkidle')
      const heading = (await tab.locator('h1').innerText()).trim()
      check(heading === PAGES[key][n], `${lang}: ${key} opens as its own page, in the language in use (${heading})`)
      check((await tab.getAttribute('html', 'lang')) === lang, `${lang}: ${key} says its language`)
      await tab.addScriptTag({ content: AXE })
      const violations = await tab.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] })).violations.map((v) => `${v.id} (${v.nodes.length})`))
      check(violations.length === 0, `${lang}: ${key} passes the WCAG check${violations.length ? ': ' + violations.join(', ') : ''}`)
      // The way back, and to the other language.
      const back = await tab.locator('nav a').first().getAttribute('href')
      const other = await tab.locator('nav a[hreflang]').getAttribute('href')
      check(back === '../' && other === (lang === 'en' ? 'es.html' : 'index.html'), `${lang}: ${key} links back to the app and to the other language`)
      await tab.close()
    }
    check(elsewhere.size === 0, `${lang}: nothing loaded from another site${elsewhere.size ? ': ' + [...elsewhere].join(', ') : ''}`)
    await context.close()
  }
} finally {
  await browser.close()
  server?.kill()
}

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('All good.')
