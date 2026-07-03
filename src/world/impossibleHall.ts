import { Mesh, MeshBuilder, StandardMaterial, Vector3 } from '@babylonjs/core'
import { MaterialKit, makeSignTexture } from '../core/materials'
import { roomShell, WorldRegistry } from './registry'

// The impossible interior of Exhibit I: a 26 × 36 × 13 vaulted gallery hiding
// 250 m east of the atrium. The pavilion it "fits inside" is 4.2 m wide.

export const HALL = {
  center: new Vector3(250, 0, 0),
  door: { position: new Vector3(237, 0, -2.5), yaw: Math.PI / 2, width: 1.6, height: 2.7 },
}

export interface HallHandles {
  monolith: Mesh
}

export function buildImpossibleHall(reg: WorldRegistry, mats: MaterialKit, toast: (t: string) => void): HallHandles {
  const scene = reg.scene
  const cx = 250
  const cz = 0

  roomShell(reg, 'hall', 'hall', cx, cz, 26, 36, 13, { wall: mats.concrete, floor: mats.floor, ceiling: mats.concreteDark }, [
    { side: 'w', offset: -2.5, width: 1.6, height: 2.7 },
  ])

  // columns
  for (const x of [cx - 7, cx + 7]) {
    for (let z = -14; z <= 14; z += 7) {
      const c = MeshBuilder.CreateCylinder(`hcol-${x}-${z}`, { height: 13, diameter: 0.95, tessellation: 24 }, scene)
      c.position.set(x, 6.5, cz + z)
      c.material = mats.concrete
      c.checkCollisions = true
      c.freezeWorldMatrix()
      reg.track('hall', c)
    }
  }

  // ceiling strips
  for (const x of [cx - 5, cx, cx + 5]) {
    reg.box('hall', `hstrip-${x}`, { w: 0.24, h: 0.06, d: 32 }, new Vector3(x, 12.8, cz), mats.emissiveWarm, { collide: false })
  }

  // floating monolith centerpiece
  const plinth = MeshBuilder.CreateCylinder('monolith-plinth', { height: 0.28, diameter: 2.8, tessellation: 32 }, scene)
  plinth.position.set(cx, 0.14, cz + 4)
  plinth.material = mats.ink
  plinth.checkCollisions = true
  plinth.freezeWorldMatrix()
  reg.track('hall', plinth)

  const ring = MeshBuilder.CreateTorus('monolith-ring', { diameter: 3.3, thickness: 0.05, tessellation: 48 }, scene)
  ring.position.set(cx, 0.34, cz + 4)
  ring.material = mats.emissiveWarm
  ring.checkCollisions = false
  ring.freezeWorldMatrix()
  reg.track('hall', ring)

  const monolith = MeshBuilder.CreateBox('monolith', { width: 1.3, height: 4.6, depth: 0.7 }, scene)
  monolith.position.set(cx, 3.4, cz + 4)
  monolith.material = mats.brass
  monolith.checkCollisions = true
  reg.track('hall', monolith) // not frozen — it rotates

  // benches
  for (const z of [-6, 12]) {
    reg.box('hall', `hbench-${z}`, { w: 2.2, h: 0.45, d: 0.6 }, new Vector3(cx - 4, 0.225, cz + z), mats.concreteDark)
  }

  // end wall sign
  const signMat = new StandardMaterial('hall-sign-mat', scene)
  const tex = makeSignTexture(scene, ['ROOM 402', 'exterior 4.2 m — interior 36 m', 'both measurements are correct'], { w: 1024, h: 384 })
  signMat.diffuseTexture = tex
  signMat.emissiveTexture = tex
  signMat.emissiveColor.set(0.6, 0.57, 0.52)
  const sign = MeshBuilder.CreatePlane('hall-sign', { width: 9, height: 3.4 }, scene)
  sign.position.set(cx + 12.8, 5.4, cz)
  sign.rotation.y = Math.PI / 2
  sign.material = signMat
  sign.checkCollisions = false
  sign.freezeWorldMatrix()
  reg.track('hall', sign)

  // teal accent strip at the far end
  reg.box('hall', 'hall-teal', { w: 0.12, h: 0.12, d: 30 }, new Vector3(cx + 12.6, 1.0, cz), mats.emissiveTeal, { collide: false })

  reg.addInteractable({
    id: 'monolith-note',
    position: new Vector3(cx, 1.6, cz + 4),
    radius: 3.4,
    prompt: 'E — curator’s note',
    enabled: () => true,
    onInteract: () =>
      toast('THE MONOLITH. Room 402 is a separate island of geometry. The doorway is a screen-space portal: a second camera mirrors your pose through the door mapping, and one step swaps the world under your feet.'),
  })

  return { monolith }
}
