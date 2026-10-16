/**
 * What was heard → the choices shown after push-to-talk. Pure.
 *
 * The engine decodes each clip twice over: once against the spoken word list, once against the spelling
 * alphabet. Vosk returns one best answer per decode, so the engine gets runner-ups by decoding again with
 * the earlier answers removed from the grammar. That also surfaces homophones (THERE → THEIR), which
 * sound identical and so come out in arbitrary order.
 */
import { WORD_LENGTH } from '../game'
import { isNato, spellLetters } from './spell'

/** One decode: the words recognised, and their mean confidence (0..1). */
export interface Hyp {
  tokens: string[]
  conf: number
}

/** Best-first decodes against each grammar. */
export interface Heard {
  words: Hyp[]
  spell: Hyp[]
}

export type Candidate = { kind: 'word'; word: string } | { kind: 'letters'; letters: string }

/** Most choices offered: with CANCEL that is the voice panel's five lines. */
export const MAX_CANDIDATES = 4

/**
 * Should spelling come before whole words? `typedLen` is how many letters the row already has.
 *  - Nothing usable as a word (no result, or several words in a row) → spell.
 *  - Two or more letters heard → the player is spelling.
 *  - One NATO word ("delta", "hotel" are also guesses): spelling only part-way through a row.
 *  - One bare letter: whichever decode is more confident (a lone "b" decoded as a word scores low).
 */
export function preferSpelling(h: Heard, typedLen: number): boolean {
  const s0 = h.spell[0]
  const letters = s0 ? spellLetters(s0.tokens) : ''
  if (!letters) return false
  const w0 = h.words[0]
  if (!w0 || w0.tokens.length !== 1) return true
  if (letters.length >= 2) return true
  if (s0.tokens.some(isNato)) return typedLen > 0
  return s0.conf >= w0.conf
}

/**
 * Choices, best first: whole words (each replaces the row and is guessed on confirm) and letter runs (added
 * to the row). Letter runs are cut to the free cells; a full row offers no letters.
 */
export function buildCandidates(h: Heard, typed: string, max = MAX_CANDIDATES): Candidate[] {
  const free = WORD_LENGTH - typed.length
  const words: Candidate[] = []
  for (const hyp of h.words) {
    if (hyp.tokens.length !== 1) continue
    const word = hyp.tokens[0]
    if (word.length === WORD_LENGTH && /^[a-z]+$/.test(word)) words.push({ kind: 'word', word })
  }
  const spelled: Candidate[] = []
  if (free > 0) {
    for (const hyp of h.spell) {
      const letters = spellLetters(hyp.tokens).slice(0, free)
      if (letters) spelled.push({ kind: 'letters', letters })
    }
  }
  const ordered = preferSpelling(h, typed.length) ? [...spelled, ...words] : [...words, ...spelled]
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const c of ordered) {
    const key = candidateLabel(c)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
    if (out.length >= max) break
  }
  return out
}

/** Label in the choice list: a word as is, letters with a leading "+" (they are added to the row). */
export function candidateLabel(c: Candidate): string {
  return c.kind === 'word' ? c.word.toUpperCase() : `+${c.letters.toUpperCase()}`
}

/** The row as it would read with this candidate applied (for the board preview). */
export function previewTyped(c: Candidate, typed: string): string {
  return c.kind === 'word' ? c.word : (typed + c.letters).slice(0, WORD_LENGTH)
}
