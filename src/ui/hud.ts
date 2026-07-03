import { getState, setState, subscribe } from '../state'
import { setFadeElement } from '../core/transitions'
import { unlockAudio, toggleMute } from '../core/audio'

export interface HudDeps {
  isTouch: boolean
  qaMode: boolean
  onStart: () => void
  onRestart: () => void
  onInteract: () => void
  onLook: (dx: number, dy: number) => void
  onMove: (fwd: number, side: number) => void
  onJump: () => void
  onCrouch: (on: boolean) => void
  onFire: (down: boolean) => void
  onPulseDown: () => void
  onPulseUp: () => void
}

export interface Hud {
  toast: (text: string, ms?: number) => void
  banner: (title: string, sub: string) => void
  hitMarker: (kind: 'hit' | 'kill' | 'shielded') => void
  setPrompt: (text: string | null) => void
  setFps: (fps: number) => void
  isBusy: () => boolean // title / paused / result — game input suspended
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html !== undefined) e.innerHTML = html
  return e
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export function createHud(deps: HudDeps): Hud {
  const root = document.getElementById('ui')!
  const s = getState()

  const fade = el('div')
  fade.id = 'fade'
  root.appendChild(fade)
  setFadeElement(fade)

  // ---- combat HUD (hidden until playing)
  const hud = el('div', 'combat-hud')

  // crosshair + charge ring + hit marker
  const cross = el('div', 'crosshair')
  cross.innerHTML = `
    <svg viewBox="0 0 80 80" width="80" height="80">
      <circle class="charge-track" cx="40" cy="40" r="30"></circle>
      <circle class="charge-fill" cx="40" cy="40" r="30"></circle>
    </svg>
    <span class="tick t-up"></span><span class="tick t-dn"></span>
    <span class="tick t-l"></span><span class="tick t-r"></span>
    <span class="dot"></span>
    <span class="hitmark"></span>`
  hud.appendChild(cross)
  const chargeFill = cross.querySelector('.charge-fill') as SVGCircleElement
  const hitmark = cross.querySelector('.hitmark') as HTMLElement
  const CIRC = 2 * Math.PI * 30
  chargeFill.style.strokeDasharray = String(CIRC)

  // top objective bar
  const top = el('div', 'hud-panel obj-bar')
  const zoneEl = el('div', 'obj-zone', 'Entrance Hall')
  const objEl = el('div', 'obj-text', 'Recover the Prism Carbine')
  const pips = el('div', 'obj-pips')
  top.append(zoneEl, objEl, pips)
  hud.appendChild(top)

  // top-right status
  const status = el('div', 'hud-status2')
  status.innerHTML = `<span class="st-time">0:00</span> · <span class="st-kills">0 sealed</span> · <span class="st-fps">—</span>`
  hud.appendChild(status)
  const stTime = status.querySelector('.st-time') as HTMLElement
  const stKills = status.querySelector('.st-kills') as HTMLElement
  const stFps = status.querySelector('.st-fps') as HTMLElement

  // vitals (bottom-left)
  const vitals = el('div', 'vitals')
  vitals.innerHTML = `
    <div class="bar bar-shield"><span class="fill"></span><label>SHIELD</label></div>
    <div class="bar bar-health"><span class="fill"></span><label>INTEGRITY</label></div>`
  hud.appendChild(vitals)
  const shieldFill = vitals.querySelector('.bar-shield .fill') as HTMLElement
  const healthFill = vitals.querySelector('.bar-health .fill') as HTMLElement

  // heat (bottom-right)
  const heatWrap = el('div', 'heat')
  heatWrap.innerHTML = `<div class="heat-bar"><span class="heat-fill"></span></div><div class="heat-label">PRISM CARBINE</div>`
  hud.appendChild(heatWrap)
  const heatFill = heatWrap.querySelector('.heat-fill') as HTMLElement
  const heatLabel = heatWrap.querySelector('.heat-label') as HTMLElement

  // interaction hint (tappable on touch so you can pick up / use)
  const hint = el('div', 'hud-panel hud-hint')
  hud.appendChild(hint)
  if (deps.isTouch) {
    hint.style.pointerEvents = 'auto'
    hint.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      deps.onInteract()
    })
  }

  // banner
  const banner = el('div', 'banner')
  banner.innerHTML = `<div class="banner-title"></div><div class="banner-sub"></div>`
  hud.appendChild(banner)
  const bannerTitle = banner.querySelector('.banner-title') as HTMLElement
  const bannerSub = banner.querySelector('.banner-sub') as HTMLElement

  // toasts
  const toasts = el('div', 'hud-toasts')
  hud.appendChild(toasts)

  // damage vignette
  const vignette = el('div', 'damage-vignette')
  hud.appendChild(vignette)

  root.appendChild(hud)

  // top-right buttons (sound/help/pause)
  const actions = el('div', 'hud-actions')
  const soundBtn = el('button', 'hud-btn', '♪')
  const pauseBtn = el('button', 'hud-btn', '⏸')
  actions.append(soundBtn, pauseBtn)
  hud.appendChild(actions)

  // ---- touch controls
  let touchLook: HTMLElement | null = null
  if (deps.isTouch) {
    const tc = el('div', 'touch-controls')
    tc.innerHTML = `
      <div class="look-zone"></div>
      <div class="joystick"><span class="stick"></span></div>
      <button class="tbtn fire">FIRE</button>
      <button class="tbtn pulse">PULSE</button>
      <button class="tbtn jump">JUMP</button>
      <button class="tbtn crouch">DUCK</button>`
    hud.appendChild(tc)
    touchLook = tc.querySelector('.look-zone') as HTMLElement
    setupTouch(tc, touchLook, deps)
  }

  // ---- overlays: title / pause / result
  const overlay = el('div', 'overlay')
  root.appendChild(overlay)

  const renderTitle = () => {
    overlay.className = 'overlay open'
    overlay.innerHTML = `
      <div class="hud-panel screen title-screen">
        <div class="screen-kicker">Threshold Institute · Anomaly Response</div>
        <h1 class="screen-title">THRESHOLD<span>: BREACH</span></h1>
        <p class="screen-sub">Space is failing across four wings. Seal the breach anchors and get out.
        A first-person anomaly shooter where the architecture is the enemy.</p>
        <button class="big-btn" data-act="start">${deps.isTouch ? 'Tap to breach' : 'Click to breach'}</button>
        <div class="screen-controls">${controlsHtml(deps.isTouch)}</div>
      </div>`
    overlay.querySelector('[data-act="start"]')!.addEventListener('click', () => {
      unlockAudio()
      deps.onStart()
    })
  }

  const renderPaused = () => {
    overlay.className = 'overlay open'
    overlay.innerHTML = `
      <div class="hud-panel screen">
        <h2 class="screen-h2">Paused</h2>
        <div class="screen-controls">${controlsHtml(deps.isTouch)}</div>
        <div class="screen-btns">
          <button class="big-btn" data-act="resume">Resume</button>
          <button class="ghost-btn" data-act="restart">Restart run</button>
        </div>
      </div>`
    overlay.querySelector('[data-act="resume"]')!.addEventListener('click', resume)
    overlay.querySelector('[data-act="restart"]')!.addEventListener('click', () => deps.onRestart())
  }

  const renderResult = (win: boolean) => {
    const st = getState()
    overlay.className = 'overlay open'
    overlay.innerHTML = `
      <div class="hud-panel screen result ${win ? 'win' : 'lose'}">
        <div class="screen-kicker">${win ? 'Breach sealed' : 'Operator down'}</div>
        <h1 class="screen-title">${win ? 'CONTAINMENT' : 'LOST TO THE'}<span>${win ? ' RESTORED' : ' ANOMALY'}</span></h1>
        <div class="result-stats">
          <div><b>${fmtTime(st.elapsed)}</b><span>time</span></div>
          <div><b>${st.kills}</b><span>anomalies purged</span></div>
          <div><b>${st.anchorsSealedTotal}</b><span>anchors sealed</span></div>
          <div><b>${st.zoneIndex + 1}/${st.zoneCount}</b><span>wings reached</span></div>
        </div>
        <button class="big-btn" data-act="restart">${win ? 'Run it again' : 'Try again'}</button>
      </div>`
    overlay.querySelector('[data-act="restart"]')!.addEventListener('click', () => deps.onRestart())
  }

  const hideOverlay = () => {
    overlay.className = 'overlay'
    overlay.innerHTML = ''
  }

  const resume = () => {
    setState({ phase: 'playing' })
    if (!deps.isTouch && !deps.qaMode) {
      const c = document.getElementById('c') as HTMLCanvasElement
      c.requestPointerLock?.()
    }
  }

  // ---- reactive state -> DOM
  let lastHealth = s.health
  subscribe((st) => {
    zoneEl.textContent = `Wing ${st.zoneIndex + 1} — ${st.zoneLabel}`
    objEl.textContent = st.objective
    // anchor pips
    if (pips.childElementCount !== st.anchorsTotal) {
      pips.innerHTML = ''
      for (let i = 0; i < st.anchorsTotal; i++) pips.appendChild(el('span', 'pip'))
    }
    Array.from(pips.children).forEach((c, i) => c.classList.toggle('on', i < st.anchorsSealed))

    shieldFill.style.width = `${(st.shield / st.maxShield) * 100}%`
    healthFill.style.width = `${(st.health / st.maxHealth) * 100}%`
    healthFill.classList.toggle('low', st.health <= 30)

    heatFill.style.width = `${st.heat}%`
    heatFill.classList.toggle('hot', st.heat > 70)
    heatWrap.classList.toggle('overheated', st.overheated)
    heatLabel.textContent = st.overheated ? 'VENTING…' : 'PRISM CARBINE'

    const cr = st.charge > 0 ? st.charge : 0
    chargeFill.style.strokeDashoffset = String(CIRC * (1 - cr))
    cross.classList.toggle('charging', st.charging)
    cross.classList.toggle('ready', st.charge >= 1)

    soundBtn.classList.toggle('active', !st.muted)

    // damage vignette
    if (st.health < lastHealth) {
      vignette.classList.remove('flash')
      void vignette.offsetWidth
      vignette.classList.add('flash')
    }
    lastHealth = st.health

    // phase-driven UI
    hud.classList.toggle('active', st.phase === 'playing' || st.phase === 'paused')
    if (st.phase === 'title') renderTitle()
    else if (st.phase === 'paused') renderPaused()
    else if (st.phase === 'victory') renderResult(true)
    else if (st.phase === 'defeat') renderResult(false)
    else hideOverlay()
  })

  // ---- buttons + keys
  soundBtn.addEventListener('click', () => {
    unlockAudio()
    toggleMute()
  })
  const togglePause = () => {
    const st = getState()
    if (st.phase === 'playing') {
      setState({ phase: 'paused' })
      document.exitPointerLock?.()
    } else if (st.phase === 'paused') resume()
  }
  pauseBtn.addEventListener('click', togglePause)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') togglePause()
    if (e.code === 'KeyM') {
      unlockAudio()
      toggleMute()
    }
  })

  // pointer-lock loss auto-pauses on desktop
  if (!deps.isTouch && !deps.qaMode) {
    document.addEventListener('pointerlockchange', () => {
      const locked = !!document.pointerLockElement
      if (!locked && getState().phase === 'playing') setState({ phase: 'paused' })
    })
  }

  return {
    toast: (text, ms = 4000) => {
      const t = el('div', 'hud-panel toast', text)
      toasts.appendChild(t)
      while (toasts.children.length > 3) toasts.firstChild?.remove()
      setTimeout(() => t.remove(), ms)
    },
    banner: (title, sub) => {
      bannerTitle.textContent = title
      bannerSub.textContent = sub
      banner.classList.remove('show')
      void banner.offsetWidth
      banner.classList.add('show')
      setTimeout(() => banner.classList.remove('show'), 2600)
    },
    hitMarker: (kind) => {
      hitmark.className = `hitmark show ${kind}`
      void hitmark.offsetWidth
      setTimeout(() => (hitmark.className = 'hitmark'), 220)
    },
    setPrompt: (text) => {
      if (text) {
        hint.innerHTML = deps.isTouch
          ? text.replace(/^E — /, '<b>TAP</b> — ')
          : text.replace(/^E — /, '<b>E</b> — ')
        hint.classList.add('show')
      } else {
        hint.classList.remove('show')
      }
    },
    setFps: (fps) => {
      const st = getState()
      stFps.textContent = `${Math.round(fps)} fps`
      stTime.textContent = fmtTime(st.elapsed)
      stKills.textContent = `${st.anchorsSealedTotal} sealed`
    },
    isBusy: () => {
      const p = getState().phase
      return p === 'title' || p === 'paused' || p === 'victory' || p === 'defeat' || p === 'loading'
    },
  }
}

