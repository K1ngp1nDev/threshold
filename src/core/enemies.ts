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
import { ANOMALY, FX } from './fx'
import { getState } from '../state'

export type EnemyType = 'echo' | 'shard' | 'warden'

export interface Bounds {
  min: Vector3
  max: Vector3
}

export interface EnemyContext {
  scene: Scene
  fx: FX
  playerPos: () => Vector3
  damagePlayer: (n: number) => void
  wallMeshes: () => Mesh[]
}

// All speeds are below the player's walk (4.0) so you can always kite them.
const STATS: Record<EnemyType, {
  hp: number; speed: number; radius: number; y: number; melee: number; meleeRange: number; meleeCd: number
}> = {
  echo: { hp: 30, speed: 3.0, radius: 0.55, y: 1.15, melee: 8, meleeRange: 1.9, meleeCd: 0.85 },
  shard: { hp: 42, speed: 2.0, radius: 0.6, y: 1.35, melee: 0, meleeRange: 0, meleeCd: 0 },
  warden: { hp: 150, speed: 1.4, radius: 1.0, y: 1.5, melee: 24, meleeRange: 2.6, meleeCd: 1.6 },
}

class Enemy {
  root: TransformNode
  type: EnemyType
  hp: number
  maxHp: number
  radius: number
  state: 'spawning' | 'active' | 'dead' = 'spawning'
  private spawnT = 0
  private atkT = 0
  private fireT = 2
  private losT = 0
  private losBlocked = false
  private teleT = 4
  private bob: number
  private core: Mesh

  constructor(private ctx: EnemyContext, type: EnemyType, pos: Vector3, private bounds: Bounds) {
    this.type = type
    const s = STATS[type]
    this.hp = s.hp
    this.maxHp = s.hp
    this.radius = s.radius
    this.bob = Math.random() * Math.PI * 2
    this.root = new TransformNode(`enemy-${type}-${Math.floor(Math.random() * 1e6)}`, ctx.scene)
    this.root.position.set(pos.x, s.y, pos.z)
    this.core = this.build(type)
    this.root.scaling.setAll(0.01)
    ctx.fx.sparks(this.root.position, 'anomaly', 18)
  }

  private mat(name: string, diffuse: Color3, emissive?: Color3): StandardMaterial {
    const m = new StandardMaterial(name, this.ctx.scene)
    m.diffuseColor = diffuse
    m.specularColor = new Color3(0.15, 0.15, 0.15)
    if (emissive) {
      m.emissiveColor = emissive
    }
    return m
  }

  private build(type: EnemyType): Mesh {
    const dark = this.mat(`e-shell-${type}`, new Color3(0.08, 0.08, 0.09))
    const coreMat = new StandardMaterial(`e-core-${type}`, this.ctx.scene)
    coreMat.emissiveColor = ANOMALY.clone()
    coreMat.diffuseColor = Color3.Black()
    coreMat.disableLighting = true

    let core: Mesh
    if (type === 'echo') {
      const shell = MeshBuilder.CreatePolyhedron('echo-shell', { type: 2, size: 0.5 }, this.ctx.scene)
      shell.material = dark
      shell.parent = this.root
      shell.isPickable = false
      core = MeshBuilder.CreateSphere('echo-core', { diameter: 0.34, segments: 10 }, this.ctx.scene)
      core.material = coreMat
      core.parent = this.root
      core.isPickable = false
    } else if (type === 'shard') {
      core = MeshBuilder.CreatePolyhedron('shard-core', { type: 1, size: 0.55 }, this.ctx.scene)
      core.material = coreMat
      core.parent = this.root
      core.isPickable = false
      const ring = MeshBuilder.CreateTorus('shard-ring', { diameter: 1.1, thickness: 0.05, tessellation: 24 }, this.ctx.scene)
      ring.material = dark
      ring.rotation.x = Math.PI / 2
      ring.parent = this.root
      ring.isPickable = false
    } else {
      const body = MeshBuilder.CreateCylinder('warden-body', { height: 2.2, diameterTop: 0.5, diameterBottom: 1.2, tessellation: 6 }, this.ctx.scene)
      body.material = this.mat('warden-shell', new Color3(0.12, 0.11, 0.1), ANOMALY.scale(0.04))
      body.parent = this.root
      body.isPickable = false
      const brass = this.mat('warden-brass', new Color3(0.5, 0.4, 0.22))
      for (let i = 0; i < 3; i++) {
        const band = MeshBuilder.CreateTorus(`warden-band-${i}`, { diameter: 1.1 - i * 0.25, thickness: 0.06, tessellation: 6 }, this.ctx.scene)
        band.material = brass
        band.position.y = -0.6 + i * 0.7
        band.rotation.x = Math.PI / 2
        band.parent = this.root
        band.isPickable = false
      }
      core = MeshBuilder.CreatePolyhedron('warden-core', { type: 3, size: 0.4 }, this.ctx.scene)
      core.material = coreMat
      core.position.y = 0.5
      core.parent = this.root
      core.isPickable = false
    }
    return core
  }

