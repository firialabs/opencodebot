/**
 * Starter projects: every example opens from the ⋯ menu, is a block program
 * for its board with no loose blocks, has a goal, turns into Python, and runs
 * in the simulator without an error. In Spanish too.
 * Run after `npm run build` (Node 24, for the simulator).
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { runHeadless, haveFlight } from '../src/sim/headless.js'

const BASE = process.env.OCB_URL || 'http://localhost:4173/'

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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
const warnings = []
page.on('console', (m) => {
  if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text())
})

async function fresh(lang = 'en') {
  await page.goto(`${BASE}?device=loopback&lang=${lang}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('opencodebot.welcomed.v1', '1')
    localStorage.setItem('opencodebot.device.v1', 'codebot')
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.openCodeBot)
}

/** Open the picker on a board; returns the examples it lists. */
async function openPicker(device) {
  await page.click('#btn-menu')
  await page.click('[data-action="examples"]')
  await page.waitForFunction(() => document.getElementById('modal')?.open)
  await page.click(`#modal [data-ex-device="${device}"]`)
  return page.$$eval('#modal .ex-item', (items) =>
    items.map((b) => ({
      id: b.dataset.example,
      title: b.querySelector('.ex-title').textContent,
      goal: b.querySelector('.ex-goal').textContent,
    })),
  )
}

/** Pick one example and say yes to replacing the blocks (there always are some). */
async function pick(id, title) {
  await page.click(`#modal [data-example="${id}"]`)
  await page.waitForFunction(() => document.querySelector('#modal[open] button[value="cancel"]'))
  await page.click('#modal button[value="ok"]')
  // The dialog shuts at once; its close event, which opens the example, comes a moment later.
  await page.waitForFunction((name) => window.openCodeBot.workspace.name === name, title, { timeout: 5000 })
}

const programs = []
await fresh()

for (const device of ['codebot', 'codex', 'codeair']) {
  const list = await openPicker(device)
  check(list.length >= 5 && list.length <= 6, `${device}: 5 or 6 examples (${list.length})`)
  check(
    list.every((e) => e.title && e.goal && e.goal.length < 120),
    `${device}: each has a title and a one-line goal`,
  )
  await page.keyboard.press('Escape')

  for (const ex of list) {
    warnings.length = 0
    await openPicker(device)
    await pick(ex.id, ex.title)
    const state = await page.evaluate(() => {
      const app = window.openCodeBot
      const ws = app.workspace.workspace
      const tops = ws.getTopBlocks(false)
      return {
        target: app.workspace.targetId,
        name: app.workspace.name,
        blocks: ws.getAllBlocks(false).length,
        types: [...new Set(ws.getAllBlocks(false).map((b) => b.type))],
        loose: tops.filter((b) => !['ocb_on_start', 'ocb_forever'].includes(b.type)).map((b) => b.type),
        python: app._currentPython(),
        mode: app.workspace.mode,
      }
    })
    const label = `${device} "${ex.title}"`
    check(state.target === device && state.mode === 'blocks', `${label}: opens as blocks for ${device}`)
    check(state.name === ex.title, `${label}: the project takes the example's name (${state.name})`)
    check(state.blocks >= 3 && state.loose.length === 0, `${label}: ${state.blocks} blocks, none loose ${state.loose.join(' ')}`)
    check(warnings.length === 0, `${label}: loads without warnings ${warnings.slice(0, 2).join('; ')}`)
    check(/\S/.test(state.python) && !/\bpass\n?$/.test(state.python.trim()), `${label}: makes Python`)
    programs.push({ device, label, python: state.python, types: state.types })
  }
}

// Ordered easy to harder: each board starts with a plain sequence (no loops,
// choices or variables) and ends with a program that decides as it goes.
for (const device of ['codebot', 'codex', 'codeair']) {
  const mine = programs.filter((p) => p.device === device)
  const first = mine[0].types.filter((t) => /^(controls_|variables_|math_change|ocb_forever)/.test(t))
  check(first.length === 0, `${device}: the first example is a plain sequence ${first.join(' ')}`)
  const last = mine.at(-1).types
  check(
    last.includes('controls_if') || last.includes('controls_whileUntil'),
    `${device}: the last example makes choices or waits for something`,
  )
}

// Replacing work asks first, and keeping it keeps it.
await openPicker('codex')
await page.click('#modal [data-example="hello"]')
await page.waitForTimeout(100)
const asked = await page.evaluate(() => document.getElementById('modal')?.open)
check(asked, 'opening an example over existing blocks asks first')
if (asked) await page.click('#modal button[value="cancel"]')
check(
  (await page.evaluate(() => window.openCodeBot.workspace.targetId)) === 'codeair',
  'and "keep my blocks" keeps them',
)

// In Spanish the picker, the names and the words in the program are Spanish.
await fresh('es')
const es = await openPicker('codex')
check(es[0]?.title === 'Saluda', `Spanish titles (${es[0]?.title})`)
await pick('hello', es[0]?.title)
check(
  (await page.evaluate(() => window.openCodeBot._currentPython())).includes('¡Hola!'),
  'the program\'s own words are Spanish',
)

await browser.close()
server?.kill()

// Each program runs in the simulator without an error.
console.log('in the simulator')
for (const p of programs) {
  if (p.device === 'codeair' && !haveFlight()) {
    console.log(`  skip  ${p.label} (no CodeAIR flight library: SIM_FLIGHT=1 npm run sim:flight)`)
    continue
  }
  const r = await runHeadless({ kind: p.device, source: p.python, seconds: 8 })
  check(!r.error, `${p.label} runs${r.error ? ': ' + r.error.name + ' ' + r.error.message + ' line ' + r.error.line : ''}`)
}

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('\nAll good.')
