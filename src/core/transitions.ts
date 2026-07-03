import { Scene, Vector3 } from '@babylonjs/core'
import type { Player } from './player'
import { getState } from '../state'

let fadeEl: HTMLElement | null = null
let active = false

export function setFadeElement(el: HTMLElement): void {
  fadeEl = el
}

/** True while a cinematic relocation is in flight — player input is paused. */
export function isTransitioning(): boolean {
  return active
}

export function fadeTo(opacity: number, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (!fadeEl) return resolve()
    fadeEl.style.transition = `opacity ${ms}ms ease`
    fadeEl.style.opacity = String(opacity)
    setTimeout(resolve, ms)
  })
}

/**
 * Cinematic relocation: optional dolly toward a focus point, fade out,
 * teleport, fade in. Under prefers-reduced-motion the dolly is skipped and the
 * fade is a fast crossfade — no camera sweeps.
 */
export async function fadeTeleport(
  scene: Scene,
  player: Player,
  target: { pos: Vector3; yaw: number; pitch?: number },
  opts: { dollyToward?: Vector3; dollyMs?: number } = {},
): Promise<void> {
  const reduced = getState().reducedMotion
  active = true
  player.enabled = false
  try {
    if (!reduced && opts.dollyToward) {
      const cam = player.camera
      const from = cam.position.clone()
      const to = Vector3.Lerp(from, opts.dollyToward, 0.62)
      const ms = opts.dollyMs ?? 850
      await new Promise<void>((resolve) => {
        const t0 = performance.now()
        const obs = scene.onBeforeRenderObservable.add(() => {
          const t = Math.min((performance.now() - t0) / ms, 1)
          const e = 1 - Math.pow(1 - t, 3) // easeOutCubic
          cam.position.copyFrom(Vector3.Lerp(from, to, e))
          if (t >= 1) {
            scene.onBeforeRenderObservable.remove(obs)
            resolve()
          }
        })
      })
      await fadeTo(1, 220)
    } else {
      await fadeTo(1, reduced ? 140 : 260)
    }
    player.teleport(target.pos, target.yaw, target.pitch ?? 0)
    scene.render() // settle one frame behind the fade
    await fadeTo(0, reduced ? 160 : 320)
  } finally {
    active = false
    player.enabled = true
  }
}
