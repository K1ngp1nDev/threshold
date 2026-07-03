// Captures the documentation screenshots into docs/screenshots/.
// Run `npm run build` first; this serves the production build via vite preview.
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { preview } from 'vite'

const OUT = 'docs/screenshots'
mkdirSync(OUT, { recursive: true })

const server = await preview({ preview: { port: 4177, strictPort: true } })
const browser = await chromium.launch()

async function readyPage(context, url) {
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__THRESHOLD__?.ready === true, { timeout: 30000 })
  await page.waitForTimeout(900)
  return page
}

// --- desktop shots (3200×2000 actual pixels)
const desktop = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
const page = await readyPage(desktop, 'http://localhost:4177/?qa=1&quality=high')

const shots = [
  ['threshold-entrance', 'entrance'],
  ['impossible-door', 'impossible-door'],
  ['loop-corridor', 'loop-corridor'],
  ['scale-gallery', 'scale-gallery'],
  ['mirror-atrium', 'mirror-atrium'],
]
for (const [file, pose] of shots) {
  await page.evaluate((id) => window.__THRESHOLD__.teleport(id), pose)
  await page.waitForTimeout(1100)
  await page.screenshot({ path: `${OUT}/${file}.png` })
  console.log('shot', file)
}
await desktop.close()

// --- mobile (cinematic tour mode)
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
})
const mp = await readyPage(mobile, 'http://localhost:4177/?qa=1&quality=low&touch=1')
await mp.evaluate(() => window.__THRESHOLD__.teleport('entrance'))
await mp.waitForTimeout(1100)
await mp.screenshot({ path: `${OUT}/mobile.png` })
console.log('shot mobile')
await mobile.close()

// --- reduced motion (badge visible in the HUD)
const reduced = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
const rp = await readyPage(reduced, 'http://localhost:4177/?qa=1&quality=high')
await rp.evaluate(() => window.__THRESHOLD__.teleport('atrium'))
await rp.waitForTimeout(1100)
await rp.screenshot({ path: `${OUT}/reduced-motion.png` })
console.log('shot reduced-motion')
await reduced.close()

await browser.close()
await server.close()
console.log('screenshots done')
process.exit(0)
