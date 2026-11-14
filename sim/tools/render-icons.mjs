// Renders the device icons (public/icons/dev-codebot.png, dev-codex.png,
// dev-codeair.png) from the devices' 3D models, as the simulator draws them:
//   node sim/tools/render-icons.mjs
// Needs the simulator's built models (npm run sim:assets) and Playwright's
// Chromium. Run it again when a model changes; the PNGs are committed.
import { createServer } from 'vite'
import { chromium } from 'playwright'
import sharp from 'sharp'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const OUT = path.join(ROOT, 'public/icons')
const PX = 96 // shown at up to 32 px, so sharp at three times that

const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'error',
  server: { port: Number(process.env.ICONS_PORT) || 0, host: '127.0.0.1' },
})
await server.listen()
const { port } = server.httpServer.address()

const browser = await chromium.launch(process.env.OCB_CHROMIUM ? { executablePath: process.env.OCB_CHROMIUM } : {})
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error(`page error: ${e.message}`))
  await page.goto(`http://127.0.0.1:${port}/sim/tools/icons/index.html`)
  await page.waitForFunction(() => window.iconsReady, null, { timeout: 60000 })
  for (const kind of ['codebot', 'codex', 'codeair']) {
    const url = await page.evaluate((k) => window.renderIcon(k), kind)
    const png = Buffer.from(url.split(',')[1], 'base64')
    const file = path.join(OUT, `dev-${kind}.png`)
    // Trim the empty margin, then fit the device in a square with a little room.
    await sharp(await sharp(png).trim().toBuffer())
      .resize(PX - 4, PX - 4, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .extend({ top: 2, bottom: 2, left: 2, right: 2, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(file)
    console.log(`wrote ${path.relative(ROOT, file)}`)
  }
} finally {
  await browser.close()
  await server.close()
}
