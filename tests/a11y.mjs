/**
 * Accessibility: an automated WCAG check (axe-core) on the screens teachers
 * and students use, plus the keyboard paths a mouse-free user needs.
 * Run after `npm run build`.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'

const BASE = process.env.OCB_URL || 'http://localhost:4173/'
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))

/** Run axe on the page as it is now; report each violation as a failure. */
async function audit(label) {
  // Check what people see once things settle, not a button halfway through
  // a colour change or a toast still fading in. Endless animations (the
  // busy dot's pulse) are left alone.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    ),
  )
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE })
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(
      {
        // Blockly's off-screen canvas for measuring text: not content.
        exclude: [['.blocklyComputeCanvas']],
      },
      { resultTypes: ['violations'], runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    )
    return result.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')}`)
  })
  check(violations.length === 0, `axe: ${label}${violations.length ? ' -> ' + violations.join('; ') : ''}`)
}

// First visit: the welcome dialog.
await page.goto(`${BASE}?device=loopback&board=codebot`, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => document.getElementById('modal')?.open)
await audit('welcome dialog')

await page.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('opencodebot.welcomed.v1', '1')
  localStorage.setItem('opencodebot.device.v1', 'codebot')
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)

await audit('main screen')

// Connected, so Run and Stop are enabled and their contrast counts.
await page.click('#btn-connect')
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready')
await page.click('#btn-run')
await page.waitForFunction(() => window.openCodeBot.device.state === 'running')
await audit('connected and running')

await page.click('.tab[data-tab="python"]')
await audit('Python tab')
await page.click('#btn-mode')
await audit('writing Python (text mode)')
await page.click('#btn-mode')

await page.click('#btn-menu')
await audit('the ⋯ menu open')
await page.keyboard.press('Escape')
check(await page.evaluate(() => document.getElementById('app-menu').hidden), 'Escape closes the ⋯ menu')
check(await page.evaluate(() => document.activeElement.id === 'btn-menu'), 'and returns focus to its button')

await page.click('#device-chip')
await audit('device menu open')
await page.keyboard.press('Escape')

await page.click('#btn-menu')
await page.click('[data-action="help"]')
await audit('Help dialog')
check(
  await page.evaluate(() => document.getElementById('modal').textContent.includes('Using the keyboard')),
  'Help explains keyboard use',
)
await page.keyboard.press('Escape')

// --- Keyboard paths ---------------------------------------------------------
check(await page.evaluate(() => document.querySelector('h1')?.textContent.trim().length > 0), 'the page has a heading')
check(
  await page.evaluate(() => document.getElementById('status-msg').getAttribute('role') === 'status'),
  'status messages are announced (role=status)',
)

// Tabs: arrows move between them, one tab stop for the list.
await page.focus('#tab-terminal')
await page.keyboard.press('ArrowRight')
check(
  await page.evaluate(
    () => document.activeElement.id === 'tab-python' && document.getElementById('tab-python').ariaSelected === 'true',
  ),
  'Right arrow moves to and selects the Python tab',
)
check(
  await page.evaluate(() => document.getElementById('tab-terminal').tabIndex === -1),
  'only the selected tab is in the Tab order',
)
await page.keyboard.press('ArrowLeft')
check(await page.evaluate(() => document.activeElement.id === 'tab-terminal'), 'Left arrow goes back')

// Splitter moves with the keyboard and reports where it is.
const before = await page.evaluate(() => Number(document.getElementById('splitter').getAttribute('aria-valuenow')))
await page.focus('#splitter')
await page.keyboard.press('ArrowLeft')
await page.keyboard.press('ArrowLeft')
const after = await page.evaluate(() => Number(document.getElementById('splitter').getAttribute('aria-valuenow')))
check(after < before, `arrow keys move the divider (${before} -> ${after})`)

// A block can be added without a mouse: T for the palette, arrows, Enter.
await page.click('#btn-stop')
const blocksBefore = await page.evaluate(() => window.openCodeBot.workspace.workspace.getAllBlocks(false).length)
await page.evaluate(() => document.querySelector('.blocklyToolboxCategoryContainer')?.focus())
await page.keyboard.press('ArrowDown') // Drive
await page.keyboard.press('ArrowRight') // into its blocks
await page.keyboard.press('Enter') // add it
await page.waitForTimeout(300)
const blocksAfter = await page.evaluate(() => window.openCodeBot.workspace.workspace.getAllBlocks(false).length)
check(blocksAfter > blocksBefore, 'a block can be added with the keyboard alone')

// Reduced motion is respected.
await page.emulateMedia({ reducedMotion: 'reduce' })
const toastMs = await page.evaluate(() => {
  const probe = document.createElement('div')
  probe.className = 'toast'
  document.getElementById('toast-stack').append(probe)
  const ms = parseFloat(getComputedStyle(probe).animationDuration) * 1000
  probe.remove()
  return ms
})
check(toastMs < 1, `animations are switched off for reduced motion (${toastMs}ms)`)
await page.emulateMedia({ reducedMotion: 'no-preference' })

// An empty project, with its "drag blocks here" hint showing.
await page.click('#btn-new')
await page.click('#modal button[value="ok"]')
await page.waitForFunction(() => !document.getElementById('blocks-hint').hidden)
await audit('empty project')

await browser.close()
server?.kill()

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('\nAll good.')
