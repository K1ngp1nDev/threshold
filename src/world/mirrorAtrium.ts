import {
  Color3,
  MeshBuilder,
  PointLight,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core'
import { MaterialKit, makeSignTexture, PALETTE } from '../core/materials'
import { roomShell, WorldRegistry } from './registry'
import type { Player } from '../core/player'

// Exhibit IV — Mirror Atrium. A wall of glass; behind it, the same room built
// mirrored by hand. The reflection is almost right: the statue faces the wrong
// way, the far door is open, the plaque answers back — and an amber presence
// stands exactly where you stand.

const MIRROR_X = 2 // reflection plane: x' = 4 − x
const mx = (x: number) => 4 - x

export interface MirrorHandles {
  updateOrb: (playerPos: Vector3, t: number, reduced: boolean) => void
}

export function buildMirrorAtrium(
  reg: WorldRegistry,
  mats: MaterialKit,
  player: Player,
  toast: (t: string) => void,
): MirrorHandles {
  const scene = reg.scene

  // --- entry passage from the atrium (z −10 … −12)
  const t = 0.35
  reg.box('mirror', 'mpass-w', { w: t, h: 3, d: 2 }, new Vector3(-7.1 - t / 2, 1.5, -11), mats.concrete)
  reg.box('mirror', 'mpass-e', { w: t, h: 3, d: 2 }, new Vector3(-4.9 + t / 2, 1.5, -11), mats.concrete)
  reg.box('mirror', 'mpass-ceil', { w: 2.2 + t * 2, h: 0.3, d: 2.4 }, new Vector3(-6, 3.15, -11), mats.concreteDark)
  reg.box('mirror', 'mpass-floor', { w: 2.2 + t * 2, h: 0.3, d: 2.6 }, new Vector3(-6, -0.15, -11.2), mats.floor)

  // --- the real room (x −14…2) and its handmade reflection (x 2…18)
  roomShell(reg, 'mirror', 'mirror-real', -6, -18, 16, 12, 6, { wall: mats.concrete, floor: mats.floor, ceiling: mats.concreteDark }, [
    { side: 'n', offset: 0, width: 2.2, height: 3 },
  ], { skipSides: ['e'] })
  roomShell(reg, 'mirror', 'mirror-twin', 10, -18, 16, 12, 6, { wall: mats.concreteDark, floor: mats.floor, ceiling: mats.concreteDark }, [
    { side: 'n', offset: 0, width: 2.2, height: 3 },
  ], { skipSides: ['w'] })

  // glass wall at x = 2 with brass mullions
  const glass = MeshBuilder.CreatePlane('mirror-glass', { width: 12, height: 6 }, scene)
  glass.position.set(MIRROR_X, 3, -18)
  glass.rotation.y = Math.PI / 2
  glass.material = mats.glass
  glass.checkCollisions = true
  glass.freezeWorldMatrix()
  reg.track('mirror', glass)
  for (const z of [-12, -16, -20, -24]) {
    reg.box('mirror', `mullion-${z}`, { w: 0.1, h: 6, d: 0.12 }, new Vector3(MIRROR_X, 3, z), mats.brass, { collide: false })
  }
  reg.box('mirror', 'mullion-top', { w: 0.1, h: 0.12, d: 12 }, new Vector3(MIRROR_X, 5.94, -18), mats.brass, { collide: false })
  reg.box('mirror', 'mullion-bot', { w: 0.1, h: 0.12, d: 12 }, new Vector3(MIRROR_X, 0.06, -18), mats.brass, { collide: false })

  // "off-brass" for the twin side — almost the same, and that's the point
  const offBrass = new StandardMaterial('off-brass', scene)
  offBrass.diffuseColor = new Color3(0.52, 0.5, 0.42)
  offBrass.specularColor = new Color3(0.35, 0.35, 0.32)
  offBrass.specularPower = 96

  // statue + its disagreeing twin
  const buildStatue = (x: number, rotY: number, mat: StandardMaterial) => {
    reg.box('mirror', `statue-plinth-${x}`, { w: 0.75, h: 1.0, d: 0.75 }, new Vector3(x, 0.5, -18), mats.ink)
    const knot = MeshBuilder.CreateTorusKnot(`statue-${x}`, { radius: 0.32, tube: 0.09, radialSegments: 64, tubularSegments: 24 }, scene)
    knot.position.set(x, 1.62, -18)
    knot.rotation.y = rotY
    knot.material = mat
    knot.checkCollisions = false
    knot.freezeWorldMatrix()
    reg.track('mirror', knot)
  }
  buildStatue(-8, 0.4, mats.brass)
  buildStatue(mx(-8), -1.9, offBrass) // the reflection turned away

  // plaques — the real one states, the reflected one replies (and is readable)
  const plaque = (x: number, yaw: number, lines: string[]) => {
    const m = new StandardMaterial(`mplaque-${x}`, scene)
    const tex = makeSignTexture(scene, lines, { w: 640, h: 300 })
    m.diffuseTexture = tex
    m.emissiveTexture = tex
    m.emissiveColor.set(0.55, 0.52, 0.48)
    const p = MeshBuilder.CreatePlane(`mplaque-mesh-${x}`, { width: 2.4, height: 1.1 }, scene)
    p.position.set(x, 2.4, -18)
    p.rotation.y = yaw
    p.material = m
    p.checkCollisions = false
    p.freezeWorldMatrix()
    reg.track('mirror', p)
  }
  plaque(-13.96, Math.PI / 2, ['IV — MIRROR ATRIUM', 'the reflection disagrees', 'please do not wave'])
  plaque(mx(-13.96), -Math.PI / 2, ['YOU WERE ALREADY HERE', 'it is rude to stare', ''])

  // south doors: closed on this side, open in the reflection
  const doorSet = (x: number, open: boolean) => {
    reg.box('mirror', `mdoor-frame-${x}`, { w: 1.3, h: 0.12, d: 0.12 }, new Vector3(x, 2.32, -23.9), mats.brass, { collide: false })
    reg.box('mirror', `mdoor-l-${x}`, { w: 0.12, h: 2.3, d: 0.12 }, new Vector3(x - 0.6, 1.15, -23.9), mats.brass, { collide: false })
    reg.box('mirror', `mdoor-r-${x}`, { w: 0.12, h: 2.3, d: 0.12 }, new Vector3(x + 0.6, 1.15, -23.9), mats.brass, { collide: false })
    if (open) {
      // dark void behind the ajar panel
      reg.box('mirror', `mdoor-void-${x}`, { w: 1.05, h: 2.2, d: 0.15 }, new Vector3(x, 1.1, -24.02), mats.ink, { collide: false })
      const panel = MeshBuilder.CreateBox(`mdoor-panel-${x}`, { width: 1.05, height: 2.2, depth: 0.07 }, scene)
      panel.position.set(x - 0.75, 1.1, -23.55)
      panel.rotation.y = 1.15
      panel.material = mats.ink
      panel.checkCollisions = false
      panel.freezeWorldMatrix()
      reg.track('mirror', panel)
    } else {
      reg.box('mirror', `mdoor-panel-${x}`, { w: 1.05, h: 2.2, d: 0.07 }, new Vector3(x, 1.1, -23.9), mats.ink, { collide: false })
    }
  }
  doorSet(-10, false)
  doorSet(mx(-10), true)

  // benches
  reg.box('mirror', 'mbench', { w: 1.9, h: 0.45, d: 0.55 }, new Vector3(-4, 0.225, -22), mats.concreteDark)
  reg.box('mirror', 'mbench-twin', { w: 1.9, h: 0.45, d: 0.55 }, new Vector3(mx(-4), 0.225, -22), mats.concreteDark)

  // ceiling strips both sides
  for (const x of [-10, -4]) {
    reg.box('mirror', `mstrip-${x}`, { w: 0.2, h: 0.05, d: 10 }, new Vector3(x, 5.9, -18), mats.emissiveWarm, { collide: false })
    reg.box('mirror', `mstrip-twin-${x}`, { w: 0.2, h: 0.05, d: 10 }, new Vector3(mx(x), 5.9, -18), mats.emissiveTeal, { collide: false })
  }

  // the presence — an amber orb standing where you stand, beyond the glass
  const orb = MeshBuilder.CreateSphere('mirror-orb', { diameter: 0.36, segments: 24 }, scene)
  orb.material = mats.amberOrb
  orb.checkCollisions = false
  orb.setEnabled(false)
  reg.track('mirror', orb)

  // light switch
  reg.box('mirror', 'switch-pole', { w: 0.08, h: 1.1, d: 0.08 }, new Vector3(-7.6, 0.55, -13.2), mats.ink)
  const switchBox = reg.box('mirror', 'switch-box', { w: 0.2, h: 0.26, d: 0.12 }, new Vector3(-7.6, 1.2, -13.2), mats.brass, { collide: false })
  void switchBox

  const realLight = new PointLight('mirror-light-real', new Vector3(-6, 4.9, -18), scene)
  realLight.diffuse = PALETTE.warmLight.clone()
  realLight.intensity = 0.6
  realLight.range = 22
  const twinLight = new PointLight('mirror-light-twin', new Vector3(10, 4.9, -18), scene)
  twinLight.diffuse = PALETTE.teal.clone()
  twinLight.intensity = 0.22
  twinLight.range = 22

  realLight.intensity = 0.78
  twinLight.intensity = 0.34 // the reflection keeps to the dark
  void toast

  return {
    updateOrb: (p: Vector3, time: number, reduced: boolean) => {
      const inside = p.x > -14 && p.x < 2 && p.z > -24 && p.z < -12
      orb.setEnabled(inside)
      if (!inside) return
      const bob = reduced ? 0 : Math.sin(time * 2.1) * 0.035
      orb.position.set(mx(p.x), p.y + bob, p.z)
    },
  }
}
