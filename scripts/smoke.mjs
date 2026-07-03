// Runtime smoke for THRESHOLD: BREACH.
import { chromium } from 'playwright'
import { preview } from 'vite'

const server = await preview({ preview: { port: 4199, strictPort: true } })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto('http://localhost:4199/?qa=1&quality=medium', { waitUntil: 'load' })
await page.waitForFunction(() => window.__BREACH__?.ready === true, { timeout: 25000 }).then(() => console.log('READY ok')).catch(() => console.log('READY TIMEOUT'))
const B = (fn, ...a) => page.evaluate(({ fn, a }) => window.__BREACH__[fn](...a), { fn, a })

console.log('phase:', (await B('state')).phase)
await B('giveWeapon')
await page.waitForTimeout(400)
console.log('enemies after give:', await B('enemyCount'))

// shoot a few times
for (let i = 0; i < 6; i++) { await B('shoot'); await page.waitForTimeout(120) }
console.log('kills:', (await B('state')).kills, 'heat:', Math.round((await B('state')).heat))

// seal anchors in zone 0
console.log('anchors remaining:', await B('anchorsRemaining'))
await B('sealNearestAnchor'); await page.waitForTimeout(200)
await B('sealNearestAnchor'); await page.waitForTimeout(500)
console.log('after seal — remaining:', await B('anchorsRemaining'), 'objective:', (await B('state')).objective)

// walk through zones
for (let z = 1; z <= 3; z++) {
  await B('enterZone', z); await page.waitForTimeout(900)
  const st = await B('state')
  console.log(`zone ${z}: label=${st.zoneLabel} anchors=${st.anchorsTotal} pos=`, (await B('pos')).map(n => n.toFixed(1)))
}
console.log('console errors:', errors.length ? errors.slice(0, 8) : 'none')
await browser.close()
await server.close()
process.exit(0)
