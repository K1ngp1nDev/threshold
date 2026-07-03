import { chromium } from 'playwright'
import { preview } from 'vite'

const server = await preview({ preview: { port: 4202, strictPort: true } })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => console.log('pageerror:', e.message))
await page.goto('http://localhost:4202/?qa=1&quality=high', { waitUntil: 'load' })
await page.waitForFunction(() => window.__BREACH__?.ready === true, { timeout: 25000 })
const B = (fn, ...a) => page.evaluate(({ fn, a }) => window.__BREACH__[fn](...a), { fn, a })

await B('invuln', true)
await B('giveWeapon')
await page.waitForTimeout(700)
await page.screenshot({ path: 'scripts/peek-entrance.png' })

// weapon + portal look
await page.evaluate(() => window.__BREACH__.look(1.5, 0))
await page.waitForTimeout(300)
await B('shoot'); await page.waitForTimeout(30)
await page.screenshot({ path: 'scripts/peek-weapon.png' })

for (const [name, z] of [['loop', 1], ['scale', 2], ['mirror', 3]]) {
  await B('enterZone', z)
  await page.waitForTimeout(1100)
  await B('spawnEnemy', 'echo'); await B('spawnEnemy', 'shard')
  await page.waitForTimeout(700)
  await B('shoot'); await page.waitForTimeout(30)
  await page.screenshot({ path: `scripts/peek-${name}.png` })
  console.log('shot', name)
}
await browser.close(); await server.close(); process.exit(0)
