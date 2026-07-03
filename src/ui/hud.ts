import { getState, setState, subscribe, ZONE_LABELS, ZoneId } from '../state'
import { setFadeElement } from '../core/transitions'
import { toggleMute, unlockAudio } from '../core/audio'

export interface HudDeps {
  isTouch: boolean
  qaMode: boolean
  viewpoints: { id: string; label: string }[]
  onEnter: () => void
  onInteract: () => void
  onViewpoint: (id: string) => void
  getPlayerPos: () => { x: number; y: number; z: number }
}

export interface Hud {
  toast: (text: string, ms?: number) => void
  setPrompt: (text: string | null) => void
  setFps: (fps: number) => void
  openHelp: () => void
  isModalOpen: () => boolean
}

const ZONE_TRICKS: Record<ZoneId, string> = {
  atrium:
    'Four exhibits, one scene. Sectors of geometry live hundreds of metres apart; portals and silent gates stitch them into a single building.',
  'impossible-door':
    'A second camera mirrors your pose through the door mapping and renders Room 402 to a texture, sampled in screen space. Crossing the plane relocates you 232 m east — the frame never cuts.',
  'loop-corridor':
    'Two invisible planes shift you ±14 m between identical segments. You never see the join; the catalogue changes while your back is turned.',
  'scale-gallery':
    'The dollhouse and the room are the same builder function at scale 0.09 and 1.0. “Entering” is a camera dolly plus a 300 m teleport.',
  'mirror-atrium':
    'There is no mirror. The room behind the glass is built by hand, reflected across x = 2, then edited. The orb maps your position through the plane.',
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html !== undefined) e.innerHTML = html
  return e
}

