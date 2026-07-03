import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core'
import { ANOMALY, FX, WARM } from './fx'
import { getState } from '../state'

// A breach anchor. It sits behind a shield: normal fire pings it. The Anomaly
// Pulse (RMB) drops the shield for a few seconds (and reveals hidden anchors) —
// only THEN does the Prism Carbine seal it. A living Warden nearby keeps the
// shield locked, so you must clear the Warden first.

const MAX_HP = 100
const EXPOSE_TIME = 5

export class Anchor {
  readonly root: TransformNode
  readonly core: Mesh
  private ring: Mesh
  private shield: Mesh
  private mat: StandardMaterial
  private ringMat: StandardMaterial
  private shieldMat: StandardMaterial
  readonly position: Vector3
  readonly radius = 0.9
  hp = MAX_HP
  sealed = false
  hidden: boolean
  guarded = false
  private exposeT = 0
  private t = 0

  constructor(scene: Scene, pos: Vector3, private fx: FX, hidden = false) {
    this.position = pos.clone()
    this.hidden = hidden
    this.root = new TransformNode(`anchor-${pos.x}-${pos.z}`, scene)
    this.root.position.copyFrom(pos)

    const plinth = MeshBuilder.CreateCylinder('anchor-plinth', { height: 1.0, diameterTop: 0.7, diameterBottom: 0.9, tessellation: 6 }, scene)
    plinth.position.y = -pos.y + 0.5
    const pm = new StandardMaterial('anchor-plinth-mat', scene)
    pm.diffuseColor = new Color3(0.09, 0.085, 0.08)
    plinth.material = pm
    plinth.parent = this.root
    plinth.checkCollisions = true

    this.core = MeshBuilder.CreatePolyhedron('anchor-core', { type: 3, size: 0.42 }, scene)
    this.core.parent = this.root
    this.mat = new StandardMaterial('anchor-core-mat', scene)
    this.mat.emissiveColor = ANOMALY.clone()
    this.mat.diffuseColor = Color3.Black()
    this.mat.disableLighting = true
    this.core.material = this.mat
    this.core.isPickable = false

    this.ring = MeshBuilder.CreateTorus('anchor-ring', { diameter: 1.5, thickness: 0.045, tessellation: 40 }, scene)
    this.ring.parent = this.root
    this.ringMat = new StandardMaterial('anchor-ring-mat', scene)
    this.ringMat.emissiveColor = ANOMALY.clone()
    this.ringMat.diffuseColor = Color3.Black()
    this.ringMat.disableLighting = true
    this.ring.material = this.ringMat
    this.ring.rotation.x = Math.PI / 2
    this.ring.isPickable = false

    // shield shell (visible while shielded)
    this.shield = MeshBuilder.CreateSphere('anchor-shield', { diameter: 1.7, segments: 16 }, scene)
    this.shield.parent = this.root
    this.shieldMat = new StandardMaterial('anchor-shield-mat', scene)
    this.shieldMat.emissiveColor = new Color3(0.4, 0.55, 0.8)
    this.shieldMat.diffuseColor = Color3.Black()
    this.shieldMat.disableLighting = true
    this.shieldMat.alpha = 0.16
    this.shieldMat.backFaceCulling = false
    this.shield.material = this.shieldMat
    this.shield.isPickable = false

    if (hidden) this.root.setEnabled(false)
  }

  get exposed(): boolean {
    return this.exposeT > 0 && !this.guarded
  }

  get shielded(): boolean {
    return !this.exposed && !this.sealed
  }

  /** Pulse effect: reveal if hidden, and drop the shield (unless a Warden guards it). */
  expose(): void {
    if (this.sealed) return
    if (this.hidden) {
      this.hidden = false
      this.root.setEnabled(true)
      this.fx.sparks(this.position, 'anomaly', 30)
    }
    if (this.guarded) {
      this.fx.sparks(this.position, 'warm', 10) // shield holds — kill the Warden
      return
    }
    this.exposeT = EXPOSE_TIME
    this.fx.sparks(this.position, 'anomaly', 18)
  }

  /** Returns 'sealed' | 'hit' | 'shielded'. LMB only damages while exposed. */
  hit(dmg: number): 'sealed' | 'hit' | 'shielded' {
    if (this.sealed || this.hidden) return 'shielded'
    if (!this.exposed) {
      this.fx.sparks(this.corePos(), 'warm', 6) // shield ping
      return 'shielded'
    }
    this.hp = Math.max(0, this.hp - dmg)
    this.fx.sparks(this.corePos(), 'anomaly', 16)
    if (this.hp <= 0) {
      this.seal()
      return 'sealed'
    }
    return 'hit'
  }

  private seal(): void {
    this.sealed = true
    this.exposeT = 0
    const calm = new Color3(0.5, 0.55, 0.5)
    this.mat.emissiveColor = calm.scale(0.35)
    this.ringMat.emissiveColor = calm.scale(0.25)
    this.shield.setEnabled(false)
    this.fx.dissolve(this.core, ANOMALY)
    this.fx.sparks(this.corePos(), 'anomaly', 40)
  }

  corePos(): Vector3 {
    return this.position.clone()
  }

  healthFraction(): number {
    return this.hp / MAX_HP
  }

  /** True if a shot at this anchor should count as targetable (visible & not sealed). */
  targetable(): boolean {
    return !this.sealed && !this.hidden
  }

  update(dt: number): void {
    this.t += dt
    if (this.exposeT > 0) this.exposeT = Math.max(0, this.exposeT - dt)
    if (this.sealed) {
      this.ring.rotation.z += dt * 0.15
      return
    }
    if (this.hidden) return
    const reduced = getState().reducedMotion
    const pulse = reduced ? 1 : 0.85 + Math.sin(this.t * 3) * 0.15

    if (this.exposed) {
      // exposed & vulnerable — bright, open, no shield
      this.shield.setEnabled(false)
      const dmgK = 0.4 + this.healthFraction() * 0.6
      this.mat.emissiveColor = ANOMALY.scale(pulse * dmgK * 1.1)
      this.ringMat.emissiveColor = ANOMALY.scale(pulse)
      this.core.rotation.y += dt * 1.6
    } else {
      // shielded — dim core, visible shield bubble (blue if guarded)
      this.shield.setEnabled(true)
      const guard = this.guarded
      this.shieldMat.emissiveColor = guard ? new Color3(0.75, 0.35, 0.3) : new Color3(0.4, 0.55, 0.8)
      this.shieldMat.alpha = 0.14 + (reduced ? 0.06 : Math.sin(this.t * 2) * 0.05 + 0.06)
      this.mat.emissiveColor = ANOMALY.scale(0.25)
      this.ringMat.emissiveColor = (guard ? WARM : ANOMALY).scale(0.3)
      this.core.rotation.y += dt * 0.5
    }
    if (!reduced) this.ring.rotation.z += dt * (this.exposed ? 2.2 : 0.4)
  }

  dispose(): void {
    this.root.dispose(false, true)
  }
}
