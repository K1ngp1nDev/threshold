// Tiny procedural WebAudio layer — room tone + interaction cues. No assets.
// Everything is wrapped so a blocked/failed AudioContext can never break the app.

import { getState, setState, subscribe } from '../state'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let started = false

function ensure(): boolean {
  if (started) return !!ctx
  started = true
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return false
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = getState().muted ? 0 : 0.5
    master.connect(ctx.destination)

    // room tone: looped filtered noise with a slow breathing LFO
    const len = ctx.sampleRate * 2
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1
      last = (last + 0.02 * white) / 1.02 // brownish
      data[i] = last * 3.2
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 150
    const g = ctx.createGain()
    g.gain.value = 0.05
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.06
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 0.018
    lfo.connect(lfoGain)
    lfoGain.connect(g.gain)
    src.connect(lp)
    lp.connect(g)
    g.connect(master)
    src.start()
    lfo.start()

    subscribe((s) => {
      if (master && ctx) master.gain.setTargetAtTime(s.muted ? 0 : 0.5, ctx.currentTime, 0.05)
    })
    return true
  } catch {
    ctx = null
    return false
  }
}

/** Call on first user gesture. */
export function unlockAudio(): void {
  try {
    if (!ensure()) return
    ctx?.resume().catch(() => undefined)
  } catch {
    /* never throw */
  }
}

export function toggleMute(): void {
  setState({ muted: !getState().muted })
}

function envGain(at: number, peak: number, dur: number): GainNode | null {
  if (!ctx || !master) return null
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(peak, at + 0.03)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  g.connect(master)
  return g
}

export function playWhoosh(): void {
  try {
    if (!ensure() || !ctx) return
    const t = ctx.currentTime
    const dur = 0.55
    const len = Math.floor(ctx.sampleRate * dur)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = ctx.createBufferSource()
    src.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 1.4
    bp.frequency.setValueAtTime(1400, t)
    bp.frequency.exponentialRampToValueAtTime(180, t + dur)
    const g = envGain(t, 0.22, dur)
    if (!g) return
    src.connect(bp)
    bp.connect(g)
    src.start(t)
    src.stop(t + dur)
  } catch {
    /* no-op */
  }
}

export function playClick(): void {
  try {
    if (!ensure() || !ctx) return
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'triangle'
    o.frequency.value = 840
    const g = envGain(t, 0.12, 0.09)
    if (!g) return
    o.connect(g)
    o.start(t)
    o.stop(t + 0.1)
  } catch {
    /* no-op */
  }
}

export function playChime(): void {
  try {
    if (!ensure() || !ctx) return
    const t = ctx.currentTime
    for (const [i, f] of [523.25, 622.25].entries()) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = f
      const g = envGain(t + i * 0.09, 0.09, 0.5)
      if (!g) continue
      o.connect(g)
      o.start(t + i * 0.09)
      o.stop(t + i * 0.09 + 0.55)
    }
  } catch {
    /* no-op */
  }
}
