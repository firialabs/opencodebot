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

// A board's NeoPixels as drawn (led.js neoPixel): each one's lens in the cup
// in its part's top, as the model has it: a real cup found (shallower than
// the part, narrower than it), the lens no wider than the cup, over the
// part's middle, and from inside the part to just over its top face. A lens
// sized to the whole part, or floating over it, fails.
function lensesSeated() {
  const f = [...window.openCodeBot.device.sim.view.figures.values()][0]
  const out = []
  f.pixels.forEach((p, n) => {
    const { lens, part, mesh, facing } = p
    if (!lens || !part) { out.push(`pixel ${n}: no lens from its part`); return }
    const frame = mesh.parent
    frame.updateMatrixWorld(true)
    const inv = frame.matrixWorld.clone().invert()
    const V = mesh.position.constructor
    const lo = new V(Infinity, Infinity, Infinity), hi = new V(-Infinity, -Infinity, -Infinity)
    part.traverse((o) => {
      if (!o.isMesh) return
      const pos = o.geometry.attributes.position
      for (let i = 0; i < pos.count; i++) {
        const v = new V().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv)
        lo.min(v); hi.max(v)
      }
    })
    const g = mesh.geometry.parameters
    const top = facing > 0 ? hi.y : lo.y
    const face = mesh.position.y + facing * g.height / 2     // the lens's outer face
    const inner = mesh.position.y - facing * g.height / 2
    const off = Math.hypot(mesh.position.x - (lo.x + hi.x) / 2, mesh.position.z - (lo.z + hi.z) / 2)
    const fails = [
      !(lens.depth > 0 && lens.depth < hi.y - lo.y) && `cup depth ${lens.depth}`,
      !(lens.side < 0.9 * lens.body) && `cup ${lens.side} as wide as the part ${lens.body}`,
      !(g.width <= lens.side && g.depth <= lens.side) && `lens ${g.width} x ${g.depth} wider than its cup ${lens.side}`,
      !(off < 0.1 * lens.body) && `lens ${off} off the part's middle`,
      !(facing * (face - top) > 0 && facing * (face - top) < 0.25 * lens.depth) && `lens face ${face} not just over the top ${top}`,
      !(inner >= lo.y && inner <= hi.y) && `lens base ${inner} outside the part`,
    ].filter(Boolean)
    if (fails.length) out.push(`pixel ${n}: ${fails.join('; ')}`)
  })
  return out
}
// OCB_CHROMIUM: use an installed Chromium when Playwright's own is missing.
const browser = await chromium.launch(process.env.OCB_CHROMIUM ? { executablePath: process.env.OCB_CHROMIUM } : {})
// One context, so a second page is another tab of the same browser.
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
// OCB_SIM_VM=asyncify: the page finds no JSPI, as in Safari and Firefox, and so
// runs everything below on the Asyncify build (src/sim/support.js).
const FALLBACK = process.env.OCB_SIM_VM === 'asyncify'
if (FALLBACK) await context.addInitScript(() => { delete WebAssembly.Suspending; delete WebAssembly.promising })
const page = await context.newPage()
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console error: ${m.text()}`) })
await page.addInitScript((realism) => {
  localStorage.setItem('opencodebot.welcome.v1', 'off')
  localStorage.setItem('opencodebot.device.v1', 'codebot')
  if (realism) localStorage.setItem('opencodebot.simSettings.v1', JSON.stringify({ realism }))
  // Medium, as Auto started everywhere before it guessed from the graphics chip (it would start this software renderer at Low). OCB_REALISM picks another.
}, process.env.OCB_REALISM || 'medium')
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

// A click on a part of the board names it, by the CAD's name (parts.js), for
// mission packs' `pick` goals; a drag that turns the camera names nothing.
{
  await page.evaluate(() => { window.__picks = []; window.openCodeBot.device.sim.addEventListener('pick', (e) => window.__picks.push(e.detail)) })
  const centre = (name) => page.evaluate((name) => {
    const view = window.openCodeBot.device.sim.view
    const parts = [...view.figures.values()][0].parts
    const part = parts.boxes.find((b) => b.name === name)
    if (!part) return null
    const c = part.box.getCenter(part.box.min.clone())
    parts.model.localToWorld(c).project(view.camera)
    const r = view.renderer.domElement.getBoundingClientRect()
    return { x: r.left + ((c.x + 1) / 2) * r.width, y: r.top + ((1 - c.y) / 2) * r.height }
  }, name)
  const picked = async (act) => {
    await page.evaluate(() => (window.__picks.length = 0))
    await act()
    await page.waitForTimeout(100)
    return page.evaluate(() => window.__picks.slice())
  }
  await page.waitForTimeout(1500)
  const speaker = await centre('Cylinder') // the speaker, as CodeSpace's PWR pack names it
  if (!speaker) problems.push('pick: CodeBot has no part named Cylinder (codebot-body.parts.json)')
  else {
    const got = await picked(() => page.mouse.click(speaker.x, speaker.y))
    if (got.join() !== 'Cylinder') problems.push(`pick: a click on the speaker named ${got.join() || 'nothing'}, not Cylinder`)
    const dragged = await picked(async () => {
      await page.mouse.move(speaker.x, speaker.y)
      await page.mouse.down()
      await page.mouse.move(speaker.x + 60, speaker.y + 10, { steps: 5 })
      await page.mouse.up()
    })
    if (dragged.length) problems.push(`pick: a drag named ${dragged.join()}`)
    const button = await centre('Cylinder.006') // BTN-0's plunger, under its press target
    const pressed = button ? await picked(() => page.mouse.click(button.x, button.y)) : []
    if (!/^(Cylinder\.00[2456])|(Plane\.00[235689])$/.test(pressed.join())) problems.push(`pick: a click on BTN-0 named ${pressed.join() || 'nothing'}`)
    // The LEDs are the figure's own: user LED 3, by name.
    const led = await page.evaluate(() => {
      const view = window.openCodeBot.device.sim.view
      const c = [...view.figures.values()][0].leds.user[3].mesh.getWorldPosition(view.camera.position.clone()).project(view.camera)
      const r = view.renderer.domElement.getBoundingClientRect()
      return { x: r.left + ((c.x + 1) / 2) * r.width, y: r.top + ((1 - c.y) / 2) * r.height }
    })
    const lit = await picked(() => page.mouse.click(led.x, led.y))
    if (lit.join() !== 'LED_user_3') problems.push(`pick: a click on user LED 3 named ${lit.join() || 'nothing'}`)
    if (!problems.some((p) => p.startsWith('pick'))) console.log('sim-ui: a click names the part of CodeBot it lands on; a drag names none')
  }
}

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
await page.evaluate(() => {
  window.__sim.out = ''
  // This run's own start and end: the status line may still say how the last program ended.
  window.__run = { started: false, ended: false }
  window.openCodeBot.device.addEventListener('state', (e) => {
    if (e.detail.state === 'running') window.__run.started = true
    else if (window.__run.started) window.__run.ended = true
  })
})
await page.click('#btn-run')
await page.waitForFunction(() => window.__run.ended && /Program finished|stopped with an error/.test(document.getElementById('status-msg').textContent), null, { timeout: 20000 })
const status = await page.locator('#status-msg').textContent()
if (!/Program finished/.test(status)) problems.push(`starter project: ${status}`)
else console.log('sim-ui: the starter project ran to the end')

// The REPL, between programs.
// (Once the board is back at its prompt: typed before the >>>, the keys are lost, and a
// slow machine gets there later.)
// A program's end leaves the terminal at the prompt, with nothing after it, ready for typing.
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready' && />>> $/.test(window.__sim.out), null, { timeout: 20000 })
  .then(() => console.log('sim-ui: the terminal ends at a >>> prompt once a program ends'))
  .catch(async () => problems.push(`REPL: no >>> prompt after the program ended: ${JSON.stringify(await page.evaluate(() => window.__sim.out.slice(-80)))}`))
await page.evaluate(() => { window.__sim.out = ''; window.openCodeBot.device.sendRaw('print(6 * 7)\r') })
await page.waitForFunction(() => /42/.test(window.__sim.out), null, { timeout: 20000 }).catch(() => problems.push('REPL: no answer to print(6 * 7)'))

// The REPL as the terminal shows it: colours drawn, not printed; the arrows
// recall history on an empty prompt with no second prompt and no stray
// characters, a line longer than the terminal is wide included; and a paste
// of several commands, one of them waiting, runs them in turn.
{
  const before = problems.length
  const shown = () => page.evaluate(() => {
    const b = window.openCodeBot.terminal.term.buffer.active
    const rows = []
    for (let i = 0; i < b.length; i++) rows.push(b.getLine(i).translateToString(true))
    return rows.join('\n').trimEnd()
  })
  const lastRow = async () => (await shown()).split('\n').pop()
  const key = async (k) => { await page.evaluate((k) => window.openCodeBot.device.sendRaw(k), k); await page.waitForTimeout(400) }
  await page.evaluate(() => window.openCodeBot.terminal.clear())
  const long = `print("${'x'.repeat(140)}")`
  await key('print("\\x1b[31mRED\\x1b[0m and \\x1b[1;38;5;208mORANGE\\x1b[0m")\r')
  await key('1+1\r')
  await key(`${long}\r`)
  await key('2+2\r')
  const colour = await page.evaluate(() => {
    const b = window.openCodeBot.terminal.term.buffer.active
    for (let i = b.length - 1; i >= 0; i--) {
      const line = b.getLine(i), s = line.translateToString(true)
      if (s.startsWith('RED and ORANGE')) return { red: line.getCell(0).getFgColor(), orange: line.getCell(8).getFgColor(), bold: !!line.getCell(8).isBold() }
    }
    return null
  })
  if (!colour || colour.red !== 1 || colour.orange !== 208 || !colour.bold) problems.push(`REPL: colours not drawn (${JSON.stringify(colour)}): ${await shown()}`)
  await key('\x1b[A')
  if (await lastRow() !== '>>> 2+2') problems.push(`REPL: Up on an empty prompt gave "${await lastRow()}"`)
  await key('\x1b[A')
  await key('\x1b[B')
  if (await lastRow() !== '>>> 2+2') problems.push(`REPL: Up, Up, Down (from a line longer than the terminal) gave "${await lastRow()}"`)
  // (history goes on from the line on show: the long line, 1+1, the colours, then back to 1+1)
  await key('\x1b[A')
  await key('\x1b[A')
  await key('\x1b[A')
  await key('\x1b[B')
  if (await lastRow() !== '>>> 1+1') problems.push(`REPL: back through history and forward again gave "${await lastRow()}"`)
  await key('\r')
  await page.waitForTimeout(400)
  const end = (await shown()).split('\n').slice(-3)
  if (end.join('|') !== '>>> 1+1|2|>>>') problems.push(`REPL: running the recalled line gave ${JSON.stringify(end)}`)
  if (/\[A|\[B|>>> >>>/.test(await shown())) problems.push(`REPL: stray characters or a second prompt: ${await shown()}`)
  await page.evaluate(() => { window.__sim.out = ''; window.openCodeBot.device.sendRaw('import time\rtime.sleep(0.3)\rprint(6 * 7)\r') })
  await page.waitForFunction(() => /42\r\n>>> $/.test(window.__sim.out), null, { timeout: 15000 }).catch(async () => problems.push(`REPL: a paste of three commands gave ${JSON.stringify(await page.evaluate(() => window.__sim.out))}`))
  if (problems.length === before) console.log('sim-ui: the REPL draws colours, recalls history cleanly (a wrapped line too), and runs a pasted line after a waiting one')
}

// A program's input() reads a line typed at the terminal (Python Level 1): what it
// printed before shows while it waits, the keys are echoed, Backspace takes one back.
{
  await page.evaluate(() => { window.__sim.out = ''; window.openCodeBot.device.run('ages = {"Ann": 12}\nprint("ages:", ages)\nname = input("Name? ")\nprint("Hello,", name, ages["Ann"])\n') })
  const waiting = await page.waitForFunction(() => /ages: \{'Ann': 12\}\r\nName\? $/.test(window.__sim.out), null, { timeout: 15000 }).then(() => true, () => false)
  if (!waiting) problems.push(`input: the prompt, and what came before it, did not show while it waited (${JSON.stringify(await page.evaluate(() => window.__sim.out))})`)
  await page.evaluate(() => window.openCodeBot.device.sendRaw('Jilx\x7fl\r'))
  const answered = await page.waitForFunction(() => window.__sim.out.includes('Name? Jilx\b \bl\r\nHello, Jill 12'), null, { timeout: 15000 }).then(() => true, () => false)
  if (!answered) problems.push(`input: the typed line did not reach the program (${JSON.stringify(await page.evaluate(() => window.__sim.out))})`)
  else console.log('sim-ui: a program\'s input() reads a line typed at the terminal')
  await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 15000 }).catch(() => {})
}

// A program's print ends its line with CR LF, as a board's console does, so
// the terminal starts each line at the left (a bare LF would stair-step).
await page.evaluate(() => { window.__sim.out = '' })
await page.evaluate(() => window.openCodeBot.device.run("print('one')\nprint('two')\n"))
await page.waitForFunction(() => /two/.test(window.__sim.out) && window.openCodeBot.device.state === 'ready', null, { timeout: 10000 }).catch(() => {})
{
  const out = await page.evaluate(() => window.__sim.out)
  if (!/one\r\ntwo\r\n/.test(out) || /[^\r]\n/.test(out)) problems.push(`print line endings: ${JSON.stringify(out.slice(0, 120))}`)
  else console.log('sim-ui: print ends its lines with CR LF')
}

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
  await page.evaluate(() => window.openCodeBot.device.sim.view.setCamera('rotate'))   // something to draw
  await page.waitForTimeout(1200)
  const view = await page.evaluate(() => ({ level: window.openCodeBot.device.sim.view.level, ratio: window.openCodeBot.device.sim.view.ratio, overlay: document.querySelector('.sim-perf').hidden ? null : document.querySelector('.sim-perf').textContent }))
  if (view.level !== 'low' || view.ratio > 0.6 || !/fps/.test(view.overlay ?? '')) problems.push(`settings: realism low and frame rate shown gave ${JSON.stringify(view)}`)
  // The readout's words change as drawing starts and rests; the panel, anchored at its foot, keeps its size.
  const tall = await page.evaluate(async () => {
    const box = document.querySelector('.sim-settings'), pace = box.querySelector('.sim-pace')
    const h = []
    for (const words of ['Frame rate 60 a second; simulation 1.0× real time', 'Nothing moving, nothing drawn; simulation 1.0× real time']) {
      pace.textContent = words
      h.push(box.getBoundingClientRect().height)
    }
    return h
  })
  if (tall[0] !== tall[1]) problems.push(`settings: the panel changes height with the frame-rate readout (${tall.join(' to ')} px)`)

  // Resizing never paints an empty view: sizing a canvas clears it, so each
  // new size is drawn before the frame is painted. A ResizeObserver made after
  // the view's runs just after it, before the paint, and checks.
  await page.evaluate(() => {
    const v = window.openCodeBot.device.sim.view, r = v.renderer
    const log = (window.__resizeLog = { sized: 0, blank: 0, observed: 0, cleared: false })
    const setSize = r.setSize.bind(r), render = r.render.bind(r)
    r.setSize = (...a) => { log.sized++; log.cleared = true; return setSize(...a) }
    r.render = (...a) => { log.cleared = false; return render(...a) }
    new ResizeObserver(() => { log.observed++; if (log.cleared) log.blank++ }).observe(v.host)
  })
  const vp = page.viewportSize()
  for (const dw of [-40, -80, -120, -60, 0]) {
    await page.setViewportSize({ width: vp.width + dw, height: vp.height + dw / 2 })
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  }
  const sizedBefore = await page.evaluate(() => window.__resizeLog.sized)
  await page.evaluate(() => window.openCodeBot.device.sim.view.resize())
  const resized = await page.evaluate(() => window.__resizeLog)
  if (resized.observed < 4 || resized.blank) problems.push(`resize: the view showed empty while resized ${JSON.stringify(resized)}`)
  if (resized.sized !== sizedBefore) problems.push('resize: sizing to the size it has cleared the view')
  else console.log(`sim-ui: resized ${resized.observed} times, drawn at once each time`)

  // a track (a quarter second of silence) brings the Music row and its credit
  const wav = (() => {
    const n = 2000, b = Buffer.alloc(44 + n * 2)
    b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16)
    b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28)
    b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
    return `data:audio/wav;base64,${b.toString('base64')}`
  })()
  await page.evaluate((url) => window.openCodeBot.device.sim.setMusic(url, 'A test track'), wav)
  await page.waitForFunction(() => window.openCodeBot.device.sim.speaker.track?.source, null, { timeout: 15000 }).catch(() => problems.push('settings: the music track did not start'))
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
  // The simulator was on: it comes back by itself, without a click.
  await again.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 20000 })
    .then(() => console.log('sim-ui: the simulator came back on a new page, as it was left'))
    .catch(() => problems.push('panels: the simulator did not come back on a new page'))
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
}, null, { timeout: 15000 }).catch(() => problems.push('course: the robot did not move to the oval\'s start'))
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
await page.evaluate(() => window.openCodeBot.device.sim.setCamera('universal'))   // from high above
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

// CodeBot's LEDs as drawn: a lit user LED red, a lit line sensor LED green,
// an unlit one its pale lens (never a black box).
await page.evaluate(() => window.openCodeBot.device.run('from botcore import *\nleds.user(1)\nleds.ls(1)\nwhile True:\n    pass\n'))
const cbLeds = await page.waitForFunction(() => {
  const f = [...window.openCodeBot.device.sim.view.figures.values()][0]
  const rgb = (c) => c.toArray().map((v) => +v.toFixed(2))
  const u = f.leds.user
  return u[0].mat.emissive.r > 0 && { user0: rgb(u[0].mat.emissive), ls0: rgb(f.leds.ls[0].mat.emissive), user1: rgb(u[1].mat.color), user1Glow: rgb(u[1].mat.emissive) }
}, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null)
await page.evaluate(() => window.openCodeBot.device.stop())
const redOf = ([r, g, b]) => r > 0.5 && g < r / 3 && b < r / 3
const greenOf = ([r, g, b]) => g > 0.5 && r < g / 3 && b < g / 3
if (!cbLeds || !redOf(cbLeds.user0) || !greenOf(cbLeds.ls0) || Math.min(...cbLeds.user1) < 0.5 || Math.max(...cbLeds.user1Glow) > 0) problems.push(`CodeBot LEDs: drawn ${JSON.stringify(cbLeds)}`)
else console.log('sim-ui: CodeBot\'s LEDs lit red and green, unlit ones pale')

// A click on the model's BTN-1 presses it, as the bar's button does (and the
// camera stays put); while held it is drawn down.
{
  await page.evaluate(() => window.openCodeBot.device.run('from botcore import *\nwhile not buttons.was_pressed(1):\n    pass\n'))
  await page.waitForTimeout(1000)
  const at =await page.evaluate(() => window.openCodeBot.device.sim.view.keyPoint(1))
  const cam = await page.evaluate(() => window.openCodeBot.device.sim.view.camera.position.toArray().join())
  if (!at) problems.push('CodeBot: no BTN-1 on the model')
  else {
    const restY = await page.evaluate(() => [...window.openCodeBot.device.sim.view.figures.values()][0].keys.keys.get(1).meshes[0].position.y)
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    const down = await page.waitForFunction((y) => [...window.openCodeBot.device.sim.view.figures.values()][0].keys.keys.get(1).meshes[0].position.y < y, restY, { timeout: 3000 }).then(() => true, () => false)
    await page.mouse.up()
    if (!down) problems.push('CodeBot: BTN-1 was not drawn down while held')
    await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 15000 })
      .then(() => console.log('sim-ui: a click on the CodeBot model pressed its BTN-1'), () => problems.push('CodeBot: a click on the model did not press BTN-1'))
    if ((await page.evaluate(() => window.openCodeBot.device.sim.view.camera.position.toArray().join())) !== cam) problems.push('CodeBot: pressing a button on the model turned the camera')
  }
}

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
  // in chase, left turns it round the robot, and it stays in chase
  const camAt = () => page.evaluate(() => window.openCodeBot.device.sim.view.camera.position.toArray())
  const camBefore = await camAt()
  await page.keyboard.press('ArrowLeft')
  const turned = await page.evaluate(() => ({ mode: window.openCodeBot.device.sim.view.cameraMode, turn: window.openCodeBot.device.sim.view.rig.chase.turn, menu: document.querySelector('.sim-camera').value }))
  const camAfter = await camAt()
  if (turned.mode !== 'chase' || turned.menu !== 'chase' || Math.abs(turned.turn + 0.2) > 0.01 || Math.hypot(camAfter[0] - camBefore[0], camAfter[2] - camBefore[2]) < 0.02) problems.push(`a11y: an arrow key in chase gave ${JSON.stringify(turned)} (camera ${camBefore} to ${camAfter})`)
  await page.evaluate(() => { window.__sim.out = ''; window.openCodeBot.device.run('from botcore import *\nimport time\nwhile not buttons.was_pressed(0):\n    time.sleep(0.02)\nprint("held")') })
  await page.waitForTimeout(500)
  await page.focus('.sim-board-btn[data-n="0"]')
  await page.keyboard.down(' ')
  await page.waitForTimeout(150)
  await page.keyboard.up(' ')
  await page.waitForFunction(() => /held/.test(window.__sim.out), null, { timeout: 15000 }).catch(() => problems.push('a11y: Space on BTN 0 did not press button 0'))
  await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 15000 }).catch(() => {})
  await page.evaluate(() => window.openCodeBot.device.sim.setCamera('chase'))
  if (problems.length === before) console.log('sim-ui: the view is described, arrows turn the camera, and Space holds a board button')
}

// A steady drive, followed by the chase camera, moves steadily on screen: the
// robot is drawn on a playout clock in simulated time, not by when each
// snapshot arrived, and the camera eases by time (camera-rig.js). Measured on
// the frames themselves, the drawing left out so the page keeps its frame
// rate without a graphics chip. (Drawn by arrival, the robot's step from one
// frame to the next varied by half, and four frames in ten were a third off.)
{
  await page.evaluate(() => {
    const view = window.openCodeBot.device.sim.view
    window.openCodeBot.device.sim.setSpeed(1)          // at real time (the course check above left it at 4x)
    window.openCodeBot.device.sim.setCamera('chase', { turn: 150 })
    window.__steady = []
    window.__draw = view.renderer.render
    view.renderer.render = (scene, cam) => {
      const p = [...view.figures.values()][0].root.position
      window.__steady.push({ now: performance.now(), bx: p.x, bz: p.z, cx: cam.position.x, cz: cam.position.z })
    }
    window.openCodeBot.device.run('from botcore import *\nimport time\nmotors.enable(True)\nmotors.run(LEFT, 50)\nmotors.run(RIGHT, 50)\ntime.sleep(4)\nmotors.run(LEFT, 0)\nmotors.run(RIGHT, 0)\n')
  })
  await page.waitForTimeout(6000)
  await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 15000 }).catch(() => {})
  const steady = await page.evaluate(() => {
    const view = window.openCodeBot.device.sim.view
    view.renderer.render = window.__draw
    const r = window.__steady
    const v = []
    for (let i = 1; i < r.length; i++) {
      const a = r[i - 1], b = r[i], dt = (b.now - a.now) / 1000
      v.push({ at: b.now, bot: Math.hypot(b.bx - a.bx, b.bz - a.bz) / dt, cam: Math.hypot(b.cx - a.cx, b.cz - a.cz) / dt })
    }
    const moving = v.filter((x) => x.bot > 0.05)
    if (moving.length < 10) return { frames: 0, drawn: r.length, moving: moving.length }
    const t0 = moving[0].at, t1 = moving[moving.length - 1].at
    if (t1 - t0 < 3000) return { frames: 0, drawn: r.length, moving: moving.length, ms: Math.round(t1 - t0) }
    const mid = v.filter((x) => x.at > t0 + 1500 && x.at < t1 - 1000)
    const spread = (xs) => { const m = xs.reduce((s, x) => s + x, 0) / xs.length; return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length) / m }
    const bot = mid.map((x) => x.bot)
    const med = [...bot].sort((a, b) => a - b)[Math.floor(bot.length / 2)]
    return { frames: mid.length, bot: spread(bot), cam: spread(mid.map((x) => x.cam)), off: bot.filter((x) => Math.abs(x - med) > med / 3).length / bot.length }
  })
  if (!(steady.frames >= 20 && steady.bot < 0.1 && steady.cam < 0.1 && steady.off < 0.1)) problems.push(`chase: a steady drive is not drawn steadily ${JSON.stringify(steady)}`)
  else console.log(`sim-ui: a steady drive in chase is drawn steadily (the robot's speed varies ${Math.round(steady.bot * 100)}% frame to frame, the camera's ${Math.round(steady.cam * 100)}%)`)
  await page.evaluate(() => { window.openCodeBot.device.sim.setCamera('chase'); window.openCodeBot.device.sim.setSpeed(4) })
}

// The camera menu: each of CodeSpace's four where it should be for the robot,
// Universal flown by the keyboard, and Center back to the camera's home.
{
  const before = problems.length
  // the camera's distance from the robot, and its height above it
  const where = () => page.evaluate(() => {
    const v = window.openCodeBot.device.sim.view
    const d = window.openCodeBot.device.sim.lastFrame.devices[0]
    const c = v.camera.position
    return { mode: v.cameraMode, far: Math.hypot(c.x - d.x, c.z + d.y), up: c.y - (d.z ?? 0), at: c.toArray() }
  })
  const want = { rotate: [0.25, 0.45], chase: [0.25, 0.35], universal: [0.6, 0.8], attached: [0.1, 0.16] }
  for (const [mode, [lo, hi]] of Object.entries(want)) {
    await page.selectOption('.sim-camera', mode)
    const w = await where()
    if (w.mode !== mode || w.far < lo || w.far > hi) problems.push(`cameras: ${mode} put the camera ${JSON.stringify(w)}`)
  }
  await page.selectOption('.sim-camera', 'universal')
  await page.focus('.sim-canvas')
  const from = await where()
  await page.keyboard.down('w')
  await page.waitForFunction((y) => window.openCodeBot.device.sim.view.camera.position.y < y - 0.05, from.at[1], { timeout: 15000 })
    .catch(() => problems.push('cameras: W did not fly the universal camera forward'))
  await page.keyboard.up('w')
  await page.selectOption('.sim-camera', 'rotate')
  const home = await where()
  await page.focus('.sim-canvas')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  const moved = await where()
  await page.click('.sim-center')
  const back = await where()
  const gap = (a, b) => Math.hypot(...a.at.map((v, i) => v - b.at[i]))
  if (gap(moved, home) < 0.05 || gap(back, home) > 0.01) problems.push(`cameras: center did not bring rotate home (${JSON.stringify({ home, moved, back })})`)
  if (await page.inputValue('.sim-camera') !== 'rotate') problems.push('cameras: the menu does not show rotate')
  await page.evaluate(() => window.openCodeBot.device.sim.setCamera('chase'))
  if (problems.length === before) console.log('sim-ui: the four cameras sit where they should, Universal flies, and Center brings one home')
}

// The run controls: at rest Run alone; running, Stop and Pause; paused, Step
// too, and Pause and Step stay until the program stops.
const shown = () =>
  page.evaluate(() => ['btn-run', 'btn-stop', 'btn-pause', 'btn-step'].filter((id) => !document.getElementById(id).hidden).join(' '))
const runPaused = async () => {
  await page.click('#btn-run')
  await page.waitForFunction(() => window.openCodeBot.device.state === 'running', null, { timeout: 10000 })
  const running = await shown()
  await page.click('#btn-pause')
  await page.waitForFunction(() => window.openCodeBot.device.sim.paused, null, { timeout: 10000 }).catch(() => {})
  return running
}

// Step by line: Run, Pause, then Step: the paused line is marked in the
// Python and on its block; each step moves on a line.
await page.evaluate(() => {
  const sim = window.openCodeBot.device.sim
  sim.setSpeed(1)
  sim.addEventListener('line', (e) => { window.__line = e.detail.line })
})
const atRest = await shown()
const whileRunning = await runPaused()
const whilePaused = await shown()
// The paused line, as the simulator reports it, and the block it is marked on.
const marked = async () => page.evaluate(() => {
  const app = window.openCodeBot
  const ran = app._ran
  const n = window.__line ?? null
  const block = n ? ran.blockAt[n] ?? null : null
  return { n, text: n ? ran.code.split('\n')[n - 1] : null, block, lit: !!block && app.workspace.workspace.getBlockById(block)?.isHighlighted?.() !== false, state: app.device.state }
})
await page.waitForFunction(() => window.__line, null, { timeout: 10000 }).catch(() => {})
// The imports come first, with no block; step on to the blocks' lines.
const step = async () => {
  const before = (await marked()).n
  await page.click('#btn-step')
  await page.waitForFunction((n) => window.__line && window.__line !== n, before, { timeout: 5000 }).catch(() => {})
  return marked()
}
let first = await marked()
for (let i = 0; i < 8 && !first.block; i++) first = await step()
const second = await step()
await page.screenshot({ path: `${SHOT_DIR}/ocb-sim-step.png` })
await page.evaluate(() => window.openCodeBot.device.stop())
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 20000 })
// Resumed, Step stays; stopped, Run alone (a program that runs on, so it is
// still running when resumed).
await page.evaluate(() => window.openCodeBot.device.run('import time\nwhile True:\n    time.sleep(0.1)\n'))
await page.waitForFunction(() => window.openCodeBot.device.state === 'running', null, { timeout: 10000 })
await page.click('#btn-pause')
await page.waitForFunction(() => window.openCodeBot.device.sim.paused, null, { timeout: 10000 }).catch(() => {})
await page.click('#btn-pause') // Resume
await page.waitForFunction(() => !window.openCodeBot.device.sim.paused, null, { timeout: 15000 }).catch(() => {})
const resumed = await shown()
await page.click('#btn-stop')
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 20000 })
const stopped = await shown()
const buttons = { atRest, whileRunning, whilePaused, resumed, stopped }
if (atRest !== 'btn-run' || whileRunning !== 'btn-stop btn-pause' || whilePaused !== 'btn-stop btn-pause btn-step' ||
    resumed !== 'btn-stop btn-pause btn-step' || stopped !== 'btn-run') {
  problems.push(`run controls: ${JSON.stringify(buttons)}`)
} else console.log('sim-ui: Run alone at rest; Stop and Pause running; Step once paused, until stopped')
if (!first.n || !first.block || !second.n || second.n === first.n || !second.block) {
  problems.push(`step by line: ${JSON.stringify({ first, second })}`)
} else console.log(`sim-ui: stepped by line, ${first.n} then ${second.n} (${second.text.trim()}), on their blocks`)

// Text mode: Run in the simulator runs the typed Python, not the blocks', and
// stepping marks the typed line itself (line n is the editor's line n).
{
  // The sleep gives Pause a moment to land in.
  const typed = "from botcore import *\nfrom time import sleep\nsleep(2)\nprint('typed one')\nx = 2\nprint('typed', x * 3)\n"
  await page.click('#btn-view')
  await page.evaluate((text) => { window.openCodeBot.pythonEditor.value = text }, typed)
  await page.evaluate(() => { window.__sim.out = '' })
  await page.click('#btn-run')
  await page.waitForFunction(() => /Program finished|stopped with an error/.test(document.getElementById('status-msg').textContent), null, { timeout: 20000 })
  const out = await page.evaluate(() => window.__sim.out)
  const ranTyped = /typed one/.test(out) && /typed 6/.test(out)
  const selected = () => page.evaluate(() => window.openCodeBot.pythonEditor.selectedText)
  await runPaused()
  await page.waitForFunction(() => window.openCodeBot.pythonEditor.selectedText, null, { timeout: 10000 }).catch(() => {})
  const line1 = await selected()
  const marked1 = await page.isVisible('#python-editor .cm-run-line')
  await page.click('#btn-step')
  // Wait for the next line to be marked, not just for a change.
  await page.waitForFunction((was) => {
    const now = window.openCodeBot.pythonEditor.selectedText
    return now && now !== was
  }, line1, { timeout: 10000 }).catch(() => {})
  const line2 = await selected()
  await page.evaluate(() => window.openCodeBot.device.stop())
  await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 20000 })
  // back to blocks for what follows (the typed Python becomes blocks)
  await page.click('#btn-view')
  await page.waitForFunction(() => window.openCodeBot.workspace.mode === 'blocks', null, { timeout: 15000 })
  if (!ranTyped || line1 !== 'sleep(2)' || line2 !== "print('typed one')" || !marked1) {
    problems.push(`text mode: ${JSON.stringify({ out: out.slice(-200), line1, line2, marked1 })}`)
  } else console.log('sim-ui: text mode ran the typed Python, and stepped it line by line in the editor')
}

// CodeX: switch boards, run every CodeX block, draw, and press a button
// with the keyboard.
await page.click('#btn-sim')                                   // stop simulating CodeBot
await page.evaluate(() => { window.openCodeBot._pickTarget('codex') })
await page.waitForTimeout(300)
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
  // codex_mp3 plays one of the CodeX's own sound files: in the simulator, a second of
  // silence (src/sim/python/codex/audiomp3.py), with no error, like every other block.
  if (type === 'codex_mp3' && !code.includes("audio.mp3('sounds/welcome')")) problems.push(`codex_mp3: expected audio.mp3('sounds/welcome')\n${code}`)
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
await page.focus('.sim-canvas')
await page.keyboard.down('a')
await page.waitForTimeout(150)
await page.keyboard.up('a')
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 15000 }).catch(() => problems.push('CodeX: the A key did not press button A'))
const green = await page.evaluate(() => window.openCodeBot.device.sim.view.screenRGB(120, 20))
if (!(green[1] > 200 && green[0] < 50)) problems.push(`CodeX: the screen is ${green}, not green`)
else console.log('sim-ui: CodeX drew, and the keyboard pressed its A button')
{
  const cxPixel = await page.evaluate(() => [...window.openCodeBot.device.sim.view.figures.values()][0].pixels[0].mat.emissive.toArray())
  const cxLens = await page.evaluate(lensesSeated)
  // red, hot past full (led.js hot): toward white, red still well ahead
  if (!(cxPixel[0] > 0.5 && cxPixel[1] < 0.4 * cxPixel[0] && cxPixel[2] < 0.4 * cxPixel[0]) || cxLens.length) problems.push(`CodeX NeoPixels: lit ${cxPixel}; ${cxLens.join(' | ')}`)
  else console.log('sim-ui: CodeX\'s NeoPixels lit red in the cup in each one\'s top')
}
await page.screenshot({ path: `${SHOT_DIR}/ocb-sim-codex.png` })

// A click on the model's B key presses it (and does not turn the camera).
await page.evaluate(() => window.openCodeBot.device.run(`from codex import *
while not buttons.was_pressed(BTN_B):
    pass