export function createHud(deps: HudDeps): Hud {
  const root = document.getElementById('ui')!
  const s = getState()

  // fade layer for transitions
  const fade = el('div')
  fade.id = 'fade'
  root.appendChild(fade)
  setFadeElement(fade)

  // top-left: zone + status
  const topLeft = el('div', 'hud-panel hud-topleft')
  const zoneEl = el('div', 'hud-zone', ZONE_LABELS[s.zone])
  const statusEl = el('div', 'hud-status')
  const fpsEl = el('span', undefined, '— fps')
  const qEl = el('span', undefined, `quality: ${s.quality}`)
  const badges = el('span', 'hud-badge', '')
  statusEl.append(fpsEl, qEl, badges)
  topLeft.append(zoneEl, statusEl)
  root.appendChild(topLeft)

  // hint
  const hint = el('div', 'hud-panel hud-hint')
  root.appendChild(hint)

  // resume chip
  const resume = el('div', 'hud-panel resume-chip', '<b>Click</b> to resume walking')
  root.appendChild(resume)

  // toasts
  const toasts = el('div', 'hud-toasts')
  root.appendChild(toasts)

  // actions
  const actions = el('div', 'hud-actions')
  const helpBtn = el('button', 'hud-btn', '?')
  helpBtn.title = 'Help (H)'
  const soundBtn = el('button', 'hud-btn', '♪')
  soundBtn.title = 'Sound (M)'
  const xrayBtn = el('button', 'hud-btn', '✕')
  xrayBtn.title = 'X-ray (X)'
  xrayBtn.textContent = '⌗'
  actions.append(xrayBtn, soundBtn, helpBtn)
  root.appendChild(actions)

  // x-ray panel
  const xray = el('div', 'hud-panel xray-panel')
  xray.innerHTML = `
    <h4>X-ray — how this zone works</h4>
    <svg viewBox="0 0 300 240" aria-label="museum sector map">
      <g fill="none" stroke="rgba(201,163,92,0.55)" stroke-width="1.5">
        <rect x="55.6" y="19" width="114" height="76"></rect>
        <rect x="74.2" y="59.2" width="16" height="13.7" fill="rgba(201,163,92,0.18)"></rect>
        <rect x="16.2" y="65.5" width="38" height="30.4"></rect>
        <rect x="59.4" y="95" width="12" height="15.2" ></rect>
        <rect x="59.4" y="110" width="61" height="45.6"></rect>
        <rect x="120.4" y="110" width="61" height="45.6" stroke-dasharray="4 3" stroke="rgba(90,163,154,0.6)"></rect>
      </g>
      <g fill="none" stroke="rgba(90,163,154,0.5)" stroke-width="1.5">
        <rect x="200" y="20" width="80" height="70"></rect>
        <rect x="204" y="110" width="18" height="95"></rect>
        <rect x="235" y="140" width="50" height="45"></rect>
      </g>
      <g stroke="rgba(244,239,231,0.3)" stroke-width="1" stroke-dasharray="3 4">
        <line x1="90" y1="66" x2="200" y2="55"></line>
        <line x1="65" y1="103" x2="204" y2="120"></line>
        <line x1="35" y1="96" x2="235" y2="162"></line>
      </g>
      <g class="xray-map-label">
        <text x="60" y="16">ATRIUM</text>
        <text x="16" y="62">GALLERY</text>
        <text x="60" y="166">MIRROR</text>
        <text x="122" y="166" fill="rgba(90,163,154,0.7)">TWIN (built)</text>
        <text x="200" y="16" fill="rgba(90,163,154,0.8)">ROOM 402 · +250 m E</text>
        <text x="196" y="104" fill="rgba(90,163,154,0.8)" transform="rotate(0)">LOOP · +290 m N</text>
        <text x="228" y="136" fill="rgba(90,163,154,0.8)">READING · −300 m S</text>
      </g>
      <circle id="xray-dot" cx="70" cy="60" r="3.4" fill="#ffb347"></circle>
    </svg>
    <div class="xray-note" id="xray-note"></div>`
  root.appendChild(xray)
  const xrayDot = xray.querySelector('#xray-dot') as SVGCircleElement
  const xrayNote = xray.querySelector('#xray-note') as HTMLElement

  // map world → svg for the player dot
  const dotPos = (p: { x: number; z: number }): { cx: number; cy: number } => {
    const near = (wx: number, wz: number) => ({ cx: 10 + (wx + 27) * 3.8, cy: 10 + (15 - wz) * 3.8 })
    if (p.x > 230 && p.x < 270) {
      return { cx: 200 + ((p.x - 237) / 26) * 80, cy: 90 - ((p.z + 18) / 36) * 70 }
    }
    if (p.z > 290) {
      return { cx: 213, cy: 205 - ((p.z - 296) / 48) * 95 }
    }
    if (p.z < -290) {
      return { cx: 235 + ((p.x + 4.5) / 9) * 50, cy: 185 - ((p.z + 303.5) / 7) * 45 }
    }
    return near(p.x, p.z)
  }
  window.setInterval(() => {
    if (!getState().xray) return
    const p = deps.getPlayerPos()
    const { cx, cy } = dotPos(p)
    xrayDot.setAttribute('cx', String(Math.max(4, Math.min(296, cx))))
    xrayDot.setAttribute('cy', String(Math.max(4, Math.min(236, cy))))
  }, 130)

  // tour bar (touch / cinematic mode)
  const tour = el('div', 'hud-panel tour-bar')
  const prevBtn = el('button', 'tour-btn', '◀')
  const tourLabel = el('div', 'tour-label', deps.viewpoints[0]?.label ?? '')
  const nextBtn = el('button', 'tour-btn', '▶')
  const interactBtn = el('button', 'tour-interact', '◉')
  tour.append(prevBtn, tourLabel, nextBtn, interactBtn)
  root.appendChild(tour)
  let vpIndex = 0
  const goViewpoint = (di: number) => {
    vpIndex = (vpIndex + di + deps.viewpoints.length) % deps.viewpoints.length
    tourLabel.textContent = deps.viewpoints[vpIndex].label
    deps.onViewpoint(deps.viewpoints[vpIndex].id)
  }
  prevBtn.addEventListener('click', () => goViewpoint(-1))
  nextBtn.addEventListener('click', () => goViewpoint(1))
  interactBtn.addEventListener('click', () => deps.onInteract())
  if (deps.isTouch) tour.classList.add('show')

  // help modal
  const modalWrap = el('div', 'modal-wrap')
  const kbd = (k: string, what: string) => `<span><kbd>${k}</kbd> ${what}</span>`
  modalWrap.innerHTML = `
    <div class="hud-panel modal">
      <h2>Threshold Institute <button class="modal-close" aria-label="close">×</button></h2>
      <p>A walkable museum of impossible spaces. Everything is procedural — no downloaded assets, no backend. The building cannot exist; the geometry insists otherwise.</p>
      <h3>Controls</h3>
      <div class="kbd-row">
        ${kbd('W A S D', 'walk')}${kbd('Shift', 'brisk pace')}${kbd('Mouse', 'look')}${kbd('E', 'interact')}${kbd('X', 'x-ray')}${kbd('M', 'sound')}${kbd('H', 'help')}${kbd('Esc', 'release cursor')}
      </div>
      <p style="margin-top:10px">On touch devices: drag to look, ◀ ▶ to move between rooms, ◉ to interact.</p>
      <h3>The exhibits — and how they work</h3>
      <ul>
        <li><b>I — Impossible Door.</b> ${ZONE_TRICKS['impossible-door']}</li>
        <li><b>II — Loop Corridor.</b> ${ZONE_TRICKS['loop-corridor']}</li>
        <li><b>III — Scale Gallery.</b> ${ZONE_TRICKS['scale-gallery']}</li>
        <li><b>IV — Mirror Atrium.</b> ${ZONE_TRICKS['mirror-atrium']}</li>
      </ul>
      <h3>Quality</h3>
      <p>
        <a href="?quality=low">low</a> · <a href="?quality=medium">medium</a> · <a href="?quality=high">high</a>
        — current: <b>${s.quality}</b>. Reduced motion: <b>${s.reducedMotion ? 'on' : 'off'}</b> (system setting).
      </p>
      <h3>Colophon</h3>
      <p>Babylon.js · TypeScript · Vite. Procedural textures, portal render-targets, translation gates. Part of the k1ngp1n.com demo collection.</p>
    </div>`
  root.appendChild(modalWrap)
  const closeModal = () => {
    modalWrap.classList.remove('open')
    modalOpen = false
  }
  let modalOpen = false
  const openHelp = () => {
    modalWrap.classList.add('open')
    modalOpen = true
    document.exitPointerLock?.()
  }
  modalWrap.querySelector('.modal-close')!.addEventListener('click', closeModal)
  modalWrap.addEventListener('click', (e) => {
    if (e.target === modalWrap) closeModal()
  })

  // onboarding
  let entered = deps.qaMode
  if (!deps.qaMode) {
    const onboard = el('div', 'onboard')
    const card = el('div', 'hud-panel onboard-card')
    card.innerHTML = `
      <div class="onboard-kicker">Threshold Institute</div>
      <div class="onboard-title">THRESHOLD</div>
      <div class="onboard-sub">A museum of impossible spaces.<br/>Four exhibits. One rule: trust the door, not the floor plan.</div>`
    const enter = el('button', 'onboard-enter', deps.isTouch ? 'Tap to enter' : 'Click to enter')
    card.appendChild(enter)
    onboard.appendChild(card)
    root.appendChild(onboard)
    enter.addEventListener('click', () => {
      onboard.remove()
      entered = true
      unlockAudio()
      deps.onEnter()
      runTips()
    })
  }

  // three short tips, sequential
  const runTips = () => {
    const tips = deps.isTouch
      ? ['<b>Drag</b> — look around', '<b>◀ ▶</b> — move between rooms', '<b>◉</b> — interact']
      : ['<b>W A S D</b> — walk · <b>Shift</b> — brisk', '<b>Mouse</b> — look around', '<b>E</b> — inspect the exhibits']
    let i = 0
    const showNext = () => {
      if (i >= tips.length) return
      const tip = el('div', 'hud-panel tip', tips[i])
      root.appendChild(tip)
      i++
      setTimeout(() => {
        tip.remove()
        showNext()
      }, 2600)
    }
    showNext()
  }

  // wire buttons + keys
  helpBtn.addEventListener('click', openHelp)
  soundBtn.addEventListener('click', () => {
    unlockAudio()
    toggleMute()
  })
  xrayBtn.addEventListener('click', () => setState({ xray: !getState().xray }))
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyH') (modalOpen ? closeModal() : openHelp())
    if (e.code === 'Escape' && modalOpen) closeModal()
    if (e.code === 'KeyX') setState({ xray: !getState().xray })
    if (e.code === 'KeyM') {
      unlockAudio()
      toggleMute()
    }
  })

  // state → DOM
  subscribe((st) => {
    zoneEl.textContent = ZONE_LABELS[st.zone]
    const b: string[] = []
    if (st.reducedMotion) b.push('reduced motion')
    if (st.xray) b.push('x-ray')
    if (st.muted) b.push('muted')
    if (st.laps > 0) b.push(`laps: ${st.laps}`)
    badges.textContent = b.join(' · ')
    soundBtn.classList.toggle('active', !st.muted)
    xrayBtn.classList.toggle('active', st.xray)
    xray.classList.toggle('show', st.xray)
    xrayNote.textContent = ZONE_TRICKS[st.zone]
    resume.classList.toggle('show', entered && !st.locked && !st.touchMode && !modalOpen && !deps.qaMode)
  })
  xrayNote.textContent = ZONE_TRICKS[s.zone]

  return {
    toast: (text: string, ms = 4200) => {
      const t = el('div', 'hud-panel toast', text)
      toasts.appendChild(t)
      while (toasts.children.length > 3) toasts.firstChild?.remove()
      setTimeout(() => t.remove(), ms)
    },
    setPrompt: (text) => {
      if (text) {
        hint.innerHTML = text.replace(/^E — /, '<b>E</b> — ')
        hint.classList.add('show')
        interactBtn.classList.add('show')
      } else {
        hint.classList.remove('show')
        interactBtn.classList.remove('show')
      }
    },
    setFps: (fps) => {
      fpsEl.textContent = `${Math.round(fps)} fps`
    },
    openHelp,
    isModalOpen: () => modalOpen,
  }
}
