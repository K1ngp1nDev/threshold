// Captures the 7 documentation screenshots for THRESHOLD: BREACH.
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

// --- title screen (no qa so it stays on the title)
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
const page = await ready(desk, 'http://localhost:4177/?qa=1&quality=high')
await call(page, 'invuln', true)
await call(page, 'giveWeapon')
await page.waitForTimeout(900)

// combat-entrance
await call(page, 'shoot')
await page.waitForTimeout(25)
await page.screenshot({ path: `${OUT}/combat-entrance.png` })
console.log('shot combat-entrance')

// weapon-and-portal (aim at the Impossible Door)
await call(page, 'look', 1.5, 0)
await page.waitForTimeout(300)
await call(page, 'shoot')
await page.waitForTimeout(25)
await page.screenshot({ path: `${OUT}/weapon-and-portal.png` })
console.log('shot weapon-and-portal')

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
await desk.close()

// --- mobile (touch controls visible)
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
