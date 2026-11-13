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
// OCB_CHROMIUM: use an installed Chromium when Playwright's own is missing.
const browser = await chromium.launch(process.env.OCB_CHROMIUM ? { executablePath: process.env.OCB_CHROMIUM } : {})
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

// The settings panel: the gear opens it with focus inside; the keyboard sets
// a bus's gain, mute zeroes it; realism and the frame-rate readout follow;
// Music shows only with a track; Escape closes it back to the gear; the
// choices outlast a reload.
{
  await page.click('.sim-gear')
  const opened = await page.evaluate(() => ({
    open: !document.querySelector('.sim-settings').hidden,
    expanded: document.querySelector('.sim-gear').getAttribute('aria-expanded'),
    focus: document.activeElement?.closest('.sim-vol')?.dataset.bus,
    music: !document.querySelector('.sim-vol[data-bus="music"]').hidden,
  }))
  if (!opened.open || opened.expanded !== 'true' || opened.focus !== 'motors' || opened.music) problems.push(`settings: opened as ${JSON.stringify(opened)}`)
  const levels = () => page.evaluate(() => window.openCodeBot.device.sim.speaker.levels())
  const before = await levels()
  if (Math.abs(before.effects - 0.49) > 1e-3 || Math.abs(before.speaker - 0.64) > 1e-3) problems.push(`settings: default levels ${JSON.stringify(before)}`)
  await page.focus('.sim-vol[data-bus="effects"] input')
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft')
  await page.click('.sim-vol[data-bus="speaker"] .sim-mute')
  const after = await levels()
  if (Math.abs(after.effects - 0.25) > 1e-3 || after.speaker !== 0 || Math.abs(after.motors - before.motors) > 1e-3) problems.push(`settings: after effects 50 and speaker muted, levels ${JSON.stringify(after)}`)
  if (await page.getAttribute('.sim-vol[data-bus="speaker"] .sim-mute', 'aria-pressed') !== 'true') problems.push('settings: the speaker\'s mute does not say it is pressed')
  // the knocks play without a fault
  await page.evaluate(() => { const s = window.openCodeBot.device.sim.speaker; s.clatter(4.4); s.thump(0.5) })

  await page.selectOption('.sim-realism', 'low')
  await page.check('.sim-show-fps')
  await page.evaluate(() => window.openCodeBot.device.sim.view.setCamera('orbit'))   // something to draw
  await page.waitForTimeout(1200)
  const view = await page.evaluate(() => ({ level: window.openCodeBot.device.sim.view.level, ratio: window.openCodeBot.device.sim.view.ratio, overlay: document.querySelector('.sim-perf').hidden ? null : document.querySelector('.sim-perf').textContent }))
  if (view.level !== 'low' || view.ratio > 0.6 || !/fps/.test(view.overlay ?? '')) problems.push(`settings: realism low and frame rate shown gave ${JSON.stringify(view)}`)

  // a track (a quarter second of silence) brings the Music row and its credit
  const wav = (() => {
    const n = 2000, b = Buffer.alloc(44 + n * 2)
    b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16)
    b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28)
    b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
    return `data:audio/wav;base64,${b.toString('base64')}`
  })()
  await page.evaluate((url) => window.openCodeBot.device.sim.setMusic(url, 'A test track'), wav)
  await page.waitForFunction(() => window.openCodeBot.device.sim.speaker.track?.source, null, { timeout: 5000 }).catch(() => problems.push('settings: the music track did not start'))
  const music = await page.evaluate(() => ({ shown: !document.querySelector('.sim-vol[data-bus="music"]').hidden, credit: document.querySelector('.sim-credit').textContent }))
  if (!music.shown || music.credit !== 'A test track') problems.push(`settings: with a track, the Music row ${JSON.stringify(music)}`)
  await page.evaluate(() => window.openCodeBot.device.sim.setMusic(null))
  if (await page.evaluate(() => !document.querySelector('.sim-vol[data-bus="music"]').hidden)) problems.push('settings: the Music row stayed without a track')
  await page.screenshot({ path: `${SHOT_DIR}/ocb-sim-settings.png` })

  await page.keyboard.press('Escape')
  const closed = await page.evaluate(() => ({ hidden: document.querySelector('.sim-settings').hidden, focus: document.activeElement?.classList.contains('sim-gear') }))
  if (!closed.hidden || !closed.focus) problems.push(`settings: Escape gave ${JSON.stringify(closed)}`)

  // another tab of the same browser starts with the same settings
  const again = await context.newPage()
  await again.goto(URL, { waitUntil: 'networkidle' })
  await again.click('#btn-sim')
  await again.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 20000 })
  await again.click('.sim-gear')
  const kept = await again.evaluate(() => ({
    effects: document.querySelector('.sim-vol[data-bus="effects"] input').value,
    speakerMuted: document.querySelector('.sim-vol[data-bus="speaker"] .sim-mute').getAttribute('aria-pressed'),
    realism: document.querySelector('.sim-realism').value,
    showFps: document.querySelector('.sim-show-fps').checked,
    levels: window.openCodeBot.device.sim.speaker.levels(),
  }))
  if (kept.effects !== '50' || kept.speakerMuted !== 'true' || kept.realism !== 'low' || !kept.showFps || kept.levels.speaker !== 0) problems.push(`settings: not kept across a reload: ${JSON.stringify(kept)}`)
  // a phone: the panel fits, and nothing scrolls sideways
  await again.setViewportSize({ width: 360, height: 740 })
  await again.keyboard.press('Escape')
  await again.click('.sim-gear')
  await again.waitForTimeout(300)
  const fit = await again.evaluate(() => {
    const el = document.querySelector('.sim-settings')
    const r = el.getBoundingClientRect()
    const onTop = [0.1, 0.5, 0.9].every((f) => el.contains(document.elementFromPoint(r.left + r.width * f, r.top + 20)))
    return { left: r.left, right: r.right, height: r.height, width: innerWidth, scroll: document.documentElement.scrollWidth, onTop }
  })
  if (fit.left < 0 || fit.right > fit.width || fit.scroll > fit.width || fit.height < 200 || !fit.onTop) problems.push(`settings: at phone width ${JSON.stringify(fit)}`)
  await again.screenshot({ path: `${SHOT_DIR}/ocb-sim-settings-phone.png` })
  await again.close()

  // back to the defaults for what follows
  await page.click('.sim-gear')
  await page.click('.sim-vol[data-bus="speaker"] .sim-mute')
  await page.focus('.sim-vol[data-bus="effects"] input')
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
  await page.selectOption('.sim-realism', 'auto')
  await page.uncheck('.sim-show-fps')
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.openCodeBot.device.sim.setCamera('chase'))
  console.log('sim-ui: the settings panel sets each bus, realism and the frame-rate readout, and keeps them')
}

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

