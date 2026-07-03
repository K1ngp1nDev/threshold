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
import { playChime, playPulse } from './audio'
import { mulberry32 } from './rng'
import type { Pose } from '../world/museum'

const PRIMARY_DAMAGE = 16
const PULSE_RECHARGE = 0.24 // per second (~4.2s to full)
const PULSE_RADIUS = 9
const WARDEN_GUARD_RANGE = 9

export interface DirectorHud {
  toast: (t: string, ms?: number) => void
  banner: (title: string, sub: string) => void
  hitMarker: (kind: 'hit' | 'kill' | 'shielded') => void
  pulseFlash: () => void
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
  anchors: { pos: Vector3; hidden?: boolean }[]
  spawnPoints: Vector3[]
  spawn: SpawnCfg
  exit?: Vector3
  mirrored?: boolean
  throughPortal?: boolean
}

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
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
  private rng: () => number
  private taughtShield = false
  private taughtPulse = false

  constructor(
    private scene: Scene,
    private player: Player,
    private world: World,
    private fx: FX,
    private hud: DirectorHud,
    seed: string,
  ) {
    this.rng = mulberry32(hashStr(seed || Date.now().toString()))
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
    const v = (x: number, y: number, z: number) => new Vector3(x, y, z)
    return [
      {
        key: 'entrance',
        label: 'Entrance Hall',
        briefing: 'Anomaly Pulse (right mouse) exposes the shielded anchors — then fire to seal them.',
        entry: { pos: v(-11, 1.8, 2), yaw: 1.85 },
        bounds: { min: v(-14, 0, -9), max: v(14, 5, 9) },
        anchors: [{ pos: v(-10, 1.3, -5) }, { pos: v(10, 1.3, 5) }],
        spawnPoints: [v(4.9, 1.2, -2.5), v(-6, 1.2, 8.5), v(-13, 1.2, -4)],
        spawn: { types: ['echo', 'echo', 'echo', 'shard'], interval, cap, initial: 3 },
        exit: v(-6, 0, 8.6),
        throughPortal: true,
      },
      {
        key: 'loop',
        label: 'Loop Corridor',
        briefing: 'The corridor folds back on itself. Watch behind you — one anchor is hidden until you Pulse.',
        entry: { pos: v(-6, 1.8, 306), yaw: 0.02 },
        bounds: { min: v(-7, 0, 300), max: v(-4.9, 4, 342) },
        anchors: [{ pos: v(-6, 1.3, 318) }, { pos: v(-6, 1.3, 334), hidden: true }],
        spawnPoints: [v(-6, 1.2, 341), v(-6, 1.2, 301), v(-6, 1.2, 325)],
        spawn: { types: ['echo', 'shard', 'echo'], interval: interval * 0.9, cap, initial: 3 },
        exit: v(-6, 0, 340),
      },
      {
        key: 'scale',
        label: 'Scale Gallery',
        briefing: 'Pulled into the model. It is full size now — and a Warden guards an anchor.',
        entry: { pos: v(0, 1.8, -301.5), yaw: 0.15 },
        bounds: { min: v(-4.5, 0, -303.5), max: v(4.5, 5, -296.5) },
        anchors: [{ pos: v(-3, 1.3, -299) }, { pos: v(3, 1.3, -299) }, { pos: v(0, 1.3, -297.4) }],
        spawnPoints: [v(-4, 1.2, -302.5), v(4, 1.2, -302.5), v(0, 1.4, -297.5)],
        spawn: { types: ['echo', 'warden', 'shard'], interval: interval * 1.1, cap: Math.max(2, cap - 1), initial: 2 },
        exit: v(0, 0, -297.3),
      },
      {
        key: 'mirror',
        label: 'Mirror Atrium',
        briefing: 'The reflection fights back. A Warden shields the core breach — clear it, Pulse, seal.',
        entry: { pos: v(-6, 1.8, -13.5), yaw: Math.PI },
        bounds: { min: v(-14, 0, -24), max: v(2, 6, -12) },
        anchors: [{ pos: v(-10, 1.3, -20) }, { pos: v(-2, 1.3, -20) }, { pos: v(-6, 1.6, -22) }],
        spawnPoints: [v(-11, 1.2, -22), v(-1, 1.2, -22), v(-6, 1.2, -23)],
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
    setState({ phase: 'playing', hasWeapon: true, kills: 0, anchorsSealedTotal: 0, elapsed: 0, pulse: 1, pulseReady: true })
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
    this.breachActive = false
    this.spawnTimer = 0.6
    this.enemies.setBounds(z.bounds)

    setState({
      zoneIndex: i,
      zoneLabel: z.label,
      anchorsSealed: 0,
      anchorsTotal: z.anchors.length,
      objective: `Seal the breach — 0 / ${z.anchors.length}`,
    })

    if (teleport) {
      this.transitioning = true
      await fadeTeleport(this.scene, this.player, { pos: z.entry.pos, yaw: z.entry.yaw, pitch: 0 })
      this.transitioning = false
    }

    for (const a of z.anchors) this.anchors.push(new Anchor(this.scene, a.pos, this.fx, a.hidden))
    this.beginBreach()
    if (z.throughPortal) this.spawnHallEnemies()

    this.hud.banner(`WING ${i + 1} / ${this.zones.length}`, z.label)
    this.hud.toast(z.briefing, 5500)
  }

  private beginBreach(): void {
    this.breachActive = true
    this.world.portal.pulse()
    const z = this.zone()
    setState({ objective: `Seal the breach — 0 / ${z.anchors.length}` })
    for (let i = 0; i < z.spawn.initial; i++) this.spawnOne()
  }

  private spawnHallEnemies(): void {
    for (const p of [new Vector3(248, 1.3, -2), new Vector3(252, 1.3, 3)]) {
      const e = this.enemies.spawn('echo', p)
      for (const m of e.root.getChildMeshes()) {
        this.world.portal.addRenderMesh(m as Mesh)
        this.hallEnemyMeshes.push(m as Mesh)
      }
    }
  }

  private spawnOne(): void {
    const z = this.zone()
    const type = z.spawn.types[Math.floor(this.rng() * z.spawn.types.length)]
    const sp = z.spawnPoints[Math.floor(this.rng() * z.spawnPoints.length)]
    const jitter = new Vector3((this.rng() - 0.5) * 1.5, 0, (this.rng() - 0.5) * 1.5)
    this.enemies.spawn(type, sp.add(jitter))
    if (z.mirrored) {
      const mx = -12 - (sp.x + jitter.x) // reflect across room centre x=-6
      this.enemies.spawn(type, new Vector3(mx, sp.y, sp.z + jitter.z))
    }
    this.world.portal.pulse()
  }

  // ---------------------------------------------------------------- Anomaly Pulse
  triggerPulse(): void {
    const st = getState()
    if (st.phase !== 'playing' || !st.hasWeapon) return
    if (st.pulse < 1) {
      this.hud.toast('Anomaly Pulse recharging…', 1200)
      return
    }
    setState({ pulse: 0, pulseReady: false })
    this.fx.pulseWave(this.player.camera.position)
    this.hud.pulseFlash()
    this.world.portal.pulse()
    playPulse()
    for (const a of this.anchors) a.expose()
    this.enemies.pulse(this.player.camera.position, PULSE_RADIUS)
    if (!this.taughtPulse) {
      this.taughtPulse = true
      this.hud.toast('Anchors exposed! Fire (left mouse) to seal them before the shield returns.', 4000)
    }
  }

  // ---------------------------------------------------------------- CombatContext
  resolveHit(origin: Vector3, dir: Vector3, maxDist: number): ResolveResult {
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
    if (near && (!anchor || near.dist < anchor.dist)) return this.hitEnemy(near.enemy, near.point)
    if (anchor) return this.hitAnchor(anchor.anchor, anchor.point)

    if (portalRay) {
      const far = this.enemies.raycast(portalRay.origin, portalRay.dir, maxDist)
      if (far) {
        const r = this.hitEnemy(far.enemy, far.point)
        return { ...r, point: portalRay.entryPoint }
      }
      return { point: portalRay.entryPoint, kind: 'miss' }
    }
    if (wall) return { point: wall.point, kind: 'wall' }
    return { point: origin.add(dir.scale(maxDist)), kind: 'miss' }
  }

  onHitMarker(kind: 'hit' | 'kill' | 'shielded'): void {
    this.hud.hitMarker(kind)
  }

  private hitEnemy(enemy: { takeDamage: (n: number) => boolean }, point: Vector3): ResolveResult {
    const killed = enemy.takeDamage(PRIMARY_DAMAGE)
    if (killed) setState({ kills: getState().kills + 1 })
    return { point, kind: 'enemy', killed }
  }

  private hitAnchor(anchor: Anchor, point: Vector3): ResolveResult {
    const r = anchor.hit(PRIMARY_DAMAGE)
    if (r === 'sealed') {
      this.onAnchorSealed()
      return { point, kind: 'sealed' }
    }
    if (r === 'shielded' && !this.taughtShield && anchor.shielded) {
      this.taughtShield = true
      this.hud.toast(anchor.guarded ? 'A Warden holds this shield — kill it first.' : 'Shielded — hit Anomaly Pulse (right mouse) to expose it.', 3500)
    }
    return { point, kind: r === 'hit' ? 'anchor' : 'shielded' }
  }

  private raycastAnchors(origin: Vector3, dir: Vector3, maxDist: number): { anchor: Anchor; point: Vector3; dist: number } | null {
    let best: { anchor: Anchor; point: Vector3; dist: number } | null = null
    for (const a of this.anchors) {
      if (!a.targetable()) continue
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
    this.hud.banner('WING STABILIZED', 'Next wing unlocked — enter the breach gate')
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

    // pulse recharge
    if (st.pulse < 1) {
      const pulse = Math.min(1, st.pulse + PULSE_RECHARGE * dt)
      setState({ pulse, pulseReady: pulse >= 1 })
    }

    this.weapon.update(dt)
    this.enemies.update(dt)
    // Wardens keep nearby anchors shielded
    for (const a of this.anchors) a.guarded = !a.sealed && this.enemies.wardenNear(a.corePos(), WARDEN_GUARD_RANGE)
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
        if (!this.breachActive) this.beginBreach()
      },
      pulse: () => this.triggerPulse(),
      forceVictory: () => {
        setState({ phase: 'victory' })
      },
      shoot: () => {
        this.weapon.setPrimary(true)
        setTimeout(() => this.weapon.setPrimary(false), 30)
      },
      sealNearestAnchor: () => {
        const a = this.anchors.filter((x) => !x.sealed)[0]
        if (!a) return false
        a.expose()
        while (!a.sealed) {
          const r = a.hit(PRIMARY_DAMAGE)
          if (r === 'sealed') break
          if (r === 'shielded') return false
        }
        if (a.sealed) this.onAnchorSealed()
        return a.sealed
      },
      anchorsRemaining: () => this.anchors.filter((a) => !a.sealed).length,
      pulseEnergy: () => getState().pulse,
    }
  }
}
