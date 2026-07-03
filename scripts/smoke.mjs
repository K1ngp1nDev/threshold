// Quick runtime smoke: load ?qa=1, report console errors + API state.
import { chromium } from 'playwright'
import { preview } from 'vite'

const server = await preview({ preview: { port: 4199, strictPort: true } })
const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-webgl'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto('http://localhost:4199/?qa=1&quality=medium', { waitUntil: 'load' })
try {
  await page.waitForFunction(() => window.__THRESHOLD__?.ready === true, { timeout: 25000 })
  console.log('READY ok')
} catch {
  console.log('READY TIMEOUT')
}
const state = await page.evaluate(() => window.__THRESHOLD__?.state?.())
console.log('state:', JSON.stringify(state))
const pos = await page.evaluate(() => window.__THRESHOLD__?.pos?.())
console.log('pos:', JSON.stringify(pos))
// try walking + teleports
const zones = ['impossible-door', 'hall', 'loop-corridor', 'scale-gallery', 'reading-room', 'mirror-atrium']
for (const z of zones) {
  const okTp = await page.evaluate((id) => window.__THRESHOLD__.teleport(id), z)
  await page.waitForTimeout(400)
  const zone = await page.evaluate(() => window.__THRESHOLD__.zone())
  const p = await page.evaluate(() => window.__THRESHOLD__.pos())
  console.log(`teleport ${z}: ok=${okTp} zone=${zone} pos=${p.map((n) => n.toFixed(1))}`)
}
console.log('console errors:', errors.length ? errors.slice(0, 10) : 'none')
await browser.close()
await server.close()
process.exit(0)
