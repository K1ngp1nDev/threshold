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
import { isTransitioning } from './core/transitions'
import { unlockAudio } from './core/audio'
import { FX, applyShake, tickTimeScale, timeScale } from './core/fx'
import { buildMuseum } from './world/museum'
import { Director } from './core/director'
import { createHud } from './ui/hud'
import type { EnemyType } from './core/enemies'

const params = new URLSearchParams(location.search)
const qaMode = params.get('qa') === '1'
const forceTouch = params.get('touch') === '1'
const forceReduce = params.get('reduce') === '1'
const seedParam = params.get('seed') ?? ''

const isTouch =
  forceTouch ||
  (window.matchMedia('(pointer: coarse)').matches && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window))
const reducedMotion = forceReduce || window.matchMedia('(prefers-reduced-motion: reduce)').matches
const quality = resolveQuality(isTouch)
setState({ touchMode: isTouch, reducedMotion, quality: quality.tier })

const canvas = document.getElementById('c') as HTMLCanvasElement
canvas.addEventListener('contextmenu', (e) => e.preventDefault())

const engine = new Engine(canvas, true, { powerPreference: 'high-performance', stencil: false })
const dpr = window.devicePixelRatio || 1
engine.setHardwareScalingLevel(quality.tier === 'high' ? 1 / Math.min(dpr, 1.75) : quality.tier === 'medium' ? 1 : 1.5)

const scene = new Scene(engine)
scene.clearColor = new Color4(0.05, 0.047, 0.043, 1)
scene.ambientColor = new Color3(0, 0, 0)
scene.fogMode = Scene.FOGMODE_EXP2
scene.fogDensity = 0.0038
scene.fogColor = new Color3(0.055, 0.052, 0.048)
scene.collisionsEnabled = true

const mats = makeMaterials(scene)
const player = new Player(scene, canvas, new Vector3(-11, 1.8, 2), 1.85)
watchPointerLock(canvas)

const museum = buildMuseum(scene, mats, player, quality.portalRatio)
player.teleport(museum.spawn.pos, museum.spawn.yaw, museum.spawn.pitch)

// post-processing
const glow = quality.glow ? new GlowLayer('glow', scene, { mainTextureRatio: 0.5 }) : null
if (glow) glow.intensity = 0.8
const pipeline = new DefaultRenderingPipeline('drp', false, scene, [player.camera])
pipeline.fxaaEnabled = quality.fxaa
pipeline.bloomEnabled = quality.bloom
pipeline.bloomThreshold = 0.72
pipeline.bloomWeight = 0.24
pipeline.bloomKernel = 48
pipeline.imageProcessingEnabled = true
pipeline.imageProcessing.contrast = 1.18
pipeline.imageProcessing.exposure = 1.05
pipeline.imageProcessing.vignetteEnabled = true
pipeline.imageProcessing.vignetteWeight = 2.2
pipeline.imageProcessing.vignetteColor = new Color4(0.03, 0.025, 0.02, 0)

const fx = new FX(scene, glow, quality.tier !== 'low')

// director is created after HUD, but HUD callbacks reference it lazily
let director: Director
const interactions = new InteractionManager(museum.registry, player, (t) => hud.setPrompt(t))

const hud = createHud({
  isTouch,
  qaMode,
  onStart: () => {
    unlockAudio()
    director.start()
    player.requestLock()
  },
  onRestart: () => {
    director.restart()
    player.requestLock()
  },
  onInteract: () => interactions.trigger(),
  onLook: (dx, dy) => player.rotate(dx, dy),
  onMove: (fwd, side) => player.setMove(fwd, side),
  onJump: () => player.jump(),
  onCrouch: (on) => player.setCrouch(on),
  onFire: (down) => director.weapon.setPrimary(down),
  onPulse: () => director.triggerPulse(),
})

director = new Director(scene, player, {
  scene,
  poses: museum.poses,
  wallMeshes: museum.wallMeshes,
  portal: museum.portal,
  clearInteractables: museum.clearInteractables,
  addInteractable: museum.addInteractable,
  removeInteractable: museum.removeInteractable,
}, fx, {
  toast: (t, ms) => hud.toast(t, ms),
  banner: (title, sub) => hud.banner(title, sub),
  hitMarker: (kind) => hud.hitMarker(kind),
  pulseFlash: () => hud.pulseFlash(),
}, seedParam)

// desktop mouse: LMB fire, RMB Anomaly Pulse
window.addEventListener('mousedown', (e) => {
  if (isTouch || getState().phase !== 'playing') return
  if (e.button === 0) director.weapon.setPrimary(true)
  else if (e.button === 2) director.triggerPulse()
})
window.addEventListener('mouseup', (e) => {
  if (isTouch) return
  if (e.button === 0) director.weapon.setPrimary(false)
})
canvas.addEventListener('pointerdown', () => {
  unlockAudio()
  if (!isTouch && getState().phase === 'playing' && !document.pointerLockElement) player.requestLock()
})

subscribe((st) => {
  scene.fogDensity = st.phase === 'playing' ? 0.0038 : 0.006
})

// ---- main loop
scene.onBeforeRenderObservable.add(() => {
  const realDt = Math.min(engine.getDeltaTime() / 1000, 0.05)
  tickTimeScale(realDt)
  const dt = realDt * timeScale()

  const playing = getState().phase === 'playing'
  player.enabled = playing && !isTransitioning()

  player.update(dt)
  applyShake(player.camera, realDt)
  museum.update(engine)
  if (playing) {
    director.update(dt, realDt)
    interactions.update()
  }
  fx.update(realDt)
})

engine.runRenderLoop(() => scene.render())
window.addEventListener('resize', () => engine.resize())
window.setInterval(() => hud.setFps(engine.getFps()), 400)

// ---- debug / QA API
const api = {
  version: '2.0.0-breach',
  ready: false,
  start: () => director.start(),
  restart: () => director.restart(),
  state: () => ({ ...getState() }),
  pos: () => [player.camera.position.x, player.camera.position.y, player.camera.position.z] as const,
  setMove: (f: number, s: number) => player.setMove(f, s),
  stop: () => player.setMove(0, 0),
  jump: () => player.jump(),
  crouch: (on: boolean) => player.setCrouch(on),
  look: (yaw: number, pitch = 0) => {
    player.camera.rotation.y = yaw
    player.camera.rotation.x = pitch
  },
  interact: () => {
    interactions.trigger()
    return interactions.current?.id ?? null
  },
  invuln: (on: boolean) => player.setInvuln(on),
  currentInteractable: () => interactions.current?.id ?? null,
  ...(() => {
    const d = () => director.debug()
    return {
      shoot: () => d().shoot(),
      pulse: () => d().pulse(),
      giveWeapon: () => d().giveWeapon(),
      forceVictory: () => d().forceVictory(),
      enterZone: (i: number) => d().enterZone(i),
      zoneCount: () => d().zoneCount,
      enemyCount: () => d().enemyCount(),
      spawnEnemy: (t: EnemyType) => d().spawnEnemy(t),
      killAll: () => d().killAll(),
      sealNearestAnchor: () => d().sealNearestAnchor(),
      anchorsRemaining: () => d().anchorsRemaining(),
      pulseEnergy: () => d().pulseEnergy(),
    }
  })(),
}
;(window as unknown as { __BREACH__: typeof api }).__BREACH__ = api

scene.executeWhenReady(() => {
  scene.render()
  document.getElementById('veil')?.classList.add('gone')
  if (reducedMotion) document.body.classList.add('reduce-motion')
  api.ready = true
  setState({ ready: true, phase: 'title' })
  if (qaMode) director.start()
})
