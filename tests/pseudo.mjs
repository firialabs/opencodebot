/**
 * Every word the app shows comes from the string table. The app runs in the
 * pseudo-language en-XA (every letter accented, each string in ⟦ ⟧), and any
 * plain letter on screen is a string that did not go through t() or Blockly's
 * messages. Then the language menu: picking Spanish switches the app and its
 * blocks. Run after `npm run build`.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))

/**
 * Plain (unaccented) words on screen now: text, the attributes people hear or
 * see (title, aria-label, placeholder, alt), and in Blockly every block's
 * tooltip and dropdown choices. Left out, as they are not the app's words:
 * code (the Python view and editor, the device's terminal), anything marked
 * with its own language (each language's name in the language menu), and the
 * product names CodeBot, CodeX and CodeAIR.
 */
function plainWords() {
  const SKIP = '#terminal-host, .python-view, #python-editor, .blocklyComputeCanvas, script, style, noscript'
  const own = document.documentElement.lang
  const found = new Set()
  // Product names stay as they are in every language, as does the maths
  // notation Blockly writes into its own blocks (ln, log10, e^, 10^).
  const NAMES = /\b(CodeBot|CodeX|CodeAIR)\b|^(ln|log10|e\^|10\^)$/g
  // A program's own words are not the app's: its variables' names, and the
  // fields that hold code or notation (a line of Python, a song's notes).
  const ws = window.openCodeBot?.workspace?.workspace
  const spaces = [ws, ws?.getFlyout?.()?.getWorkspace?.()].filter(Boolean)
  const DATA = ['CODE', 'SONG', 'BITS']
  const data = new Set()
  const vars = new Set()
  for (const space of spaces) {
    for (const map of [space.getVariableMap(), space.getPotentialVariableMap?.()]) {
      for (const v of map?.getAllVariables() ?? []) vars.add(v.getName())
    }
    for (const block of space.getAllBlocks(false)) {
      for (const name of DATA) if (block.getField(name)) data.add(block.getFieldValue(name).replace(/\s+/g, ' '))
    }
  }
  const quote = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const VARS = vars.size ? new RegExp(`(^|[^\\w])(${[...vars].map(quote).join('|')})(?![\\w])`, 'g') : null
  const look = (text, where) => {
    if (typeof text !== 'string') return
    const s = text.trim()
    if (data.has(s.replace(/\s+/g, ' '))) return
    let rest = s.replace(NAMES, '')
    if (VARS) rest = rest.replace(VARS, '$1')
    if (/[A-Za-z]/.test(rest)) found.add(`${where}: "${s.slice(0, 60)}"`)
  }
  const skipped = (el) => el.closest(SKIP) || el.closest('[lang]')?.lang !== own
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement
    if (!el || skipped(el) || !shown(el)) continue
    look(n.textContent, el.id ? `#${el.id}` : el.tagName.toLowerCase() + (el.className?.baseVal ?? el.className ? `.${String(el.className?.baseVal ?? el.className).split(' ')[0]}` : ''))
  }
  for (const el of document.querySelectorAll('[title], [aria-label], [placeholder], [alt]')) {
    // Blockly builds a block's label from its words, which are checked one by one.
    if (skipped(el) || !shown(el) || el.closest('.blocklyBlock')) continue
    for (const a of ['title', 'aria-label', 'placeholder', 'alt']) if (el.hasAttribute(a)) look(el.getAttribute(a), `${el.id ? '#' + el.id : el.tagName.toLowerCase()}[${a}]`)
  }

  // Blockly: tooltips and dropdown choices, on the canvas and in the palette.
  for (const space of spaces) {
    for (const block of space.getAllBlocks(false)) {
      const tip = typeof block.tooltip === 'function' ? block.tooltip() : block.tooltip
      look(tip, `${block.type} tooltip`)
      for (const input of block.inputList) {
        for (const field of input.fieldRow) {
          // A variable's menu lists the program's variables (and Blockly's Rename, Delete).
          if (typeof field.getOptions !== 'function' || field.constructor.name.includes('Variable')) continue
          for (const [label] of field.getOptions(false)) if (typeof label === 'string') look(label, `${block.type} choice`)
        }
      }
    }
  }
  return [...found]
}

async function sweep(label) {
  // Let things settle: toasts and dialogs fade in.
  await page.waitForTimeout(250)
  const words = await page.evaluate(plainWords)
  check(words.length === 0, `${label}${words.length ? ': ' + words.slice(0, 10).join('; ') + (words.length > 10 ? ` and ${words.length - 10} more` : '') : ''}`)
}

