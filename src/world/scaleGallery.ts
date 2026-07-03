import {
  Color3,
  Mesh,
  MeshBuilder,
  PointLight,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core'
import { MaterialKit, makeSignTexture } from '../core/materials'
import { mulberry32 } from '../core/rng'
import { roomShell, WorldRegistry, SectorId } from './registry'
import type { Player } from '../core/player'

// Exhibit III — Scale Gallery. A dollhouse-sized reading room on a pedestal;
// interact and the camera dives in, and the exact same room is real around
// you. Inside, on a table, the model sits again.

export const READING_ROOM_ORIGIN = new Vector3(0, 0, -300)
export const READING_ROOM_ENTRY = { pos: new Vector3(0, 1.8, -302.2), yaw: 0.15 }

interface RoomOpts {
  ceiling: boolean
  recurse: boolean
  collide: boolean
  /** museum-model style: open the south wall so the interior reads at a glance */
  cutSouth?: boolean
}

function buildReadingRoom(
  reg: WorldRegistry,
  mats: MaterialKit,
  sector: SectorId,
  origin: Vector3,
  s: number,
  opts: RoomOpts,
): void {
  const scene = reg.scene
  const o = origin
  const P = (x: number, y: number, z: number) => new Vector3(o.x + x * s, o.y + y * s, o.z + z * s)
  const tag = `rr-${sector}-${s}-${o.z}`
  const col = opts.collide

  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: StandardMaterial, collide = col) =>
    reg.box(sector, `${tag}-${name}`, { w: w * s, h: h * s, d: d * s }, P(x, y, z), mat, { collide })

  // shell — 9 × 7 × 4.2
  const t = 0.32
  box('floor', 9 + t * 2, 0.3, 7 + t * 2, 0, -0.15, 0, mats.floor)
  if (opts.ceiling) box('ceil', 9 + t * 2, 0.3, 7 + t * 2, 0, 4.35, 0, mats.concreteDark)
  box('wall-n', 9 + t * 2, 4.2, t, 0, 2.1, 3.5 + t / 2, mats.plaster)
  if (!opts.cutSouth) box('wall-s', 9 + t * 2, 4.2, t, 0, 2.1, -3.5 - t / 2, mats.plaster)
  box('wall-e', t, 4.2, 7, 4.5 + t / 2, 2.1, 0, mats.plaster)
  box('wall-w', t, 4.2, 7, -4.5 - t / 2, 2.1, 0, mats.plaster)

  // rug + desk + chair
  const rug = new StandardMaterial(`${tag}-rug`, scene)
  rug.diffuseColor = new Color3(0.16, 0.28, 0.27)
  rug.specularColor = Color3.Black()
  box('rug', 3.4, 0.024, 2.4, 0, 0.02, -0.4, rug, false)
  box('desk-top', 2.4, 0.09, 1.05, 0, 0.79, 2.6, mats.brass, col)
  box('desk-l', 0.09, 0.75, 0.95, -1.12, 0.375, 2.6, mats.ink, col)
  box('desk-r', 0.09, 0.75, 0.95, 1.12, 0.375, 2.6, mats.ink, col)
  box('chair-seat', 0.52, 0.07, 0.52, 0, 0.45, 1.6, mats.ink, col)
  box('chair-back', 0.52, 0.62, 0.07, 0, 0.79, 1.88, mats.ink, false)

  // desk lamp
  box('lamp-stem', 0.05, 0.4, 0.05, 0.75, 1.03, 2.7, mats.ink, false)
  const bulb = MeshBuilder.CreateSphere(`${tag}-bulb`, { diameter: 0.2 * s, segments: 12 }, scene)
  bulb.position = P(0.75, 1.3, 2.7)
  bulb.material = mats.emissiveWarm
  bulb.checkCollisions = false
  bulb.freezeWorldMatrix()
  reg.track(sector, bulb)

  // west bookshelf: shelves + merged books
  const bookMats = [mats.brass, mats.ink, (() => {
    const m = new StandardMaterial(`${tag}-bookteal`, scene)
    m.diffuseColor = new Color3(0.22, 0.42, 0.4)
    m.specularColor = Color3.Black()
    return m
  })()]
  const rnd = mulberry32(90210)
  for (let i = 0; i < 3; i++) {
    const shelfY = 0.75 + i * 0.85
    box(`shelf-${i}`, 0.3, 0.06, 5.6, -4.28, shelfY, 0, mats.ink, false)
    const groups: Mesh[][] = [[], [], []]
    for (let k = 0; k < 9; k++) {
      const h = 0.42 + rnd() * 0.22
      const b = MeshBuilder.CreateBox(`${tag}-book-${i}-${k}`, { width: 0.22 * s, height: h * s, depth: 0.13 * s }, scene)
      b.position = P(-4.24, shelfY + 0.03 + h / 2, -2.3 + k * 0.55)
      groups[Math.floor(rnd() * 3)].push(b)
    }
    groups.forEach((g, gi) => {
      if (!g.length) return
      const merged = Mesh.MergeMeshes(g, true, false, undefined, false, false)
      if (merged) {
        merged.material = bookMats[gi]
        merged.checkCollisions = false
        merged.freezeWorldMatrix()
        reg.track(sector, merged)
      }
    })
  }

  if (!opts.cutSouth) {
    // "the way you came" — a locked decorative door on the south wall
    box('door-frame-l', 0.12, 2.2, 0.12, 2.1, 1.1, -3.44, mats.brass, false)
    box('door-frame-r', 0.12, 2.2, 0.12, 3.2, 1.1, -3.44, mats.brass, false)
    box('door-frame-t', 1.22, 0.12, 0.12, 2.65, 2.2, -3.44, mats.brass, false)
    box('door-panel', 1.0, 2.1, 0.08, 2.65, 1.05, -3.42, mats.ink, false)
  }

  if (opts.ceiling) {
    // pendant light
    box('pendant-cord', 0.03, 0.7, 0.03, 0, 3.85, -0.4, mats.ink, false)
    box('pendant', 0.85, 0.06, 0.85, 0, 3.5, -0.4, mats.emissiveWarm, false)
  }

  if (s === 1) {
    // full-size extras: plaque + sign
    const signMat = new StandardMaterial(`${tag}-sign`, scene)
    const tex = makeSignTexture(scene, ['THE READING ROOM', 'scale 1 : 1', 'previously 1 : 11'], { w: 512, h: 256 })
    signMat.diffuseTexture = tex
    signMat.emissiveTexture = tex
    signMat.emissiveColor.set(0.55, 0.52, 0.48)
    const sign = MeshBuilder.CreatePlane(`${tag}-wallsign`, { width: 1.7, height: 0.85 }, scene)
    sign.position = P(-2.4, 2.3, 3.42)
    sign.rotation.y = Math.PI
    sign.material = signMat
    sign.checkCollisions = false
    sign.freezeWorldMatrix()
    reg.track(sector, sign)
  }

  if (opts.recurse) {
    // the model of the room, inside the room
    box('mini-pedestal', 1.0, 1.02, 1.0, 2.9, 0.51, -1.9, mats.ink, col)
    buildReadingRoom(reg, mats, sector, P(2.9, 1.06, -1.9), 0.09 * s, { ceiling: false, recurse: false, collide: false, cutSouth: true })
  }
}

