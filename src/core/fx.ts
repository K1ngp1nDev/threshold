import {
  Color3,
  Color4,
  DynamicTexture,
  GlowLayer,
  LinesMesh,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  PointLight,
  Scene,
  StandardMaterial,
  UniversalCamera,
  Vector3,
} from '@babylonjs/core'
import { getState } from '../state'

// Combat juice: tracers, muzzle flash, impact sparks, screen shake, dissolve,
// and a global time-scale for slow-motion. All effects respect reduced motion.

export const ANOMALY = new Color3(0.36, 0.85, 0.78) // teal-cyan anomaly accent
export const WARM = new Color3(1.0, 0.82, 0.5)

let _timeScale = 1
let _timeScaleTarget = 1
let _timeScaleHold = 0

export function timeScale(): number {
  return _timeScale
}

export function requestSlowMo(scale: number, holdMs: number): void {
  if (getState().reducedMotion) return
  _timeScaleTarget = scale
  _timeScaleHold = holdMs / 1000
}

export function tickTimeScale(realDt: number): void {
  if (_timeScaleHold > 0) {
    _timeScaleHold -= realDt
    if (_timeScaleHold <= 0) _timeScaleTarget = 1
  }
  _timeScale += (_timeScaleTarget - _timeScale) * Math.min(1, realDt * 8)
}

// ---------------------------------------------------------------- shake
let _trauma = 0
let _lastShake = { x: 0, y: 0 }

export function addTrauma(amount: number): void {
  if (getState().reducedMotion) return
  _trauma = Math.min(1, _trauma + amount)
}

export function applyShake(cam: UniversalCamera, realDt: number): void {
  // undo previous frame's offset so shake self-corrects against look input
  cam.rotation.x -= _lastShake.x
  cam.rotation.y -= _lastShake.y
  _trauma = Math.max(0, _trauma - realDt * 1.6)
  const s = _trauma * _trauma
  const nx = (Math.random() * 2 - 1) * s * 0.06
  const ny = (Math.random() * 2 - 1) * s * 0.06
  cam.rotation.x += nx
  cam.rotation.y += ny
  _lastShake = { x: nx, y: ny }
}

// ---------------------------------------------------------------- FX system
export class FX {
  private scene: Scene
  private glow: GlowLayer | null
  private tracers: { mesh: LinesMesh; life: number; max: number }[] = []
  private lights: { light: PointLight; life: number; max: number; base: number }[] = []
  private sparkWarm: ParticleSystem
  private sparkAnomaly: ParticleSystem
  private enableParticles: boolean

  constructor(scene: Scene, glow: GlowLayer | null, enableParticles: boolean) {
    this.scene = scene
    this.glow = glow
    this.enableParticles = enableParticles
    this.sparkWarm = this.makeSparks('spark-warm', new Color4(1, 0.8, 0.4, 1), new Color4(1, 0.5, 0.15, 1))
    this.sparkAnomaly = this.makeSparks('spark-anom', new Color4(0.5, 1, 0.92, 1), new Color4(0.2, 0.7, 0.7, 1))
  }

  private makeSparks(name: string, c1: Color4, c2: Color4): ParticleSystem {
    const tex = new DynamicTexture(`${name}-tex`, 32, this.scene, false)
    const ctx = tex.getContext() as CanvasRenderingContext2D
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.4, 'rgba(255,255,255,0.6)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 32, 32)
    tex.update()

    const ps = new ParticleSystem(name, 220, this.scene)
    ps.particleTexture = tex
    ps.blendMode = ParticleSystem.BLENDMODE_ADD
    ps.color1 = c1
    ps.color2 = c2
    ps.colorDead = new Color4(0, 0, 0, 0)
    ps.minSize = 0.03
    ps.maxSize = 0.13
    ps.minLifeTime = 0.12
    ps.maxLifeTime = 0.4
    ps.emitRate = 0
    ps.minEmitPower = 2
    ps.maxEmitPower = 7
    ps.gravity = new Vector3(0, -9, 0)
    ps.direction1 = new Vector3(-1, -1, -1)
    ps.direction2 = new Vector3(1, 1, 1)
    ps.minAngularSpeed = 0
    ps.maxAngularSpeed = Math.PI
    ps.updateSpeed = 0.016
    ps.start()
    return ps
  }

