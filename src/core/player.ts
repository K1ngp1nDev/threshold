import { Scene, UniversalCamera, Vector3 } from '@babylonjs/core'
import { getState, setState } from '../state'

// First-person controller. Input is handled at window level (not Babylon's
// canvas-focused inputs) so it is deterministic for both humans and the QA driver.
// Movement is fed through camera.cameraDirection, which Babylon resolves with
// collisions + gravity (checkCollisions / applyGravity).

export class Player {
  readonly camera: UniversalCamera
  private keys = new Set<string>()
  private scene: Scene
  private canvas: HTMLCanvasElement
  enabled = true // false while onboarding/modal or cinematic transitions

  constructor(scene: Scene, canvas: HTMLCanvasElement, spawn: Vector3, yaw: number) {
    this.scene = scene
    this.canvas = canvas
    const cam = new UniversalCamera('player', spawn.clone(), scene)
    cam.minZ = 0.05
    cam.maxZ = 800
    cam.fov = 0.95
    cam.inertia = 0 // rotation applied manually; movement smoothing is ours
    cam.speed = 0 // built-in inputs unused
    cam.rotation.set(0, yaw, 0)
    cam.checkCollisions = true
    cam.applyGravity = true
    // eye sits near the top of the capsule: feet = eye − 1.62 m
    cam.ellipsoid = new Vector3(0.38, 0.9, 0.38)
    cam.ellipsoidOffset = new Vector3(0, 0.72, 0)
    cam.inputs.clear() // fully custom input
    scene.activeCamera = cam
    this.camera = cam

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return
      this.keys.add(e.code)
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.keys.clear())

    // Mouse look — pointer lock on desktop, drag anywhere (touch or mouse).
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas && this.enabled) {
        this.rotate(e.movementX, e.movementY)
      }
    })
    let dragging = false
    let lastX = 0
    let lastY = 0
    canvas.addEventListener('pointerdown', (e) => {
      if (document.pointerLockElement === canvas) return
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      canvas.setPointerCapture(e.pointerId)
    })
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging || !this.enabled) return
      this.rotate((e.clientX - lastX) * 1.6, (e.clientY - lastY) * 1.6)
      lastX = e.clientX
      lastY = e.clientY
    })
    canvas.addEventListener('pointerup', () => (dragging = false))
    canvas.addEventListener('pointercancel', () => (dragging = false))
  }

  private rotate(dx: number, dy: number): void {
    const s = 0.0021
    this.camera.rotation.y += dx * s
    this.camera.rotation.x += dy * s
    const lim = Math.PI / 2 - 0.02
    if (this.camera.rotation.x > lim) this.camera.rotation.x = lim
    if (this.camera.rotation.x < -lim) this.camera.rotation.x = -lim
  }

  isDown(code: string): boolean {
    return this.keys.has(code)
  }

  /** Called every frame before render. */
  update(): void {
    const cam = this.camera
    const dt = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.05)
    if (!this.enabled) return
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
    const speed = (sprint ? 6.4 : 3.8) * dt

    let fwd = 0
    let side = 0
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fwd += 1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fwd -= 1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) side += 1
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) side -= 1
    if (fwd === 0 && side === 0) return

    const yaw = cam.rotation.y
    const f = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    const r = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
    const move = f.scale(fwd).add(r.scale(side))
    move.normalize().scaleInPlace(speed)
    cam.cameraDirection.addInPlace(move)
  }

  /** Instant relocation (portals, QA, cinematic mode). */
  teleport(pos: Vector3, yaw?: number, pitch?: number): void {
    this.camera.position.copyFrom(pos)
    if (yaw !== undefined) this.camera.rotation.y = yaw
    if (pitch !== undefined) this.camera.rotation.x = pitch
    this.camera.cameraDirection.setAll(0)
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
