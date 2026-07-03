// Captures the 8 documentation screenshots for THRESHOLD: BREACH.
// Run `npm run build` first.
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { preview } from 'vite'

const OUT = 'docs/screenshots'
mkdirSync(OUT, { recursive: true })
const server = await preview({ preview: { port: 4177, strictPort: true } })
const browser = await chromium.launch()

async function ready(context, url) {
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__BREACH__?.ready === true, { timeout: 30000 })
  await page.waitForTimeout(800)
  return page
}
const call = (page, fn, ...a) => page.evaluate(({ fn, a }) => window.__BREACH__[fn](...a), { fn, a })

// --- title screen
{
  const c = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
  const p = await ready(c, 'http://localhost:4177/?quality=high')
  await p.waitForTimeout(400)
  await p.screenshot({ path: `${OUT}/threshold-breach-start.png` })
  console.log('shot threshold-breach-start')
  await c.close()
}

// --- desktop combat shots
const desk = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
const page = await ready(desk, 'http://localhost:4177/?qa=1&quality=high&seed=demo')
await call(page, 'invuln', true)
await call(page, 'giveWeapon')
await page.waitForTimeout(900)

// combat-entrance (shields up)
await call(page, 'shoot')
await page.waitForTimeout(25)
await page.screenshot({ path: `${OUT}/combat-entrance.png` })
console.log('shot combat-entrance')

// anomaly-pulse (right after a pulse — ring, flash, exposed anchors)
await call(page, 'pulse')
await page.waitForTimeout(60)
await page.screenshot({ path: `${OUT}/anomaly-pulse.png` })
console.log('shot anomaly-pulse')

const zones = [
  ['loop-corridor-fight', 1, ['echo', 'shard']],
  ['scale-gallery-arena', 2, ['warden', 'echo']],
  ['mirror-atrium-final', 3, ['echo', 'shard']],
]
for (const [file, z, types] of zones) {
  await call(page, 'enterZone', z)
  await page.waitForTimeout(1100)
  for (const t of types) await call(page, 'spawnEnemy', t)
  await page.waitForTimeout(700)
  await call(page, 'shoot')
  await page.waitForTimeout(25)
  await page.screenshot({ path: `${OUT}/${file}.png` })
  console.log('shot', file)
}

// victory screen
await call(page, 'forceVictory')
await page.waitForTimeout(1300)
await page.screenshot({ path: `${OUT}/victory-screen.png` })
console.log('shot victory-screen')
await desk.close()

// --- mobile
const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
const mp = await ready(mob, 'http://localhost:4177/?qa=1&quality=low&touch=1')
await call(mp, 'invuln', true)
await call(mp, 'giveWeapon')
await mp.waitForTimeout(900)
await mp.screenshot({ path: `${OUT}/mobile.png` })
console.log('shot mobile')
await mob.close()

await browser.close()
await server.close()
console.log('screenshots done')
process.exit(0)
