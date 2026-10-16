/**
 * Spelling by voice: single letters ("c", "r") and the NATO alphabet ("charlie", "romeo"). Pure.
 *
 * Bare letters are cheap to say but easy to confuse (B/D/E/P/T/V, M/N); NATO words are recognised almost
 * perfectly. Both work, and can be mixed in one utterance.
 */

export const NATO: Readonly<Record<string, string>> = {
  alpha: 'a',
  bravo: 'b',
  charlie: 'c',
  delta: 'd',
  echo: 'e',
  foxtrot: 'f',
  golf: 'g',
  hotel: 'h',
  india: 'i',
  juliet: 'j',
  kilo: 'k',
  lima: 'l',
  mike: 'm',
  november: 'n',
  oscar: 'o',
  papa: 'p',
  quebec: 'q',
  romeo: 'r',
  sierra: 's',
  tango: 't',
  uniform: 'u',
  victor: 'v',
  whiskey: 'w',
  // "x-ray" is not one word in the model vocabulary; it is heard as "x ray" (see spellLetters).
  yankee: 'y',
  zulu: 'z',
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('')

/** Every word the spelling grammar accepts. "ray" exists only to absorb the second half of "x-ray". */
export const SPELL_TOKENS: readonly string[] = [...LETTERS, ...Object.keys(NATO), 'ray']

/** True for a NATO word (as opposed to a bare letter). */
export function isNato(token: string): boolean {
  return token in NATO
}

/**
 * Recognised spelling tokens → letters. "x ray" → x; a lone "ray" and anything unknown ("[unk]") are dropped.
 */
export function spellLetters(tokens: readonly string[]): string {
  let out = ''
  for (const t of tokens) {
    if (t.length === 1 && t >= 'a' && t <= 'z') out += t
    else if (t in NATO) out += NATO[t]
  }
  return out
}
