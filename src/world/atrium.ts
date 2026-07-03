import { Mesh, MeshBuilder, Scene, Vector3 } from '@babylonjs/core'
import { MaterialKit, makeSignTexture, PALETTE } from '../core/materials'
import { roomShell, WorldRegistry } from './registry'
import { StandardMaterial } from '@babylonjs/core'

// Main Atrium — 30 × 20 × 7. The visitor spawns here, facing the pavilion of
// Exhibit I. Openings: N → loop corridor, W → scale gallery, S → mirror atrium.

export const ATRIUM = {
  spawn: new Vector3(-11, 1.8, 2),
  spawnYaw: 1.85,
  pavilionDoor: { position: new Vector3(4.9, 0, -2.5), yaw: -Math.PI / 2, width: 1.6, height: 2.7 },
}

function signPlane(
  reg: WorldRegistry,
  scene: Scene,
  name: string,
  lines: string[],
  size: { w: number; h: number },
  pos: Vector3,
  yaw: number,
  opts: { bg?: string; accent?: string } = {},
): Mesh {
  const mat = new StandardMaterial(`${name}-mat`, scene)
  const tex = makeSignTexture(scene, lines, { w: 512, h: Math.round((512 * size.h) / size.w), bg: opts.bg, accent: opts.accent })
  mat.diffuseTexture = tex
  mat.emissiveTexture = tex
  mat.emissiveColor.set(0.55, 0.52, 0.48)
  mat.specularColor.set(0.02, 0.02, 0.02)
  const m = MeshBuilder.CreatePlane(name, { width: size.w, height: size.h }, scene)
  m.position.copyFrom(pos)
  m.rotation.y = yaw
  m.material = mat
  m.checkCollisions = false
  m.freezeWorldMatrix()
  return reg.track('atrium', m)
}

