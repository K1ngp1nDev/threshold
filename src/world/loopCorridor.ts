import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  PointLight,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core'
import { MaterialKit, PALETTE } from '../core/materials'
import type { Player } from '../core/player'
import { WorldRegistry } from './registry'

// Wing II — Loop Corridor. A corridor of identical segments; in BREACH the
// "loop" reads through repeated geometry and enemies spawning behind you.

const X_MIN = -7.1
const X_MAX = -4.9
const H = 3.2
const SEG = 14 // segment length
const Z0 = 300 // corridor start
const LOCK_ATRIUM_Z = 10 // atrium-side light-lock starts here
const LOCK_CORRIDOR_Z = 296

export interface CorridorHandles {
  lights: PointLight[]
}

function buildLightLock(reg: WorldRegistry, mats: MaterialKit, zStart: number, sector: 'atrium' | 'corridor'): void {
  const t = 0.35
  const zEnd = zStart + 4
  // side walls
  reg.box(sector, `lock-w-${zStart}`, { w: t, h: 2.6, d: 4 }, new Vector3(X_MIN - t / 2, 1.3, zStart + 2), mats.ink)
  // east wall gets a join opening only on the corridor side (z 298.0–299.2)
  if (sector === 'corridor') {
    reg.box(sector, `lock-e-a-${zStart}`, { w: t, h: 2.6, d: 2.0 }, new Vector3(X_MAX + t / 2, 1.3, zStart + 1.0), mats.ink)
    reg.box(sector, `lock-e-b-${zStart}`, { w: t, h: 2.6, d: 0.8 }, new Vector3(X_MAX + t / 2, 1.3, zStart + 3.6), mats.ink)
    reg.box(sector, `lock-e-lintel-${zStart}`, { w: t, h: 0.2, d: 1.2 }, new Vector3(X_MAX + t / 2, 2.5, zStart + 2.6), mats.ink)
  } else {
    reg.box(sector, `lock-e-${zStart}`, { w: t, h: 2.6, d: 4 }, new Vector3(X_MAX + t / 2, 1.3, zStart + 2), mats.ink)
  }
  // baffles — offset walls so you can never see through the lock
  reg.box(sector, `lock-baffle-a-${zStart}`, { w: 1.3, h: 2.6, d: 0.22 }, new Vector3(X_MIN + 0.65, 1.3, zStart + 1.6), mats.ink)
  reg.box(sector, `lock-baffle-b-${zStart}`, { w: 1.3, h: 2.6, d: 0.22 }, new Vector3(X_MAX - 0.65, 1.3, zStart + 2.6), mats.ink)
  // floor & ceiling
  reg.box(sector, `lock-floor-${zStart}`, { w: 2.2 + t * 2, h: 0.3, d: 4.4 }, new Vector3(-6, -0.15, zStart + 2), mats.ink)
  reg.box(sector, `lock-ceil-${zStart}`, { w: 2.2 + t * 2, h: 0.3, d: 4.4 }, new Vector3(-6, 2.75, zStart + 2), mats.ink)
  // faint guide strip
  reg.box(sector, `lock-strip-${zStart}`, { w: 0.05, h: 0.02, d: 3.6 }, new Vector3(-6, 0.02, zStart + 2), mats.emissiveTeal, { collide: false })
  void zEnd
}

