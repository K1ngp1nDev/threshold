import {
  Mesh,
  MeshBuilder,
  Scene,
  UniversalCamera,
  Vector3,
} from '@babylonjs/core'
import { getState, setState } from '../state'

const GRAVITY = 22
const JUMP_SPEED = 7.2
const WALK = 4.0
const SPRINT = 6.8
const CROUCH_SPEED = 2.2
const STAND_EYE = 1.62
const CROUCH_EYE = 0.95
const BODY_HALF = 0.9 // ellipsoid half-height
const SHIELD_REGEN_DELAY = 4.5
const SHIELD_REGEN_RATE = 14

// Kinematic FPS controller. A hidden collider mesh does the moving (Babylon's
// moveWithCollisions / ellipsoid slide), and the camera eye is slaved to it —
// so crouch is just an eye-height lerp and never fights the collision solver.
export class Player {
  readonly camera: UniversalCamera
  private collider: Mesh
  private canvas: HTMLCanvasElement
  private keys = new Set<string>()
  private vy = 0
  private grounded = false
  private jumpQueued = false
  private crouching = false
  private eye = STAND_EYE
  private lastDamageAt = -999
  private moveInput = { fwd: 0, side: 0 } // for touch / QA
  private invuln = false
  enabled = true

  constructor(scene: Scene, canvas: HTMLCanvasElement, spawn: Vector3, yaw: number) {
    this.canvas = canvas

    this.collider = MeshBuilder.CreateBox('player-collider', { size: 0.8 }, scene)
    this.collider.isVisible = false
    this.collider.isPickable = false
    this.collider.checkCollisions = false
    this.collider.ellipsoid = new Vector3(0.4, BODY_HALF, 0.4)
    this.collider.position.set(spawn.x, BODY_HALF, spawn.z) // feet on floor y=0

    const cam = new UniversalCamera('player', new Vector3(spawn.x, spawn.y, spawn.z), scene)
    cam.minZ = 0.05
    cam.maxZ = 800
    cam.fov = 1.05
    cam.rotation.set(0, yaw, 0)
    cam.inputs.clear()
    cam.checkCollisions = false
    cam.applyGravity = false
    scene.activeCamera = cam
    this.camera = cam
    this.syncCamera()

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') e.preventDefault()
      if (e.repeat) return
      this.keys.add(e.code)
      if (e.code === 'Space') this.jumpQueued = true
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.keys.clear())

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas && this.enabled) this.rotate(e.movementX, e.movementY)
    })
    let dragging = false
    let lx = 0
    let ly = 0
    canvas.addEventListener('pointerdown', (e) => {
      if (document.pointerLockElement === canvas) return
      if (getState().touchMode) return // touch look handled by HUD zone
      dragging = true
      lx = e.clientX
      ly = e.clientY
    })
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging || !this.enabled) return
      this.rotate((e.clientX - lx) * 1.5, (e.clientY - ly) * 1.5)
      lx = e.clientX
      ly = e.clientY
    })
    canvas.addEventListener('pointerup', () => (dragging = false))
    canvas.addEventListener('pointercancel', () => (dragging = false))
  }

  rotate(dx: number, dy: number): void {
    const s = 0.0021
    this.camera.rotation.y += dx * s
    this.camera.rotation.x += dy * s
    const lim = Math.PI / 2 - 0.02
    this.camera.rotation.x = Math.max(-lim, Math.min(lim, this.camera.rotation.x))
  }

  /** Touch / QA analog move, each in [-1, 1]. */
  setMove(fwd: number, side: number): void {
    this.moveInput.fwd = Math.max(-1, Math.min(1, fwd))
    this.moveInput.side = Math.max(-1, Math.min(1, side))
  }

  setCrouch(on: boolean): void {
    this.crouching = on
  }

  jump(): void {
    this.jumpQueued = true
  }

  get position(): Vector3 {
    return this.camera.position
  }

  forward(): Vector3 {
    const yaw = this.camera.rotation.y
    const pitch = this.camera.rotation.x
    return new Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      -Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    )
  }

  private syncCamera(): void {
    const feet = this.collider.position.y - BODY_HALF
    this.camera.position.x = this.collider.position.x
    this.camera.position.z = this.collider.position.z
    this.camera.position.y = feet + this.eye
  }

  update(dt: number): void {
    if (!this.enabled) {
      this.syncCamera()
      return
    }

    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
    this.crouching = this.crouching || this.keys.has('ControlLeft') || this.keys.has('ControlRight')
    const targetEye = this.crouching ? CROUCH_EYE : STAND_EYE
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 12)

    let fwd = this.moveInput.fwd
    let side = this.moveInput.side
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fwd += 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fwd -= 1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) side += 1
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) side -= 1
    fwd = Math.max(-1, Math.min(1, fwd))
    side = Math.max(-1, Math.min(1, side))

    const speed = this.crouching ? CROUCH_SPEED : sprint ? SPRINT : WALK
    const yaw = this.camera.rotation.y
    const f = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    const r = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
    const move = f.scale(fwd).add(r.scale(side))
    if (move.lengthSquared() > 1) move.normalize()
    move.scaleInPlace(speed * dt)

    // gravity + jump
    this.vy -= GRAVITY * dt
    if (this.grounded && this.jumpQueued && !this.crouching) {
      this.vy = JUMP_SPEED
      this.grounded = false
    }
    this.jumpQueued = false

    const disp = new Vector3(move.x, this.vy * dt, move.z)
    const prevY = this.collider.position.y
    this.collider.moveWithCollisions(disp)
    const dy = this.collider.position.y - prevY
    if (this.vy <= 0 && dy > this.vy * dt + 0.02) {
      this.grounded = true
      this.vy = 0
    } else {
      this.grounded = false
    }

    // shield regen
    const st = getState()
    if (st.shield < st.maxShield && st.elapsed - this.lastDamageAt > SHIELD_REGEN_DELAY) {
      setState({ shield: Math.min(st.maxShield, st.shield + SHIELD_REGEN_RATE * dt) })
    }

    this.syncCamera()
  }

  setInvuln(on: boolean): void {
    this.invuln = on
  }

  damage(amount: number): void {
    const st = getState()
    if (st.phase !== 'playing' || this.invuln) return
    this.lastDamageAt = st.elapsed
    let dmg = amount
    let shield = st.shield
    if (shield > 0) {
      const absorbed = Math.min(shield, dmg)
      shield -= absorbed
      dmg -= absorbed
    }
    const health = Math.max(0, st.health - dmg)
    setState({ shield, health })
    if (health <= 0) setState({ phase: 'defeat' })
  }

  teleport(pos: Vector3, yaw?: number, pitch?: number): void {
    this.collider.position.set(pos.x, BODY_HALF, pos.z)
    this.vy = 0
    this.grounded = false
    if (yaw !== undefined) this.camera.rotation.y = yaw
    if (pitch !== undefined) this.camera.rotation.x = pitch
    this.syncCamera()
  }

  resetVitals(): void {
    const st = getState()
    setState({ health: st.maxHealth, shield: st.maxShield })
    this.lastDamageAt = -999
  }

  requestLock(): void {
    if (getState().touchMode) return
    this.canvas.requestPointerLock?.()
  }
}

export function watchPointerLock(canvas: HTMLCanvasElement): void {
  document.addEventListener('pointerlockchange', () => {
    setState({ locked: document.pointerLockElement === canvas })
  })
}
