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
  localStorage.setItem('opencodebot.welcome.v1', 'off')
  localStorage.setItem('opencodebot.device.v1', 'codebot')
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)

const mode = () => page.evaluate(() => window.openCodeBot.workspace.mode)

// The editor area shows the blocks or the Python, never both
const shows = () =>
  page.evaluate(() => ({
    blocks: !!document.getElementById('blockly-root').offsetParent,
    python: !!document.getElementById('code-pane').offsetParent,
  }))
let view = await shows()
check(view.blocks && !view.python, 'the blocks show at first, not the Python')
check(!(await page.isVisible('.tab[data-tab="python"]')), 'there is no Python tab beside the device')
// The editor bar: the file on its left, the blocks/Python switch on its right,
// over the blocks and over the Python alike.
const box = (sel) => page.locator(sel).first().boundingBox()
const barLayout = async () => {
  const [bar, file, toggle, main] = await Promise.all([box('#editor-bar'), box('#btn-files'), box('#btn-view'), box('.editor-main')])
  return file.x < bar.x + 40 && toggle.x + toggle.width > bar.x + bar.width - 40 && bar.y + bar.height <= main.y + 1
}
check(await barLayout(), 'with the blocks, the bar sits over them: the file on the left, the switch on the right')
check(!(await page.isVisible('#btn-mode')) && !(await page.isVisible('#btn-new')) && !(await page.isVisible('#project-name')), 'no Edit as Python, New or name field')
check(/\.py$/.test(await page.textContent('#file-name')), 'the file name shows .py, even in blocks')
await page.click('#btn-view')
view = await shows()
check(view.python && !view.blocks, '🐍 Python shows the Python in place of the blocks')
check((await mode()) === 'text' && (await page.isVisible('#python-editor')), 'and it is there to edit, always')
check((await page.getAttribute('#btn-view', 'aria-checked')) === 'true', 'the switch says Python is showing')
check(await barLayout(), 'with the Python, the same bar sits over it')
await page.click('#btn-view')
view = await shows()
check(view.blocks && !view.python && (await mode()) === 'blocks', '🧩 Blocks brings the blocks back')

// Into the Python
await page.click('#btn-view')
view = await shows()
check(view.python && !view.blocks, 'the blocks are out of sight while writing Python')
const editorText = () => page.evaluate(() => window.openCodeBot.pythonEditor.value)
const seeded = await editorText()
check(seeded.includes('from botcore import *'), 'the editor starts with the blocks\' Python')
check(await page.isVisible('#python-editor .cm-content[aria-label]'), 'the editor is labelled for screen readers')
check((await page.locator('#python-editor .k').count()) > 0, 'the editor colours Python keywords')

// A colon's Enter indents; Tab and Shift+Tab move the line a level
await page.click('#python-editor .cm-content')
await page.keyboard.press('Control+End')
await page.keyboard.type('\nfor i in range(3):\n')
await page.keyboard.type("print('typed by hand'")
let typed = await editorText()
check(typed.includes("\n    print('typed by hand')"), 'Enter after a colon indents four spaces (and the bracket closes itself)')
await page.keyboard.press('Tab')
check((await editorText()).includes("\n        print('typed by hand')"), 'Tab indents four more spaces')
await page.keyboard.press('Shift+Tab')
typed = await editorText()
check(typed.includes("\n    print('typed by hand')") && !typed.includes("\n        print"), 'Shift+Tab takes the indent back')
await page.keyboard.press('Control+z')
// (Ctrl+Y: Playwright's Control+Shift+z sends a lowercase z, unlike a keyboard)
await page.keyboard.press('Control+y')
check((await editorText()) === typed, 'undo and redo')
// Escape, then Tab, leaves the editor
await page.keyboard.press('Escape')
await page.keyboard.press('Tab')
check(!(await page.evaluate(() => document.getElementById('python-editor').contains(document.activeElement))), 'Escape, then Tab, leaves the editor')

// Run sends the typed code
await page.click('#btn-connect')
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready')
await page.keyboard.press('Control+Enter')
await page.waitForFunction(() => window.openCodeBot.device.state === 'running')
// The app's device pairs the page's kind with the simulator; files are the loopback's.
const sent = await page.evaluate(() => window.openCodeBot.device.board.files['main.py'])
check(sent.includes("print('typed by hand')"), 'Run sends the typed Python')

// Survives a reload
await page.waitForTimeout(400)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)
check((await mode()) === 'text', 'text mode survives a reload')
check(await page.isVisible('#python-editor'), 'after a reload the typed Python is on screen')
check((await editorText()).includes('typed by hand'), 'the typed code survives a reload')

// Back to blocks (the 🧩 Blocks button) turns the typed Python into blocks
const typedBefore = await editorText()
await page.click('#btn-view')
await page.waitForFunction(() => window.openCodeBot.workspace.mode === 'blocks')
check(!(await page.evaluate(() => document.getElementById('modal')?.open)), 'going back with typed changes does not ask')
check((await shows()).blocks, 'the blocks are on screen again')
const kinds = await page.evaluate(() => window.openCodeBot.workspace.workspace.getAllBlocks(false).map((b) => b.type))
check(kinds.includes('controls_repeat_ext') && kinds.includes('ocb_print'), 'the typed loop came back as blocks')
check(!kinds.includes('ocb_python'), 'with nothing left over as Python')

// Only looked at in blocks: the Python view gives back exactly what was typed
await page.click('#btn-view')
check((await mode()) === 'text', 'the Python again')
check((await editorText()) === typedBefore, 'Python only looked at in blocks comes back exactly as typed')

