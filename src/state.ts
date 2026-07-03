// Tiny observable store — no framework needed for a handful of flags.

export type ZoneId =
  | 'atrium'
  | 'impossible-door'
  | 'loop-corridor'
  | 'scale-gallery'
  | 'mirror-atrium'

export interface AppState {
  zone: ZoneId
  laps: number
  inMiniatureRoom: boolean
  mirrorLight: boolean
  corridorUnlocked: boolean
  xray: boolean
  muted: boolean
  reducedMotion: boolean
  touchMode: boolean
  quality: 'low' | 'medium' | 'high'
  locked: boolean // pointer lock active
  ready: boolean
}

type Listener = (s: AppState) => void

const state: AppState = {
  zone: 'atrium',
  laps: 0,
  inMiniatureRoom: false,
  mirrorLight: true,
  corridorUnlocked: false,
  xray: false,
  muted: false,
  reducedMotion: false,
  touchMode: false,
  quality: 'high',
  locked: false,
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
  atrium: 'Main Atrium',
  'impossible-door': 'Exhibit I — Impossible Door',
  'loop-corridor': 'Exhibit II — Loop Corridor',
  'scale-gallery': 'Exhibit III — Scale Gallery',
  'mirror-atrium': 'Exhibit IV — Mirror Atrium',
}
