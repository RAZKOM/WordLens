/**
 * 5×7 pixel font (uppercase, digits, a little punctuation). Drawn on the phone
 * into the framebuffer, so no font file ever ships to the glasses.
 * Each glyph is 7 rows of 5 characters; '#' = pixel on.
 */
const G: Record<string, string> = {
  A: ' ### #   ##   #######   ##   ##   #',
  B: '#### #   ##   ##### #   ##   ##### ',
  C: ' ### #   ##    #    #    #   # ### ',
  D: '#### #   ##   ##   ##   ##   ##### ',
  E: '######    #    #### #    #    #####',
  F: '######    #    #### #    #    #    ',
  G: ' ### #   ##    # ####   ##   # ####',
  H: '#   ##   ##   #######   ##   ##   #',
  I: ' ###   #    #    #    #    #   ### ',
  J: '  ###   #    #    # #  # #  #  ##  ',
  K: '#   ##  # # #  ##   # #  #  # #   #',
  L: '#    #    #    #    #    #    #####',
  M: '#   ### ### # ## # ##   ##   ##   #',
  N: '#   ###  ## # ##  ###   ##   ##   #',
  O: ' ### #   ##   ##   ##   ##   # ### ',
  P: '#### #   ##   ##### #    #    #    ',
  Q: ' ### #   ##   ##   ## # ##  #  ## #',
  R: '#### #   ##   ##### # #  #  # #   #',
  S: ' #####    #     ###     #    ##### ',
  T: '#####  #    #    #    #    #    #  ',
  U: '#   ##   ##   ##   ##   ##   # ### ',
  V: '#   ##   ##   ##   ##   # # #   #  ',
  W: '#   ##   ##   ## # ## # ### ###   #',
  X: '#   ##   # # #   #   # # #   ##   #',
  Y: '#   ##   # # #   #    #    #    #  ',
  Z: '#####    #   #   #   #   #    #####',
  '0': ' ### #   ##  ### # ###  ##   # ### ',
  '1': '  #   ##    #    #    #    #   ### ',
  '2': ' ### #   #    #   #   #   #   #####',
  '3': '####     #    # ###     #    ##### ',
  '4': '   #   ##  # # #  # #####   #    # ',
  '5': '######    ####     #    ##   # ### ',
  '6': '  ##  #   #    #### #   ##   # ### ',
  '7': '#####    #   #   #   #    #    #   ',
  '8': ' ### #   ##   # ### #   ##   # ### ',
  '9': ' ### #   ##   # ####    #   #  ##  ',
  ' ': '                                   ',
  '!': '  #    #    #    #    #         #  ',
  '/': '    #    #   #   #   #   #    #    ',
  '-': '                ###                ',
  '%': '##  ###  #   #   #   #   #  ###  ##',
  ':': '       #    #         #    #       ',
  '.': '                          ##   ##  ',
  '?': ' ### #   #    #   #   #         #  ',
}

export const GLYPH_W = 5
export const GLYPH_H = 7

export function glyph(ch: string): string {
  const g = G[ch.toUpperCase()]
  if (g && g.length !== GLYPH_W * GLYPH_H) throw new Error(`bad glyph ${ch}`)
  return g ?? G['?']
}

export function hasGlyph(ch: string): boolean {
  return ch.toUpperCase() in G
}

/** Advance per character at a scale: glyph width plus 1 unit of spacing. */
export function advance(scale: number): number {
  return (GLYPH_W + 1) * scale
}

export function textWidth(text: string, scale: number): number {
  return text.length === 0 ? 0 : text.length * advance(scale) - scale
}