`))
await page.waitForTimeout(1000)
const keyB = await page.evaluate(() => window.openCodeBot.device.sim.view.keyPoint(5))
const camBefore = await page.evaluate(() => window.openCodeBot.device.sim.view.camera.position.toArray().join())
await page.mouse.move(keyB.x, keyB.y)
await page.mouse.down()
await page.mouse.move(keyB.x + 30, keyB.y + 10, { steps: 3 })
await page.waitForTimeout(150)
await page.mouse.up()
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 15000 })
  .then(() => console.log('sim-ui: a click on the CodeX model pressed its B key'), () => problems.push('CodeX: a click on the model did not press button B'))
if ((await page.evaluate(() => window.openCodeBot.device.sim.view.camera.position.toArray().join())) !== camBefore) problems.push('CodeX: pressing a key on the model turned the camera')

// CodeX's reset is on its back: a click on the face over it does not reach it.
{
  await page.evaluate(() => window.openCodeBot.device.run('while True:\n    pass\n'))
  await page.waitForTimeout(800)
  const at = await page.evaluate(() => window.openCodeBot.device.sim.view.keyPoint('reset'))
  await page.mouse.click(at.x, at.y)
  await page.waitForTimeout(800)
  const still = await page.evaluate(() => [window.openCodeBot.device.state, window.openCodeBot.device.sim.lastFrame.devices[0].reset])
  if (still[0] !== 'running' || still[1]) problems.push(`CodeX: a click on the face reached the reset on its back (${still})`)
  else console.log('sim-ui: CodeX\'s reset, on its back, is not pressed through the board')
  await page.evaluate(() => window.openCodeBot.device.stop())
}

// Tilt: a drag on a rotation arrow tilts the CodeX (the model turns, the
// accelerometer reads it, the camera stays); Shift and an arrow key tilt it
// too, and Home sets it level. No sliders in the bar.
{
  const before = problems.length
  if (await page.$('.sim-tilt-x, .sim-tilt-y')) problems.push('tilt: the bar still has tilt sliders')
  await page.evaluate(() => { window.__sim.out = ''; window.openCodeBot.device.run(`from codex import *
