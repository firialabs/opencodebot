/**
 * Projects from a teacher's point of view: start over with the New button,
 * rename a project, and find it again after a reload. Run after `npm run build`.
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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true })
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))

const modalOpen = () => page.evaluate(() => document.getElementById('modal')?.open)
const blockCount = () => page.evaluate(() => window.openCodeBot.workspace.workspace.getAllBlocks(false).length)

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.evaluate(() => {
  localStorage.clear()
  // Skip the welcome dialog; this test is about projects.
  localStorage.setItem('opencodebot.welcomed.v1', '1')
  localStorage.setItem('opencodebot.device.v1', 'codebot')
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)

check(await page.isVisible('#btn-new'), 'New is a visible button, not hidden in a menu')
check((await page.inputValue('#project-name')) === 'My project', 'a fresh project is called "My project"')
check((await blockCount()) > 0, 'the CodeBot starter program is loaded')

// Rename
await page.fill('#project-name', '  Line   Follower ')
await page.press('#project-name', 'Enter')
check((await page.inputValue('#project-name')) === 'Line Follower', 'renaming tidies the name')
check((await page.title()).startsWith('Line Follower'), 'the browser tab shows the project name')

// Saved file is named after the project
const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')])
check(download.suggestedFilename() === 'line-follower.ocb', `saved file is named after the project (${download.suggestedFilename()})`)
const saved = JSON.parse(await (await import('node:fs/promises')).readFile(await download.path(), 'utf8'))
check(saved.name === 'Line Follower', 'the saved file keeps the name')

// Survives a reload
await page.waitForTimeout(400) // autosave is debounced
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)
check((await page.inputValue('#project-name')) === 'Line Follower', 'the name survives a reload')

// Escape puts the old name back
await page.fill('#project-name', 'Oops')
await page.press('#project-name', 'Escape')
check((await page.inputValue('#project-name')) === 'Line Follower', 'Escape cancels a rename')

// New asks first, and "Keep my blocks" keeps them
const before = await blockCount()
await page.click('#btn-new')
check(await modalOpen(), 'New asks before clearing blocks')
await page.click('#modal button[value="cancel"]')
check((await blockCount()) === before, '"Keep my blocks" keeps them')

// New, confirmed, starts over
await page.click('#btn-new')
await page.click('#modal button[value="ok"]')
await page
  .waitForFunction(() => window.openCodeBot.workspace.workspace.getAllBlocks(false).length === 0, null, { timeout: 3000 })
  .catch(() => {})
check((await blockCount()) === 0, 'New clears the blocks')
check((await page.inputValue('#project-name')) === 'My project', 'New resets the name')

// With nothing to lose, New does not ask
await page.click('#btn-new')
check(!(await modalOpen()), 'New on an empty project does not ask')

await browser.close()
server?.kill()

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('\nAll good.')
