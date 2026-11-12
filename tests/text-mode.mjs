/**
 * The blocks/text toggle teachers asked for: edit the Python, run what was
 * typed, keep it across a reload, and go back to blocks only after asking.
 * Uses the loopback device, so no hardware. Run after `npm run build`.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.OCB_URL || 'http://localhost:4173/'
const URL_ = `${BASE}?device=loopback&board=codebot`

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

await page.goto(URL_, { waitUntil: 'networkidle' })
await page.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('opencodebot.welcomed.v1', '1')
  localStorage.setItem('opencodebot.device.v1', 'codebot')
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)

const mode = () => page.evaluate(() => window.openCodeBot.workspace.mode)

// Into text mode
await page.click('.tab[data-tab="python"]')
check(!(await page.isVisible('#python-editor')), 'blocks mode shows read-only Python')
await page.click('#btn-mode')
check((await mode()) === 'text', '"Edit as Python" switches to text mode')
check(await page.isVisible('#python-editor'), 'the Python becomes editable')
check(await page.isVisible('#text-mode-cover'), 'the blocks area says you are writing Python')
check(
  await page.evaluate(() => {
    const box = document.querySelector('.blocklyToolboxDiv, .blocklyToolbox')
    return !!box && getComputedStyle(box).pointerEvents === 'none'
  }),
  'the block palette cannot be used while writing Python',
)
const seeded = await page.inputValue('#python-editor')
check(seeded.includes('from botcore import *'), 'the editor starts with the blocks\' Python')

// Tab indents
await page.click('#python-editor')
await page.keyboard.press('Control+End')
await page.keyboard.type('\nfor i in range(3):\n')
await page.keyboard.press('Tab')
await page.keyboard.type("print('typed by hand')")
const typed = await page.inputValue('#python-editor')
check(typed.includes("\n    print('typed by hand')"), 'Tab indents four spaces')

// Run sends the typed code
await page.click('#btn-connect')
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready')
await page.keyboard.press('Control+Enter')
await page.waitForFunction(() => window.openCodeBot.device.state === 'running')
const sent = await page.evaluate(() => window.openCodeBot.device.files['main.py'])
check(sent.includes("print('typed by hand')"), 'Run sends the typed Python')

// Survives a reload
await page.waitForTimeout(400)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)
check((await mode()) === 'text', 'text mode survives a reload')
check(await page.isVisible('#python-editor'), 'after a reload the typed Python is on screen')
check((await page.inputValue('#python-editor')).includes('typed by hand'), 'the typed code survives a reload')

// Back to blocks asks first, because typed changes would be lost
await page.click('#btn-back-to-blocks')
check(await page.evaluate(() => document.getElementById('modal')?.open), 'going back with changes asks first')
await page.click('#modal button[value="cancel"]')
await page.waitForTimeout(100)
check((await mode()) === 'text', '"Keep my Python" stays in text mode')
await page.click('#btn-back-to-blocks')
await page.click('#modal button[value="ok"]')
await page.waitForFunction(() => window.openCodeBot.workspace.mode === 'blocks', null, { timeout: 3000 }).catch(() => {})
check((await mode()) === 'blocks', 'confirming goes back to blocks')
check(!(await page.isVisible('#text-mode-cover')), 'the blocks are usable again')
check((await page.evaluate(() => window.openCodeBot.workspace.workspace.getAllBlocks(false).length)) > 0, 'the blocks were kept')

// Untouched code goes back without a question
await page.click('.tab[data-tab="python"]')
await page.click('#btn-mode')
await page.click('#btn-mode')
check(!(await page.evaluate(() => document.getElementById('modal')?.open)), 'unchanged Python goes back without asking')
check((await mode()) === 'blocks', 'and is back in blocks mode')

await browser.close()
server?.kill()

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('\nAll good.')