import time
while True:
    print('A', *accel.read())
    time.sleep(0.1)
`) })
  // the program's latest reading, once one passes `ok`
  const reads = (ok, what) => page.waitForFunction((src) => {
    const m = [...window.__sim.out.matchAll(/A (-?\d+) (-?\d+) (-?\d+)/g)].pop()
    if (!m) return false
    const [x, y, z] = m.slice(1).map(Number)
    return new Function('x', 'y', 'z', `return ${src}`)(x, y, z) && [x, y, z]
  }, ok, { timeout: 5000 }).then((h) => h.jsonValue(), async () => { problems.push(`tilt: ${what} (last: ${(await page.evaluate(() => window.__sim.out)).trim().split('\n').pop()})`); return null })
  const tiltNow = () => page.evaluate(() => {
    const v = window.openCodeBot.device.sim.view
    const f = v._tiltFigure()
    return { world: window.openCodeBot.device.sim.lastFrame.devices[0].tilt, model: [f.tilt.rotation.y, f.tilt.rotation.x], cam: v.camera.position.toArray().join() }
  })
  await reads('Math.abs(x) < 1500 && z < -14000', 'flat did not read flat')
  const drag = async (axis, dx, dy) => {
    const p = await page.evaluate((a) => window.openCodeBot.device.sim.view.arrowPoint(a), axis)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move(p.x + dx, p.y + dy, { steps: 6 })
    await page.mouse.up()
  }
  const cam0 = (await tiltNow()).cam
  await drag('x', 60, 0)               // the arc under it, to the right: right edge down
  await page.waitForFunction(() => Math.abs(window.openCodeBot.device.sim.lastFrame.devices[0].tilt[0] - 0.6) < 0.05, null, { timeout: 15000 }).catch(() => {})
  // (readings are along the silkscreen's axes, x right and y down, and
  // against gravity: an edge down reads below zero on its axis)
  await reads('x < -7000', 'a drag to the right on the lower arrow did not read right edge down')
  await drag('y', 0, 40)               // the arc at its right, down: bottom edge down
  await reads('x < -6000 && y < -4000', 'a drag down on the right arrow did not read bottom edge down')
  const t = await tiltNow()
  if (Math.abs(t.world[0] - 0.6) > 0.05 || Math.abs(t.world[1] - 0.4) > 0.05) problems.push(`tilt: dragged to ${t.world}, not 0.6, 0.4`)
  if (Math.abs(t.model[0] - t.world[0]) > 0.01 || Math.abs(t.model[1] - t.world[1]) > 0.01) problems.push(`tilt: the model turned to ${t.model}, the board is at ${t.world}`)
  if (t.cam !== cam0) problems.push('tilt: a drag on an arrow turned the camera')
  await page.screenshot({ path: `${SHOT_DIR}/ocb-sim-codex-tilt.png` })
  await page.focus('.sim-canvas')
  await page.keyboard.press('Home')
  await reads('Math.abs(x) < 1500 && Math.abs(y) < 1500', 'Home did not set it level')
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Shift+ArrowLeft')
  await reads('x > 2000 && Math.abs(y) < 1500', 'Shift+Left did not tilt the left edge down')
  const k = await tiltNow()
  if (Math.abs(k.world[0] + Math.PI / 18) > 0.01) problems.push(`tilt: two Shift+Left presses gave ${k.world}`)
  await page.keyboard.press('Home')
  await page.evaluate(() => window.openCodeBot.device.stop())
  if (problems.length === before) console.log('sim-ui: dragging CodeX\'s rotation arrows tilts it, Shift and the arrows too, Home levels it')
}

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
    leds.set_status(255)
    fly.take_off(0.5)
    fly.turn_left(45)
    fly.steady(5)
    fly.land()
`))
  await page.waitForFunction(() => (window.openCodeBot.device.sim.lastFrame?.devices[0].z ?? 0) > 0.45, null, { timeout: 15000 })
    .catch(() => problems.push('CodeAIR: it never got to 0.45 m'))
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOT_DIR}/ocb-sim-codeair.png` })
  // its LEDs as drawn: BYTE 1, 3, 5, 7 lit blue, the others their pale lens,
  // STA green, the pixels blue; every LED on the board (whose top is 17.2 mm
  // up the model), none floating above it
  const air = await page.evaluate(() => {
    const f = [...window.openCodeBot.device.sim.view.figures.values()][0]
    const rgb = (c) => c.toArray().map((v) => +v.toFixed(2))
    return {
      lit: f.leds.slice(0, 8).map((l) => rgb(l.mat.emissive)),
      sta: rgb(f.leds[8].mat.emissive),
      lens: rgb(f.leds[0].mat.color),
      pixel: rgb(f.pixels[0].mat.emissive),
      heights: [...f.leds, ...f.pixels].map((l) => +(l.mesh.position.y * 1000).toFixed(1)),
    }
  })
  const blueOf = ([r, g, b]) => b > 0.5 && r < b / 2
  const greenOfAir = ([r, g, b]) => g > 0.5 && r < g / 3 && b < g / 3
  const seated = air.heights.every((y) => (y > 17 && y < 19.5) || (y > 14 && y < 15.4))
  if (!air.lit.every((c, n) => (n % 2 ? blueOf(c) : Math.max(...c) === 0)) || !greenOfAir(air.sta) || Math.min(...air.lens) < 0.5 || !blueOf(air.pixel) || !seated) {
    problems.push(`CodeAIR LEDs: drawn ${JSON.stringify(air)}`)
  } else console.log('sim-ui: CodeAIR\'s LEDs lit blue on the board and STA green, unlit ones pale')
  const airLens = await page.evaluate(lensesSeated)
  if (airLens.length) problems.push(`CodeAIR NeoPixels: ${airLens.join(' | ')}`)
  else console.log('sim-ui: CodeAIR\'s NeoPixels lit in the cup in each one\'s top, above and below the arms')
  await page.evaluate(() => window.openCodeBot.device.stop())
  await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 20000 })
  const landed = await page.evaluate(() => window.openCodeBot.device.sim.lastFrame.devices[0].z)
  if (landed > 0.08) problems.push(`CodeAIR: stopped inside with recorder:, it did not land (at ${landed} m)`)
  else console.log('sim-ui: CodeAIR flew, and a stop landed it')

  // A close look: the wheel brings the camera within 3 cm of the board, and
  // the near plane comes in with it (nothing cut away).
  {
    const box = await (await page.$('.sim-canvas')).boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(20) }
    const close = await page.waitForFunction(() => {
      const v = window.openCodeBot.device.sim.view
      const d = v.camera.position.distanceTo(v.controls.target)
      return d < 0.035 && { d, near: v.camera.near, aimY: v.controls.target.y }
    }, null, { timeout: 15000 }).then((h) => h.jsonValue(), () => null)
    if (!close || close.near > close.d * 0.2 || close.aimY > 0.03) problems.push(`CodeAIR: no close look at the board (${JSON.stringify(close)})`)
    else console.log('sim-ui: the camera comes within 3 cm of CodeAIR\'s board')
    await page.evaluate(() => window.openCodeBot.device.sim.setCamera('rotate'))
  }

  // A click on the model's BTN-0 presses it; a click on its reset holds the
  // board in reset (LEDs off) and, let go, runs the program again from the top.
  {
    const before = problems.length
    // Held for at least holdMs; with `whileHeld`, held until `until` is true of what it
    // returns (or 10 s pass), so a slow machine (the deploy's runner) gets there in its
    // own time rather than being read at a fixed moment. Returns the last reading.
    // Where a key is on the page once it has stopped moving there: the camera eases after a
    // change of view, and Chase follows a board in flight, so a point read once can be stale
    // by the time the mouse presses it.
    const steadyPoint = async (n) => {
      let last = null
      for (const t0 = Date.now(); Date.now() - t0 < 10000;) {
        const at = await page.evaluate((k) => window.openCodeBot.device.sim.view.keyPoint(k), n)
        if (!at) return null
        if (last && Math.hypot(at.x - last.x, at.y - last.y) < 1) return at
        last = at
        await page.waitForTimeout(100)
      }
      return last
    }
    // A press lands on the key, or it is let go and aimed again. The view's own record of the
    // keys held down says whether it landed; a miss records what was under the mouse.
    const isDown = (k) => page.evaluate((key) => window.openCodeBot.device.sim.view.down.has(key), k)
    const click = async (n, holdMs = 150, whileHeld = null, until = () => true) => {
      let landed = false
      const tries = []
      for (const t0 = Date.now(); !landed && Date.now() - t0 < 10000;) {
        const at = await steadyPoint(n)
        if (!at) { problems.push(`CodeAIR: no ${n} button on the model`); return null }
        await page.mouse.move(at.x, at.y)
        await page.mouse.down()
        landed = await isDown(n)
        if (!landed) {
          // what was under the mouse, for the failure to say why it missed
          tries.push(await page.evaluate(({ x, y }) => {
            const view = window.openCodeBot.device.sim.view
            const s = window.openCodeBot.device.sim.lastFrame?.devices[0] ?? {}
            const el = document.elementFromPoint(x, y)
            return {
              at: [Math.round(x), Math.round(y)], on: el?.className?.baseVal ?? el?.className ?? el?.tagName,
              cursor: view.renderer.domElement.style.cursor, down: [...view.down],
              pose: [s.x, s.y, s.z, s.heading].map((v) => v === undefined ? null : +v.toFixed(3)),
              cam: view.camera.position.toArray().map((v) => +v.toFixed(3)), focus: document.activeElement?.id || document.activeElement?.tagName,
            }
          }, at))
          await page.mouse.up()
        }
      }
      if (!landed) {
        const presses = await page.evaluate(() => window.__presses.slice(-6))
        problems.push(`CodeAIR: a click never landed on the ${n} key (${tries.length} tries; first ${JSON.stringify(tries[0])}; last ${JSON.stringify(tries.at(-1))}; presses ${JSON.stringify(presses)})`)
        return null
      }
      await page.waitForTimeout(holdMs)
      let held = whileHeld && await page.evaluate(whileHeld)
      for (const t0 = Date.now(); whileHeld && !until(held) && Date.now() - t0 < 10000;) {
        await page.waitForTimeout(50)
        held = await page.evaluate(whileHeld)
      }
      await page.mouse.up()
      return held
    }
    // Which keys the model's clicks pressed, for a failure to say whether a click missed.
    await page.evaluate(() => {
      const view = window.openCodeBot.device.sim.view
      window.__presses = []
      if (!view.__pressWatched) {
        const press = view._press.bind(view)
        view._press = (n, down) => { window.__presses.push([n, down, window.openCodeBot.device.state]); press(n, down) }
        view.__pressWatched = true
      }
    })
    await page.evaluate(() => { window.__sim.out = ''; window.openCodeBot.device.run(`from codeair import *
