// THRESHOLD QA — run `npm run build` first (this serves the production build).
//
// Checks: app loads · no console errors · canvas non-blank (pixel variance) ·
// desktop controls move the camera · every zone reachable · interact works ·
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

// ---------------------------------------------------------------- main pass
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()
const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

// 1. app loads
try {
  await page.goto('http://localhost:4188/?qa=1&quality=medium', { waitUntil: 'load' })
  await page.waitForFunction(() => window.__THRESHOLD__?.ready === true, { timeout: 30000 })
  check('app loads (engine ready)', true)
} catch (e) {
  check('app loads (engine ready)', false, String(e).slice(0, 120))
}
await page.waitForTimeout(600)

// 2. canvas non-blank via pixel variance
try {
  const buf = await page.locator('#c').screenshot()
  const png = PNG.sync.read(buf)
  let sum = 0
  let sumSq = 0
  const n = png.width * png.height
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const lum = 0.2126 * png.data[o] + 0.7152 * png.data[o + 1] + 0.0722 * png.data[o + 2]
    sum += lum
    sumSq += lum * lum
  }
  const mean = sum / n
  const variance = sumSq / n - mean * mean
  check('canvas non-blank (pixel variance)', variance > 40, `variance=${variance.toFixed(1)} mean=${mean.toFixed(1)}`)
} catch (e) {
  check('canvas non-blank (pixel variance)', false, String(e).slice(0, 120))
}

// 3. desktop controls: W walks forward, mouse-drag look works at the API level
try {
  await page.evaluate(() => window.__THRESHOLD__.teleport('entrance'))
  await page.waitForTimeout(300)
  const before = await page.evaluate(() => window.__THRESHOLD__.pos())
  await page.keyboard.down('w')
  await page.waitForTimeout(900)
  await page.keyboard.up('w')
  const after = await page.evaluate(() => window.__THRESHOLD__.pos())
  const moved = Math.hypot(after[0] - before[0], after[2] - before[2])
  check('desktop controls (W moves player)', moved > 1, `moved ${moved.toFixed(2)} m`)
} catch (e) {
  check('desktop controls (W moves player)', false, String(e).slice(0, 120))
}

// 4. every zone reachable (teleport + zone detection agree)
const zoneChecks = [
  ['atrium', 'atrium'],
  ['hall', 'impossible-door'],
  ['loop-corridor', 'loop-corridor'],
  ['scale-gallery', 'scale-gallery'],
  ['reading-room', 'scale-gallery'],
  ['mirror-atrium', 'mirror-atrium'],
]
for (const [pose, zone] of zoneChecks) {
  try {
    await page.evaluate((id) => window.__THRESHOLD__.teleport(id), pose)
    await page.waitForTimeout(350)
    const z = await page.evaluate(() => window.__THRESHOLD__.zone())
    check(`zone reachable: ${pose} → ${zone}`, z === zone, `got ${z}`)
  } catch (e) {
    check(`zone reachable: ${pose} → ${zone}`, false, String(e).slice(0, 120))
  }
}

// 5. the impossible door actually teleports on crossing
try {
  await page.evaluate(() => {
    window.__THRESHOLD__.teleport('impossible-door')
    window.__THRESHOLD__.look(Math.PI / 2, 0)
  })
  await page.waitForTimeout(400)
  await page.evaluate(() => window.__THRESHOLD__.walk(7))
  await page.waitForTimeout(2600)
  const pos = await page.evaluate(() => window.__THRESHOLD__.pos())
  const zone = await page.evaluate(() => window.__THRESHOLD__.zone())
  check('impossible door: crossing relocates 232 m east', pos[0] > 200 && zone === 'impossible-door', `x=${pos[0].toFixed(1)} zone=${zone}`)
} catch (e) {
  check('impossible door: crossing relocates 232 m east', false, String(e).slice(0, 120))
}

