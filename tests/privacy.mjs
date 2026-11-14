/**
 * Nothing leaves the browser: every request the app makes, from the page, its
 * workers and its service worker, goes to the site it was loaded from. This
 * walks the app (palette, dialogs, a run, the simulator in every room, the
 * boards page) and fails on any request elsewhere. Then it goes offline and
 * reloads: the app still opens, as About says. Run after `npm run build`.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.OCB_URL || 'http://localhost:4173/'
const ORIGIN = new URL(BASE).origin

async function reachable(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok
  } catch {
    return false
  }
}

let server = null
if (!(await reachable(BASE))) {
  server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' })
  for (let i = 0; i < 40 && !(await reachable(BASE)); i++) await new Promise((r) => setTimeout(r, 250))
}

const problems = []
const check = (ok, label) => {
  console.log(`  ${ok ? 'ok' : 'FAIL'}  ${label}`)
  if (!ok) problems.push(label)
}

const browser = await chromium.launch(process.env.OCB_CHROMIUM ? { executablePath: process.env.OCB_CHROMIUM } : {})
// A fresh profile with service workers on, as a first-time visitor has.
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'allow' })
const elsewhere = new Set()
let requests = 0
// The context sees the page's, its workers' and the service worker's requests.
context.on('request', (req) => {
  const url = req.url()
  if (/^(data|blob):/.test(url)) return
  requests++
  if (new URL(url).origin !== ORIGIN) elsewhere.add(`${req.resourceType()} ${url}`)
})
const page = await context.newPage()
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))

await page.goto(`${BASE}?device=loopback&board=codebot`, { waitUntil: 'networkidle' })
await page.evaluate(() => {
  localStorage.setItem('opencodebot.welcomed.v1', '1')
  localStorage.setItem('opencodebot.device.v1', 'codebot')
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)
await page.evaluate(() => navigator.serviceWorker.ready)

// The palette, every category.
for (let i = 0; i < (await page.$$('.blocklyToolboxCategory')).length; i++) {
  await (await page.$$('.blocklyToolboxCategory'))[i].click()
  await page.waitForTimeout(100)
}
await page.keyboard.press('Escape')

// Help and About.
for (const action of ['help', 'about']) {
  await page.click('#btn-menu')
  await page.click(`#app-menu [data-action="${action}"]`)
  await page.waitForFunction(() => document.getElementById('modal')?.open)
  await page.keyboard.press('Escape')
}

// A run, and the Python tab.
await page.click('#btn-connect')
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready')
await page.click('#btn-run')
await page.waitForFunction(() => window.openCodeBot.device.state === 'running')
await page.click('#btn-stop')
await page.click('#btn-view') // the Python, in place of the blocks
await page.click('#btn-view') // and back

// The simulator, in every room it has.
await page.click('#btn-sim')
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 20000 })
const rooms = await page.$$eval('.sim-room option', (os) => os.map((o) => o.value))
for (const room of rooms) {
  await page.selectOption('.sim-room', room)
  await page.waitForLoadState('networkidle')
}
check(rooms.length > 1, `the simulator visited ${rooms.length} rooms`)

// The boards page.
await page.goto(`${BASE}boards.html`, { waitUntil: 'networkidle' })

check(requests > 20, `requests seen: ${requests}`)
check(elsewhere.size === 0, `every request went to the app's own site${elsewhere.size ? ': ' + [...elsewhere].join('; ') : ''}`)

// Offline, the app still opens and works from what the service worker kept.
await context.setOffline(true)
await page.goto(`${BASE}?device=loopback&board=codebot`, { waitUntil: 'domcontentloaded' })
const offline = await page
  .waitForFunction(() => !!window.openCodeBot && document.querySelectorAll('.blocklyToolboxCategory').length > 5, null, { timeout: 15000 })
  .then(() => true)
  .catch(() => false)
check(offline, 'with no network, the app still opens')
await context.setOffline(false)

await browser.close()
server?.kill()

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('\nAll good.')
