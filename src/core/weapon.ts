import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  UniversalCamera,
  Vector3,
} from '@babylonjs/core'
import { ANOMALY, addTrauma, FX, WARM } from './fx'
import { getState, setState } from '../state'
import { playClick } from './audio'

export type HitKind = 'enemy' | 'anchor' | 'sealed' | 'shielded' | 'wall' | 'miss'
export interface ResolveResult {
  point: Vector3
  kind: HitKind
  killed?: boolean
}
export interface CombatContext {
  resolveHit(origin: Vector3, dir: Vector3, maxDist: number): ResolveResult
  onHitMarker(kind: 'hit' | 'kill' | 'shielded'): void
}

const PRIMARY_HEAT = 9
const PRIMARY_CD = 0.11
const COOL_RATE = 26
const OVERHEAT_RESET = 35
const RANGE = 90

// The Prism Carbine — LMB only. Fast energy shot: hitscan, tracer, muzzle
// flash, hit marker, recoil, heat instead of ammo. (RMB is the Anomaly Pulse,
// owned by the director.)
export class Weapon {
  private root: TransformNode
  private prism: Mesh
  private prismMat: StandardMaterial
  private cooldown = 0
  private recoil = 0
  private appliedRecoil = 0
  private kickZ = 0
  private bobT = 0
  private firingPrimary = false
  private basePos = new Vector3(0.26, -0.26, 0.62)

  constructor(scene: Scene, private cam: UniversalCamera, private ctx: CombatContext, private fx: FX) {
    this.root = new TransformNode('carbine', scene)
    this.root.parent = cam
    this.root.position.copyFrom(this.basePos)
    this.root.rotation.set(0.04, -0.06, 0)

    const dark = new StandardMaterial('carbine-dark', scene)
    dark.diffuseColor = new Color3(0.1, 0.1, 0.11)
    dark.specularColor = new Color3(0.3, 0.3, 0.3)
    const brass = new StandardMaterial('carbine-brass', scene)
    brass.diffuseColor = new Color3(0.55, 0.44, 0.24)
    brass.specularColor = new Color3(0.5, 0.42, 0.25)
    brass.specularPower = 64

    const body = MeshBuilder.CreateBox('carbine-body', { width: 0.1, height: 0.13, depth: 0.5 }, scene)
    body.material = dark
    body.parent = this.root
    const grip = MeshBuilder.CreateBox('carbine-grip', { width: 0.08, height: 0.2, depth: 0.1 }, scene)
    grip.material = dark
    grip.position.set(0, -0.13, -0.12)
    grip.rotation.x = 0.3
    grip.parent = this.root
    const barrel = MeshBuilder.CreateCylinder('carbine-barrel', { height: 0.44, diameter: 0.06, tessellation: 12 }, scene)
    barrel.material = brass
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.02, 0.32)
    barrel.parent = this.root
    const ring = MeshBuilder.CreateTorus('carbine-ring', { diameter: 0.14, thickness: 0.02, tessellation: 16 }, scene)
    ring.material = brass
    ring.rotation.x = Math.PI / 2
    ring.position.set(0, 0.02, 0.42)
    ring.parent = this.root

    this.prism = MeshBuilder.CreatePolyhedron('carbine-prism', { type: 0, size: 0.05 }, scene)
    this.prismMat = new StandardMaterial('carbine-prism-mat', scene)
    this.prismMat.emissiveColor = ANOMALY.clone()
    this.prismMat.diffuseColor = Color3.Black()
    this.prismMat.disableLighting = true
    this.prism.material = this.prismMat
    this.prism.position.set(0, 0.02, 0.5)
    this.prism.parent = this.root

    for (const m of this.root.getChildMeshes()) {
      m.isPickable = false
      m.renderingGroupId = 1 // draw on top so it never clips into walls
    }
  }

  private canFire(): boolean {
    const st = getState()
    return st.phase === 'playing' && st.hasWeapon && !st.overheated
  }

  private muzzle(): Vector3 {
    const f = this.forward()
    const right = new Vector3(Math.cos(this.cam.rotation.y), 0, -Math.sin(this.cam.rotation.y))
    return this.cam.position.add(f.scale(0.6)).add(right.scale(0.18)).add(new Vector3(0, -0.12, 0))
  }

  private forward(): Vector3 {
    const yaw = this.cam.rotation.y
    const pitch = this.cam.rotation.x
    return new Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).normalize()
  }

  setPrimary(down: boolean): void {
    this.firingPrimary = down
  }

  private firePrimary(): void {
    if (!this.canFire() || this.cooldown > 0) return
    this.cooldown = PRIMARY_CD
    const dir = this.forward()
    const origin = this.cam.position.clone()
    const res = this.ctx.resolveHit(origin, dir, RANGE)
    this.fx.tracer(this.muzzle(), res.point, WARM)
    this.fx.flash(this.muzzle(), WARM, 1.6, 60)
    this.recoil += 0.012
    this.kickZ = -0.06
    addTrauma(0.08)
    playClick()
    this.addHeat(PRIMARY_HEAT)
    this.markHit(res)
  }

  private markHit(res: ResolveResult): void {
    if (res.kind === 'enemy') {
      this.fx.sparks(res.point, 'anomaly', 10)
      this.ctx.onHitMarker(res.killed ? 'kill' : 'hit')
    } else if (res.kind === 'sealed') {
      this.ctx.onHitMarker('kill')
    } else if (res.kind === 'anchor') {
      this.ctx.onHitMarker('hit')
    } else if (res.kind === 'shielded') {
      this.ctx.onHitMarker('shielded')
    } else if (res.kind === 'wall') {
      this.fx.sparks(res.point, 'warm', 6)
    }
  }

  private addHeat(amount: number): void {
    const st = getState()
    const heat = Math.min(100, st.heat + amount)
    setState({ heat, overheated: heat >= 100 ? true : st.overheated })
  }

  update(dt: number): void {
    const st = getState()
    if (this.cooldown > 0) this.cooldown -= dt

    const heat = Math.max(0, st.heat - COOL_RATE * dt)
    const overheated = st.overheated && heat > OVERHEAT_RESET
    setState({ heat, overheated })

    if (this.firingPrimary) this.firePrimary()

    // prism visual: overheat red, else anomaly with a small heat glow
    const glow = st.overheated ? new Color3(1, 0.25, 0.2) : ANOMALY
    this.prismMat.emissiveColor = glow.scale(0.8 + (st.heat / 100) * 0.8)

    // recoil (self-correcting like screen shake)
    this.cam.rotation.x -= this.appliedRecoil
    this.recoil -= this.recoil * Math.min(1, dt * 9)
    this.cam.rotation.x += this.recoil
    this.appliedRecoil = this.recoil

    // viewmodel bob + kick
    this.kickZ += (0 - this.kickZ) * Math.min(1, dt * 10)
    this.bobT += dt
    const bobAmt = st.reducedMotion ? 0 : 0.006
    this.root.position.set(this.basePos.x, this.basePos.y + Math.sin(this.bobT * 6) * bobAmt, this.basePos.z + this.kickZ)
  }
}
