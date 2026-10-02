/**
 * Dev only: `?demo=crane:slate.eerie:cra&focus=N` starts on a given round (target, guesses, typed letters)
 * with a long stats history, in memory, so store screenshots can be taken in the simulator
 * (scripts/listing-sim.ts). Nothing is read from or written to the glasses' storage.
 */
import type { Stats } from './game'
import { Storage, type KeyValueStore } from './storage'
import { KB_KEYS } from './textkb'

/** A long run: wins in every bucket, and enough losses that the outline bar is obvious. */
export const DEMO_HISTORY: Stats = {
  streak: 9,
  best: 23,
  played: 186,
  wins: 142,
  dist: [8, 22, 41, 38, 21, 12, 44],
  last: 3,
}

export interface Demo {
  kv: KeyValueStore
  /** Keyboard focus (index into KB_KEYS). */
  focus: number
}

export async function demoFromUrl(search: string): Promise<Demo | null> {
  const q = new URLSearchParams(search)
  const spec = q.get('demo')
  if (!spec) return null
  const [target, guesses = '', typed = ''] = spec.toLowerCase().split(':')
  const data = new Map<string, string>()
  const kv: KeyValueStore = {
    get: async (k) => data.get(k) ?? '',
    set: async (k, v) => {
      data.set(k, v)
      return true
    },
  }
  const storage = new Storage(kv)
  await storage.saveStats(DEMO_HISTORY)
  await storage.saveRound({ target, guesses: guesses ? guesses.split('.') : [], typed })
  const label = (q.get('focus') ?? 'Q').toUpperCase()
  return { kv, focus: Math.max(0, KB_KEYS.findIndex((k) => k.label === label)) }
}
