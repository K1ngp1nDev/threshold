import {
  Camera,
  Effect,
  Engine,
  Mesh,
  MeshBuilder,
  RenderTargetTexture,
  Scene,
  ShaderMaterial,
  UniversalCamera,
  Vector2,
  Vector3,
} from '@babylonjs/core'
import type { Player } from './player'

// ---------------------------------------------------------------------------
// True portal rendering: the doorway quad samples a render-target drawn from a
// virtual camera that mirrors the player's pose through the portal mapping.
// Sampling happens in *screen space* (gl_FragCoord), which is what turns a
// textured quad into a convincing hole in space.
// ---------------------------------------------------------------------------

Effect.ShadersStore['portalVertexShader'] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
void main() {
  vUV = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`

Effect.ShadersStore['portalFragmentShader'] = `
precision highp float;
uniform sampler2D rttSampler;
uniform vec2 resolution;
uniform float glowAmp;
uniform float time;
varying vec2 vUV;
void main() {
  vec2 suv = gl_FragCoord.xy / resolution;
  vec3 col = texture2D(rttSampler, suv).rgb;
  // soft brass shimmer hugging the frame
  float ex = min(vUV.x, 1.0 - vUV.x);
  float ey = min(vUV.y, 1.0 - vUV.y);
  float edge = 1.0 - smoothstep(0.0, 0.045, min(ex, ey));
  float pulse = 0.75 + 0.25 * sin(time * 1.7);
  col += vec3(0.79, 0.62, 0.33) * edge * glowAmp * pulse;
  gl_FragColor = vec4(col, 1.0);
}`

export interface PortalAnchor {
  position: Vector3 // center of the opening, at floor level
  yaw: number // direction the portal FACES (towards the room the viewer stands in)
  width: number
  height: number
}

function dirOf(yaw: number): Vector3 {
  return new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
}

/** One visible face of a portal pair: quad + RTT + virtual camera + crossing. */
class PortalSide {
  readonly quad: Mesh
  readonly rtt: RenderTargetTexture
  private readonly vcam: UniversalCamera
  private readonly mat: ShaderMaterial
  private prevDist = Infinity
  private active = false
  private t = 0
  private glowBase: number
  private pulseT = 0

  constructor(
    private scene: Scene,
    private player: Player,
    readonly from: PortalAnchor, // where this face lives (viewer side)
    readonly to: PortalAnchor, // counterpart anchor
    visibleMeshes: Mesh[],
    portalRatio: number,
    private onCross: () => void,
    glowAmp: number,
    private allowCross: boolean,
  ) {
    this.glowBase = glowAmp
    const name = `portal-${from.position.x}-${from.position.z}`
    this.mat = new ShaderMaterial(name, scene, { vertex: 'portal', fragment: 'portal' }, {
      attributes: ['position', 'uv'],
      uniforms: ['worldViewProjection', 'resolution', 'glowAmp', 'time'],
      samplers: ['rttSampler'],
    })
    this.mat.setFloat('glowAmp', glowAmp)
    this.mat.backFaceCulling = true

    this.quad = MeshBuilder.CreatePlane(`${name}-quad`, {
      width: from.width * 0.995,
      height: from.height * 0.995,
    }, scene)
    this.quad.position = from.position.add(new Vector3(0, from.height / 2, 0))
    // CreatePlane faces +Z; rotate so the face points along `yaw`
    this.quad.rotation.y = from.yaw + Math.PI
    this.quad.material = this.mat
    this.quad.isPickable = false
    this.quad.checkCollisions = false

    this.vcam = new UniversalCamera(`${name}-vcam`, Vector3.Zero(), scene)
    this.vcam.minZ = 0.05
    this.vcam.maxZ = 800
    this.vcam.fov = player.camera.fov
    this.vcam.mode = Camera.PERSPECTIVE_CAMERA

    this.rtt = new RenderTargetTexture(`${name}-rtt`, { ratio: portalRatio }, scene, false)
    this.rtt.activeCamera = this.vcam
    this.rtt.renderList = visibleMeshes
    this.mat.setTexture('rttSampler', this.rtt)
  }

  /** Maps a world point from the `from` frame to the `to` frame (through the portal). */
  private map(p: Vector3): Vector3 {
    const delta = this.to.yaw + Math.PI - this.from.yaw
    const local = p.subtract(this.from.position)
    const cos = Math.cos(delta)
    const sin = Math.sin(delta)
    const rx = local.x * cos + local.z * sin
    const rz = -local.x * sin + local.z * cos
    return new Vector3(this.to.position.x + rx, this.to.position.y + local.y, this.to.position.z + rz)
  }

  get yawDelta(): number {
    return this.to.yaw + Math.PI - this.from.yaw
  }

  addRenderMesh(m: Mesh): void {
    if (!this.rtt.renderList) this.rtt.renderList = []
    if (!this.rtt.renderList.includes(m)) this.rtt.renderList.push(m)
  }

  pulse(): void {
    this.pulseT = 1
  }

  /** Remap a ray that enters this portal's opening into the counterpart frame. */
  remap(origin: Vector3, dir: Vector3): { origin: Vector3; dir: Vector3; entryDist: number; entryPoint: Vector3 } | null {
    const n = dirOf(this.from.yaw)
    const denom = Vector3.Dot(dir, n)
    if (denom >= -1e-4) return null // must be moving INTO the front face
    const t = Vector3.Dot(this.from.position.subtract(origin), n) / denom
    if (t <= 0) return null
    const entry = origin.add(dir.scale(t))
    const rel = entry.subtract(this.from.position)
    const lateral = Math.abs(rel.x * n.z - rel.z * n.x)
    if (lateral > this.from.width / 2) return null
    if (rel.y < 0 || rel.y > this.from.height) return null
    const delta = this.yawDelta
    const cos = Math.cos(delta)
    const sin = Math.sin(delta)
    const md = new Vector3(dir.x * cos + dir.z * sin, dir.y, -dir.x * sin + dir.z * cos).normalize()
    return { origin: this.map(entry), dir: md, entryDist: t, entryPoint: entry }
  }

  setActive(on: boolean): void {
    if (on === this.active) return
    this.active = on
    this.quad.setEnabled(on)
    const list = this.scene.customRenderTargets
    if (on) {
      if (!list.includes(this.rtt)) list.push(this.rtt)
    } else {
      const i = list.indexOf(this.rtt)
      if (i >= 0) list.splice(i, 1)
    }
  }

  update(engine: Engine, reducedMotion: boolean): void {
    const cam = this.player.camera
    const p = cam.position
    const dist = Vector3.Distance(p, this.from.position)
    this.setActive(dist < 34)
    if (!this.active) {
      this.prevDist = Infinity
      return
    }

    this.t += engine.getDeltaTime() / 1000
    if (this.pulseT > 0) this.pulseT = Math.max(0, this.pulseT - (engine.getDeltaTime() / 1000) * 1.4)
    this.mat.setVector2('resolution', new Vector2(engine.getRenderWidth(), engine.getRenderHeight()))
    this.mat.setFloat('time', reducedMotion ? 0 : this.t)
    this.mat.setFloat('glowAmp', this.glowBase + this.pulseT * 0.5)

    // virtual camera mirrors the player through the mapping
    const vp = this.map(p)
    this.vcam.position.copyFrom(vp)
    this.vcam.rotation.x = cam.rotation.x
    this.vcam.rotation.y = cam.rotation.y + this.yawDelta
    this.vcam.rotation.z = 0
    this.vcam.fov = cam.fov

    // crossing check: signed distance along the facing normal
    const n = dirOf(this.from.yaw)
    const rel = p.subtract(this.from.position)
    const d = Vector3.Dot(rel, n)
    const lateral = Math.abs(rel.x * n.z - rel.z * n.x) // perpendicular offset in plane
    const withinOpening = lateral < this.from.width / 2 + 0.15 && rel.y > -0.5 && rel.y < this.from.height + 0.5
    if (this.allowCross && this.prevDist > 0 && d <= 0 && this.prevDist < 1.6 && withinOpening) {
      const mapped = this.map(p)
      const delta = this.yawDelta
      // rotate residual velocity so momentum carries through
      const cd = cam.cameraDirection
      const cos = Math.cos(delta)
      const sin = Math.sin(delta)
      const vx = cd.x * cos + cd.z * sin
      const vz = -cd.x * sin + cd.z * cos
      cd.x = vx
      cd.z = vz
      this.player.teleport(mapped, cam.rotation.y + delta, cam.rotation.x)
      this.onCross()
      this.prevDist = Infinity
      return
    }
    this.prevDist = d
  }
}

export interface PortalPairOptions {
  a: PortalAnchor
  b: PortalAnchor
  seenFromA: Mesh[] // what the quad at A shows (the world around B)
  seenFromB: Mesh[]
  portalRatio: number
  glowAmp?: number
  allowCross?: boolean
  onCross?: (toSide: 'a' | 'b') => void
}

export class PortalPair {
  private sideA: PortalSide
  private sideB: PortalSide

  constructor(scene: Scene, player: Player, opts: PortalPairOptions) {
    const glow = opts.glowAmp ?? 0.35
    const cross = opts.allowCross ?? true
    this.sideA = new PortalSide(scene, player, opts.a, opts.b, opts.seenFromA, opts.portalRatio, () => opts.onCross?.('b'), glow, cross)
    this.sideB = new PortalSide(scene, player, opts.b, opts.a, opts.seenFromB, opts.portalRatio, () => opts.onCross?.('a'), glow, cross)
  }

  update(engine: Engine, reducedMotion: boolean): void {
    this.sideA.update(engine, reducedMotion)
    this.sideB.update(engine, reducedMotion)
  }

  /** Ray remap using the viewer-facing (A) side — for shooting through the door. */
  remapPrimary(origin: Vector3, dir: Vector3): { origin: Vector3; dir: Vector3; entryDist: number; entryPoint: Vector3 } | null {
    return this.sideA.remap(origin, dir)
  }

  addRenderMesh(m: Mesh): void {
    this.sideA.addRenderMesh(m)
  }

  pulse(): void {
    this.sideA.pulse()
    this.sideB.pulse()
  }
}

// ---------------------------------------------------------------------------
// TranslationGate — an invisible plane that silently shifts the player by a
// fixed offset when crossed (loop corridor, dark-vestibule sector joins).
// Deterministic, geometry-free, zero rendering cost.
// ---------------------------------------------------------------------------

export interface GateOptions {
  /** Plane through `point` with normal along `axis` (+1 or -1 on x or z). */
  point: Vector3
  axis: 'x' | 'z'
  direction: 1 | -1 // crossing direction (movement sign along axis) that triggers
  span: { min: Vector3; max: Vector3 } // player must be inside this box
  offset: Vector3 // applied to player position on trigger
  onCross?: () => void
  enabled?: () => boolean
}

export class TranslationGate {
  private prev: number | null = null

  constructor(private player: Player, private o: GateOptions) {}

  update(): void {
    const p = this.player.camera.position
    const s = this.o.span
    if (
      p.x < s.min.x || p.x > s.max.x ||
      p.y < s.min.y || p.y > s.max.y ||
      p.z < s.min.z || p.z > s.max.z
    ) {
      this.prev = null
      return
    }
    if (this.o.enabled && !this.o.enabled()) {
      this.prev = null
      return
    }
    const v = this.o.axis === 'x' ? p.x : p.z
    const plane = this.o.axis === 'x' ? this.o.point.x : this.o.point.z
    if (this.prev !== null) {
      const crossed =
        this.o.direction === 1
          ? this.prev < plane && v >= plane
          : this.prev > plane && v <= plane
      if (crossed && Math.abs(v - this.prev) < 2) {
        p.addInPlace(this.o.offset)
        this.o.onCross?.()
        this.prev = null
        return
      }
    }
    this.prev = v
  }
}
