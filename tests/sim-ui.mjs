/**
 * The simulator in the real app, in headless Chromium: start it, run every
 * CodeBot block's Python on it, run the starter project with the Run button,
 * and talk to the REPL. Run it after `npm run build` (and `npm run sim:assets`).
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

// Its own port, so it never meets another test's (or someone's) server.
const PORT = '4183'
const URL = process.env.OCB_URL || `http://localhost:${PORT}/`
const SHOT_DIR = process.env.OCB_SHOTS || 'tests/screenshots'

async function reachable(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok } catch { return false }
}
async function ensureServer() {
  if (await reachable(URL)) return null
  // its own process group, so stopping it stops vite and not only npx
  const proc = spawn('npx', ['vite', 'preview', '--port', PORT, '--strictPort'], { stdio: 'ignore', detached: true })
  const server = { kill: () => { try { process.kill(-proc.pid) } catch { /* gone */ } } }
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
process.on('exit', () => server?.kill())          // even when a step throws
if (!(await reachable(new globalThis.URL('sim-assets/env/gym/world.json', URL).href))) {
  console.log('sim-ui: skipped (no built simulator assets: npm run sim:assets, then npm run build)')
  server?.kill()
  process.exit(0)
}

const problems = []
// CHROME_PATH: use an installed Chromium when Playwright's own is missing.
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
// One context, so a second page is another tab of the same browser.
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
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

// A line course from the picker, and a follower on it, at 4x.
await page.selectOption('.sim-course', 'oval')
await page.waitForFunction(() => {
  const d = window.openCodeBot.device.sim.lastFrame?.devices[0]
  return d && Math.abs(d.x + 0.3) < 0.01 && Math.abs(d.y + 0.5) < 0.01
}, null, { timeout: 5000 }).catch(() => problems.push('course: the robot did not move to the oval\'s start'))
await page.evaluate(() => { window.openCodeBot.device.sim.setSpeed(4); window.__sim.errors = [] })
await page.evaluate(() => window.openCodeBot.device.run(`from botcore import *
motors.enable(True)
while True:
    s = ls.check()
    if s[2] or (s[1] and s[3]):
        motors.run(LEFT, 40)
        motors.run(RIGHT, 40)
    elif s[1] or s[0]:
        motors.run(LEFT, 10)
        motors.run(RIGHT, 45)
    elif s[3] or s[4]:
        motors.run(LEFT, 45)
        motors.run(RIGHT, 10)
`))
await page.evaluate(() => window.openCodeBot.device.sim.setCamera('top'))
await page.waitForTimeout(3000)
const onOval = await page.evaluate(() => {
  const d = window.openCodeBot.device.sim.lastFrame.devices[0]
  // the oval: straights at y = +-0.5 for |x| <= 0.6, half circles of 0.5 m beyond
  const ax = Math.max(0, Math.abs(d.x) - 0.6)
  return { at: [d.x, d.y], off: Math.abs(Math.hypot(ax, d.y) - 0.5) }
})
await page.screenshot({ path: `${SHOT_DIR}/ocb-sim-course.png` })
await page.evaluate(() => window.openCodeBot.device.stop())
await page.evaluate(() => window.openCodeBot.device.sim.setCourse(null))
if (onOval.off > 0.08) problems.push(`course: the follower left the oval (at ${onOval.at}, ${onOval.off.toFixed(2)} m off)`)
else console.log('sim-ui: a follower kept to the oval course')

