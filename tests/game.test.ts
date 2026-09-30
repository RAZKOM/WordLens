import { describe, expect, it } from 'vitest'
import { EMPTY_STATS, applyLoss, applyWin, isLost, isWon, keyMarks, scoreGuess, winRate, type Stats } from '../src/game'

describe('scoreGuess', () => {
  it('ABBEY vs BABES: duplicate B, one correct and one present', () => {
    expect(scoreGuess('babes', 'abbey')).toEqual(['present', 'present', 'correct', 'correct', 'absent'])
  })
  it('CRANE vs EERIE: only the E in place counts', () => {
    expect(scoreGuess('eerie', 'crane')).toEqual(['absent', 'absent', 'present', 'absent', 'correct'])
  })
  it('SPEED vs EERIE: two Es present, third E absent', () => {
    expect(scoreGuess('eerie', 'speed')).toEqual(['present', 'present', 'absent', 'absent', 'absent'])
  })
  it('identical guess is all correct', () => {
    expect(scoreGuess('crane', 'crane')).toEqual(Array(5).fill('correct'))
  })
  it('extra copies beyond the target count are absent', () => {
    expect(scoreGuess('llama', 'hello')).toEqual(['present', 'present', 'absent', 'absent', 'absent'])
  })
})

describe('keyMarks', () => {
  it('only upgrades: a later absent copy never downgrades a correct key', () => {
    const m = keyMarks(['eerie'], 'crane')
    expect(m.get('e')).toBe('correct')
    expect(m.get('r')).toBe('present')
    expect(m.get('i')).toBe('absent')
  })
  it('present upgrades to correct across guesses', () => {
    const m = keyMarks(['rates', 'crane'], 'crane')
    expect(m.get('r')).toBe('correct')
  })
})

describe('round and stats', () => {
  it('win and loss detection', () => {
    expect(isWon({ target: 'crane', guesses: ['slate', 'crane'], typed: '' })).toBe(true)
    expect(isLost({ target: 'crane', guesses: Array(6).fill('slate'), typed: '' })).toBe(true)
    expect(isLost({ target: 'crane', guesses: [...Array(5).fill('slate'), 'crane'], typed: '' })).toBe(false)
  })
  const base = (o: Partial<Stats>): Stats => ({ ...EMPTY_STATS, ...o })
  it('win increments streak, best, played, wins and the guess bucket', () => {
    const s = applyWin(base({ streak: 2, best: 2, played: 5, wins: 3, dist: [0, 1, 2, 0, 0, 0, 2] }), 3)
    expect(s).toEqual({ streak: 3, best: 3, played: 6, wins: 4, dist: [0, 1, 3, 0, 0, 0, 2], last: 2 })
  })
  it('loss resets streak, keeps best, counts played and the L bucket', () => {
    const s = applyLoss(base({ streak: 3, best: 5, played: 6, wins: 4 }))
    expect(s).toEqual({ streak: 0, best: 5, played: 7, wins: 4, dist: [0, 0, 0, 0, 0, 0, 1], last: 6 })
  })
  it('does not mutate the previous distribution', () => {
    const before = base({})
    applyWin(before, 1)
    expect(before.dist).toEqual([0, 0, 0, 0, 0, 0, 0])
  })
  it('win rate is a whole percent, null before any games', () => {
    expect(winRate(base({}))).toBeNull()
    expect(winRate(base({ played: 3, wins: 2 }))).toBe(67)
  })
})