print('top')
leds.set_mask(255, 100)
while not buttons.was_pressed(0):
    pass
print('pressed 0')
while True:
    pass
`) })
    await page.waitForFunction(() => window.__sim.out.includes('top') && window.openCodeBot.device.state === 'running', null, { timeout: 30000 })
      .catch(() => problems.push('CodeAIR: the button program never started'))
    // Straight down onto the board, 15 cm over its keys: Universal, flown there as a student
    // would. From the side (Rotate) the model hides BTN-0 and BTN-1, and a click on a hidden
    // key presses nothing (keys.js). Universal's own place, 1.6 m up and looking in at an
    // angle, failed two ways: a 4 mm key there is one pixel, so a click a pixel off missed;
    // and at some headings the drone came to rest at after its flight, another part of it
    // stands between that camera and reset. From straight above, nothing covers the keys
    // whatever the heading, and each is a target about 14 pixels across (measured: the same
    // at every heading tried).
    await page.evaluate(() => window.openCodeBot.device.sim.setCamera('universal'))
    const apart = await page.evaluate(() => {
      const view = window.openCodeBot.device.sim.view
      const f = [...view.figures.values()][0]
      const over = f.keyCentre(0).add(f.keyCentre(1)).add(f.keyCentre('reset')).multiplyScalar(1 / 3)
      view.camera.position.set(over.x, over.y + 0.15, over.z + 0.0001)
      view.camera.lookAt(over)
      view.camera.updateMatrixWorld()
      view._touch()
      const a = view.keyPoint(0), b = view.keyPoint('reset')
      return Math.hypot(a.x - b.x, a.y - b.y)
    })
    if (!(apart >= 40)) problems.push(`CodeAIR: from above, its keys are too close together to click (${apart} px apart)`)
    // held until the program has seen it, however long a slow machine takes
    await click(0, 150, () => window.__sim.out.includes('pressed 0'), (seen) => seen)
    await page.waitForFunction(() => window.__sim.out.includes('pressed 0'), null, { timeout: 15000 })
      .catch(async () => problems.push(`CodeAIR: a click on the model did not press BTN-0 (${JSON.stringify(await page.evaluate(() => ({ presses: window.__presses, out: window.__sim.out, state: window.openCodeBot.device.state })))})`))
    const held = await click('reset', 600, () => {
      const s = window.openCodeBot.device.sim.lastFrame.devices[0]
      return { reset: s.reset, leds: s.leds.slice(0, 8).every((v) => v === 0), state: window.openCodeBot.device.state }
    }, (h) => h?.reset && h.leds && h.state !== 'running')
    if (!held?.reset || !held.leds || held.state === 'running') problems.push(`CodeAIR: reset held did not hold the board in reset (${JSON.stringify(held)})`)
    await page.waitForFunction(() => (window.__sim.out.match(/top/g) || []).length >= 2 && window.openCodeBot.device.state === 'running', null, { timeout: 8000 })
      .catch(async () => problems.push(`CodeAIR: after reset the program did not start again (${JSON.stringify(await page.evaluate(() => [window.__sim.out, window.openCodeBot.device.state]))})`))
    // The propellers stop wherever the flight left them, and at this heading one can rest
    // with a blade over reset (150 and 330 degrees, measured): a click passes through it.
    // Each angle in turn, the pointer over reset shows the hand that says a click presses it.
    {
      await page.evaluate(() => {
        const f = [...window.openCodeBot.device.sim.view.figures.values()][0]
        f.__update = f.update
        f.update = (s) => { f.__update(s); f.props.forEach((p, i) => { p.rotation.y = (i === 0 || i === 3 ? 1 : -1) * window.__propAt }) }
      })
      const hidden = []
      for (let deg = 0; deg < 360; deg += 15) {
        await page.evaluate((deg) => { window.__propAt = deg * Math.PI / 180; window.openCodeBot.device.sim.view._touch() }, deg)
        await page.waitForTimeout(150)
        const at = await page.evaluate(() => window.openCodeBot.device.sim.view.keyPoint('reset'))
        await page.mouse.move(at.x + 40, at.y + 40)
        await page.mouse.move(at.x, at.y)
        if (await page.evaluate(() => window.openCodeBot.device.sim.view.renderer.domElement.style.cursor) !== 'pointer') hidden.push(deg)
      }
      await page.evaluate(() => { const f = [...window.openCodeBot.device.sim.view.figures.values()][0]; f.update = f.__update })
      if (hidden.length) problems.push(`CodeAIR: a propeller at rest hides reset from a click (at ${hidden.join(', ')} degrees)`)
    }
    await page.evaluate(() => window.openCodeBot.device.stop())
    // in flight, a reset cuts the motors: it drops, it does not land
    await page.evaluate(() => window.openCodeBot.device.run(`from codeair import *