function controlsHtml(touch: boolean): string {
  if (touch) {
    return `<div class="ctl-grid">
      <span><kbd>◀ joystick</kbd> move</span><span><kbd>drag</kbd> look</span>
      <span><kbd>FIRE</kbd> shoot</span><span><kbd>PULSE</kbd> charge / seal</span>
      <span><kbd>JUMP</kbd> jump</span><span><kbd>DUCK</kbd> crouch</span></div>`
  }
  return `<div class="ctl-grid">
    <span><kbd>W A S D</kbd> move</span><span><kbd>Mouse</kbd> look</span>
    <span><kbd>L-click</kbd> fire</span><span><kbd>R-click hold</kbd> charge → seal anchors</span>
    <span><kbd>Space</kbd> jump</span><span><kbd>Ctrl</kbd> crouch</span>
    <span><kbd>Shift</kbd> sprint</span><span><kbd>E</kbd> interact</span>
    <span><kbd>Esc</kbd> pause</span><span><kbd>M</kbd> sound</span></div>`
}

function setupTouch(tc: HTMLElement, look: HTMLElement, deps: HudDeps): void {
  const stick = tc.querySelector('.stick') as HTMLElement
  const joy = tc.querySelector('.joystick') as HTMLElement
  let joyId = -1
  let cx = 0
  let cy = 0
  joy.addEventListener('pointerdown', (e) => {
    joyId = e.pointerId
    const r = joy.getBoundingClientRect()
    cx = r.left + r.width / 2
    cy = r.top + r.height / 2
    joy.setPointerCapture(e.pointerId)
  })
  joy.addEventListener('pointermove', (e) => {
    if (e.pointerId !== joyId) return
    const dx = (e.clientX - cx) / 45
    const dy = (e.clientY - cy) / 45
    const cl = (v: number) => Math.max(-1, Math.min(1, v))
    deps.onMove(cl(-dy), cl(dx))
    stick.style.transform = `translate(${cl(dx) * 22}px, ${cl(dy) * 22}px)`
  })
  const endJoy = (e: PointerEvent) => {
    if (e.pointerId !== joyId) return
    joyId = -1
    deps.onMove(0, 0)
    stick.style.transform = 'translate(0,0)'
  }
  joy.addEventListener('pointerup', endJoy)
  joy.addEventListener('pointercancel', endJoy)

  let lookId = -1
  let lx = 0
  let ly = 0
  look.addEventListener('pointerdown', (e) => {
    lookId = e.pointerId
    lx = e.clientX
    ly = e.clientY
  })
  look.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId) return
    deps.onLook((e.clientX - lx) * 1.4, (e.clientY - ly) * 1.4)
    lx = e.clientX
    ly = e.clientY
  })
  const endLook = (e: PointerEvent) => {
    if (e.pointerId === lookId) lookId = -1
  }
  look.addEventListener('pointerup', endLook)
  look.addEventListener('pointercancel', endLook)

  const btn = (sel: string, down: () => void, up?: () => void) => {
    const b = tc.querySelector(sel) as HTMLElement
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      down()
    })
    if (up) {
      b.addEventListener('pointerup', up)
      b.addEventListener('pointercancel', up)
    }
  }
  btn('.fire', () => deps.onFire(true), () => deps.onFire(false))
  btn('.pulse', () => deps.onPulseDown(), () => deps.onPulseUp())
  btn('.jump', () => deps.onJump())
  let crouched = false
  const cb = tc.querySelector('.crouch') as HTMLElement
  cb.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    crouched = !crouched
    cb.classList.toggle('on', crouched)
    deps.onCrouch(crouched)
  })
}