// Lines that will become grey Python blocks have a quiet mark in the gutter,
// worked out again once typing pauses.
await page.evaluate(() => {
  window.openCodeBot.pythonEditor.value = "print('one')\ntry:\n    print(1 / 0)\nexcept ZeroDivisionError:\n    pass\nprint(f'{2} two')\n"
})
const marked = () => page.evaluate(() => window.openCodeBot.pythonEditor.markedLines().join())
await page.waitForFunction(() => window.openCodeBot.pythonEditor.markedLines().length > 0)
check((await marked()) === '2,3,4,5,6', `a statement with no block, all its lines, and a line with a piece of Python are marked (${await marked()})`)
check(
  await page.evaluate(() => [...document.querySelectorAll('.cm-no-block-mark')].every((m) => m.title.includes('gray Python block'))),
  'each mark says why',
)
await page.evaluate(() => {
  const view = window.openCodeBot.pythonEditor.view
  view.dispatch({ changes: { from: view.state.doc.length, insert: 'import math\n' } })
})
await page.waitForFunction(() => window.openCodeBot.pythonEditor.markedLines().includes(7))
check((await marked()) === '2,3,4,5,6,7', 'a line typed with no block is marked once typing pauses')
await page.evaluate(() => { window.openCodeBot.pythonEditor.value = "print('one')\n" })
await page.waitForFunction(() => window.openCodeBot.pythonEditor.markedLines().length === 0)
check(true, 'and the marks go when every line has a block')

// Code that does not parse stays Python, with the cursor on the line to fix
await page.evaluate(() => { window.openCodeBot.pythonEditor.value = "print('one')\nprint((\nprint('three')\n" })
await page.click('#btn-view')
check((await mode()) === 'text', 'Python with a mistake does not go back to blocks')
check(await page.isVisible('.toast >> text=Fix the Python first'), 'and says so')
check(
  await page.evaluate(() => window.openCodeBot.pythonEditor.selectedText.startsWith('print((')),
  'with the line to fix selected',
)

// Fixed, it goes back
await page.evaluate(() => { window.openCodeBot.pythonEditor.value = "print('one')\n" })
await page.click('#btn-view')
check((await mode()) === 'blocks', 'fixed Python goes back to blocks')

// --- Typed Python counts as work, even with no blocks on the canvas -------
// A student clears the blocks, switches to Python and types. Nothing that
// replaces the project may drop that without asking.
async function freshTyped(url, typed) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  p.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
  await p.goto(url, { waitUntil: 'networkidle' })
  await p.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('opencodebot.welcome.v1', 'off')
    localStorage.setItem('opencodebot.device.v1', 'codebot')
  })
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForFunction(() => !!window.openCodeBot)
  await p.evaluate(() => window.openCodeBot.workspace.workspace.clear())
  await p.click('#btn-view')
  await p.evaluate((text) => { window.openCodeBot.pythonEditor.value = text }, typed)
  return p
}
const TYPED = "print('my own program')\n"
const keeps = (p) =>
  p.evaluate(
    (t) => window.openCodeBot.workspace.mode === 'text' && window.openCodeBot.workspace.pythonText === t,
    TYPED,
  )

{
  // A new file: the typed Python is saved in its own file first.
  const p = await freshTyped(BASE, TYPED)
  const mine = await p.evaluate(() => window.openCodeBot.openFile.path)
  await p.click('#btn-files')
  await p.click('#files-panel .files-section[data-store="browser"] [data-act="new-file"]')
  await p.fill('#files-name', 'another')
  await p.press('#files-name', 'Enter')
  await p.waitForFunction(() => window.openCodeBot.openFile.path === 'another.py')
  check(!(await p.evaluate(() => document.getElementById('modal')?.open)), 'a new file does not ask')
  const kept = await p.evaluate((path) => window.openCodeBot.stores.browser.read(path), mine)
  check(kept === TYPED, `the typed Python is kept in ${mine}`)
  await p.close()
}
{
  const p = await freshTyped(BASE, TYPED)
  await p.evaluate(() => window.openCodeBot._pickTarget('codex'))
  await p.waitForTimeout(300)
  check(await keeps(p), 'picking another device keeps typed Python (no starter over it)')
  await p.waitForTimeout(400)
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForFunction(() => !!window.openCodeBot)
  check(await keeps(p), 'and autosave did not overwrite it')
  await p.close()
}
{
  // The board that plugs in is a CodeX, while the project was for CodeBot.
  const p = await freshTyped(`${BASE}?device=loopback&board=codex`, TYPED)
  await p.click('#btn-connect')
  await p.waitForFunction(() => window.openCodeBot.device.state === 'ready')
  await p.waitForTimeout(300)
  check(await keeps(p), 'connecting a different board keeps typed Python')
  await p.close()
}
{
  // A starter program has no name; it keeps the file's.
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await p.goto(BASE, { waitUntil: 'networkidle' })
  await p.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('opencodebot.welcome.v1', 'off')
    localStorage.setItem('opencodebot.device.v1', 'codebot')
  })
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForFunction(() => !!window.openCodeBot)
  await p.evaluate(() => window.openCodeBot.workspace.workspace.clear())
  const file = await p.textContent('#file-name')
  await p.evaluate(() => window.openCodeBot._pickTarget('codex'))
  await p.waitForTimeout(300)
  const loaded = await p.evaluate(() => window.openCodeBot.workspace.workspace.getAllBlocks(false).length)
  check(loaded > 0, 'an empty project gets the new device\'s starter program')
  check((await p.textContent('#file-name')) === file, `loading a starter keeps the file (${file})`)
  await p.close()
}

await browser.close()
server?.kill()

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('\nAll good.')