  get position(): Vector3 {
    return this.root.position
  }

  takeDamage(dmg: number): boolean {
    if (this.state === 'dead') return false
    this.hp -= dmg
    this.ctx.fx.sparks(this.root.position, 'anomaly', 8)
    if (this.hp <= 0) {
      this.die()
      return true
    }
    return false
  }

  die(): void {
    if (this.state === 'dead') return
    this.state = 'dead'
    this.ctx.fx.dissolve(this.core, ANOMALY)
    // dissolve the shell too
    for (const c of this.root.getChildMeshes()) {
      if (c !== this.core) this.ctx.fx.dissolve(c as Mesh, ANOMALY)
    }
    setTimeout(() => this.root.dispose(), 400)
  }

  private clamp(): void {
    const p = this.root.position
    const b = this.bounds
    p.x = Math.max(b.min.x + 0.6, Math.min(b.max.x - 0.6, p.x))
    p.z = Math.max(b.min.z + 0.6, Math.min(b.max.z - 0.6, p.z))
  }

  private lineOfSight(from: Vector3, to: Vector3): boolean {
    const dir = to.subtract(from)
    const dist = dir.length()
    dir.normalize()
    const ray = new Ray(from, dir, dist - 0.5)
    const walls = this.ctx.wallMeshes()
    const hit = this.ctx.scene.pickWithRay(ray, (m) => walls.includes(m as Mesh))
    return !(hit && hit.hit)
  }

  update(dt: number, spawnProjectile: (pos: Vector3, vel: Vector3) => void): void {
    const s = STATS[this.type]
    const player = this.ctx.playerPos()
    this.bob += dt

    if (this.state === 'spawning') {
      this.spawnT += dt
      const k = Math.min(1, this.spawnT / 0.4)
      this.root.scaling.setAll(k)
      if (k >= 1) this.state = 'active'
      return
    }
    if (this.state === 'dead') return

    const toPlayer = player.subtract(this.root.position)
    const dist = toPlayer.length()
    const flat = new Vector3(toPlayer.x, 0, toPlayer.z)
    if (flat.lengthSquared() > 0.0001) flat.normalize()

    // face player (yaw)
    this.root.rotation.y = Math.atan2(toPlayer.x, toPlayer.z)

    const reduced = getState().reducedMotion
    this.root.position.y = s.y + (reduced ? 0 : Math.sin(this.bob * 2) * 0.12)
    this.core.rotation.y += dt * 1.5

    if (this.type === 'echo') {
      this.root.position.addInPlace(flat.scale(s.speed * dt))
      if (dist < s.meleeRange) this.tryMelee(dt, s.melee, s.meleeCd)
    } else if (this.type === 'shard') {
      // keep mid distance, strafe
      const desired = 10
      if (dist < desired - 1.5) this.root.position.subtractInPlace(flat.scale(s.speed * dt))
      else if (dist > desired + 1.5) this.root.position.addInPlace(flat.scale(s.speed * dt))
      const strafe = new Vector3(flat.z, 0, -flat.x).scale(Math.sin(this.bob * 0.7) * s.speed * dt)
      this.root.position.addInPlace(strafe)
      // fire
      this.losT -= dt
      if (this.losT <= 0) {
        this.losT = 0.3
        this.losBlocked = !this.lineOfSight(this.root.position, player)
      }
      this.fireT -= dt
      if (this.fireT <= 0 && dist < 24 && !this.losBlocked) {
        this.fireT = 2.2
        const aim = player.add(new Vector3(0, -0.2, 0)).subtract(this.root.position)
        aim.normalize()
        spawnProjectile(this.root.position.clone(), aim.scale(9))
      }
    } else {
      // warden: slow advance + periodic blink toward player
      this.teleT -= dt
      if (this.teleT <= 0 && dist > 6) {
        this.teleT = 5 + Math.random() * 3
        const blink = player.subtract(flat.scale(4))
        this.ctx.fx.sparks(this.root.position, 'anomaly', 20)
        this.root.position.x = blink.x
        this.root.position.z = blink.z
        this.ctx.fx.sparks(this.root.position, 'anomaly', 20)
      } else {
        this.root.position.addInPlace(flat.scale(s.speed * dt))
      }
      if (dist < s.meleeRange) this.tryMelee(dt, s.melee, s.meleeCd)
    }

    this.clamp()
  }