export function buildAtrium(reg: WorldRegistry, mats: MaterialKit, toast: (t: string) => void): void {
  const scene = reg.scene

  roomShell(reg, 'atrium', 'atrium', 0, 0, 30, 20, 7, { wall: mats.concrete, floor: mats.floor, ceiling: mats.concreteDark }, [
    { side: 'n', offset: -6, width: 1.8, height: 2.6 }, // loop corridor light-lock
    { side: 'w', offset: -4, width: 2.0, height: 2.8 }, // scale gallery
    { side: 's', offset: -6, width: 2.2, height: 3.0 }, // mirror atrium passage
  ])

  // ceiling light coves
  for (const z of [-5, 0, 5]) {
    reg.box('atrium', `strip-${z}`, { w: 22, h: 0.06, d: 0.22 }, new Vector3(0, 6.85, z), mats.emissiveWarm, { collide: false })
  }

  // --- Exhibit I pavilion: a 4.2 × 3.6 shed that cannot contain what's inside
  const px = 7
  const pz = -2.5
  const ph = 3.4
  // west face holds the doorway: two jambs + lintel
  reg.box('atrium', 'pav-w-a', { w: 0.3, h: ph, d: 1.0 }, new Vector3(px - 2.1 + 0.15, ph / 2, pz - 1.8 + 0.5), mats.concreteDark)
  reg.box('atrium', 'pav-w-b', { w: 0.3, h: ph, d: 1.0 }, new Vector3(px - 2.1 + 0.15, ph / 2, pz + 1.8 - 0.5), mats.concreteDark)
  reg.box('atrium', 'pav-w-lintel', { w: 0.3, h: ph - 2.7, d: 1.6 }, new Vector3(px - 2.1 + 0.15, 2.7 + (ph - 2.7) / 2, pz), mats.concreteDark)
  reg.box('atrium', 'pav-e', { w: 0.3, h: ph, d: 3.6 }, new Vector3(px + 2.1 - 0.15, ph / 2, pz), mats.concreteDark)
  reg.box('atrium', 'pav-n', { w: 4.2, h: ph, d: 0.3 }, new Vector3(px, ph / 2, pz + 1.8 - 0.15), mats.concreteDark)
  reg.box('atrium', 'pav-s', { w: 4.2, h: ph, d: 0.3 }, new Vector3(px, ph / 2, pz - 1.8 + 0.15), mats.concreteDark)
  reg.box('atrium', 'pav-roof', { w: 4.6, h: 0.25, d: 4.0 }, new Vector3(px, ph + 0.125, pz), mats.concreteDark)
  // interior floor (fallback only — normally you never stand inside)
  reg.box('atrium', 'pav-floor', { w: 4.2, h: 0.1, d: 3.6 }, new Vector3(px, 0.05, pz), mats.ink)

  // brass door frame
  const fd = ATRIUM.pavilionDoor
  const fx = fd.position.x - 0.02
  reg.box('atrium', 'frame-l', { w: 0.14, h: fd.height + 0.14, d: 0.14 }, new Vector3(fx, (fd.height + 0.14) / 2, pz - fd.width / 2 - 0.07), mats.brass, { collide: false })
  reg.box('atrium', 'frame-r', { w: 0.14, h: fd.height + 0.14, d: 0.14 }, new Vector3(fx, (fd.height + 0.14) / 2, pz + fd.width / 2 + 0.07), mats.brass, { collide: false })
  reg.box('atrium', 'frame-t', { w: 0.14, h: 0.14, d: fd.width + 0.28 }, new Vector3(fx, fd.height + 0.07, pz), mats.brass, { collide: false })

  signPlane(reg, scene, 'pav-sign', ['402', 'IMPOSSIBLE DOOR'], { w: 1.5, h: 0.75 }, new Vector3(px - 2.27, 3.0, pz), -Math.PI / 2)

  // exterior measurement markings — the joke you only get after entering
  signPlane(reg, scene, 'pav-measure', ['4.2 m', 'exterior, verified'], { w: 1.1, h: 0.55 }, new Vector3(px, 2.6, pz - 1.98), Math.PI, { bg: '#22201c' })

  // --- reception desk
  reg.box('atrium', 'desk', { w: 3.2, h: 1.05, d: 0.9 }, new Vector3(-2, 0.525, 6), mats.ink)
  reg.box('atrium', 'desk-top', { w: 3.4, h: 0.06, d: 1.0 }, new Vector3(-2, 1.08, 6), mats.brass, { collide: false })
  signPlane(reg, scene, 'desk-sign', ['THRESHOLD INSTITUTE', 'information'], { w: 1.6, h: 0.5 }, new Vector3(-2, 1.75, 5.62), Math.PI)

  // benches & plinths
  reg.box('atrium', 'bench-1', { w: 1.9, h: 0.45, d: 0.55 }, new Vector3(2, 0.225, -7.5), mats.concreteDark)
  reg.box('atrium', 'bench-2', { w: 1.9, h: 0.45, d: 0.55 }, new Vector3(-2.5, 0.225, 0.5), mats.concreteDark)
  for (const [i, [x, z]] of ([[-13, -8], [13, 8], [13, -8]] as const).entries()) {
    reg.box('atrium', `plinth-${i}`, { w: 0.5, h: 1.1, d: 0.5 }, new Vector3(x, 0.55, z), mats.ink)
    const s = MeshBuilder.CreateSphere(`plinth-orb-${i}`, { diameter: 0.34, segments: 16 }, scene)
    s.position.set(x, 1.3, z)
    s.material = mats.brass
    s.checkCollisions = false
    s.freezeWorldMatrix()
    reg.track('atrium', s)
  }

  // columns with brass bands, kept off the spawn sightline
  for (const [i, [x, z]] of ([[-3, -6], [3, 7]] as const).entries()) {
    const c = MeshBuilder.CreateCylinder(`col-${i}`, { height: 7, diameter: 0.85, tessellation: 24 }, scene)
    c.position.set(x, 3.5, z)
    c.material = mats.concrete
    c.checkCollisions = true
    c.freezeWorldMatrix()
    reg.track('atrium', c)
    const band = MeshBuilder.CreateCylinder(`col-band-${i}`, { height: 0.1, diameter: 0.9, tessellation: 24 }, scene)
    band.position.set(x, 2.1, z)
    band.material = mats.brass
    band.checkCollisions = false
    band.freezeWorldMatrix()
    reg.track('atrium', band)
  }

  // institute lettering on the east wall
  signPlane(reg, scene, 'inst-sign', ['THRESHOLD', 'museum of impossible spaces'], { w: 7, h: 2.6 }, new Vector3(14.8, 3.6, 3), Math.PI / 2, { bg: '#161411' })

  // wayfinding sign near spawn — kept off the spawn→door sightline
  reg.box('atrium', 'way-pole', { w: 0.08, h: 1.5, d: 0.08 }, new Vector3(-8.2, 0.75, 4.6), mats.ink)
  signPlane(
    reg, scene, 'way-sign',
    ['WAYFINDING', 'I door · II corridor', 'III gallery · IV mirror'],
    { w: 1.4, h: 0.9 },
    new Vector3(-8.2, 1.75, 4.6),
    -Math.PI / 2 + 0.85,
  )

  // dark framed panels on the north wall
  for (const x of [2, 6, 10]) {
    reg.box('atrium', `art-frame-${x}`, { w: 1.7, h: 2.3, d: 0.08 }, new Vector3(x, 3.2, 9.78), mats.brass, { collide: false })
    reg.box('atrium', `art-panel-${x}`, { w: 1.5, h: 2.1, d: 0.1 }, new Vector3(x, 3.2, 9.76), mats.ink, { collide: false })
  }

  // curator's note by the pavilion
  reg.addInteractable({
    id: 'pav-note',
    position: new Vector3(4.9, 1.4, -0.4),
    radius: 3.0,
    prompt: 'E — curator’s note',
    enabled: () => true,
    onInteract: () =>
      toast('EXHIBIT I. The far room is rendered to a texture in screen space; crossing the plane relocates you 232 m east. Nothing overlaps — everything lines up.'),
  })

  // teal accent above mirror passage
  reg.box('atrium', 'mirror-accent', { w: 2.6, h: 0.08, d: 0.08 }, new Vector3(-6, 3.25, -9.8), mats.emissiveTeal, { collide: false })
  void PALETTE
}
