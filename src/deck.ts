/**
 * Endless answer deck: a seeded shuffle of target indices. Only the seed and the
 * position are persisted, so the shuffled order is recomputed on launch.
 */

export interface DeckState {
  seed: number
  index: number
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const permCache = new Map<string, number[]>()

/** Fisher–Yates permutation of 0..n-1 for a seed (memoised: one live deck at a time). */
export function permutation(n: number, seed: number): number[] {
  const key = `${n}:${seed >>> 0}`
  const hit = permCache.get(key)
  if (hit) return hit
  const rand = mulberry32(seed)
  const p = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  permCache.clear()
  permCache.set(key, p)
  return p
}

export function wordAt(words: readonly string[], deck: DeckState): string {
  return words[permutation(words.length, deck.seed)[deck.index]]
}

export type SeedSource = () => number

export const randomSeed: SeedSource = () => (Math.random() * 0x100000000) >>> 0

/**
 * A fresh deck whose first word is not `avoid` (the last answer played), so a
 * reshuffle never deals the same word twice in a row.
 */
export function freshDeck(words: readonly string[], avoid: string | null, nextSeed: SeedSource = randomSeed): DeckState {
  for (let attempt = 0; attempt < 50; attempt++) {
    const deck = { seed: nextSeed(), index: 0 }
    if (words.length < 2 || wordAt(words, deck) !== avoid) return deck
  }
  // Astronomically unlikely; fall back to starting one step in.
  return { seed: nextSeed(), index: 1 }
}

/** Move to the next answer, reshuffling when the deck runs out. */
export function advance(words: readonly string[], deck: DeckState, nextSeed: SeedSource = randomSeed): DeckState {
  const lastWord = wordAt(words, deck)
  if (deck.index + 1 < words.length) return { seed: deck.seed, index: deck.index + 1 }
  return freshDeck(words, lastWord, nextSeed)
}

export function isValidDeck(words: readonly string[], d: DeckState): boolean {
  return Number.isInteger(d.seed) && d.seed >= 0 && Number.isInteger(d.index) && d.index >= 0 && d.index < words.length
}
