import { describe, expect, it } from 'vitest'
import { advance, freshDeck, isValidDeck, permutation, wordAt } from '../src/deck'

const words = ['aaaaa', 'bbbbb', 'ccccc', 'ddddd', 'eeeee']

describe('deck', () => {
  it('permutation is a deterministic shuffle of every index', () => {
    const p = permutation(100, 42)
    expect([...p].sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, i) => i))
    expect(permutation(100, 42)).toEqual(p)
    expect(permutation(100, 43)).not.toEqual(p)
  })

  it('deals every word once before reshuffling', () => {
    let seeds = 1
    let d = freshDeck(words, null, () => seeds++)
    const seen = new Set<string>()
    for (let i = 0; i < words.length; i++) {
      seen.add(wordAt(words, d))
      if (i < words.length - 1) d = advance(words, d, () => seeds++)
    }
    expect(seen.size).toBe(words.length)
  })

  it('a reshuffle never repeats the last word immediately', () => {
    for (let s = 1; s < 300; s++) {
      let seeds = s
      const d = { seed: s, index: words.length - 1 }
      const last = wordAt(words, d)
      const next = advance(words, d, () => seeds++ * 7919)
      expect(next.index).toBe(0)
      expect(wordAt(words, next)).not.toBe(last)
    }
  })

  it('validates persisted deck state', () => {
    expect(isValidDeck(words, { seed: 5, index: 4 })).toBe(true)
    expect(isValidDeck(words, { seed: 5, index: 5 })).toBe(false)
    expect(isValidDeck(words, { seed: -1, index: 0 })).toBe(false)
  })
})
