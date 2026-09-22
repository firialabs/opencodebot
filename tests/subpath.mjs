/**
 * GitHub Pages serves this project from a sub-path (/opencodebot/), not from
 * the root of a domain, and the whole point of the app is that it keeps
 * working with the internet unplugged. Both claims are easy to break with a
 * one-line config change, so check them for real: serve `dist/` under a
 * sub-path, load it, let the service worker install, then go offline and
 * reload.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright'

const PREFIX = '/opencodebot'
const PORT = Number(process.env.OCB_SUBPATH_PORT || 4180)
const ROOT = new URL('../dist/', import.meta.url).pathname

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.cur': 'image/x-icon',
}

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`)
  if (!ok) failures++
}

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0])
  if (!path.startsWith(`${PREFIX}/`)) {
    res.writeHead(404).end('not found')
    return
  }
  // Resolve the directory index before normalising: normalize('') is '.'.
  let file = path.slice(PREFIX.length + 1)
  if (file === '' || file.endsWith('/')) file += 'index.html'
  file = normalize(file).replace(/^(\.\.[/\\])+/, '')
  try {
    const body = await readFile(join(ROOT, file))
    // No caching, so the service worker is genuinely what serves the reload.
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    }).end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
})
await new Promise((resolve) => server.listen(PORT, resolve))

const url = `http://localhost:${PORT}${PREFIX}/`
console.log(`Serving dist/ at ${url}`)

const browser = await chromium.launch()
const context = await browser.newContext({ serviceWorkers: 'allow' })
const page = await context.newPage()
const problems = []
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
page.on('console', (m) => m.type() === 'error' && problems.push(`console error: ${m.text()}`))
page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`))

try {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.openCodeBotInternals, { timeout: 15000 })
  await page.evaluate(() => document.getElementById('modal')?.close())
  check('the app boots from a sub-path', await page.evaluate(() => !!window.openCodeBot))

  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]').href
    const parsed = await (await fetch(href)).json()
    return {
      scope: new URL(parsed.scope, href).pathname,
      start: new URL(parsed.start_url, href).pathname,
      icon: new URL(parsed.icons[0].src, href).pathname,
    }
  })
  check('manifest scope stays inside the sub-path', manifest.scope === `${PREFIX}/`, manifest.scope)
  check('manifest start_url stays inside the sub-path', manifest.start === `${PREFIX}/`, manifest.start)
  check('manifest icon resolves', manifest.icon === `${PREFIX}/icons/icon.svg`, manifest.icon)

  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForTimeout(2500)
  const worker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    return { scope: registration ? new URL(registration.scope).pathname : null, active: !!registration?.active }
  })
  check('service worker claims the sub-path', worker.active && worker.scope === `${PREFIX}/`, JSON.stringify(worker))

  await context.setOffline(true)
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(2000)
  const offline = await page.evaluate(() => ({
    booted: !!window.openCodeBot,
    categories: document.querySelectorAll('.blocklyToolboxCategoryLabel').length,
    font: getComputedStyle(document.querySelector('.brand-name')).fontFamily,
  }))
  check('it still boots with the network unplugged', offline.booted)
  check('the toolbox still renders offline', offline.categories > 0, `(${offline.categories} categories)`)
  check('the bundled font is still there offline', offline.font.includes('Fredoka'), offline.font)
  await context.setOffline(false)
} catch (error) {
  // A wrong `base` in vite.config.js shows up here as a page that never
  // boots. Report it as a failure rather than a stack trace.
  check(`the page never came up: ${String(error.message).split('\n')[0]}`, false)
} finally {
  await browser.close()
  server.close()
}

for (const problem of problems) check(problem, false)
console.log(failures ? `\n${failures} failure(s)` : '\nAll good.')
process.exit(failures ? 1 : 0)
