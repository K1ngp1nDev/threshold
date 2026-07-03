import {
  AbstractMesh,
  Color3,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PointLight,
  Scene,
  Vector3,
} from '@babylonjs/core'
import { MaterialKit, PALETTE } from '../core/materials'
import { PortalPair } from '../core/portals'
import type { Player } from '../core/player'
import { WorldRegistry, SectorId, Interactable } from './registry'
import { ATRIUM, buildAtrium } from './atrium'
import { buildImpossibleHall, HALL } from './impossibleHall'
import { buildLoopCorridor } from './loopCorridor'
import { buildScaleGallery } from './scaleGallery'
import { buildMirrorAtrium } from './mirrorAtrium'
import { getState } from '../state'

export interface Pose {
  pos: Vector3
  yaw: number
  pitch?: number
}

export interface Museum {
  registry: WorldRegistry
  portal: PortalPair
  spawn: Pose
  poses: Record<string, Pose>
  wallMeshes: () => Mesh[]
  clearInteractables: () => void
  addInteractable: (i: Interactable) => void
  removeInteractable: (id: string) => void
  update: (engine: Engine) => void
}

export function buildMuseum(
  scene: Scene,
  mats: MaterialKit,
  player: Player,
  portalRatio: number,
): Museum {
  const reg = new WorldRegistry(scene)
  const noop = () => undefined

  // --- geometry (curator-note interactables are cleared by the director)
  buildAtrium(reg, mats, noop)
  const hall = buildImpossibleHall(reg, mats, noop)
  const corridor = buildLoopCorridor(reg, mats, player, noop)
  const gallery = buildScaleGallery(reg, mats, player, noop)
  const mirror = buildMirrorAtrium(reg, mats, player, noop)

  // --- Impossible Door portal (render-only in BREACH: you shoot through it and
  //     enemies pour out, but crossing is blocked by an invisible pane).
  const portal = new PortalPair(scene, player, {
    a: ATRIUM.pavilionDoor,
    b: HALL.door,
    seenFromA: reg.meshesOf('hall'),
    seenFromB: reg.meshesOf('atrium', 'mirror'),
    portalRatio,
    glowAmp: 0.18,
    allowCross: false,
  })
  // invisible pane across the doorway (blocks the player, not shots or enemies)
  const pane = MeshBuilder.CreateBox('door-pane', { width: 0.2, height: 2.7, depth: 1.7 }, scene)
  pane.position.set(4.9, 1.35, -2.5)
  pane.isVisible = false
  pane.isPickable = false
  pane.checkCollisions = true

  // --- lights: unscoped hemi lights everything (incl. dynamic enemies/weapon);
  //     point lights are scoped per sector to respect the per-mesh light cap.
  const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene)
  hemi.intensity = 0.5
  hemi.diffuse = new Color3(0.92, 0.89, 0.84)
  hemi.groundColor = new Color3(0.14, 0.13, 0.12)

  const scoped: { light: PointLight; sectors: SectorId[] }[] = []
  const pl = (name: string, pos: Vector3, color: Color3, intensity: number, range: number, sectors: SectorId[]) => {
    const l = new PointLight(name, pos, scene)
    l.diffuse = color
    l.intensity = intensity
    l.range = range
    scoped.push({ light: l, sectors })
  }

  pl('atrium-a', new Vector3(-7, 5.6, 3), PALETTE.warmLight, 0.8, 28, ['atrium'])
  pl('atrium-b', new Vector3(7, 5.6, -4), PALETTE.warmLight, 0.8, 28, ['atrium'])
  pl('hall-a', new Vector3(245, 9, -9), PALETTE.warmLight, 0.95, 44, ['hall'])
  pl('hall-b', new Vector3(255, 9, 9), PALETTE.warmLight, 0.95, 44, ['hall'])
  pl('diorama', new Vector3(-20.5, 2.4, -4), PALETTE.warmLight, 0.9, 4.5, ['atrium'])
  scoped.push(...gallery.lights)
  for (const l of corridor.lights) scoped.push({ light: l, sectors: ['corridor'] })
  for (const name of ['mirror-light-real', 'mirror-light-twin']) {
    const l = scene.getLightByName(name) as PointLight | null
    if (l) scoped.push({ light: l, sectors: ['mirror'] })
  }
  for (const { light, sectors } of scoped) {
    light.includedOnlyMeshes = reg.meshesOf(...sectors) as AbstractMesh[]
  }

  // --- named poses (screenshots + QA)
  const poses: Record<string, Pose> = {
    entrance: { pos: ATRIUM.spawn.clone(), yaw: ATRIUM.spawnYaw, pitch: 0.02 },
    'weapon-portal': { pos: new Vector3(-7.5, 1.8, 0.4), yaw: 1.5, pitch: 0.0 },
    hall: { pos: new Vector3(244.5, 1.8, -6.5), yaw: 0.48, pitch: -0.02 },
    loop: { pos: new Vector3(-6, 1.8, 309), yaw: 0.03, pitch: 0.02 },
    scale: { pos: new Vector3(0, 1.8, -301.6), yaw: 0.12, pitch: 0.05 },
    mirror: { pos: new Vector3(-6, 1.8, -13.5), yaw: Math.PI, pitch: 0.03 },
  }

  // --- cached collidables for shot/LOS ray tests
  let walls: Mesh[] | null = null
  const wallMeshes = (): Mesh[] => {
    if (!walls) {
      walls = []
      for (const list of reg.sectorMeshes.values()) {
        for (const m of list) if (m.checkCollisions) walls.push(m)
      }
    }
    return walls
  }

  // --- interactable management (used by the director)
  const clearInteractables = () => {
    reg.interactables.length = 0
  }
  const addInteractable = (i: Interactable) => reg.interactables.push(i)
  const removeInteractable = (id: string) => {
    const idx = reg.interactables.findIndex((x) => x.id === id)
    if (idx >= 0) reg.interactables.splice(idx, 1)
  }

  // --- per-frame world logic (no player-teleport gates in BREACH)
  let time = 0
  const update = (engine: Engine) => {
    const dt = engine.getDeltaTime() / 1000
    time += dt
    const reduced = getState().reducedMotion
    portal.update(engine, reduced)
    if (!reduced) {
      hall.monolith.rotation.y += dt * 0.16
      hall.monolith.position.y = 3.4 + Math.sin(time * 0.7) * 0.12
    }
    mirror.updateOrb(player.camera.position, time, reduced)
  }

  return {
    registry: reg,
    portal,
    spawn: poses.entrance,
    poses,
    wallMeshes,
    clearInteractables,
    addInteractable,
    removeInteractable,
    update,
  }
}