  private tryMelee(dt: number, dmg: number, cd: number): void {
    this.atkT -= dt
    if (this.atkT <= 0) {
      this.atkT = cd
      this.ctx.damagePlayer(dmg)
    }
  }
}

interface Projectile {
  mesh: Mesh
  vel: Vector3
  life: number
}

export class EnemyManager {
  private enemies: Enemy[] = []
  private projectiles: Projectile[] = []
  private projMat: StandardMaterial
  bounds: Bounds = { min: new Vector3(-100, 0, -100), max: new Vector3(100, 5, 100) }

  constructor(private ctx: EnemyContext) {
    this.projMat = new StandardMaterial('proj-mat', ctx.scene)
    this.projMat.emissiveColor = new Color3(1, 0.55, 0.35)
    this.projMat.diffuseColor = Color3.Black()
    this.projMat.disableLighting = true
  }

  setBounds(b: Bounds): void {
    this.bounds = b
  }

  spawn(type: EnemyType, pos: Vector3): Enemy {
    const e = new Enemy(this.ctx, type, pos, this.bounds)
    this.enemies.push(e)
    return e
  }

  aliveCount(): number {
    return this.enemies.filter((e) => e.state !== 'dead').length
  }

  /** Nearest enemy hit by a ray, within maxDist. Returns hit info for damage. */
  raycast(origin: Vector3, dir: Vector3, maxDist: number): { enemy: Enemy; point: Vector3; dist: number } | null {
    let best: { enemy: Enemy; point: Vector3; dist: number } | null = null
    for (const e of this.enemies) {
      if (e.state === 'dead') continue
      const oc = origin.subtract(e.position)
      const b = 2 * Vector3.Dot(oc, dir)
      const c = Vector3.Dot(oc, oc) - e.radius * e.radius
      const disc = b * b - 4 * c
      if (disc < 0) continue
      const t = (-b - Math.sqrt(disc)) / 2
      if (t < 0 || t > maxDist) continue
      if (!best || t < best.dist) {
        best = { enemy: e, point: origin.add(dir.scale(t)), dist: t }
      }
    }
    return best
  }

  update(dt: number): void {
    // separation
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i]
      if (a.state === 'dead') continue
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j]
        if (b.state === 'dead') continue
        const d = a.position.subtract(b.position)
        d.y = 0
        const dist = d.length()
        const min = a.radius + b.radius + 0.2
        if (dist > 0.001 && dist < min) {
          const push = d.scale(((min - dist) / dist) * 0.5)
          a.position.addInPlace(push)
          b.position.subtractInPlace(push)
        }
      }
    }

    for (const e of this.enemies) e.update(dt, (p, v) => this.spawnProjectile(p, v))
    this.enemies = this.enemies.filter((e) => {
      if (e.state === 'dead') {
        // keep until disposed by timeout; drop from list quickly
        return false
      }
      return true
    })

    // projectiles
    const player = this.ctx.playerPos()
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]
      p.life -= dt
      p.mesh.position.addInPlace(p.vel.scale(dt))
      if (Vector3.Distance(p.mesh.position, player) < 0.7) {
        this.ctx.damagePlayer(12)
        this.ctx.fx.sparks(p.mesh.position, 'warm', 12)
        p.mesh.dispose()
        this.projectiles.splice(i, 1)
      } else if (p.life <= 0) {
        p.mesh.dispose()
        this.projectiles.splice(i, 1)
      }
    }
  }

  private spawnProjectile(pos: Vector3, vel: Vector3): void {
    const m = MeshBuilder.CreateSphere('proj', { diameter: 0.32, segments: 8 }, this.ctx.scene)
    m.material = this.projMat
    m.position.copyFrom(pos)
    m.isPickable = false
    this.projectiles.push({ mesh: m, vel, life: 4 })
  }

  clearAll(dissolve = true): void {
    for (const e of this.enemies) {
      if (dissolve) e.die()
      else e.root.dispose()
    }
    this.enemies = []
    for (const p of this.projectiles) p.mesh.dispose()
    this.projectiles = []
  }
}
