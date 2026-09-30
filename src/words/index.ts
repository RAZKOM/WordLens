import { ALLOWLIST_PACKED } from './allowlist'
import { TARGETS_PACKED } from './targets'

function unpack(packed: string): string[] {
  const out: string[] = []
  for (let i = 0; i < packed.length; i += 5) out.push(packed.slice(i, i + 5))
  return out
}

/** Answers, in a fixed sorted order (the deck shuffles indices into this list). */
export const TARGETS: readonly string[] = unpack(TARGETS_PACKED)

const allow = new Set(unpack(ALLOWLIST_PACKED))

export function isValidGuess(word: string): boolean {
  return allow.has(word)
}