  sparks(pos: Vector3, kind: 'warm' | 'anomaly' = 'warm', count = 14): void {
    if (!this.enableParticles) return
    const ps = kind === 'anomaly' ? this.sparkAnomaly : this.sparkWarm
    ps.emitter = pos.clone()
    ps.manualEmitCount = getState().reducedMotion ? Math.floor(count / 2) : count
  }

  tracer(from: Vector3, to: Vector3, color: Color3, charged = false): void {
    const mesh = MeshBuilder.CreateLines('tracer', { points: [from, to], updatable: false }, this.scene)
    mesh.color = color
    mesh.isPickable = false
    mesh.alpha = 1
    if (charged) mesh.enableEdgesRendering?.()
    this.tracers.push({ mesh, life: 0, max: charged ? 0.14 : 0.07 })
  }

  flash(pos: Vector3, color: Color3, intensity = 2, ms = 90): void {
    const l = new PointLight(`flash-${this.lights.length}`, pos.clone(), this.scene)
    l.diffuse = color
    l.specular = color
    l.intensity = intensity
    l.range = 8
    this.lights.push({ light: l, life: 0, max: ms / 1000, base: intensity })
  }

  /** Anomaly Pulse shockwave — an expanding ground ring + burst + heavy shake. */
  pulseWave(pos: Vector3): void {
    addTrauma(0.5)
    this.sparks(pos.add(new Vector3(0, -0.6, 0)), 'anomaly', 34)
    this.flash(pos, ANOMALY, 2.4, 220)
    const ring = MeshBuilder.CreateTorus('pulse-ring', { diameter: 1, thickness: 0.14, tessellation: 48 }, this.scene)
    ring.position.set(pos.x, 0.15, pos.z)
    ring.rotation.x = Math.PI / 2
    const mat = new StandardMaterial('pulse-ring-mat', this.scene)
    mat.emissiveColor = ANOMALY.clone()
    mat.diffuseColor = Color3.Black()
    mat.disableLighting = true
    ring.material = mat
    ring.isPickable = false
    const reduced = getState().reducedMotion
    const dur = reduced ? 0.2 : 0.55
    let t = 0
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      t += this.scene.getEngine().getDeltaTime() / 1000
      const k = Math.min(1, t / dur)
      const s = 1 + k * 22
      ring.scaling.set(s, s, s)
      mat.alpha = 1 - k
      if (k >= 1) {
        this.scene.onBeforeRenderObservable.remove(obs)
        ring.dispose()
      }
    })
  }

  /** Dissolve + dispose a mesh (enemy death). */
  dissolve(mesh: Mesh, color: Color3, onDone?: () => void): void {
    this.sparks(mesh.getAbsolutePosition(), 'anomaly', 22)
    this.flash(mesh.getAbsolutePosition(), color, 1.4, 160)
    const reduced = getState().reducedMotion
    const dur = reduced ? 0.12 : 0.32
    let t = 0
    const start = mesh.scaling.clone()
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      t += this.scene.getEngine().getDeltaTime() / 1000
      const k = Math.min(1, t / dur)
      mesh.scaling.copyFrom(start.scale(1 - k))
      mesh.position.y += this.scene.getEngine().getDeltaTime() / 1000 * 1.2
      if (k >= 1) {
        this.scene.onBeforeRenderObservable.remove(obs)
        mesh.dispose()
        onDone?.()
      }
    })
  }

  update(realDt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]
      t.life += realDt
      const k = 1 - t.life / t.max
      t.mesh.alpha = Math.max(0, k)
      if (t.life >= t.max) {
        t.mesh.dispose()
        this.tracers.splice(i, 1)
      }
    }
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i]
      l.life += realDt
      const k = 1 - l.life / l.max
      l.light.intensity = l.base * Math.max(0, k)
      if (l.life >= l.max) {
        l.light.dispose()
        this.lights.splice(i, 1)
      }
    }
    void this.glow
  }
}
