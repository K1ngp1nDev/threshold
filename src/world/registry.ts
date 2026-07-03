import {
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core'
import type { ZoneId } from '../state'

// Sectors are disjoint islands of geometry in one scene. Far-apart islands +
// seamless teleports are what make the "impossible" layouts possible.
export type SectorId =
  | 'atrium'
  | 'hall' // the impossible interior behind the door
  | 'corridor'
  | 'reading-room' // full-size version of the diorama
  | 'mirror'

export interface ZoneBox {
  zone: ZoneId
  min: Vector3
  max: Vector3
}

export interface Interactable {
  id: string
  position: Vector3
  radius: number
  prompt: string
  onInteract: () => void
  enabled: () => boolean
}

export class WorldRegistry {
  readonly scene: Scene
  readonly sectorMeshes = new Map<SectorId, Mesh[]>()
  readonly zones: ZoneBox[] = []
  readonly interactables: Interactable[] = []

  constructor(scene: Scene) {
    this.scene = scene
  }

  track(sector: SectorId, mesh: Mesh): Mesh {
    let list = this.sectorMeshes.get(sector)
    if (!list) {
      list = []
      this.sectorMeshes.set(sector, list)
    }
    list.push(mesh)
    return mesh
  }

  meshesOf(...sectors: SectorId[]): Mesh[] {
    const out: Mesh[] = []
    for (const s of sectors) out.push(...(this.sectorMeshes.get(s) ?? []))
    return out
  }

  addZone(zone: ZoneId, min: Vector3, max: Vector3): void {
    this.zones.push({ zone, min, max })
  }

  zoneAt(p: Vector3): ZoneId | null {
    for (const z of this.zones) {
      if (
        p.x >= z.min.x && p.x <= z.max.x &&
        p.y >= z.min.y && p.y <= z.max.y &&
        p.z >= z.min.z && p.z <= z.max.z
      ) {
        return z.zone
      }
    }
    return null
  }

  addInteractable(i: Interactable): void {
    this.interactables.push(i)
  }

  // ---- geometry helpers -------------------------------------------------

  box(
    sector: SectorId,
    name: string,
    size: { w: number; h: number; d: number },
    pos: Vector3,
    mat: StandardMaterial,
    opts: { collide?: boolean; rotY?: number } = {},
  ): Mesh {
    const m = MeshBuilder.CreateBox(name, { width: size.w, height: size.h, depth: size.d }, this.scene)
    m.position.copyFrom(pos)
    if (opts.rotY) m.rotation.y = opts.rotY
    m.material = mat
    m.checkCollisions = opts.collide !== false
    m.freezeWorldMatrix()
    return this.track(sector, m)
  }
}

export interface Opening {
  side: 'n' | 's' | 'e' | 'w'
  offset: number // along the wall, from wall center
  width: number
  height: number
}

/**
 * Builds floor, ceiling and four walls (with door openings) for a rectangular
 * room. Walls sit just outside the given inner bounds.
 */
export function roomShell(
  reg: WorldRegistry,
  sector: SectorId,
  name: string,
  cx: number,
  cz: number,
  w: number,
  d: number,
  h: number,
  mats: { wall: StandardMaterial; floor: StandardMaterial; ceiling?: StandardMaterial },
  openings: Opening[] = [],
  opts: { skipSides?: ('n' | 's' | 'e' | 'w')[]; wallT?: number; skipCeiling?: boolean; skipFloor?: boolean } = {},
): void {
  const t = opts.wallT ?? 0.35
  if (!opts.skipFloor) {
    reg.box(sector, `${name}-floor`, { w: w + t * 2, h: 0.3, d: d + t * 2 }, new Vector3(cx, -0.15, cz), mats.floor)
  }
  if (!opts.skipCeiling) {
    reg.box(sector, `${name}-ceil`, { w: w + t * 2, h: 0.3, d: d + t * 2 }, new Vector3(cx, h + 0.15, cz), mats.ceiling ?? mats.wall)
  }

  const sides: ('n' | 's' | 'e' | 'w')[] = ['n', 's', 'e', 'w']
  for (const side of sides) {
    if (opts.skipSides?.includes(side)) continue
    const along = side === 'n' || side === 's' ? w : d
    const ops = openings
      .filter((o) => o.side === side)
      .sort((a, b) => a.offset - b.offset)

    // wall segments between openings (in wall-local coords: -along/2..along/2)
    const spans: { from: number; to: number }[] = []
    let cursor = -along / 2
    for (const o of ops) {
      const a = o.offset - o.width / 2
      const b = o.offset + o.width / 2
      if (a > cursor + 0.01) spans.push({ from: cursor, to: a })
      cursor = b
    }
    if (cursor < along / 2 - 0.01) spans.push({ from: cursor, to: along / 2 })

    const place = (from: number, to: number, y: number, height: number, idx: number) => {
      const len = to - from
      const mid = (from + to) / 2
      let pos: Vector3
      let size: { w: number; h: number; d: number }
      if (side === 'n' || side === 's') {
        const z = side === 'n' ? cz + d / 2 + t / 2 : cz - d / 2 - t / 2
        pos = new Vector3(cx + mid, y + height / 2, z)
        size = { w: len, h: height, d: t }
      } else {
        const x = side === 'e' ? cx + w / 2 + t / 2 : cx - w / 2 - t / 2
        pos = new Vector3(x, y + height / 2, cz + mid)
        size = { w: t, h: height, d: len }
      }
      reg.box(sector, `${name}-${side}-${idx}`, size, pos, mats.wall)
    }

    spans.forEach((s, i) => place(s.from, s.to, 0, h, i))
    // lintels above openings
    ops.forEach((o, i) => {
      if (o.height < h - 0.01) {
        place(o.offset - o.width / 2, o.offset + o.width / 2, o.height, h - o.height, 100 + i)
      }
    })
  }
}