// The other rooms, from the picker: each drawn, the robot at its start.
await page.evaluate(() => window.openCodeBot.device.sim.setCamera('chase'))
for (const room of ['classroom', 'cafeteria', 'auditorium', 'gym']) {
  await page.selectOption('.sim-room', room)
  const ok = await page.waitForFunction(async (id) => {
    const sim = window.openCodeBot.device.sim
    const s = (await (await fetch(`sim-assets/env/${id}/world.json`)).json()).spawns[0]
    const d = sim.lastFrame?.devices[0]
    return sim.view?.roomId === id && d && Math.abs(d.x - s.x) < 0.01 && Math.abs(d.y - s.y) < 0.01 && Math.abs(d.z - (s.z ?? 0)) < 0.01
  }, room, { timeout: 15000, polling: 200 }).catch(() => null)
  if (!ok) { problems.push(`rooms: the ${room} did not load, or the robot is not at its start`); continue }
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOT_DIR}/ocb-sim-${room}.png` })
}
if (!problems.some((p) => p.startsWith('rooms'))) console.log('sim-ui: the room picker moved the robot through every room')

// Without a mouse: the view is named and described for a screen reader,
// the keyboard turns the camera, and Space holds the board's button.
{
  const before = problems.length
  await page.focus('.sim-canvas')
  await page.waitForTimeout(1200)
  const a11y = await page.evaluate(() => {
    const c = document.querySelector('.sim-canvas')
    const desc = document.getElementById(c.getAttribute('aria-describedby'))
    return { label: c.getAttribute('aria-label'), desc: desc?.textContent ?? '', mode: window.openCodeBot.device.sim.cameraMode }
  })
  if (!/CodeBot/.test(a11y.label ?? '')) problems.push(`a11y: the 3D view's label is ${a11y.label}`)
  if (!/CodeBot in the gymnasium.*facing/.test(a11y.desc)) problems.push(`a11y: the 3D view's description is "${a11y.desc}"`)
  await page.keyboard.press('ArrowLeft')
  const turned = await page.evaluate(() => ({ mode: window.openCodeBot.device.sim.cameraMode, pressed: document.querySelector('.sim-chip[data-mode="orbit"]').getAttribute('aria-pressed') }))
  if (turned.mode !== 'orbit' || turned.pressed !== 'true') problems.push(`a11y: an arrow key left the camera in ${turned.mode} (orbit chip pressed: ${turned.pressed})`)
  await page.evaluate(() => { window.__sim.out = ''; window.openCodeBot.device.run('from botcore import *\nimport time\nwhile not buttons.was_pressed(0):\n    time.sleep(0.02)\nprint("held")') })
  await page.waitForTimeout(500)
  await page.focus('.sim-board-btn[data-n="0"]')
  await page.keyboard.down(' ')
  await page.waitForTimeout(150)
  await page.keyboard.up(' ')
  await page.waitForFunction(() => /held/.test(window.__sim.out), null, { timeout: 5000 }).catch(() => problems.push('a11y: Space on BTN 0 did not press button 0'))
  await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 5000 }).catch(() => {})
  await page.evaluate(() => window.openCodeBot.device.sim.setCamera('chase'))
  if (problems.length === before) console.log('sim-ui: the view is described, arrows turn the camera, and Space holds a board button')
}

// Step by line: from a stop the starter project pauses at its first line,
// marked in the Python tab and on its block; each step moves on a line.
await page.evaluate(() => window.openCodeBot.device.sim.setSpeed(1))
await page.click('.sim-step-line')
const marked = async () => page.evaluate(() => {
  const el = document.querySelector('#python-view .py-line.is-current')
  const ran = window.openCodeBot._ran
  const n = el ? Number(el.dataset.n) : null
  return { n, text: el?.textContent ?? null, block: n ? ran.blockAt[n] ?? null : null, state: window.openCodeBot.device.state }
})
await page.waitForSelector('#python-view .py-line.is-current', { state: 'attached', timeout: 10000 }).catch(() => {})
// The imports come first, with no block; step on to the blocks' lines.
const step = async () => {
  const before = (await marked()).n
  await page.click('.sim-step-line')
  await page.waitForFunction((n) => {
    const el = document.querySelector('#python-view .py-line.is-current')
    return el && Number(el.dataset.n) !== n
  }, before, { timeout: 5000 }).catch(() => {})
  return marked()
}
let first = await marked()
for (let i = 0; i < 8 && !first.block; i++) first = await step()
const second = await step()
await page.click('[data-tab="python"]').catch(() => {})
await page.screenshot({ path: `${SHOT_DIR}/ocb-sim-step.png` })
await page.click('[data-tab="sim"]').catch(() => {})
await page.evaluate(() => window.openCodeBot.device.stop())
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 20000 })
if (!first.n || !first.block || !second.n || second.n === first.n || !second.block) {
  problems.push(`step by line: ${JSON.stringify({ first, second })}`)
} else console.log(`sim-ui: stepped by line, ${first.n} then ${second.n} (${second.text.trim()}), on their blocks`)

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

