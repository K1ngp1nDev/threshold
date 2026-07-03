import { Vector3 } from '@babylonjs/core'
import type { Player } from './player'
import type { Interactable, WorldRegistry } from '../world/registry'
import { playClick } from './audio'

/** Proximity + facing based interaction. The HUD renders the prompt. */
export class InteractionManager {
  current: Interactable | null = null
  private onPrompt: (text: string | null) => void

  constructor(
    private reg: WorldRegistry,
    private player: Player,
    onPrompt: (text: string | null) => void,
  ) {
    this.onPrompt = onPrompt
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyE' && this.player.enabled) this.trigger()
    })
  }

  update(): void {
    const cam = this.player.camera
    const p = cam.position
    const yaw = cam.rotation.y
    const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    let best: Interactable | null = null
    let bestScore = -Infinity
    for (const it of this.reg.interactables) {
      if (!it.enabled()) continue
      const to = it.position.subtract(p)
      const dist = to.length()
      if (dist > it.radius) continue
      to.y = 0
      to.normalize()
      const facing = Vector3.Dot(fwd, to)
      if (dist > 1.1 && facing < 0.45) continue
      const score = facing - dist * 0.1
      if (score > bestScore) {
        bestScore = score
        best = it
      }
    }
    if (best !== this.current) {
      this.current = best
      this.onPrompt(best ? best.prompt : null)
    }
  }

  trigger(): void {
    if (this.current) {
      playClick()
      this.current.onInteract()
    }
  }
}
