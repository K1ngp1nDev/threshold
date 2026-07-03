import {
  Color3,
  DynamicTexture,
  Scene,
  StandardMaterial,
  Texture,
} from '@babylonjs/core'
import { mulberry32 } from './rng'

// Palette: warm white, concrete, black, brass/amber, subtle teal accents.
export const PALETTE = {
  paper: new Color3(0.957, 0.937, 0.906),
  concrete: new Color3(0.62, 0.6, 0.57),
  concreteDark: new Color3(0.38, 0.365, 0.345),
  ink: new Color3(0.075, 0.07, 0.065),
  brass: new Color3(0.788, 0.639, 0.361),
  amber: new Color3(1.0, 0.78, 0.45),
  teal: new Color3(0.353, 0.639, 0.604),
  warmLight: new Color3(1.0, 0.86, 0.66),
}

export interface MaterialKit {
  concrete: StandardMaterial
  concreteDark: StandardMaterial
  floor: StandardMaterial
  plaster: StandardMaterial
  brass: StandardMaterial
  ink: StandardMaterial
  glass: StandardMaterial
  emissiveWarm: StandardMaterial
  emissiveTeal: StandardMaterial
  amberOrb: StandardMaterial
}

function concreteTexture(scene: Scene, seed: number, base: string, size = 512): DynamicTexture {
  const dt = new DynamicTexture(`concrete-${seed}`, size, scene, true)
  const ctx = dt.getContext() as CanvasRenderingContext2D
  const rnd = mulberry32(seed)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  // speckle
  for (let i = 0; i < 2600; i++) {
    const v = Math.floor(rnd() * 46) - 23
    ctx.fillStyle = `rgba(${128 + v},${126 + v},${122 + v},${0.16 + rnd() * 0.2})`
    const r = rnd() < 0.94 ? 1 : 2
    ctx.fillRect(rnd() * size, rnd() * size, r, r)
  }
  // faint stains
  for (let i = 0; i < 9; i++) {
    const g = ctx.createRadialGradient(
      rnd() * size, rnd() * size, 4, rnd() * size, rnd() * size, 60 + rnd() * 120,
    )
    const dark = rnd() < 0.5
    g.addColorStop(0, dark ? 'rgba(30,28,26,0.05)' : 'rgba(250,247,240,0.04)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  // board-form seams
  ctx.strokeStyle = 'rgba(20,18,16,0.09)'
  ctx.lineWidth = 2
  for (let y = size / 4; y < size; y += size / 4) {
    ctx.beginPath()
    ctx.moveTo(0, y + (rnd() - 0.5) * 3)
    ctx.lineTo(size, y + (rnd() - 0.5) * 3)
    ctx.stroke()
  }
  // form-tie dots
  ctx.fillStyle = 'rgba(20,18,16,0.14)'
  for (let y = size / 8; y < size; y += size / 4) {
    for (let x = size / 8; x < size; x += size / 4) {
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  dt.update()
  return dt
}

function floorTexture(scene: Scene, seed: number): DynamicTexture {
  const size = 1024
  const dt = new DynamicTexture('floor-tex', size, scene, true)
  const ctx = dt.getContext() as CanvasRenderingContext2D
  const rnd = mulberry32(seed)
  ctx.fillStyle = '#8e8a82'
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 5200; i++) {
    const v = Math.floor(rnd() * 40) - 20
    ctx.fillStyle = `rgba(${140 + v},${136 + v},${128 + v},${0.14 + rnd() * 0.18})`
    ctx.fillRect(rnd() * size, rnd() * size, 1, 1)
  }
  // polished sheen patches
  for (let i = 0; i < 6; i++) {
    const g = ctx.createRadialGradient(
      rnd() * size, rnd() * size, 10, rnd() * size, rnd() * size, 120 + rnd() * 180,
    )
    g.addColorStop(0, 'rgba(255,252,244,0.05)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  // grout grid — big 2m tiles (texture tiles every 4m in world with uScale)
  ctx.strokeStyle = 'rgba(24,22,20,0.35)'
  ctx.lineWidth = 3
  for (let p = 0; p <= size; p += size / 2) {
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke()
  }
  dt.update()
  return dt
}

export function makeSignTexture(
  scene: Scene,
  lines: string[],
  opts: { w?: number; h?: number; bg?: string; fg?: string; sub?: string; accent?: string } = {},
): DynamicTexture {
  const w = opts.w ?? 512
  const h = opts.h ?? 256
  const dt = new DynamicTexture(`sign-${lines[0]}-${Math.floor(Math.random() * 1e9)}`, { width: w, height: h }, scene, true)
  const ctx = dt.getContext() as CanvasRenderingContext2D
  ctx.fillStyle = opts.bg ?? '#1a1815'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = opts.accent ?? 'rgba(201,163,92,0.85)'
  ctx.lineWidth = 4
  ctx.strokeRect(10, 10, w - 20, h - 20)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const fg = opts.fg ?? '#f4efe7'
  const n = lines.length
  lines.forEach((line, i) => {
    const isTitle = i === 0
    ctx.fillStyle = isTitle ? fg : (opts.sub ?? 'rgba(244,239,231,0.72)')
    ctx.font = isTitle
      ? `600 ${Math.floor(h * 0.16)}px ui-sans-serif, system-ui, sans-serif`
      : `400 ${Math.floor(h * 0.1)}px ui-sans-serif, system-ui, sans-serif`
    const y = h * (0.5 + (i - (n - 1) / 2) * 0.24)
    ctx.fillText(line, w / 2, y, w - 60)
  })
  dt.update()
  return dt
}

export function makeMaterials(scene: Scene): MaterialKit {
  const std = (name: string, diffuse: Color3, spec = 0.04): StandardMaterial => {
    const m = new StandardMaterial(name, scene)
    m.diffuseColor = diffuse
    m.specularColor = new Color3(spec, spec, spec)
    m.specularPower = 64
    return m
  }

  const concrete = std('concrete', PALETTE.concrete)
  const cTex = concreteTexture(scene, 1337, '#a09c93')
  cTex.uScale = 2; cTex.vScale = 2
  concrete.diffuseTexture = cTex

  const concreteDark = std('concreteDark', PALETTE.concreteDark)
  const cdTex = concreteTexture(scene, 4242, '#6b6862')
  cdTex.uScale = 2; cdTex.vScale = 2
  concreteDark.diffuseTexture = cdTex

  const floor = std('floor', new Color3(0.58, 0.565, 0.535), 0.12)
  const fTex = floorTexture(scene, 777)
  fTex.uScale = 8; fTex.vScale = 8
  fTex.wrapU = Texture.WRAP_ADDRESSMODE
  fTex.wrapV = Texture.WRAP_ADDRESSMODE
  floor.diffuseTexture = fTex
  floor.specularPower = 128

  const plaster = std('plaster', new Color3(0.9, 0.875, 0.835), 0.02)

  const brass = std('brass', PALETTE.brass, 0.55)
  brass.specularPower = 96
  brass.emissiveColor = PALETTE.brass.scale(0.06)

  const ink = std('ink', PALETTE.ink, 0.1)

  const glass = std('glass', new Color3(0.75, 0.83, 0.82), 0.5)
  glass.alpha = 0.16
  glass.specularPower = 128
  glass.backFaceCulling = false

  const emissiveWarm = new StandardMaterial('emissiveWarm', scene)
  emissiveWarm.emissiveColor = PALETTE.warmLight
  emissiveWarm.diffuseColor = Color3.Black()
  emissiveWarm.disableLighting = true

  const emissiveTeal = new StandardMaterial('emissiveTeal', scene)
  emissiveTeal.emissiveColor = PALETTE.teal.scale(0.9)
  emissiveTeal.diffuseColor = Color3.Black()
  emissiveTeal.disableLighting = true

  const amberOrb = new StandardMaterial('amberOrb', scene)
  amberOrb.emissiveColor = PALETTE.amber
  amberOrb.diffuseColor = Color3.Black()
  amberOrb.disableLighting = true

  return { concrete, concreteDark, floor, plaster, brass, ink, glass, emissiveWarm, emissiveTeal, amberOrb }
}