// Text mode: Run in the simulator runs the typed Python, not the blocks', and
// stepping marks the typed line itself (line n is the editor's line n).
{
  const typed = "from botcore import *\nprint('typed one')\nx = 2\nprint('typed', x * 3)\n"
  await page.click('[data-tab="python"]')
  await page.click('#btn-mode')
  await page.fill('#python-editor', typed)
  await page.click('[data-tab="sim"]')
  await page.evaluate(() => { window.__sim.out = '' })
  await page.click('#btn-run')
  await page.waitForFunction(() => /Program finished|stopped with an error/.test(document.getElementById('status-msg').textContent), null, { timeout: 20000 })
  const out = await page.evaluate(() => window.__sim.out)
  const ranTyped = /typed one/.test(out) && /typed 6/.test(out)
  const selected = () => page.evaluate(() => {
    const e = document.getElementById('python-editor')
    return e.value.slice(e.selectionStart, e.selectionEnd)
  })
  await page.click('.sim-step-line')
  await page.waitForFunction(() => window.openCodeBot.device.state === 'running', null, { timeout: 10000 })
  await page.waitForFunction(() => {
    const e = document.getElementById('python-editor')
    return e.selectionEnd > e.selectionStart
  }, null, { timeout: 10000 }).catch(() => {})
  const line1 = await selected()
  await page.click('.sim-step-line')
  await page.waitForFunction((was) => {
    const e = document.getElementById('python-editor')
    return e.value.slice(e.selectionStart, e.selectionEnd) !== was
  }, line1, { timeout: 5000 }).catch(() => {})
  const line2 = await selected()
  await page.evaluate(() => window.openCodeBot.device.stop())
  await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 20000 })
  // back to blocks for what follows (the typed changes are let go)
  await page.click('[data-tab="python"]')
  await page.click('#btn-mode')
  await page.click('#modal button[value="ok"]')
  await page.waitForFunction(() => window.openCodeBot.workspace.mode === 'blocks', null, { timeout: 5000 })
  await page.click('[data-tab="sim"]')
  if (!ranTyped || line1 !== 'from botcore import *' || line2 !== "print('typed one')") {
    problems.push(`text mode: ${JSON.stringify({ out: out.slice(-200), line1, line2 })}`)
  } else console.log('sim-ui: text mode ran the typed Python, and stepped it line by line in the editor')
}

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

// CodeAIR flies only in a build with its flight library (SIM_FLIGHT=1,
// sim/tools/flight-library.mjs), which serves the GPL's text with it.
// (A missing file answers with the app's page, so look for the text itself.)
const FLIGHT = await fetch(new globalThis.URL('licenses/GPL-2.0.txt', URL).href)
  .then((r) => r.text(), () => '').then((s) => s.includes('GNU GENERAL PUBLIC LICENSE'))
if (FLIGHT) {
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
} else {
  // Without it CodeAIR is not offered: the app says flight is coming, and
  // the boards page leaves it out.
  await page.evaluate(() => window.openCodeBot.device.disconnect())
  await page.evaluate(() => { window.openCodeBot._pickTarget('codeair') })
  await page.waitForTimeout(300)
  if (await page.evaluate(() => document.getElementById('modal')?.open)) await page.click('#modal button[value="ok"]')
  await page.click('#btn-sim')
  await page.waitForTimeout(500)
  if (!(await page.evaluate(() => document.body.innerText.includes('Flight simulation is coming')))) problems.push('no flight: picking CodeAIR did not say flight simulation is coming')
  if (await page.evaluate(() => window.openCodeBot.device.simulating)) problems.push('no flight: a CodeAIR started in the simulator')
  const boards = await context.newPage()
  await boards.goto(new globalThis.URL('boards.html?boards=codex,codeair', URL).href, { waitUntil: 'networkidle' })
  const kinds = await boards.evaluate(() => [...document.querySelector('.bd-kind').options].map((o) => o.value))
  if (kinds.includes('codeair')) problems.push(`no flight: the boards page offers ${kinds}`)
  if ((await boards.evaluate(() => window.boards.length)) !== 1) problems.push('no flight: the boards page started a CodeAIR board')
  await boards.close()
  console.log('sim-ui: no CodeAIR flight in this build: CodeAIR is not offered, and the app says flight is coming')
}
await browser.close()
server?.kill()

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('sim-ui: all good')
