/** Pure game rules. No SDK imports: unit-tested directly. */

export type Mark = 'correct' | 'present' | 'absent'

export const WORD_LENGTH = 5
export const MAX_GUESSES = 6

/**
 * Standard scoring with duplicate-letter handling:
 *  1. exact matches are `correct`, and consume that target letter;
 *  2. left to right, remaining guess letters are `present` while unmatched
 *     copies of that letter remain in the target, otherwise `absent`.
 */
export function scoreGuess(guess: string, target: string): Mark[] {
  const marks: Mark[] = new Array(WORD_LENGTH).fill('absent')
  const remaining = new Map<string, number>()
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guess[i] === target[i]) marks[i] = 'correct'
    else remaining.set(target[i], (remaining.get(target[i]) ?? 0) + 1)
  }
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (marks[i] === 'correct') continue
    const left = remaining.get(guess[i]) ?? 0
    if (left > 0) {
      marks[i] = 'present'
      remaining.set(guess[i], left - 1)
    }
  }
  return marks
}

const RANK: Record<Mark, number> = { absent: 0, present: 1, correct: 2 }

/** Best mark seen for each letter across all guesses. Marks only ever upgrade. */
export function keyMarks(guesses: readonly string[], target: string): Map<string, Mark> {
  const best = new Map<string, Mark>()
  for (const g of guesses) {
    const marks = scoreGuess(g, target)
    for (let i = 0; i < WORD_LENGTH; i++) {
      const prev = best.get(g[i])
      if (prev === undefined || RANK[marks[i]] > RANK[prev]) best.set(g[i], marks[i])
    }
  }
  return best
}

export interface Round {
  target: string
  guesses: string[]
  typed: string
}

export function isWon(r: Round): boolean {
  return r.guesses.length > 0 && r.guesses[r.guesses.length - 1] === r.target
}

export function isLost(r: Round): boolean {
  return !isWon(r) && r.guesses.length >= MAX_GUESSES
}

export function isFinished(r: Round): boolean {
  return isWon(r) || isLost(r)
}

/** Distribution buckets: guesses 1–6, then index 6 for losses and give-ups. */
export const LOSS_BUCKET = 6
export const DIST_LABELS = ['1', '2', '3', '4', '5', '6', 'L'] as const

export interface Stats {
  streak: number
  best: number
  played: number
  wins: number
  /** Seven counts: games won in 1..6 guesses, then losses (including give-ups). */
  dist: number[]
  /** Bucket of the most recent finished game, for highlighting; null before any. */
  last: number | null
}

export const EMPTY_STATS: Stats = { streak: 0, best: 0, played: 0, wins: 0, dist: [0, 0, 0, 0, 0, 0, 0], last: null }

function bump(dist: number[], bucket: number): number[] {
  const next = dist.slice()
  next[bucket] += 1
  return next
}

export function applyWin(s: Stats, guesses: number): Stats {
  const streak = s.streak + 1
  const bucket = Math.min(Math.max(guesses, 1), MAX_GUESSES) - 1
  return {
    streak,
    best: Math.max(s.best, streak),
    played: s.played + 1,
    wins: s.wins + 1,
    dist: bump(s.dist, bucket),
    last: bucket,
  }
}

export function applyLoss(s: Stats): Stats {
  return { ...s, streak: 0, played: s.played + 1, dist: bump(s.dist, LOSS_BUCKET), last: LOSS_BUCKET }
}

/** Whole-percent win rate, or null when nothing has been played. */
export function winRate(s: Stats): number | null {
  return s.played === 0 ? null : Math.round((100 * s.wins) / s.played)
}
