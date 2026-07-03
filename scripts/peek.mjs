// Render selected poses to PNGs for visual inspection.
import { chromium } from 'playwright'
import { preview } from 'vite'

const poses = process.argv[2] ? process.argv[2].split(',') : ['entrance', 'impossible-door', 'hall', 'loop-corridor', 'scale-gallery', 'reading-room', 'mirror-atrium', 'atrium']
const server = await preview({ preview: { port: 4199, strictPort: true } })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => console.log('pageerror:', e.message))
await page.goto('http://localhost:4199/?qa=1&quality=high', { waitUntil: 'load' })
await page.waitForFunction(() => window.__THRESHOLD__?.ready === true, { timeout: 25000 })
await page.waitForTimeout(600)
for (const pose of poses) {
  await page.evaluate((id) => window.__THRESHOLD__.teleport(id), pose)
  await page.waitForTimeout(700)
  await page.screenshot({ path: `scripts/peek-${pose}.png` })
  console.log('shot', pose)
}
await browser.close()
await server.close()
process.exit(0)
