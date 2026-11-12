/**
 * The performance budget for a low-end school Chromebook, roughly: the
 * page's CPU throttled 4x and software GL (SwiftShader, slower than any real
 * GPU, so a pessimistic stand-in). Run it after `npm run build`:
 *   npm run perf
 * It measures the first visit (bytes, compressed, and time), the simulator's
 * start (bytes and time) and, with a program moving the device in the gym,
 * frames per second and whether simulated time keeps up with real time.
 * PERF_LIST=1 lists the simulator start's largest files.
 * Exits 1 when a number misses its budget. Not part of `npm test`: a CI
 * runner's speed varies, so CI runs it as a report.
 */
import { spawn } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const BUDGET = {
  firstKB: 600,         // first visit, gzip: the app, Blockly, the terminal, fonts
  firstLoadMs: 3000,    // to the page's load event
  simKB: 1400,          // the simulator's start, gzip: MicroPython, the room, the model
  simStartMs: 5000,     // Simulate pressed to ready
  fps: 20,              // in the gym, a device moving, follow camera
  simPerWall: 0.95,     // simulated seconds per wall second at 1x
}
const RATE = 4
const PORT = '4184'     // its own (sim-ui uses 4183)
const URL = `http://localhost:${PORT}/`
const DIST = new globalThis.URL('../dist/', import.meta.url).pathname

const server = spawn('npx', ['vite', 'preview', '--port', PORT, '--strictPort'], { stdio: 'ignore', detached: true })
const stop = () => { try { process.kill(-server.pid) } catch { /* gone */ } }
process.on('exit', stop)
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 250))
  try { if ((await fetch(URL)).ok) break } catch { /* not yet */ }
}

// What a file weighs on the wire: gzip, as any host serves it.
const gz = (url) => {
  const p = path.join(DIST, new globalThis.URL(url).pathname.replace(/^\//, ''))
  return fs.existsSync(p) && fs.statSync(p).isFile() ? gzipSync(fs.readFileSync(p)).length : 0
}

const browser = await chromium.launch({
  ...(process.env.OCB_CHROMIUM ? { executablePath: process.env.OCB_CHROMIUM } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const misses = []
for (const kind of ['codebot', 'codeair']) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' })
  const page = await context.newPage()
  await page.addInitScript((k) => {
    localStorage.setItem('opencodebot.welcomed.v1', '1')
    localStorage.setItem('opencodebot.device.v1', k)
  }, kind)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE })
  const urls = []
  page.on('request', (r) => urls.push(r.url()))

  const t0 = Date.now()
  await page.goto(URL, { waitUntil: 'load' })
  const firstLoadMs = Date.now() - t0
  await page.waitForLoadState('networkidle')
  const firstKB = Math.round([...new Set(urls.splice(0))].reduce((a, u) => a + gz(u), 0) / 1024)

  const t1 = Date.now()
  await page.click('#btn-sim')
  await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 120000 })
  const simStartMs = Date.now() - t1
  await page.waitForLoadState('networkidle')
  // The page sees its workers' fetches too, except a module worker's wasm.
  const wasm = fs.readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.wasm')).map((f) => `${URL}assets/${f}`)
  for (const w of wasm) if (!urls.includes(w)) urls.push(w)
  if (process.env.PERF_LIST) console.log([...new Set(urls)].map((u) => [gz(u), u.replace(URL, '')]).sort((a, b) => b[0] - a[0]).slice(0, 12))
  const simKB = Math.round([...new Set(urls)].reduce((a, u) => a + gz(u), 0) / 1024)

  await page.evaluate((k) => window.openCodeBot.device.run(k === 'codeair'
    ? 'from codeair import *\nfrom flight import *\nfly.take_off(0.5)\nwhile True:\n    fly.turn_left(90)\n'
    : 'from botcore import *\nmotors.enable(True)\nmotors.run(LEFT, 40)\nmotors.run(RIGHT, 60)\nwhile True:\n    pass\n'), kind)
  await page.waitForTimeout(4000)       // take-off, and the view settling its resolution
  const run = await page.evaluate(async () => {
    const d = window.openCodeBot.device.sim
    const s0 = d.lastFrame.t
    const w0 = performance.now()
    let n = 0
    await new Promise((res) => { const f = () => { n++; if (performance.now() - w0 < 5000) requestAnimationFrame(f); else res() }; requestAnimationFrame(f) })
    const w = performance.now() - w0
    return { fps: n / (w / 1000), simPerWall: (d.lastFrame.t - s0) / 1000 / w, ratio: d.view.ratio }
  })
  await context.close()

  const got = { firstKB, firstLoadMs, simKB, simStartMs, fps: +run.fps.toFixed(1), simPerWall: +run.simPerWall.toFixed(2) }
  const line = Object.entries(got).map(([k, v]) => {
    const ok = k === 'fps' || k === 'simPerWall' ? v >= BUDGET[k] : v <= BUDGET[k]
    if (!ok) misses.push(`${kind} ${k} ${v} (budget ${BUDGET[k]})`)
    return `${k} ${v}${ok ? '' : ' MISS'}`
  }).join(', ')
  console.log(`perf ${kind} at ${RATE}x CPU, software GL: ${line}; pixel ratio ${run.ratio.toFixed(2)}`)
}
await browser.close()
stop()
if (misses.length) {
  console.error('\nOver budget:\n - ' + misses.join('\n - '))
  process.exit(1)
}
console.log('perf: within budget')
