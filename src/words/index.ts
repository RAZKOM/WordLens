import { ALLOWLIST_PACKED } from './allowlist'
import { SPOKEN_PACKED } from './spoken'
import { TARGETS_PACKED } from './targets'

function unpack(packed: string): string[] {
  const out: string[] = []
  for (let i = 0; i < packed.length; i += 5) out.push(packed.slice(i, i + 5))
  return out
}

/** Answers, in a fixed sorted order (the deck shuffles indices into this list). */
export const TARGETS: readonly string[] = unpack(TARGETS_PACKED)

/** Allowed guesses the voice model can recognise (the voice grammar). */
export const SPOKEN: readonly string[] = unpack(SPOKEN_PACKED)

const allow = new Set(unpack(ALLOWLIST_PACKED))

export function isValidGuess(word: string): boolean {
  return allow.has(word)
}
