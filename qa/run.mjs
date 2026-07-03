// THRESHOLD: BREACH QA — run `npm run build` first (serves the production build).
//
// Verifies: app loads · play starts · move/jump/crouch · shooting kills an enemy ·
// anchor can be destroyed · ≥2 zones reachable · no console errors ·
// no horizontal overflow at 360/390/768/1440 · screenshots ≤ 4000 px.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { PNG } from 'pngjs'
import { chromium } from 'playwright'
import { preview } from 'vite'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const server = await preview({ preview: { port: 4188, strictPort: true } })
const browser = await chromium.launch()

// ---- play-starts check on the un-started build (title -> start())
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  await page.goto('http://localhost:4188/?quality=medium', { waitUntil: 'load' })
  try {
    await page.waitForFunction(() => window.__BREACH__?.ready === true, { timeout: 30000 })
    const titlePhase = await page.evaluate(() => window.__BREACH__.state().phase)
    await page.evaluate(() => window.__BREACH__.start())
    await page.waitForTimeout(300)
    const playPhase = await page.evaluate(() => window.__BREACH__.state().phase)
    check('app loads', true)
    check('play starts (title → playing)', titlePhase === 'title' && playPhase === 'playing', `${titlePhase} → ${playPhase}`)
  } catch (e) {
    check('app loads', false, String(e).slice(0, 120))
  }
  await ctx.close()
}

// ---- main gameplay pass
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()
const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
await page.goto('http://localhost:4188/?qa=1&quality=medium', { waitUntil: 'load' })
await page.waitForFunction(() => window.__BREACH__?.ready === true, { timeout: 30000 })
const B = (fn, ...a) => page.evaluate(({ fn, a }) => window.__BREACH__[fn](...a), { fn, a })
await B('invuln', true)
await page.waitForTimeout(300)

// canvas non-blank
try {
  const buf = await page.locator('#c').screenshot()
  const png = PNG.sync.read(buf)
  let sum = 0, sumSq = 0
  const n = png.width * png.height
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const l = 0.2126 * png.data[o] + 0.7152 * png.data[o + 1] + 0.0722 * png.data[o + 2]
    sum += l; sumSq += l * l
  }
  const mean = sum / n
  const variance = sumSq / n - mean * mean
  check('canvas non-blank (pixel variance)', variance > 40, `variance=${variance.toFixed(0)}`)
} catch (e) {
  check('canvas non-blank (pixel variance)', false, String(e).slice(0, 120))
}

// movement
try {
  const before = await B('pos')
  await B('setMove', 1, 0)
  await page.waitForTimeout(700)
  await B('stop')
  const after = await B('pos')
  const moved = Math.hypot(after[0] - before[0], after[2] - before[2])
  check('player can move', moved > 1, `moved ${moved.toFixed(2)} m`)
} catch (e) { check('player can move', false, String(e).slice(0, 120)) }

// jump
try {
  const base = (await B('pos'))[1]
  await B('jump')
  let maxY = base
  for (let i = 0; i < 8; i++) { await page.waitForTimeout(45); maxY = Math.max(maxY, (await B('pos'))[1]) }
  check('player can jump', maxY > base + 0.25, `Δy ${(maxY - base).toFixed(2)} m`)
} catch (e) { check('player can jump', false, String(e).slice(0, 120)) }

// crouch
try {
  const base = (await B('pos'))[1]
  await B('crouch', true)
  await page.waitForTimeout(450)
  const low = (await B('pos'))[1]
  await B('crouch', false)
  await page.waitForTimeout(300)
  check('player can crouch', low < base - 0.3, `Δy ${(base - low).toFixed(2)} m`)
} catch (e) { check('player can crouch', false, String(e).slice(0, 120)) }

// shooting kills an enemy
try {
  await B('giveWeapon')
  await B('killAll')
  await page.waitForTimeout(300)
  await B('spawnEnemy', 'echo')
  await page.waitForTimeout(500)
  const before = await B('enemyCount')
  const killsBefore = (await B('state')).kills
  for (let i = 0; i < 6; i++) { await B('shoot'); await page.waitForTimeout(130) }
  await page.waitForTimeout(400)
  const killsAfter = (await B('state')).kills
  check('shooting works & enemy can be killed', killsAfter > killsBefore, `kills ${killsBefore}→${killsAfter}, spawned ${before}`)
} catch (e) { check('shooting works & enemy can be killed', false, String(e).slice(0, 120)) }

// anchor can be destroyed
try {
  const before = await B('anchorsRemaining')
  const sealedBefore = (await B('state')).anchorsSealed
  await B('sealNearestAnchor')
  await page.waitForTimeout(400)
  const after = await B('anchorsRemaining')
  const sealedAfter = (await B('state')).anchorsSealed
  check('anchor can be destroyed', after < before && sealedAfter > sealedBefore, `remaining ${before}→${after}`)
} catch (e) { check('anchor can be destroyed', false, String(e).slice(0, 120)) }

// zones reachable
try {
  await B('enterZone', 1)
  await page.waitForTimeout(900)
  const z1 = (await B('state')).zoneLabel
  await B('enterZone', 2)
  await page.waitForTimeout(900)
  const z2 = (await B('state')).zoneLabel
  check('≥2 zones reachable', z1 === 'Loop Corridor' && z2 === 'Scale Gallery', `${z1} · ${z2}`)
} catch (e) { check('≥2 zones reachable', false, String(e).slice(0, 120)) }

check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ').slice(0, 200) || 'clean')
await ctx.close()

// ---- horizontal overflow at 4 widths
for (const width of [360, 390, 768, 1440]) {
  const c = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: width < 500, isMobile: width < 500 })
  const p = await c.newPage()
  try {
    await p.goto(`http://localhost:4188/?qa=1&quality=low${width < 500 ? '&touch=1' : ''}`, { waitUntil: 'load' })
    await p.waitForFunction(() => window.__BREACH__?.ready === true, { timeout: 30000 })
    await p.waitForTimeout(400)
    const o = await p.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
    }))
    check(`no horizontal overflow @ ${width}px`, o.doc <= 0 && o.body <= 0, JSON.stringify(o))
  } catch (e) { check(`no horizontal overflow @ ${width}px`, false, String(e).slice(0, 120)) }
  await c.close()
}

// ---- screenshots
const DIR = 'docs/screenshots'
const expected = ['threshold-breach-start.png', 'combat-entrance.png', 'loop-corridor-fight.png', 'scale-gallery-arena.png', 'mirror-atrium-final.png', 'weapon-and-portal.png', 'mobile.png']
if (!existsSync(DIR) || readdirSync(DIR).length === 0) {
  check('screenshots present (run `npm run shots`)', false, 'docs/screenshots is empty')
} else {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.png'))
  const missing = expected.filter((f) => !files.includes(f))
  check('screenshots present (all 7)', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${files.length} files`)
  let ok = true
  const bad = []
  for (const f of files) {
    const png = PNG.sync.read(readFileSync(`${DIR}/${f}`))
    if (png.width > 4000 || png.height > 4000) { ok = false; bad.push(`${f}:${png.width}x${png.height}`) }
  }
  check('screenshots ≤ 4000×4000', ok, bad.join(', ') || 'all within limits')
}

await browser.close()
await server.close()
const failed = results.filter((r) => !r.ok)
console.log(`\nQA: ${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) { console.log('FAILED:', failed.map((f) => f.name).join(' · ')); process.exit(1) }
process.exit(0)
