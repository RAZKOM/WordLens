/**
 * Typed persistence over the host's string key/value store
 * (`bridge.getLocalStorage` / `bridge.setLocalStorage`).
 *
 * Every read is defensive: missing, non-numeric or malformed values fall back
 * to defaults and never throw.
 */
import { type DeckState } from './deck'
import { MAX_GUESSES, type Round, type Stats } from './game'

export interface KeyValueStore {
  get(key: string): Promise<string>
  set(key: string, value: string): Promise<boolean>
}

export const KEYS = {
  streak: 'wordlens_streak',
  best: 'wordlens_best',
  played: 'wordlens_played',
  wins: 'wordlens_wins',
  deckSeed: 'wordlens_deck_seed',
  deckIndex: 'wordlens_deck_index',
  lastAnswer: 'wordlens_last_answer',
  round: 'wordlens_round',
  dist: 'wordlens_dist',
} as const

const WORD = /^[a-z]{5}$/
const PARTIAL = /^[a-z]{0,5}$/

export function parseCount(raw: unknown): number {
  if (typeof raw !== 'string' || !/^\d{1,9}$/.test(raw.trim())) return 0
  return Number(raw.trim())
}

function parseOptionalInt(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d{1,10}$/.test(raw.trim())) return null
  const n = Number(raw.trim())
  return n <= 0xffffffff ? n : null
}

export function parseRound(raw: unknown): Round | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (o.v !== 1) return null
  if (typeof o.target !== 'string' || !WORD.test(o.target)) return null
  if (!Array.isArray(o.guesses) || o.guesses.length > MAX_GUESSES) return null
  if (!o.guesses.every((g) => typeof g === 'string' && WORD.test(g))) return null
  const typed = typeof o.typed === 'string' && PARTIAL.test(o.typed) ? o.typed : ''
  return { target: o.target, guesses: [...(o.guesses as string[])], typed }
}

export function serializeRound(r: Round): string {
  return JSON.stringify({ v: 1, target: r.target, guesses: r.guesses, typed: r.typed })
}

/** `{ v: 1, counts: [7 ints], last: 0..6 | null }`. Anything else → empty distribution. */
export function parseDist(raw: unknown): { dist: number[]; last: number | null } {
  const empty = { dist: [0, 0, 0, 0, 0, 0, 0], last: null }
  if (typeof raw !== 'string' || raw.trim() === '') return empty
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    if (!o || o.v !== 1 || !Array.isArray(o.counts) || o.counts.length !== 7) return empty
    if (!o.counts.every((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 1e9)) return empty
    const last = Number.isInteger(o.last) && (o.last as number) >= 0 && (o.last as number) <= 6 ? (o.last as number) : null
    return { dist: [...(o.counts as number[])], last }
  } catch {
    return empty
  }
}

export interface Saved {
  stats: Stats
  deck: DeckState | null
  lastAnswer: string | null
  round: Round | null
}

async function safeGet(kv: KeyValueStore, key: string): Promise<string> {
  try {
    const v = await kv.get(key)
    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}

export class Storage {
  constructor(private kv: KeyValueStore) {}

  async load(): Promise<Saved> {
    const [streak, best, played, wins, seed, index, last, round, dist] = await Promise.all(
      [
        KEYS.streak,
        KEYS.best,
        KEYS.played,
        KEYS.wins,
        KEYS.deckSeed,
        KEYS.deckIndex,
        KEYS.lastAnswer,
        KEYS.round,
        KEYS.dist,
      ].map((k) => safeGet(this.kv, k)),
    )
    const d = parseDist(dist)
    const s: Stats = {
      streak: parseCount(streak),
      best: parseCount(best),
      played: parseCount(played),
      wins: parseCount(wins),
      dist: d.dist,
      last: d.last,
    }
    // Repair impossible combinations rather than trusting them.
    if (s.wins > s.played) s.played = s.wins
    if (s.best < s.streak) s.best = s.streak

    const seedN = parseOptionalInt(seed)
    const indexN = parseOptionalInt(index)
    return {
      stats: s,
      deck: seedN !== null && indexN !== null ? { seed: seedN, index: indexN } : null,
      lastAnswer: WORD.test(last.trim()) ? last.trim() : null,
      round: parseRound(round),
    }
  }

  // Writes are awaited in order by the caller's queue, but never block input.
  private async put(key: string, value: string): Promise<void> {
    try {
      await this.kv.set(key, value)
    } catch (err) {
      console.warn('[wordlens] storage write failed', key, err)
    }
  }

  async saveStats(s: Stats): Promise<void> {
    await this.put(KEYS.streak, String(s.streak))
    await this.put(KEYS.best, String(s.best))
    await this.put(KEYS.played, String(s.played))
    await this.put(KEYS.wins, String(s.wins))
    await this.put(KEYS.dist, JSON.stringify({ v: 1, counts: s.dist, last: s.last }))
  }

  async saveDeck(d: DeckState, lastAnswer: string | null): Promise<void> {
    await this.put(KEYS.deckSeed, String(d.seed))
    await this.put(KEYS.deckIndex, String(d.index))
    await this.put(KEYS.lastAnswer, lastAnswer ?? '')
  }

  async saveRound(r: Round | null): Promise<void> {
    await this.put(KEYS.round, r ? serializeRound(r) : '')
  }
}


/** Serialises writes so a later write can never land before an earlier one. */
export class WriteChain {
  private tail: Promise<void> = Promise.resolve()
  run(task: () => Promise<void>): Promise<void> {
    this.tail = this.tail.then(task, task)
    return this.tail
  }
  idle(): Promise<void> {
    return this.tail
  }
}