async function open(board, { fresh = true, lang = 'en-XA' } = {}) {
  await page.goto(`${BASE}?device=loopback&board=${board}&lang=${lang}`, { waitUntil: 'networkidle' })
  if (fresh) {
    await page.evaluate((b) => {
      localStorage.clear()
      localStorage.setItem('opencodebot.welcomed.v1', '1')
      localStorage.setItem('opencodebot.device.v1', b)
    }, board)
    await page.reload({ waitUntil: 'networkidle' })
  }
  await page.waitForFunction(() => !!window.openCodeBot)
}

/** Every category of the palette, one after another. */
async function palette(label) {
  const sel = '.blocklyToolboxCategory'
  const count = (await page.$$(sel)).length
  const words = new Set()
  for (let i = 0; i < count; i++) {
    await (await page.$$(sel))[i].click()
    await page.waitForTimeout(150)
    for (const w of await page.evaluate(plainWords)) words.add(w)
  }
  await page.keyboard.press('Escape')
  const list = [...words]
  check(count > 5 && list.length === 0, `${label} palette, ${count} categories${list.length ? ': ' + list.slice(0, 10).join('; ') + (list.length > 10 ? ` and ${list.length - 10} more` : '') : ''}`)
}

console.log('pseudo-language (en-XA)')

// First visit: the welcome dialog.
await page.goto(`${BASE}?device=loopback&board=codebot&lang=en-XA`, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => document.getElementById('modal')?.open)
check(await page.evaluate(() => document.documentElement.lang === 'en-XA'), 'the page says which language it is in')
await sweep('welcome dialog')

for (const [board, name] of [['codebot', 'CodeBot'], ['codex', 'CodeX'], ['codeair', 'CodeAIR']]) {
  await open(board)
  await sweep(`${name}: main screen`)
  await palette(name)
}

await open('codebot')
await page.click('#btn-menu')
await sweep('the ⋯ menu')
await page.keyboard.press('Escape')
await page.click('#device-chip')
await sweep('the device menu')
await page.keyboard.press('Escape')
await page.click('body', { position: { x: 700, y: 880 } })

for (const action of ['help', 'about']) {
  await page.click('#btn-menu')
  await page.click(`#app-menu [data-action="${action}"]`)
  await page.waitForFunction(() => document.getElementById('modal')?.open)
  await sweep(`the ${action} dialog`)
  await page.keyboard.press('Escape')
}

await page.click('#btn-connect')
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready')
await page.click('#btn-run')
await page.waitForFunction(() => window.openCodeBot.device.state === 'running')
await sweep('connected and running')
await page.click('#btn-stop')

await page.click('.tab[data-tab="python"]')
await sweep('the Python tab')
await page.click('#btn-mode')
await sweep('writing Python')
await page.click('#btn-mode')
await page.click('.tab[data-tab="sim"]')
await sweep('the Simulator tab')

await page.click('#btn-new')
await page.waitForFunction(() => document.getElementById('modal')?.open)
await sweep('the New dialog')
await page.click('#modal button[value="ok"]')
await sweep('an empty project')

await page.click('#btn-sim')
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 20000 })
await page.waitForTimeout(500)
await sweep('simulating')

console.log('languages')

// The language menu: each language named in its own language, the current one checked.
await open('codebot', { lang: 'en' })
await page.click('#btn-menu')
const items = await page.$$eval('#lang-menu [role="menuitemradio"]', (els) =>
  els.map((e) => ({ name: e.textContent, lang: e.lang, checked: e.getAttribute('aria-checked') })),
)
check(
  items.some((i) => i.lang === 'en' && i.name === 'English' && i.checked === 'true') &&
    items.some((i) => i.lang === 'es' && i.name === 'Español' && i.checked === 'false'),
  `the ⋯ menu offers English and Español (${items.map((i) => i.name).join(', ')})`,
)

// Picking Spanish reloads into it, and stays picked.
await page.goto(`${BASE}?device=loopback&board=codebot`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)
await page.click('#btn-menu')
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.click('#lang-menu [lang="es"]')])
await page.waitForFunction(() => !!window.openCodeBot)
check(await page.evaluate(() => document.documentElement.lang === 'es'), 'picking Español switches the page to Spanish')
check(await page.evaluate(() => document.getElementById('btn-run').textContent.trim() !== 'Run'), 'the buttons are in Spanish')
await (await page.$$('.blocklyToolboxCategory'))[0].click()
await page.waitForTimeout(200)
const words = await page.evaluate(() =>
  [...document.querySelectorAll('.blocklyFlyout .blocklyText')].map((t) => t.textContent).join(' | '),
)
check(!/when program starts|forever|seconds/.test(words) && words.length > 20, `the blocks are in Spanish (${words.slice(0, 80)}…)`)
await page.reload({ waitUntil: 'networkidle' })
check(await page.evaluate(() => document.documentElement.lang === 'es'), 'and it stays Spanish after a reload')
await page.evaluate(() => localStorage.removeItem('opencodebot.lang.v1'))

await browser.close()
server?.kill()

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('\nAll good.')