export interface GalleryHandles {
  lights: { light: PointLight; sectors: SectorId[] }[]
}

export function buildScaleGallery(
  reg: WorldRegistry,
  mats: MaterialKit,
  player: Player,
  toast: (t: string) => void,
): GalleryHandles {
  const scene: Scene = reg.scene

  // --- gallery room, attached west of the atrium
  roomShell(reg, 'atrium', 'gallery', -20.35, -4, 10, 8, 4.5, { wall: mats.concrete, floor: mats.floor, ceiling: mats.concreteDark }, [], {
    skipSides: ['e'],
    skipFloor: true,
  })
  reg.box('atrium', 'gallery-floor', { w: 10.35, h: 0.3, d: 8.7 }, new Vector3(-20.525, -0.15, -4), mats.floor)
  reg.box('atrium', 'gallery-strip', { w: 7, h: 0.05, d: 0.2 }, new Vector3(-20.35, 4.42, -4), mats.emissiveWarm, { collide: false })

  // pedestal with the dollhouse
  reg.box('atrium', 'gallery-pedestal', { w: 1.25, h: 1.02, d: 1.25 }, new Vector3(-20.5, 0.51, -4), mats.ink)
  buildReadingRoom(reg, mats, 'atrium', new Vector3(-20.5, 1.06, -4), 0.09, { ceiling: false, recurse: false, collide: false, cutSouth: true })

  // gallery signage
  const signMat = new StandardMaterial('gallery-sign-mat', scene)
  const tex = makeSignTexture(scene, ['III — SCALE GALLERY', 'do not lean into the exhibit', '(step into it instead)'], { w: 640, h: 300 })
  signMat.diffuseTexture = tex
  signMat.emissiveTexture = tex
  signMat.emissiveColor.set(0.55, 0.52, 0.48)
  const sign = MeshBuilder.CreatePlane('gallery-sign', { width: 2.6, height: 1.2 }, scene)
  sign.position.set(-20.35, 2.6, 0.28)
  sign.rotation.y = Math.PI
  sign.material = signMat
  sign.checkCollisions = false
  sign.freezeWorldMatrix()
  reg.track('atrium', sign)

  // --- the full-size reading room, far away at z = −300
  buildReadingRoom(reg, mats, 'reading-room', READING_ROOM_ORIGIN, 1, { ceiling: true, recurse: true, collide: true })

  // (dive/exit interactions are driven by the director in BREACH)
  void player
  void toast

  // --- lights
  const galleryLight = new PointLight('gallery-light', new Vector3(-20.3, 3.5, -4), scene)
  galleryLight.diffuse = new Color3(1.0, 0.86, 0.66)
  galleryLight.intensity = 0.75
  galleryLight.range = 15

  const rrLight = new PointLight('rr-light', new Vector3(1.0, 3.1, -300.6), scene)
  rrLight.diffuse = new Color3(1.0, 0.84, 0.6)
  rrLight.intensity = 1.0
  rrLight.range = 14

  return {
    lights: [
      { light: galleryLight, sectors: ['atrium'] },
      { light: rrLight, sectors: ['reading-room'] },
    ],
  }
}