export function buildLoopCorridor(
  reg: WorldRegistry,
  mats: MaterialKit,
  player: Player,
  toast: (t: string) => void,
): CorridorHandles {
  const scene = reg.scene
  const t = 0.35
  const zEnd = Z0 + SEG * 3 // 342

  // --- light-locks (identical geometry at both ends of the jump)
  buildLightLock(reg, mats, LOCK_ATRIUM_Z, 'atrium')
  buildLightLock(reg, mats, LOCK_CORRIDOR_Z, 'corridor')

  // --- corridor shell
  reg.box('corridor', 'cor-w', { w: t, h: H, d: zEnd - Z0 }, new Vector3(X_MIN - t / 2, H / 2, (Z0 + zEnd) / 2), mats.concrete)
  // east wall with exit opening at z 320.4–322.6
  reg.box('corridor', 'cor-e-a', { w: t, h: H, d: 320.4 - Z0 }, new Vector3(X_MAX + t / 2, H / 2, (Z0 + 320.4) / 2), mats.concrete)
  reg.box('corridor', 'cor-e-b', { w: t, h: H, d: zEnd - 322.6 }, new Vector3(X_MAX + t / 2, H / 2, (322.6 + zEnd) / 2), mats.concrete)
  reg.box('corridor', 'cor-e-lintel', { w: t, h: H - 2.6, d: 2.2 }, new Vector3(X_MAX + t / 2, 2.6 + (H - 2.6) / 2, 321.5), mats.concrete)
  reg.box('corridor', 'cor-n', { w: 2.2 + t * 2, h: H, d: t }, new Vector3(-6, H / 2, zEnd + t / 2), mats.concrete)
  reg.box('corridor', 'cor-floor', { w: 2.2 + t * 2, h: 0.3, d: zEnd - Z0 }, new Vector3(-6, -0.15, (Z0 + zEnd) / 2), mats.floor)
  reg.box('corridor', 'cor-ceil', { w: 2.2 + t * 2, h: 0.3, d: zEnd - Z0 }, new Vector3(-6, H + 0.15, (Z0 + zEnd) / 2), mats.concreteDark)

  // --- per-segment dressing
  const plaqueTex = new DynamicTexture('cor-plaque', { width: 640, height: 384 }, scene, true)
  const plaqueMat = new StandardMaterial('cor-plaque-mat', scene)
  plaqueMat.diffuseTexture = plaqueTex
  plaqueMat.emissiveTexture = plaqueTex
  plaqueMat.emissiveColor.set(0.5, 0.48, 0.44)
  plaqueMat.specularColor.set(0.02, 0.02, 0.02)

  const accentMat = new StandardMaterial('cor-accent', scene)
  accentMat.emissiveColor = PALETTE.warmLight.clone()
  accentMat.diffuseColor = Color3.Black()
  accentMat.disableLighting = true

  const artifacts: Mesh[][] = []
  const cardSigns: Mesh[] = []

  for (let i = 0; i < 3; i++) {
    const base = Z0 + i * SEG
    // plaque
    const plaque = MeshBuilder.CreatePlane(`cor-plaque-${i}`, { width: 1.5, height: 0.9 }, scene)
    plaque.position.set(X_MIN + 0.02, 1.7, base + 7)
    plaque.rotation.y = Math.PI / 2
    plaque.material = plaqueMat
    plaque.checkCollisions = false
    plaque.freezeWorldMatrix()
    reg.track('corridor', plaque)

    // pedestal + swappable artifacts
    reg.box('corridor', `cor-ped-${i}`, { w: 0.5, h: 1.05, d: 0.5 }, new Vector3(-5.45, 0.525, base + 3), mats.ink)
    const y = 1.32
    const sphere = MeshBuilder.CreateSphere(`cor-art-s-${i}`, { diameter: 0.32, segments: 16 }, scene)
    sphere.position.set(-5.45, y, base + 3)
    const cube = MeshBuilder.CreateBox(`cor-art-c-${i}`, { size: 0.3 }, scene)
    cube.position.set(-5.45, y, base + 3)
    cube.rotation.y = 0.6
    const torus = MeshBuilder.CreateTorus(`cor-art-t-${i}`, { diameter: 0.38, thickness: 0.06, tessellation: 32 }, scene)
    torus.position.set(-5.45, y + 0.02, base + 3)
    torus.rotation.x = Math.PI / 3
    for (const m of [sphere, cube, torus]) {
      m.material = mats.brass
      m.checkCollisions = false
      m.freezeWorldMatrix()
      reg.track('corridor', m)
      m.setEnabled(false)
    }
    artifacts.push([sphere, cube, torus])

    const card = MeshBuilder.CreatePlane(`cor-card-${i}`, { width: 0.34, height: 0.2 }, scene)
    card.position.set(-5.45, 1.22, base + 3)
    card.rotation.y = Math.PI / 2
    card.material = mats.emissiveTeal
    card.checkCollisions = false
    card.freezeWorldMatrix()
    card.setEnabled(false)
    reg.track('corridor', card)
    cardSigns.push(card)

    // ceiling strips + sconces
    for (const dz of [3.5, 10.5]) {
      reg.box('corridor', `cor-strip-${i}-${dz}`, { w: 0.16, h: 0.04, d: 3.2 }, new Vector3(-6, H - 0.08, base + dz), mats.emissiveWarm, { collide: false })
    }
    for (const dz of [3, 11]) {
      const sc = reg.box('corridor', `cor-sconce-${i}-${dz}`, { w: 0.06, h: 0.5, d: 0.1 }, new Vector3(X_MIN + 0.03, 2.2, base + dz), mats.ink, { collide: false })
      sc.material = accentMat
    }

    void toast
  }

  // --- exit door + chamber + service corridor back (sealed in BREACH)
  const doorMat = mats.brass
  reg.box('corridor', 'cor-exit-door', { w: 0.12, h: 2.55, d: 2.15 }, new Vector3(-4.72, 1.275, 321.5), doorMat)
  const lockedSign = MeshBuilder.CreatePlane('cor-exit-sign', { width: 1.1, height: 0.4 }, scene)
  lockedSign.position.set(-4.86, 2.15, 321.5)
  lockedSign.rotation.y = Math.PI / 2
  lockedSign.material = mats.emissiveTeal
  lockedSign.checkCollisions = false
  lockedSign.freezeWorldMatrix()
  reg.track('corridor', lockedSign)

  // chamber east of the opening
  reg.box('corridor', 'cham-n', { w: 1.95, h: 2.6, d: t }, new Vector3(-3.575, 1.3, 322.8 + t / 2), mats.ink)
  reg.box('corridor', 'cham-e', { w: t, h: 2.6, d: 2.6 + t }, new Vector3(-2.6 + t / 2, 1.3, 321.5), mats.ink)
  // south wall with opening for the service corridor (x −4.55…−3.35)
  reg.box('corridor', 'cham-s', { w: 0.75, h: 2.6, d: t }, new Vector3(-2.975, 1.3, 320.2 - t / 2), mats.ink)
  reg.box('corridor', 'cham-floor', { w: 1.95, h: 0.3, d: 2.6 }, new Vector3(-3.575, -0.15, 321.5), mats.ink)
  reg.box('corridor', 'cham-ceil', { w: 1.95, h: 0.3, d: 2.6 }, new Vector3(-3.575, 2.75, 321.5), mats.ink)

  // service corridor south to the light-lock join
  reg.box('corridor', 'svc-e', { w: t, h: 2.4, d: 322.55 - 297.65 }, new Vector3(-3.35 + t / 2, 1.2, (297.65 + 322.55) / 2), mats.ink)
  reg.box('corridor', 'svc-s', { w: 1.2 + t, h: 2.4, d: t }, new Vector3(-3.95, 1.2, 298.0 - t / 2), mats.ink)
  reg.box('corridor', 'svc-floor', { w: 1.2, h: 0.3, d: 322.4 - 298 }, new Vector3(-3.95, -0.15, (298 + 322.4) / 2), mats.ink)
  reg.box('corridor', 'svc-ceil', { w: 1.2, h: 0.3, d: 322.4 - 298 }, new Vector3(-3.95, 2.55, (298 + 322.4) / 2), mats.ink)
  for (const z of [302, 310, 318]) {
    reg.box('corridor', `svc-strip-${z}`, { w: 0.05, h: 0.02, d: 4 }, new Vector3(-3.95, 0.02, z), mats.emissiveTeal, { collide: false })
  }

  // --- corridor lights
  const lights: PointLight[] = []
  for (const z of [304, 313, 322, 331, 340]) {
    const l = new PointLight(`cor-light-${z}`, new Vector3(-6, 2.9, z), scene)
    l.diffuse = PALETTE.warmLight.clone()
    l.intensity = 1.15
    l.range = 17
    lights.push(l)
  }

  // static catalogue dressing (the "loop" now reads through repeated segments
  // and enemies spawning behind you, not player teleport gates)
  const ctx = plaqueTex.getContext() as CanvasRenderingContext2D
  const w = 640
  const h = 384
  ctx.fillStyle = '#1a1815'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(201,163,92,0.85)'
  ctx.lineWidth = 4
  ctx.strokeRect(10, 10, w - 20, h - 20)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#f4efe7'
  ctx.font = '600 40px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText('WING II — LOOP CORRIDOR', w / 2, 130, w - 60)
  ctx.fillStyle = 'rgba(244,239,231,0.72)'
  ctx.font = '400 30px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText('the corridor folds back', w / 2, 215, w - 60)
  ctx.fillText('watch behind you', w / 2, 270, w - 60)
  plaqueTex.update()

  artifacts.forEach((set, i) => {
    set.forEach((m, j) => m.setEnabled(j === 0))
    cardSigns[i].setEnabled(false)
  })
  accentMat.emissiveColor = PALETTE.warmLight.clone()

  return { lights }
}
