import {
  AbstractMesh,
  Color3,
  Engine,
  HemisphericLight,
  PointLight,
  Scene,
  Vector3,
} from '@babylonjs/core'
import { MaterialKit, PALETTE } from '../core/materials'
import { PortalPair } from '../core/portals'
import type { Player } from '../core/player'
import { WorldRegistry, SectorId } from './registry'
import { ATRIUM, buildAtrium } from './atrium'
import { buildImpossibleHall, HALL } from './impossibleHall'
import { buildLoopCorridor } from './loopCorridor'
import { buildScaleGallery, READING_ROOM_ENTRY } from './scaleGallery'
import { buildMirrorAtrium } from './mirrorAtrium'
import { getState } from '../state'
import { playWhoosh } from '../core/audio'

export interface Pose {
  pos: Vector3
  yaw: number
  pitch?: number
}

export interface Museum {
  registry: WorldRegistry
  spawn: Pose
  poses: Record<string, Pose>
  viewpoints: { id: string; label: string; pose: Pose }[]
  update: (engine: Engine) => void
}

export function buildMuseum(
  scene: Scene,
  mats: MaterialKit,
  player: Player,
  portalRatio: number,
  toast: (t: string) => void,
): Museum {
  const reg = new WorldRegistry(scene)

  // --- geometry
  buildAtrium(reg, mats, toast)
  const hall = buildImpossibleHall(reg, mats, toast)
  const corridor = buildLoopCorridor(reg, mats, player, toast)
  const gallery = buildScaleGallery(reg, mats, player, toast)
  const mirror = buildMirrorAtrium(reg, mats, player, toast)

  // --- the Impossible Door portal pair
  const portal = new PortalPair(scene, player, {
    a: ATRIUM.pavilionDoor,
    b: HALL.door,
    seenFromA: reg.meshesOf('hall'),
    seenFromB: reg.meshesOf('atrium', 'mirror'),
    portalRatio,
    glowAmp: 0.14,
    onCross: () => playWhoosh(),
  })

  // --- lights (scoped per sector so the 4-light material budget always holds)
  const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene)
  hemi.intensity = 0.46
  hemi.diffuse = new Color3(0.92, 0.89, 0.84)
  hemi.groundColor = new Color3(0.13, 0.12, 0.11)

  const scoped: { light: PointLight; sectors: SectorId[] }[] = []
  const pl = (name: string, pos: Vector3, color: Color3, intensity: number, range: number, sectors: SectorId[]) => {
    const l = new PointLight(name, pos, scene)
    l.diffuse = color
    l.intensity = intensity
    l.range = range
    scoped.push({ light: l, sectors })
    return l
  }

  pl('atrium-a', new Vector3(-7, 5.6, 3), PALETTE.warmLight, 0.8, 28, ['atrium'])
  pl('atrium-b', new Vector3(7, 5.6, -4), PALETTE.warmLight, 0.8, 28, ['atrium'])
  pl('hall-a', new Vector3(245, 9, -9), PALETTE.warmLight, 0.95, 44, ['hall'])
  pl('hall-b', new Vector3(255, 9, 9), PALETTE.warmLight, 0.95, 44, ['hall'])
  pl('hall-teal', new Vector3(261, 4, 0), PALETTE.teal, 0.4, 30, ['hall'])
  pl('diorama', new Vector3(-20.5, 2.4, -4), PALETTE.warmLight, 0.9, 4.5, ['atrium'])
  scoped.push(...gallery.lights)
  // corridor + mirror lights are created inside their builders; scope them too
  for (const l of corridor.lights) scoped.push({ light: l, sectors: ['corridor'] })
  for (const name of ['mirror-light-real', 'mirror-light-twin']) {
    const l = scene.getLightByName(name) as PointLight | null
    if (l) scoped.push({ light: l, sectors: ['mirror'] })
  }

  for (const { light, sectors } of scoped) {
    light.includedOnlyMeshes = reg.meshesOf(...sectors) as AbstractMesh[]
  }

  // --- zones (checked in order; atrium is the fallback and must stay last)
  reg.addZone('impossible-door', new Vector3(4.4, 0, -4.8), new Vector3(9.6, 8, -0.4))
  reg.addZone('impossible-door', new Vector3(236, 0, -19), new Vector3(264, 14, 19))
  reg.addZone('loop-corridor', new Vector3(-7.6, 0, 10.2), new Vector3(-4.4, 4, 14.4))
  reg.addZone('loop-corridor', new Vector3(-8, 0, 295), new Vector3(-2.4, 4, 344))
  reg.addZone('scale-gallery', new Vector3(-26, 0, -8.8), new Vector3(-15, 5, 0.6))
  reg.addZone('scale-gallery', new Vector3(-5.5, 0, -304.5), new Vector3(5.5, 5, -295.5))
  reg.addZone('mirror-atrium', new Vector3(-14.5, 0, -24.8), new Vector3(2.2, 7, -9.6))
  reg.addZone('atrium', new Vector3(-16, 0, -11), new Vector3(16, 8, 11))

  // --- named poses (QA + screenshots + cinematic tour)
  const poses: Record<string, Pose> = {
    entrance: { pos: ATRIUM.spawn.clone(), yaw: ATRIUM.spawnYaw, pitch: 0.02 },
    atrium: { pos: new Vector3(-2, 1.8, 6.5), yaw: Math.PI + 0.5, pitch: 0.04 },
    'impossible-door': { pos: new Vector3(0.4, 1.8, -2.5), yaw: 1.45, pitch: 0 },
    hall: { pos: new Vector3(244.5, 1.8, -6.5), yaw: 0.48, pitch: -0.02 },
    'loop-corridor': { pos: new Vector3(-6, 1.8, 312.3), yaw: 0.03, pitch: 0.02 },
    'scale-gallery': { pos: new Vector3(-18.5, 1.75, -5.5), yaw: -0.9, pitch: 0.34 },
    'reading-room': { pos: READING_ROOM_ENTRY.pos.clone(), yaw: READING_ROOM_ENTRY.yaw, pitch: 0.03 },
    'mirror-atrium': { pos: new Vector3(-11.2, 1.8, -20.6), yaw: 1.35, pitch: 0.02 },
  }

  const viewpoints = [
    { id: 'entrance', label: 'Entrance', pose: poses.entrance },
    { id: 'atrium', label: 'Main Atrium', pose: poses.atrium },
    { id: 'impossible-door', label: 'I — Impossible Door', pose: poses['impossible-door'] },
    { id: 'hall', label: 'I — Room 402', pose: poses.hall },
    { id: 'loop-corridor', label: 'II — Loop Corridor', pose: poses['loop-corridor'] },
    { id: 'scale-gallery', label: 'III — Scale Gallery', pose: poses['scale-gallery'] },
    { id: 'reading-room', label: 'III — Reading Room', pose: poses['reading-room'] },
    { id: 'mirror-atrium', label: 'IV — Mirror Atrium', pose: poses['mirror-atrium'] },
  ]

  // --- per-frame world logic
  let time = 0
  const update = (engine: Engine) => {
    const dt = engine.getDeltaTime() / 1000
    time += dt
    const reduced = getState().reducedMotion

    portal.update(engine as Engine, reduced)
    for (const g of corridor.gates) g.update()

    if (!reduced) {
      hall.monolith.rotation.y += dt * 0.16
      hall.monolith.position.y = 3.4 + Math.sin(time * 0.7) * 0.12
    }
    mirror.updateOrb(player.camera.position, time, reduced)
  }

  return { registry: reg, spawn: poses.entrance, poses, viewpoints, update }
}
