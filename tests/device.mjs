/**
 * Connect, Run and Stop, end to end, with no hardware: the app is opened with
 * `?device=loopback`, a pretend board that keeps whatever it is sent. Also
 * checks that every registered kind of device fits the DeviceTarget contract
 * in docs/device-targets.md. Run with `npm run build` first.
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

// Start from nothing so the welcome dialog and saved work do not interfere.
await page.goto(URL_, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)
const dismiss = async () => {
  if (await page.evaluate(() => document.getElementById('modal')?.open)) {
    await page.click('#modal button[value="ok"]')
  }
}
await dismiss()

const contract = await page.evaluate(() => {
  const { device } = window.openCodeBot
  const { missingMembers } = window.openCodeBotInternals
  return { kind: device.kind, missing: missingMembers(device) }
})
check(contract.kind === 'loopback', '?device=loopback picks the loopback device')
check(contract.missing.length === 0, `loopback fits the DeviceTarget contract ${contract.missing.join(', ')}`)

await page.click('#btn-connect')
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready')
await dismiss()
check(true, 'Connect reaches the ready state')

const toolboxHasCodebot = await page.evaluate(() =>
  [...document.querySelectorAll('.blocklyToolboxCategory')].some((r) => r.textContent.includes('Drive')),
)
check(toolboxHasCodebot, 'connecting a CodeBot switches to CodeBot blocks')

await page.click('#btn-run')
await page.waitForFunction(() => window.openCodeBot.device.state === 'running')
const sent = await page.evaluate(() => window.openCodeBot.device.files['main.py'] || '')
check(sent.includes('from botcore import *'), 'Run sends a CodeBot program as main.py')
check(sent.includes('motors.run('), 'the starter program drives the motors')

const terminalText = await page.evaluate(() => {
  const buffer = window.openCodeBot.terminal.term.buffer.active
  let text = ''
  for (let i = 0; i < buffer.length; i++) text += buffer.getLine(i).translateToString(true) + '\n'
  return text
})
check(terminalText.includes('running main.py'), 'device output reaches the terminal')

await page.click('#btn-stop')
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready')
check(true, 'Stop returns to ready')

await page.click('#btn-connect')
await page.waitForFunction(() => window.openCodeBot.device.state === 'offline')
check(true, 'Connect again disconnects')

await browser.close()
server?.kill()

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('\nAll good.')
