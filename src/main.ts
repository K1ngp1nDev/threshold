import {
  Color3,
  Color4,
  DefaultRenderingPipeline,
  Engine,
  GlowLayer,
  Scene,
  Vector3,
} from '@babylonjs/core'
import './ui/styles.css'
import { getState, setState, subscribe } from './state'
import { resolveQuality } from './core/quality'
import { makeMaterials } from './core/materials'
import { Player, watchPointerLock } from './core/player'
import { InteractionManager } from './core/interact'
import { fadeTeleport, isTransitioning } from './core/transitions'
import { unlockAudio, playWhoosh } from './core/audio'
import { buildMuseum } from './world/museum'
import { createHud } from './ui/hud'

const params = new URLSearchParams(location.search)
const qaMode = params.get('qa') === '1'
const forceTouch = params.get('touch') === '1'
const forceReduce = params.get('reduce') === '1'

const isTouch =
  forceTouch ||
  (window.matchMedia('(pointer: coarse)').matches && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window))
const reducedMotion = forceReduce || window.matchMedia('(prefers-reduced-motion: reduce)').matches
const quality = resolveQuality(isTouch)

setState({ touchMode: isTouch, reducedMotion, quality: quality.tier })

const canvas = document.getElementById('c') as HTMLCanvasElement
canvas.addEventListener('contextmenu', (e) => e.preventDefault())

const engine = new Engine(canvas, true, {
  powerPreference: 'high-performance',
  stencil: false,
  preserveDrawingBuffer: false,
})
const dpr = window.devicePixelRatio || 1
engine.setHardwareScalingLevel(
  quality.tier === 'high' ? 1 / Math.min(dpr, 1.75) : quality.tier === 'medium' ? 1 : 1.5,
)

const scene = new Scene(engine)
scene.clearColor = new Color4(0.05, 0.047, 0.043, 1)
scene.ambientColor = new Color3(0, 0, 0)
scene.fogMode = Scene.FOGMODE_EXP2
scene.fogDensity = 0.0042
scene.fogColor = new Color3(0.055, 0.052, 0.048)
scene.collisionsEnabled = true
scene.gravity = new Vector3(0, -0.19, 0)

const mats = makeMaterials(scene)

// player is created first (world builders need it for gates/portals)
const player = new Player(scene, canvas, new Vector3(-11, 1.8, 2), 1.85)
watchPointerLock(canvas)

// world
let toastFn: (t: string) => void = () => undefined
const museum = buildMuseum(scene, mats, player, quality.portalRatio, (t) => toastFn(t))
player.teleport(museum.spawn.pos, museum.spawn.yaw, museum.spawn.pitch)

// interactions
const interactions = new InteractionManager(museum.registry, player, (text) => hud.setPrompt(text))

// HUD
const hud = createHud({
  isTouch,
  qaMode,
  viewpoints: museum.viewpoints,
  onEnter: () => {
    player.requestLock()
  },
  onInteract: () => interactions.trigger(),
  onViewpoint: (id) => {
    const pose = museum.poses[id]
    if (pose) {
      void fadeTeleport(scene, player, { pos: pose.pos, yaw: pose.yaw, pitch: pose.pitch })
    }
  },
  getPlayerPos: () => ({
    x: player.camera.position.x,
    y: player.camera.position.y,
    z: player.camera.position.z,
  }),
})
toastFn = (t) => hud.toast(t)

// re-lock pointer + audio unlock on canvas click
canvas.addEventListener('pointerdown', () => {
  unlockAudio()
  if (!isTouch && !hud.isModalOpen()) player.requestLock()
})

// pause player while help modal is open
subscribe((s) => {
  scene.forceWireframe = s.xray
})

// post-processing per quality tier
if (quality.glow) {
  const glow = new GlowLayer('glow', scene, { mainTextureRatio: 0.5 })
  glow.intensity = 0.65
}
const pipeline = new DefaultRenderingPipeline('drp', false, scene, [player.camera])
pipeline.fxaaEnabled = quality.fxaa
pipeline.bloomEnabled = quality.bloom
pipeline.bloomThreshold = 0.72
pipeline.bloomWeight = 0.22
pipeline.bloomKernel = 48
pipeline.imageProcessingEnabled = true
pipeline.imageProcessing.contrast = 1.16
pipeline.imageProcessing.exposure = 1.06
pipeline.imageProcessing.vignetteEnabled = true
pipeline.imageProcessing.vignetteWeight = 2.4
pipeline.imageProcessing.vignetteColor = new Color4(0.03, 0.025, 0.02, 0)

// zone tracking + whoosh on zone change
let lastZone = getState().zone
scene.onBeforeRenderObservable.add(() => {
  const z = museum.registry.zoneAt(player.camera.position)
  if (z && z !== lastZone) {
    lastZone = z
    setState({ zone: z })
    if (z !== 'atrium') playWhoosh()
  }
})

// QA/debug driver — deterministic hooks for Playwright and the screenshot rig
interface WalkJob {
  remaining: number
  resolve: () => void
}
let walkJob: WalkJob | null = null

const api = {
  version: '1.0.0',
  ready: false,
  zone: () => getState().zone,
  state: () => ({ ...getState() }),
  pos: () => [player.camera.position.x, player.camera.position.y, player.camera.position.z] as const,
  poseNames: () => Object.keys(museum.poses),
  teleport: (id: string) => {
    const pose = museum.poses[id]
    if (!pose) return false
    player.teleport(pose.pos, pose.yaw, pose.pitch)
    return true
  },
  look: (yaw: number, pitch = 0) => {
    player.camera.rotation.y = yaw
    player.camera.rotation.x = pitch
  },
  walk: (meters: number) =>
    new Promise<void>((resolve) => {
      walkJob?.resolve()
      walkJob = { remaining: meters, resolve }
    }),
  interact: () => {
    interactions.trigger()
    return interactions.current?.id ?? null
  },
  currentInteractable: () => interactions.current?.id ?? null,
}
;(window as unknown as { __THRESHOLD__: typeof api }).__THRESHOLD__ = api

// main loop
scene.onBeforeRenderObservable.add(() => {
  if (!isTransitioning()) player.enabled = !hud.isModalOpen()

  if (walkJob && player.enabled) {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.05)
    const step = Math.min(3.8 * dt, walkJob.remaining)
    const yaw = player.camera.rotation.y
    player.camera.cameraDirection.addInPlace(new Vector3(Math.sin(yaw) * step, 0, Math.cos(yaw) * step))
    walkJob.remaining -= step
    if (walkJob.remaining <= 0.001) {
      walkJob.resolve()
      walkJob = null
    }
  }

  player.update()
  museum.update(engine)
  interactions.update()
})

engine.runRenderLoop(() => {
  scene.render()
})

window.addEventListener('resize', () => engine.resize())

// fps meter
window.setInterval(() => hud.setFps(engine.getFps()), 500)

// reveal
scene.executeWhenReady(() => {
  scene.render()
  document.getElementById('veil')?.classList.add('gone')
  api.ready = true
  if (reducedMotion) document.body.classList.add('reduce-motion')
})