// The boards page: a CodeX remote and a CodeAIR listener, each in its own
// worker, and the app's CodeX (still on this page's tab) listening too.
await page.evaluate(async () => {
  const d = window.openCodeBot.device
  await d.disconnect()
  await d.simulate('codex')
})
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 20000 })
await page.evaluate(() => window.openCodeBot.device.run(`import radio
from codex import *
radio.on()
radio.config(channel=7)
while True:
    m = radio.receive()
    if m:
        print('app heard', m)
`))
if (!(await page.isVisible('.sim-boards'))) problems.push('boards: no "More boards" link in the simulator bar for CodeX')
const boards = await context.newPage()
await boards.setViewportSize({ width: 1280, height: 900 })
boards.on('pageerror', (e) => problems.push(`boards page error: ${e.message}`))
boards.on('console', (m) => { if (m.type() === 'error') problems.push(`boards console error: ${m.text()}`) })
await boards.goto(new globalThis.URL('boards.html?boards=codex,codeair', URL).href, { waitUntil: 'networkidle' })
for (const b of await boards.$$('.bd-run')) await b.click()
await boards.waitForFunction(() => window.boards.every((b) => b.sim.state === 'running'), null, { timeout: 20000 })
await boards.waitForTimeout(500)
await boards.click('.bd-card:first-child .cx-A', { delay: 150 })
await boards.waitForFunction(() => {
  const p = window.boards[1].sim.lastFrame?.devices[0].pixels[0]
  return p && p[1] > 0 && p[0] === 0
}, null, { timeout: 5000 }).catch(() => problems.push('boards: the CodeAIR did not hear the CodeX remote'))
await page.waitForFunction(() => window.__sim.out.includes('app heard A'), null, { timeout: 5000 })
  .catch(() => problems.push('boards: the app, in another tab, did not hear the remote'))
await boards.waitForTimeout(300)
await boards.screenshot({ path: `${SHOT_DIR}/ocb-sim-boards.png` })
console.log('sim-ui: boards page: a CodeX remote reached a CodeAIR and the app in another tab')
await boards.close()

// CodeAIR's factory program and a CodeX remote: hold B to pair by infrared,
// then A takes off.
await page.evaluate(() => window.openCodeBot.device.stop())
const xfly = await context.newPage()
await xfly.setViewportSize({ width: 1280, height: 900 })
xfly.on('pageerror', (e) => problems.push(`xfly page error: ${e.message}`))
await xfly.goto(new globalThis.URL('boards.html?boards=codex:codeair-remote,codeair:xfly', URL).href, { waitUntil: 'networkidle' })
for (const b of await xfly.$$('.bd-run')) await b.click()
await xfly.waitForFunction(() => window.boards.every((b) => b.sim.state === 'running'), null, { timeout: 20000 })
// What each board prints, to wait on what happens rather than on the clock
// (a slow machine runs the boards slower than real time).
await xfly.evaluate(() => {
  window.__out = window.boards.map(() => '')
  window.boards.forEach((b, i) => b.sim.addEventListener('data', (e) => { window.__out[i] += new TextDecoder().decode(e.detail) }))
})
await xfly.waitForFunction(() => /No pairing found/.test(window.__out[1]), null, { timeout: 20000 })
  .catch(() => problems.push('xfly: the CodeAIR never began to seek a pairing'))
const holdB = xfly.locator('.bd-card:first-child .cx-B')
await holdB.dispatchEvent('pointerdown')
await xfly.waitForFunction(() => /Ctrl mode/.test(window.__out[1]), null, { timeout: 20000 })
  .catch(() => problems.push('xfly: holding B did not pair the CodeAIR'))
await xfly.waitForTimeout(1000)                       // the remote's ACKs, then its flight screen
await holdB.dispatchEvent('pointerup')
await xfly.waitForTimeout(500)
await xfly.click('.bd-card:first-child .cx-A', { delay: 150 })
const rose = await xfly.waitForFunction(() => (window.boards[1].sim.lastFrame?.devices[0].z ?? 0) > 0.3, null, { timeout: 15000 })
  .then(() => true, () => false)
await xfly.screenshot({ path: `${SHOT_DIR}/ocb-sim-xfly.png` })
if (!rose) problems.push('xfly: the CodeAIR did not pair and take off from the CodeX remote')
else console.log('sim-ui: a CodeX remote paired with CodeAIR\'s factory program by infrared and flew it')
await xfly.close()
await browser.close()
server?.kill()

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('sim-ui: all good')
