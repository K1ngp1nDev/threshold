import {
  Color3,
  Mesh,
  MeshBuilder,
  Ray,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core'
import { ANOMALY, FX, requestSlowMo } from './fx'
import { Player } from './player'
import { Weapon, CombatContext, ResolveResult } from './weapon'
import { Anchor } from './anchors'
import { EnemyManager, EnemyType } from './enemies'
import { fadeTeleport } from './transitions'
import { getState, setState } from '../state'
import { playChime } from './audio'
import type { Pose } from '../world/museum'

const PRIMARY_DAMAGE = 16
const CHARGED_DAMAGE = 60

export interface DirectorHud {
  toast: (t: string, ms?: number) => void
  banner: (title: string, sub: string) => void
  hitMarker: (kind: 'hit' | 'kill' | 'shielded') => void
}

export interface World {
  scene: Scene
  poses: Record<string, Pose>
  wallMeshes: () => Mesh[]
  portal: {
    remapPrimary: (origin: Vector3, dir: Vector3) => { origin: Vector3; dir: Vector3; entryDist: number; entryPoint: Vector3 } | null
    addRenderMesh: (m: Mesh) => void
    pulse: () => void
  }
  clearInteractables: () => void
  addInteractable: (i: { id: string; position: Vector3; radius: number; prompt: string; onInteract: () => void; enabled: () => boolean }) => void
  removeInteractable: (id: string) => void
}

interface SpawnCfg {
  types: EnemyType[]
  interval: number
  cap: number
  initial: number
}

interface ZoneCfg {
  key: string
  label: string
  briefing: string
  entry: Pose
  bounds: { min: Vector3; max: Vector3 }
  anchors: Vector3[]
  spawnPoints: Vector3[]
  spawn: SpawnCfg
  exit?: Vector3 // exit gateway position (omit on final zone)
  mirrored?: boolean
  throughPortal?: boolean
}

export class Director implements CombatContext {
  readonly weapon: Weapon
  private enemies: EnemyManager
  private anchors: Anchor[] = []
  private zones: ZoneCfg[]
  private zoneIndex = 0
  private breachActive = false
  private spawnTimer = 0
  private transitioning = false
  private exitGate: TransformNode | null = null
  private hallEnemyMeshes: Mesh[] = []

  constructor(
    private scene: Scene,
    private player: Player,
    private world: World,
    private fx: FX,
    private hud: DirectorHud,
  ) {
    this.enemies = new EnemyManager({
      scene,
      fx,
      playerPos: () => this.player.camera.position,
      damagePlayer: (n) => this.player.damage(n),
      wallMeshes: () => this.world.wallMeshes(),
    })
    this.weapon = new Weapon(scene, player.camera, this, fx)
    this.zones = this.buildZones()
  }

  // ---------------------------------------------------------------- zones
  private buildZones(): ZoneCfg[] {
    const q = getState().quality
    const cap = q === 'low' ? 2 : q === 'medium' ? 3 : 5
    const interval = q === 'low' ? 2.4 : q === 'medium' ? 1.9 : 1.5
    return [
      {
        key: 'entrance',
        label: 'Entrance Hall',
        briefing: 'Seal the breach anchors. Charged shots (right mouse) collapse them.',
        entry: { pos: new Vector3(-11, 1.8, 2), yaw: 1.85 },
        bounds: { min: new Vector3(-14, 0, -9), max: new Vector3(14, 5, 9) },
        anchors: [new Vector3(-10, 1.3, -5), new Vector3(10, 1.3, 5)],
        spawnPoints: [new Vector3(4.9, 1.2, -2.5), new Vector3(-6, 1.2, 8.5), new Vector3(-13, 1.2, -4)],
        spawn: { types: ['echo', 'echo', 'echo', 'shard'], interval, cap, initial: 3 },
        exit: new Vector3(-6, 0, 8.6),
        throughPortal: true,
      },
      {
        key: 'loop',
        label: 'Loop Corridor',
        briefing: 'The corridor folds back on itself. Watch behind you.',
        entry: { pos: new Vector3(-6, 1.8, 306), yaw: 0.02 },
        bounds: { min: new Vector3(-7, 0, 300), max: new Vector3(-4.9, 4, 342) },
        anchors: [new Vector3(-6, 1.3, 318), new Vector3(-6, 1.3, 334)],
        spawnPoints: [new Vector3(-6, 1.2, 341), new Vector3(-6, 1.2, 301), new Vector3(-6, 1.2, 325)],
        spawn: { types: ['echo', 'shard', 'echo'], interval: interval * 0.9, cap, initial: 3 },
        exit: new Vector3(-6, 0, 340),
      },
      {
        key: 'scale',
        label: 'Scale Gallery',
        briefing: 'You have been pulled into the model. It is full size now — so are they.',
        entry: { pos: new Vector3(0, 1.8, -301.5), yaw: 0.15 },
        bounds: { min: new Vector3(-4.5, 0, -303.5), max: new Vector3(4.5, 5, -296.5) },
        anchors: [new Vector3(-3, 1.3, -299), new Vector3(3, 1.3, -299), new Vector3(0, 1.3, -297.4)],
        spawnPoints: [new Vector3(-4, 1.2, -302.5), new Vector3(4, 1.2, -302.5), new Vector3(0, 1.4, -297.5)],
        spawn: { types: ['echo', 'warden', 'shard'], interval: interval * 1.1, cap: Math.max(2, cap - 1), initial: 2 },
        exit: new Vector3(0, 0, -297.3),
      },
      {
        key: 'mirror',
        label: 'Mirror Atrium',
        briefing: 'The reflection fights back. Collapse the core breach.',
        entry: { pos: new Vector3(-6, 1.8, -13.5), yaw: Math.PI },
        bounds: { min: new Vector3(-14, 0, -24), max: new Vector3(2, 6, -12) },
        anchors: [new Vector3(-10, 1.3, -20), new Vector3(-2, 1.3, -20), new Vector3(-6, 1.6, -22)],
        spawnPoints: [new Vector3(-11, 1.2, -22), new Vector3(-1, 1.2, -22), new Vector3(-6, 1.2, -23)],
        spawn: { types: ['echo', 'shard', 'warden'], interval, cap, initial: 2 },
        mirrored: true,
      },
    ]
  }

  private zone(): ZoneCfg {
    return this.zones[this.zoneIndex]
  }

  // ---------------------------------------------------------------- flow
  start(): void {
    setState({ phase: 'playing', hasWeapon: false, kills: 0, anchorsSealedTotal: 0, elapsed: 0 })
    this.player.resetVitals()
    this.zoneIndex = 0
    this.player.teleport(this.zones[0].entry.pos, this.zones[0].entry.yaw, 0)
    this.setupZone(0, false)
  }

  restart(): void {
    this.enemies.clearAll(false)
    this.disposeAnchors()
    this.clearExitGate()
    for (const m of this.hallEnemyMeshes) m.dispose()
    this.hallEnemyMeshes = []
    this.start()
  }

  private async setupZone(i: number, teleport: boolean): Promise<void> {
    this.zoneIndex = i
    const z = this.zone()
    this.enemies.clearAll(false)
    this.disposeAnchors()
    this.clearExitGate()
    this.world.clearInteractables()
    this.breachActive = i !== 0 // zone 0 waits for the weapon pickup
    this.spawnTimer = 0.6
    this.enemies.setBounds(z.bounds)

    setState({
      zoneIndex: i,
      zoneLabel: z.label,
      anchorsSealed: 0,
      anchorsTotal: z.anchors.length,
      objective: i === 0 && !getState().hasWeapon ? 'Recover the Prism Carbine' : `Seal the breach — 0 / ${z.anchors.length}`,
    })

    if (teleport) {
      this.transitioning = true
      await fadeTeleport(this.scene, this.player, { pos: z.entry.pos, yaw: z.entry.yaw, pitch: 0 })
      this.transitioning = false
    }

    for (const a of z.anchors) this.anchors.push(new Anchor(this.scene, a, this.fx))

    if (i === 0 && !getState().hasWeapon) {
      this.spawnWeaponPickup()
    } else {
      this.beginBreach()
    }

    if (z.throughPortal) this.spawnHallEnemies()

    if (i === 0 && !getState().hasWeapon) {
      this.hud.banner('RECOVER THE PRISM CARBINE', 'It’s on the plinth ahead — press E')
      this.hud.toast('Walk up to the glowing plinth ahead and press E to arm the Prism Carbine.', 6000)
    } else {
      this.hud.banner(`WING ${i + 1} / ${this.zones.length}`, z.label)
      this.hud.toast(z.briefing, 5000)
    }
  }

  private spawnWeaponPickup(): void {
    const pos = new Vector3(-7, 1.15, 1.4)
    const node = new TransformNode('weapon-pickup-node', this.scene)
    node.position.copyFrom(pos)
    const ped = MeshBuilder.CreateCylinder('wp-ped', { height: 1.0, diameter: 0.5, tessellation: 8 }, this.scene)
    const pm = new StandardMaterial('wp-ped-mat', this.scene)
    pm.diffuseColor = new Color3(0.09, 0.085, 0.08)
    ped.material = pm
    ped.position.y = -0.65
    ped.parent = node
    const icon = MeshBuilder.CreateBox('wp-icon', { width: 0.1, height: 0.12, depth: 0.5 }, this.scene)
    const im = new StandardMaterial('wp-icon-mat', this.scene)
    im.emissiveColor = ANOMALY.clone()
    im.diffuseColor = Color3.Black()
    im.disableLighting = true
    icon.material = im
    icon.parent = node
    this.scene.onBeforeRenderObservable.add(() => {
      if (node.isDisposed()) return
      if (!getState().reducedMotion) icon.rotation.y += this.scene.getEngine().getDeltaTime() / 1000
    })

    this.world.addInteractable({
      id: 'weapon',
      position: pos,
      radius: 5,
      prompt: 'E — take the Prism Carbine',
      enabled: () => !getState().hasWeapon,
      onInteract: () => {
        node.dispose(false, true)
        setState({ hasWeapon: true })
        this.world.removeInteractable('weapon')
        this.hud.banner('BREACH DETECTED', 'Space folds. Hostiles inbound.')
        this.hud.toast('Left mouse fires · Right mouse charges to seal anchors', 6000)
        this.beginBreach()
      },
    })
    setState({ objective: 'Recover the Prism Carbine' })
  }

  private beginBreach(): void {
    this.breachActive = true
    this.world.portal.pulse()
    const z = this.zone()
    setState({ objective: `Seal the breach — 0 / ${z.anchors.length}` })
    for (let i = 0; i < z.spawn.initial; i++) this.spawnOne()
  }

  private spawnHallEnemies(): void {
    // enemies in Room 402, visible & shootable THROUGH the Impossible Door
    for (const p of [new Vector3(248, 1.3, -2), new Vector3(252, 1.3, 3)]) {
      const e = this.enemies.spawn('echo', p)
      for (const m of e.root.getChildMeshes()) {
        this.world.portal.addRenderMesh(m as Mesh)
        this.hallEnemyMeshes.push(m as Mesh)
      }
    }
    // enemies here are outside the atrium bounds; they idle until shot (bounds
    // clamp keeps them in the hall). They demonstrate the through-portal shot.
  }

  private spawnOne(): void {
    const z = this.zone()
    const type = z.spawn.types[Math.floor(Math.random() * z.spawn.types.length)]
    const sp = z.spawnPoints[Math.floor(Math.random() * z.spawnPoints.length)]
    const jitter = new Vector3((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5)
    this.enemies.spawn(type, sp.add(jitter))
    if (z.mirrored) {
      const mx = -12 - (sp.x + jitter.x) // reflect across room centre x=-6
      this.enemies.spawn(type, new Vector3(mx, sp.y, sp.z + jitter.z))
    }
    this.world.portal.pulse()
  }

  // ---------------------------------------------------------------- CombatContext
  resolveHit(origin: Vector3, dir: Vector3, maxDist: number, charged: boolean): ResolveResult {
    const wall = this.pickWall(origin, dir, maxDist)
    const limit = wall ? wall.dist : maxDist

    let portalRay: { origin: Vector3; dir: Vector3; entryDist: number; entryPoint: Vector3 } | null = null
    if (this.zone().throughPortal) {
      const pr = this.world.portal.remapPrimary(origin, dir)
      if (pr && pr.entryDist < limit) portalRay = pr
    }
    const nearLimit = portalRay ? portalRay.entryDist : limit

    const near = this.enemies.raycast(origin, dir, nearLimit)
    const anchor = this.raycastAnchors(origin, dir, nearLimit)
    if (near && (!anchor || near.dist < anchor.dist)) return this.hitEnemy(near.enemy, near.point, charged)
    if (anchor) return this.hitAnchor(anchor.anchor, anchor.point, charged)

    if (portalRay) {
      const far = this.enemies.raycast(portalRay.origin, portalRay.dir, maxDist)
      if (far) {
        const r = this.hitEnemy(far.enemy, far.point, charged)
        return { ...r, point: portalRay.entryPoint } // tracer visibly enters the portal
      }
      return { point: portalRay.entryPoint, kind: 'miss' }
    }

    if (wall) return { point: wall.point, kind: 'wall' }
    return { point: origin.add(dir.scale(maxDist)), kind: 'miss' }
  }

  onHitMarker(kind: 'hit' | 'kill' | 'shielded'): void {
    this.hud.hitMarker(kind)
  }

  private hitEnemy(enemy: { takeDamage: (n: number) => boolean }, point: Vector3, charged: boolean): ResolveResult {
    const killed = enemy.takeDamage(charged ? CHARGED_DAMAGE : PRIMARY_DAMAGE)
    if (killed) setState({ kills: getState().kills + 1 })
    return { point, kind: 'enemy', killed }
  }

  private hitAnchor(anchor: Anchor, point: Vector3, charged: boolean): ResolveResult {
    const r = anchor.hit(charged ? CHARGED_DAMAGE : PRIMARY_DAMAGE, charged)
    if (r === 'sealed') {
      this.onAnchorSealed()
      return { point, kind: 'sealed' }
    }
    return { point, kind: r === 'hit' ? 'anchor' : 'shielded' }
  }

  private raycastAnchors(origin: Vector3, dir: Vector3, maxDist: number): { anchor: Anchor; point: Vector3; dist: number } | null {
    let best: { anchor: Anchor; point: Vector3; dist: number } | null = null
    for (const a of this.anchors) {
      if (a.sealed) continue
      const oc = origin.subtract(a.corePos())
      const b = 2 * Vector3.Dot(oc, dir)
      const c = Vector3.Dot(oc, oc) - a.radius * a.radius
      const disc = b * b - 4 * c
      if (disc < 0) continue
      const t = (-b - Math.sqrt(disc)) / 2
      if (t < 0 || t > maxDist) continue
      if (!best || t < best.dist) best = { anchor: a, point: origin.add(dir.scale(t)), dist: t }
    }
    return best
  }

  private pickWall(origin: Vector3, dir: Vector3, maxDist: number): { point: Vector3; dist: number } | null {
    const ray = new Ray(origin, dir, maxDist)
    const walls = this.world.wallMeshes()
    const hit = this.scene.pickWithRay(ray, (m) => walls.includes(m as Mesh))
    if (hit && hit.hit && hit.pickedPoint) return { point: hit.pickedPoint, dist: hit.distance }
    return null
  }

  private onAnchorSealed(): void {
    const sealed = this.anchors.filter((a) => a.sealed).length
    setState({ anchorsSealed: sealed, anchorsSealedTotal: getState().anchorsSealedTotal + 1 })
    playChime()
    const total = this.zone().anchors.length
    setState({ objective: `Seal the breach — ${sealed} / ${total}` })
    if (sealed >= total) this.onZoneCleared()
    else this.hud.toast(`Anchor sealed — ${sealed} / ${total}`, 2200)
  }

  private onZoneCleared(): void {
    this.breachActive = false
    const last = this.zoneIndex >= this.zones.length - 1
    if (last) {
      this.victory()
      return
    }
    this.enemies.clearAll(true)
    this.hud.banner('WING STABILIZED', 'The breach gate is open.')
    setState({ objective: 'Enter the breach gate' })
    this.spawnExitGate()
  }

  private spawnExitGate(): void {
    const z = this.zone()
    if (!z.exit) return
    const gate = new TransformNode('exit-gate', this.scene)
    gate.position.copyFrom(z.exit)
    gate.position.y = 1.5
    const ring = MeshBuilder.CreateTorus('exit-ring', { diameter: 2.4, thickness: 0.09, tessellation: 40 }, this.scene)
    const rm = new StandardMaterial('exit-ring-mat', this.scene)
    rm.emissiveColor = ANOMALY.clone()
    rm.diffuseColor = Color3.Black()
    rm.disableLighting = true
    ring.material = rm
    ring.parent = gate
    const disc = MeshBuilder.CreateDisc('exit-disc', { radius: 1.1, tessellation: 40 }, this.scene)
    const dm = new StandardMaterial('exit-disc-mat', this.scene)
    dm.emissiveColor = ANOMALY.scale(0.35)
    dm.diffuseColor = Color3.Black()
    dm.disableLighting = true
    dm.alpha = 0.55
    disc.material = dm
    disc.parent = gate
    this.scene.onBeforeRenderObservable.add(() => {
      if (gate.isDisposed()) return
      if (!getState().reducedMotion) ring.rotation.z += this.scene.getEngine().getDeltaTime() / 1000
    })
    this.exitGate = gate

    this.world.addInteractable({
      id: 'exit',
      position: z.exit.clone(),
      radius: 3,
      prompt: 'E — enter the breach gate',
      enabled: () => true,
      onInteract: () => {
        this.world.removeInteractable('exit')
        void this.setupZone(this.zoneIndex + 1, true)
      },
    })
  }

  private clearExitGate(): void {
    if (this.exitGate) {
      this.exitGate.dispose(false, true)
      this.exitGate = null
    }
  }

  private disposeAnchors(): void {
    for (const a of this.anchors) a.dispose()
    this.anchors = []
  }

  private victory(): void {
    requestSlowMo(0.18, 1400)
    this.enemies.clearAll(true)
    this.world.clearInteractables()
    setTimeout(() => setState({ phase: 'victory' }), getState().reducedMotion ? 200 : 900)
  }

  // ---------------------------------------------------------------- loop
  update(dt: number, realDt: number): void {
    const st = getState()
    if (st.phase !== 'playing') return
    setState({ elapsed: st.elapsed + realDt })

    this.weapon.update(dt)
    this.enemies.update(dt)
    for (const a of this.anchors) a.update(dt)

    if (this.breachActive && !this.transitioning) {
      this.spawnTimer -= dt
      const cap = this.zone().spawn.cap
      if (this.spawnTimer <= 0 && this.enemies.aliveCount() < cap) {
        this.spawnTimer = this.zone().spawn.interval
        this.spawnOne()
      }
    }
  }

  // ---------------------------------------------------------------- debug API
  debug() {
    return {
      enterZone: (i: number) => this.setupZone(Math.max(0, Math.min(this.zones.length - 1, i)), true),
      zoneCount: this.zones.length,
      enemyCount: () => this.enemies.aliveCount(),
      spawnEnemy: (t: EnemyType) => {
        this.enemies.spawn(t, this.player.camera.position.add(this.player.forward().scale(6)))
      },
      killAll: () => this.enemies.clearAll(true),
      giveWeapon: () => {
        setState({ hasWeapon: true })
        this.world.removeInteractable('weapon')
        if (!this.breachActive) this.beginBreach()
      },
      shoot: () => {
        this.weapon.setPrimary(true)
        setTimeout(() => this.weapon.setPrimary(false), 30)
      },
      chargedShoot: () => {
        setState({ charging: true, charge: 1 })
        this.weapon.releaseCharge()
      },
      sealNearestAnchor: () => {
        const a = this.anchors.filter((x) => !x.sealed)[0]
        if (a) {
          const r = a.hit(CHARGED_DAMAGE, true)
          if (r !== 'sealed') a.hit(CHARGED_DAMAGE, true)
          if (a.sealed) this.onAnchorSealed()
          return true
        }
        return false
      },
      anchorsRemaining: () => this.anchors.filter((a) => !a.sealed).length,
    }
  }
}