from flight import *
with recorder:
    fly.take_off(0.5)
    fly.steady(20)
`))
    await page.waitForFunction(() => (window.openCodeBot.device.sim.lastFrame?.devices[0].z ?? 0) > 0.45, null, { timeout: 15000 })
      .catch(() => problems.push('CodeAIR: it never got to 0.45 m before the reset'))
    // The reset pressed as a click that finds it presses it (the view's own press; a click
    // finding the key is checked on the ground above). In flight the drone wobbles, and a
    // click aimed at a 4 mm key on a moving board tests the aim, not the reset.
    await page.evaluate(() => window.openCodeBot.device.sim.view._press('reset', true))
    const fell = await page.waitForFunction(() => {
      const s = window.openCodeBot.device.sim.lastFrame.devices[0]
      return s.z < 0.05 && { z: s.z, reset: s.reset, state: window.openCodeBot.device.state }
    }, null, { timeout: 15000 }).then((h) => h.jsonValue(), async () => page.evaluate(() => {
      const s = window.openCodeBot.device.sim.lastFrame.devices[0]
      return { z: s.z, reset: s.reset, state: window.openCodeBot.device.state }
    }))
    await page.evaluate(() => window.openCodeBot.device.sim.view._press('reset', false))
    if (!(fell?.z < 0.05) || !fell.reset) problems.push(`CodeAIR: a reset in flight did not drop it (${JSON.stringify(fell)})`)
    await page.waitForTimeout(300)
    await page.evaluate(() => window.openCodeBot.device.stop())
    await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 20000 }).catch(() => {})
    await page.evaluate(() => window.openCodeBot.device.sim.setCamera('rotate'))
    if (problems.length === before) console.log('sim-ui: a click on CodeAIR\'s BTN-0 pressed it; its reset restarted the program, with a propeller over it or not, and in flight dropped it')
  }

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
  }, null, { timeout: 15000 }).catch(() => problems.push('boards: the CodeAIR did not hear the CodeX remote'))
  await page.waitForFunction(() => window.__sim.out.includes('app heard A'), null, { timeout: 15000 })
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
  // What each board prints, to wait on what happens rather than on the clock
  // (a slow machine runs the boards slower than real time); heard from before
  // they run, since one board may start well before another is ready.
  await xfly.evaluate(() => {
    window.__out = window.boards.map(() => '')
    window.boards.forEach((b, i) => b.sim.addEventListener('data', (e) => { window.__out[i] += new TextDecoder().decode(e.detail) }))
  })
  for (const b of await xfly.$$('.bd-run')) await b.click()
  await xfly.waitForFunction(() => window.boards.every((b) => b.sim.state === 'running'), null, { timeout: 20000 })
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

// After all those programs: they ran on the build the page chose, and the
// service worker kept the fallback's loader and wasm for the next visit, or in
// a browser with JSPI never saw either. (Checked at the end: the CodeAIR
// clicks above are sensitive to the timing of anything added before them.)
{
  const want = FALLBACK ? 'asyncify' : 'jspi'
  const vm = await page.evaluate(() => window.openCodeBot.device.sim.vm)
  if (vm !== want) problems.push(`MicroPython: expected the ${want} build, running ${vm}`)
  else console.log(`sim-ui: ran on the ${want} build of MicroPython`)
}
{
  const cached = await page.evaluate(async () => {
    if (!(await caches.has('sim-asyncify'))) return []
    return (await (await caches.open('sim-asyncify')).keys()).map((r) => r.url.split('/').pop())
  })
  const kinds = cached.map((u) => u.split('.').pop()).sort().join(',')
  if (FALLBACK ? kinds !== 'js,wasm' : cached.length) problems.push(`the sim-asyncify cache holds ${cached.join(', ') || 'nothing'}`)
  else console.log(`sim-ui: the service worker ${FALLBACK ? 'kept the Asyncify build once fetched' : 'never saw the Asyncify build'}`)
}
await browser.close()
server?.kill()

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('sim-ui: all good')
