export interface QualitySettings {
  tier: 'low' | 'medium' | 'high'
  hardwareScale: number // engine.setHardwareScalingLevel — higher = fewer pixels
  portalRatio: number // RTT size as a ratio of screen size
  glow: boolean
  bloom: boolean
  fxaa: boolean
}

const TIERS: Record<string, QualitySettings> = {
  low: { tier: 'low', hardwareScale: 1.5, portalRatio: 0.35, glow: false, bloom: false, fxaa: false },
  medium: { tier: 'medium', hardwareScale: 1, portalRatio: 0.5, glow: true, bloom: false, fxaa: true },
  high: { tier: 'high', hardwareScale: 1, portalRatio: 0.75, glow: true, bloom: true, fxaa: true },
}

export function resolveQuality(isTouch: boolean): QualitySettings {
  const q = new URLSearchParams(location.search).get('quality')
  if (q && TIERS[q]) return TIERS[q]
  if (isTouch) return TIERS.low
  return TIERS.high
}
