import { describe, expect, it } from 'vitest'
import { TARGETS, isValidGuess } from '../src/words'

describe('word lists', () => {
  it('targets are unique lowercase 5-letter words, all valid guesses', () => {
    expect(TARGETS.length).toBeGreaterThanOrEqual(1500)
    expect(TARGETS.length).toBeLessThanOrEqual(2500)
    expect(new Set(TARGETS).size).toBe(TARGETS.length)
    for (const w of TARGETS) {
      expect(w).toMatch(/^[a-z]{5}$/)
      expect(isValidGuess(w)).toBe(true)
    }
  })
  it('accepts common guesses and rejects junk', () => {
    for (const w of ['slate', 'crane', 'eerie', 'abbey', 'fizzy']) expect(isValidGuess(w)).toBe(true)
    for (const w of ['xxxxx', 'abcde', 'CRANE', 'cran']) expect(isValidGuess(w)).toBe(false)
  })
})
