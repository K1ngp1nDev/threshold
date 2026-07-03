// Tiny observable store for THRESHOLD: BREACH.

export type Phase =
  | 'loading'
  | 'title'
  | 'briefing'
  | 'playing'
  | 'paused'
  | 'victory'
  | 'defeat'

// Geometry regions (used by the world's zoneAt detection). Distinct from the
// game's ordered combat zones, which the director owns.
export type ZoneId =
  | 'atrium'
  | 'impossible-door'
  | 'loop-corridor'
  | 'scale-gallery'
  | 'mirror-atrium'

export interface AppState {
  phase: Phase
  // player vitals
  health: number
  maxHealth: number
  shield: number
  maxShield: number
  // weapon
  heat: number
  overheated: boolean
  charge: number // 0..1 while charging RMB
  charging: boolean
  // objective
  zoneIndex: number
  zoneCount: number
  zoneLabel: string
  objective: string
  anchorsSealed: number
  anchorsTotal: number
  // run stats
  kills: number
  anchorsSealedTotal: number
  elapsed: number // seconds, playing time
  // system
  hasWeapon: boolean
  reducedMotion: boolean
  touchMode: boolean
  quality: 'low' | 'medium' | 'high'
  locked: boolean
  muted: boolean
  ready: boolean
}

type Listener = (s: AppState) => void

const state: AppState = {
  phase: 'loading',
  health: 100,
  maxHealth: 100,
  shield: 50,
  maxShield: 50,
  heat: 0,
  overheated: false,
  charge: 0,
  charging: false,
  zoneIndex: 0,
  zoneCount: 4,
  zoneLabel: 'Entrance Hall',
  objective: 'Recover the Prism Carbine',
  anchorsSealed: 0,
  anchorsTotal: 0,
  kills: 0,
  anchorsSealedTotal: 0,
  elapsed: 0,
  hasWeapon: false,
  reducedMotion: false,
  touchMode: false,
  quality: 'high',
  locked: false,
  muted: false,
  ready: false,
}

const listeners = new Set<Listener>()

export function getState(): AppState {
  return state
}

export function setState(patch: Partial<AppState>): void {
  let changed = false
  for (const k of Object.keys(patch) as (keyof AppState)[]) {
    if (state[k] !== patch[k]) {
      ;(state as unknown as Record<string, unknown>)[k] = patch[k]
      changed = true
    }
  }
  if (changed) for (const l of listeners) l(state)
}

export function subscribe(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export const ZONE_LABELS: Record<ZoneId, string> = {
  atrium: 'Entrance Hall',
  'impossible-door': 'Room 402',
  'loop-corridor': 'Loop Corridor',
  'scale-gallery': 'Scale Gallery',
  'mirror-atrium': 'Mirror Atrium',
}