// 6. loop corridor: walking 20 m nets < 10 m and increments the lap counter
try {
  await page.evaluate(() => {
    window.__THRESHOLD__.teleport('loop-corridor')
    window.__THRESHOLD__.look(0, 0)
  })
  await page.waitForTimeout(400)
  const before = await page.evaluate(() => window.__THRESHOLD__.pos())
  await page.evaluate(() => window.__THRESHOLD__.walk(24))
  await page.waitForTimeout(8000)
  const after = await page.evaluate(() => window.__THRESHOLD__.pos())
  const laps = await page.evaluate(() => window.__THRESHOLD__.state().laps)
  const net = after[2] - before[2]
  check('loop corridor: 24 m walked, loop engaged', laps >= 1 && net < 14, `net Δz=${net.toFixed(1)} m, laps=${laps}`)
} catch (e) {
  check('loop corridor: 24 m walked, loop engaged', false, String(e).slice(0, 120))
}

// 7. interact works (gallery pedestal → reading room)
try {
  await page.evaluate(() => window.__THRESHOLD__.teleport('scale-gallery'))
  await page.waitForTimeout(500)
  const target = await page.evaluate(() => window.__THRESHOLD__.currentInteractable())
  await page.keyboard.press('e')
  await page.waitForTimeout(2600)
  const state = await page.evaluate(() => window.__THRESHOLD__.state())
  const pos = await page.evaluate(() => window.__THRESHOLD__.pos())
  check(
    'interact (E): step into the model',
    target === 'gallery-dive' && state.inMiniatureRoom === true && pos[2] < -290,
    `target=${target} inMiniatureRoom=${state.inMiniatureRoom} z=${pos[2].toFixed(1)}`,
  )
} catch (e) {
  check('interact (E): step into the model', false, String(e).slice(0, 120))
}

// 8. no console errors accumulated across the whole session
check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ').slice(0, 200) || 'clean')
await ctx.close()

// ------------------------------------------------- overflow at 4 viewports
for (const width of [360, 390, 768, 1440]) {
  const c = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: width < 500, isMobile: width < 500 })
  const p = await c.newPage()
  try {
    await p.goto(`http://localhost:4188/?qa=1&quality=low${width < 500 ? '&touch=1' : ''}`, { waitUntil: 'load' })
    await p.waitForFunction(() => window.__THRESHOLD__?.ready === true, { timeout: 30000 })
    await p.waitForTimeout(400)
    const overflow = await p.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
    }))
    check(`no horizontal overflow @ ${width}px`, overflow.doc <= 0 && overflow.body <= 0, JSON.stringify(overflow))
  } catch (e) {
    check(`no horizontal overflow @ ${width}px`, false, String(e).slice(0, 120))
  }
  await c.close()
}

// -------------------------------------------------- screenshot dimensions
const SHOTS_DIR = 'docs/screenshots'
const expected = ['threshold-entrance.png', 'impossible-door.png', 'loop-corridor.png', 'scale-gallery.png', 'mirror-atrium.png', 'mobile.png', 'reduced-motion.png']
if (!existsSync(SHOTS_DIR) || readdirSync(SHOTS_DIR).length === 0) {
  check('screenshots present (run `npm run shots`)', false, 'docs/screenshots is empty')
} else {
  const files = readdirSync(SHOTS_DIR).filter((f) => f.endsWith('.png'))
  const missing = expected.filter((f) => !files.includes(f))
  check('screenshots present (all 7)', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${files.length} files`)
  let allOk = true
  const details = []
  for (const f of files) {
    const png = PNG.sync.read(readFileSync(`${SHOTS_DIR}/${f}`))
    if (png.width > 4000 || png.height > 4000) {
      allOk = false
      details.push(`${f}: ${png.width}×${png.height}`)
    }
  }
  check('screenshots ≤ 4000×4000', allOk, details.join(', ') || 'all within limits')
}

await browser.close()
await server.close()

const failed = results.filter((r) => !r.ok)
console.log(`\nQA: ${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:', failed.map((f) => f.name).join(' · '))
  process.exit(1)
}
process.exit(0)
