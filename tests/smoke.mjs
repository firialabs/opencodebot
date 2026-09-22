/**
 * Headless smoke test: builds every block in every toolbox and makes sure it
 * produces Python without throwing. Run it with `npm test` after `npm run build`.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const URL = process.env.OCB_URL || 'http://localhost:4173/'
const DEVICES = ['codebot', 'codex', 'codeair']
const SHOT_DIR = process.env.OCB_SHOTS || 'tests/screenshots'

/** Serve dist/ ourselves unless something is already answering. */
async function ensureServer() {
  if (await reachable(URL)) return null
  const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], {
    stdio: 'ignore',
  })
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250))
    if (await reachable(URL)) return server
  }
  server.kill()
  throw new Error(`Nothing is serving ${URL} — run \`npm run build\` first.`)
}

async function reachable(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok
  } catch {
    return false
  }
}

const server = await ensureServer()

const problems = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console error: ${m.text()}`)
})

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBotInternals)
if (await page.evaluate(() => document.getElementById('modal')?.open)) {
  await page.click('#modal button[value="ok"]')
}

for (const device of DEVICES) {
  const result = await page.evaluate((deviceId) => {
    const { Blockly, toolboxFor, generatePython } = window.openCodeBotInternals
    const types = []
    const walk = (items) => {
      for (const item of items || []) {
        if (item.kind === 'block') types.push(item.type)
        if (item.contents) walk(item.contents)
      }
    }
    walk(toolboxFor(deviceId).contents)

    const scratch = new Blockly.Workspace()
    const failures = []
    let generated = 0
    for (const type of types) {
      try {
        const block = scratch.newBlock(type)
        block.initSvg?.()
        const code = generatePython(scratch, deviceId)
        if (!code.trim()) failures.push(`${type}: produced nothing`)
        else generated++
        block.dispose(false)
      } catch (err) {
        failures.push(`${type}: ${err.message}`)
      }
    }
    scratch.dispose()
    return { count: types.length, generated, failures }
  }, device)

  console.log(`${device}: ${result.generated}/${result.count} blocks generated Python`)
  for (const failure of result.failures) problems.push(`${device} ▸ ${failure}`)

  // And render the real editor for that device, to catch layout errors.
  // Deliberately not returned to evaluate(): picking a board may open a
  // dialog, and evaluate() would sit waiting on the promise it hands back.
  await page.evaluate((deviceId) => {
    window.openCodeBot._pickTarget(deviceId)
  }, device)
  await page.waitForTimeout(300)
  // Switching boards asks whether to start fresh; say yes.
  if (await page.evaluate(() => document.getElementById('modal')?.open)) {
    await page.click('#modal button[value="ok"]')
  }
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOT_DIR}/ocb-${device}.png` })
}

// The flyout is a separate SVG layered over the workspace: if its backing
// path is even slightly translucent, the student's program ghosts through
// the whole palette.
{
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.blocklyToolboxCategory')].find((r) =>
      r.textContent.includes('Basics'),
    )
    row?.click()
  })
  await page.waitForTimeout(600)
  const flyout = await page.evaluate(() => {
    const bg = document.querySelector('.blocklyFlyoutBackground')
    if (!bg) return null
    const style = getComputedStyle(bg)
    return { fillOpacity: style.fillOpacity, opacity: style.opacity }
  })
  if (!flyout) {
    problems.push('flyout ▸ no background path found — did the flyout open?')
  } else if (flyout.fillOpacity !== '1' || flyout.opacity !== '1') {
    problems.push(
      `flyout ▸ background is translucent (fill-opacity ${flyout.fillOpacity}, ` +
        `opacity ${flyout.opacity}) — the workspace will show through the palette`,
    )
  } else {
    console.log('flyout: background is fully opaque')
  }
}

await browser.close()
server?.kill()

if (problems.length) {
  console.error('\nFAILURES:')
  for (const problem of problems) console.error(' -', problem)
  process.exit(1)
}
console.log('\nAll good.')
