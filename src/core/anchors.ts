import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core'
import { ANOMALY, FX } from './fx'
import { getState } from '../state'

// A breach anchor: a shielded anomaly core on a plinth. Immune to normal fire
// (LMB pings its shield); only a charged Prism shot (RMB) damages it. Two
// charged hits seal it.

const MAX_HP = 100

export class Anchor {
  readonly root: TransformNode
  readonly core: Mesh
  readonly ring: Mesh
  private mat: StandardMaterial
  private ringMat: StandardMaterial
  readonly position: Vector3
  readonly radius = 0.9
  hp = MAX_HP
  sealed = false
  private t = 0

  constructor(scene: Scene, pos: Vector3, private fx: FX) {
    this.position = pos.clone()
    this.root = new TransformNode(`anchor-${pos.x}-${pos.z}`, scene)
    this.root.position.copyFrom(pos)

    const plinth = MeshBuilder.CreateCylinder('anchor-plinth', { height: 1.0, diameterTop: 0.7, diameterBottom: 0.9, tessellation: 6 }, scene)
    plinth.position.y = -pos.y + 0.5
    const pm = new StandardMaterial('anchor-plinth-mat', scene)
    pm.diffuseColor = new Color3(0.09, 0.085, 0.08)
    pm.specularColor = new Color3(0.1, 0.1, 0.1)
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
  }

  /** Returns 'sealed' | 'hit' | 'shielded'. */
  hit(dmg: number, charged: boolean): 'sealed' | 'hit' | 'shielded' {
    if (this.sealed) return 'shielded'
    if (!charged) {
      this.fx.sparks(this.corePos(), 'anomaly', 8)
      return 'shielded'
    }
    this.hp = Math.max(0, this.hp - dmg)
    this.fx.sparks(this.corePos(), 'anomaly', 20)
    if (this.hp <= 0) {
      this.seal()
      return 'sealed'
    }
    return 'hit'
  }

  private seal(): void {
    this.sealed = true
    const calm = new Color3(0.5, 0.55, 0.5)
    this.mat.emissiveColor = calm.scale(0.35)
    this.ringMat.emissiveColor = calm.scale(0.25)
    this.fx.dissolve(this.core, ANOMALY)
    this.fx.sparks(this.corePos(), 'anomaly', 40)
  }

  corePos(): Vector3 {
    return this.position.clone()
  }

  healthFraction(): number {
    return this.hp / MAX_HP
  }

  update(dt: number): void {
    this.t += dt
    if (this.sealed) {
      this.ring.rotation.z += dt * 0.15
      return
    }
    const reduced = getState().reducedMotion
    const pulse = reduced ? 1 : 0.85 + Math.sin(this.t * 3) * 0.15
    const dmgK = 0.4 + this.healthFraction() * 0.6
    this.mat.emissiveColor = ANOMALY.scale(pulse * dmgK * 0.85)
    this.core.rotation.y += dt * 0.9
    this.core.rotation.x += dt * 0.4
    if (!reduced) {
      this.ring.rotation.z += dt * (0.4 + (1 - this.healthFraction()) * 2)
      this.ring.scaling.setAll(0.98 + Math.sin(this.t * 3) * 0.03)
    }
  }

  dispose(): void {
    this.root.dispose(false, true)
  }
}
