/**
 * The simulator in the real app, in headless Chromium: start it, run every
 * CodeBot block's Python on it, run the starter project with the Run button,
 * and talk to the REPL. Run it after `npm run build` (and `npm run sim:assets`).
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const URL = process.env.OCB_URL || 'http://localhost:4173/'
const SHOT_DIR = process.env.OCB_SHOTS || 'tests/screenshots'

async function reachable(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok } catch { return false }
}
async function ensureServer() {
  if (await reachable(URL)) return null
  const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' })
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250))
    if (await reachable(URL)) return server
  }
  server.kill()
  throw new Error(`Nothing is serving ${URL}; run \`npm run build\` first.`)
}

if (!(await reachable(new globalThis.URL('sim-assets/env/gym/world.json', URL).href)) && !(await reachable(URL))) {
  // fall through: ensureServer below reports it
}
const server = await ensureServer()
if (!(await reachable(new globalThis.URL('sim-assets/env/gym/world.json', URL).href))) {
  console.log('sim-ui: skipped (no built simulator assets: npm run sim:assets, then npm run build)')
  server?.kill()
  process.exit(0)
}

const problems = []
// CHROME_PATH: use an installed Chromium when Playwright's own is missing.
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console error: ${m.text()}`) })
await page.addInitScript(() => {
  localStorage.setItem('opencodebot.welcomed.v1', '1')
  localStorage.setItem('opencodebot.device.v1', 'codebot')
})
await page.goto(URL, { waitUntil: 'networkidle' })
await page.click('#btn-sim')
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 20000 })

// Collect what the simulated board says and the errors it reports.
await page.evaluate(() => {
  const d = window.openCodeBot.device
  window.__sim = { out: '', errors: [] }
  d.addEventListener('data', (e) => { window.__sim.out += new TextDecoder('latin1').decode(e.detail) })
  d.addEventListener('program-error', (e) => window.__sim.errors.push(e.detail))
  d.sim.setSpeed(8)
})

// Every CodeBot block, alone, generated and run.
const codes = await page.evaluate(() => {
  const { Blockly, toolboxFor, generatePython } = window.openCodeBotInternals
  const types = []
  const walk = (items) => { for (const it of items || []) { if (it.kind === 'block') types.push(it.type); if (it.contents) walk(it.contents) } }
  walk(toolboxFor('codebot').contents)
  const scratch = new Blockly.Workspace()
  const out = []
  for (const type of types) {
    const block = scratch.newBlock(type)
    out.push([type, generatePython(scratch, 'codebot')])
    block.dispose(false)
  }
  scratch.dispose()
  return out
})
let ran = 0
for (const [type, code] of codes) {
  const r = await page.evaluate(async (code) => {
    const d = window.openCodeBot.device
    window.__sim.errors = []
    await d.run(code)
    const t0 = performance.now()
    while (d.state === 'running' && performance.now() - t0 < 1500) await new Promise((r) => setTimeout(r, 25))
    if (d.state === 'running') await d.stop()
    return window.__sim.errors
  }, code)
  // A generic block alone can be wrong Python (a `break` outside a loop,
  // `0 % 0`), and the simulator rightly says so. What must never happen is
  // the simulator missing something the device has.
  const gap = (e) => type.startsWith('codebot') || /NameError|ImportError|AttributeError|NotImplementedError|TypeError/.test(e.name)
  for (const e of r.filter(gap)) problems.push(`${type} ▸ ${e.name}: ${e.message} (line ${e.line})\n${code}`)
  ran++
}
console.log(`sim-ui: ran ${ran} CodeBot blocks on the simulator`)

// The starter project, with the Run button.
await page.evaluate(() => window.openCodeBot.device.sim.setSpeed(1))
await page.evaluate(() => { window.__sim.out = '' })
await page.click('#btn-run')
await page.waitForFunction(() => /Program finished|stopped with an error/.test(document.getElementById('status-msg').textContent), null, { timeout: 20000 })
const status = await page.locator('#status-msg').textContent()
if (!/Program finished/.test(status)) problems.push(`starter project: ${status}`)
else console.log('sim-ui: the starter project ran to the end')

// The REPL, between programs.
await page.evaluate(() => { window.__sim.out = ''; window.openCodeBot.device.sendRaw('print(6 * 7)\r') })
await page.waitForFunction(() => /42/.test(window.__sim.out), null, { timeout: 5000 }).catch(() => problems.push('REPL: no answer to print(6 * 7)'))

await page.screenshot({ path: `${SHOT_DIR}/ocb-sim.png` })

// CodeX: switch boards, run every CodeX block, draw, and press a button
// with the keyboard.
await page.click('#btn-sim')                                   // stop simulating CodeBot
await page.evaluate(() => { window.openCodeBot._pickTarget('codex') })
await page.waitForTimeout(300)
if (await page.evaluate(() => document.getElementById('modal')?.open)) await page.click('#modal button[value="ok"]')
await page.click('#btn-sim')
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready' && window.openCodeBot.device.targetId === 'codex', null, { timeout: 20000 })
await page.evaluate(() => {
  const d = window.openCodeBot.device
  d.addEventListener('data', (e) => { window.__sim.out += new TextDecoder('latin1').decode(e.detail) })
  d.addEventListener('program-error', (e) => window.__sim.errors.push(e.detail))
  d.sim.setSpeed(8)
})
const cxCodes = await page.evaluate(() => {
  const { Blockly, toolboxFor, generatePython } = window.openCodeBotInternals
  const types = []
  const walk = (items) => { for (const it of items || []) { if (it.kind === 'block') types.push(it.type); if (it.contents) walk(it.contents) } }
  walk(toolboxFor('codex').contents)
  const scratch = new Blockly.Workspace()
  const out = []
  for (const type of types.filter((t) => t.startsWith('codex'))) {
    const block = scratch.newBlock(type)
    out.push([type, generatePython(scratch, 'codex')])
    block.dispose(false)
  }
  scratch.dispose()
  return out
})
for (const [type, code] of cxCodes) {
  const errs = await page.evaluate(async (code) => {
    const d = window.openCodeBot.device
    window.__sim.errors = []
    await d.run(code)
    const t0 = performance.now()
    while (d.state === 'running' && performance.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 25))
    if (d.state === 'running') await d.stop()
    return window.__sim.errors
  }, code)
  for (const e of errs) problems.push(`${type} ▸ ${e.name}: ${e.message} (line ${e.line})\n${code}`)
}
console.log(`sim-ui: ran ${cxCodes.length} CodeX blocks on the simulator`)

await page.evaluate(() => window.openCodeBot.device.sim.setSpeed(1))
await page.evaluate(() => window.openCodeBot.device.run(`from codex import *
display.fill(BLUE)
display.draw_text("Press A", x=36, y=100, color=WHITE, scale=3)
while not buttons.was_pressed(BTN_A):
    pass
display.fill(GREEN)
pixels.fill(RED, 100)
`))
await page.waitForTimeout(1500)
await page.focus('.cx-wrap')
await page.keyboard.down('a')
await page.waitForTimeout(150)
await page.keyboard.up('a')
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 5000 }).catch(() => problems.push('CodeX: the A key did not press button A'))
const green = await page.evaluate(() => {
  const c = document.querySelector('.cx-screen').getContext('2d').getImageData(120, 20, 1, 1).data
  return [c[0], c[1], c[2]]
})
if (!(green[1] > 200 && green[0] < 50)) problems.push(`CodeX: the screen is ${green}, not green`)
else console.log('sim-ui: CodeX drew, and the keyboard pressed its A button')
await page.screenshot({ path: `${SHOT_DIR}/ocb-sim-codex.png` })

// CodeAIR: switch boards, run every CodeAIR block, and fly.
await page.click('#btn-sim')
await page.evaluate(() => { window.openCodeBot._pickTarget('codeair') })
await page.waitForTimeout(300)
if (await page.evaluate(() => document.getElementById('modal')?.open)) await page.click('#modal button[value="ok"]')
await page.click('#btn-sim')
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready' && window.openCodeBot.device.targetId === 'codeair', null, { timeout: 20000 })
await page.evaluate(() => {
  const d = window.openCodeBot.device
  d.addEventListener('data', (e) => { window.__sim.out += new TextDecoder('latin1').decode(e.detail) })
  d.addEventListener('program-error', (e) => window.__sim.errors.push(e.detail))
  d.sim.setSpeed(8)
})
const airCodes = await page.evaluate(() => {
  const { Blockly, toolboxFor, generatePython } = window.openCodeBotInternals
  const types = []
  const walk = (items) => { for (const it of items || []) { if (it.kind === 'block') types.push(it.type); if (it.contents) walk(it.contents) } }
  walk(toolboxFor('codeair').contents)
  const scratch = new Blockly.Workspace()
  const out = []
  for (const type of types.filter((t) => t.startsWith('codeair'))) {
    const block = scratch.newBlock(type)
    let code = generatePython(scratch, 'codeair')
    // a move alone would rightly fail on the ground: take off first
    if (/\nfly\.(?!take_off|land|steady)/.test(code)) code = code.replace(/\nfly\./, '\nfly.take_off(0.4)\nfly.')
    out.push([type, code])
    block.dispose(false)
  }
  scratch.dispose()
  return out
})
for (const [type, code] of airCodes) {
  const errs = await page.evaluate(async (code) => {
    const d = window.openCodeBot.device
    window.__sim.errors = []
    await d.run(code)
    const t0 = performance.now()
    while (d.state === 'running' && performance.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 25))
    if (d.state === 'running') await d.stop()
    return window.__sim.errors
  }, code)
  for (const e of errs) problems.push(`${type} ▸ ${e.name}: ${e.message} (line ${e.line})\n${code}`)
}
console.log(`sim-ui: ran ${airCodes.length} CodeAIR blocks on the simulator`)

// A flight at real speed: take off, light up, and see it in the air.
await page.evaluate(() => { window.openCodeBot.device.sim.reset(); window.openCodeBot.device.sim.setSpeed(1) })
await page.evaluate(() => window.openCodeBot.device.run(`from codeair import *
from flight import *
with recorder:
    pixels.fill(BLUE, 100)
    leds.set_mask(0b10101010, 255)
    fly.take_off(0.5)
    fly.turn_left(45)
    fly.steady(5)
    fly.land()
`))
await page.waitForFunction(() => (window.openCodeBot.device.sim.lastFrame?.devices[0].z ?? 0) > 0.45, null, { timeout: 15000 })
  .catch(() => problems.push('CodeAIR: it never got to 0.45 m'))
await page.waitForTimeout(1500)
await page.screenshot({ path: `${SHOT_DIR}/ocb-sim-codeair.png` })
await page.evaluate(() => window.openCodeBot.device.stop())
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 20000 })
const landed = await page.evaluate(() => window.openCodeBot.device.sim.lastFrame.devices[0].z)
if (landed > 0.08) problems.push(`CodeAIR: stopped inside with recorder:, it did not land (at ${landed} m)`)
else console.log('sim-ui: CodeAIR flew, and a stop landed it')
await browser.close()
server?.kill()

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('sim-ui: all good')
