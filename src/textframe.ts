/**
 * Boxes drawn in firmware text, so they appear and change with ~60 ms text updates instead of image sends.
 * Pure.
 *
 * The G2 font is proportional, but the box-drawing glyphs (╭ ╮ ╰ ╯ │ ─), the ideographic space and
 * fullwidth letters (Ｅ Ｎ Ｔ) are all 20 px wide (measured in the simulator), so a box made only of them
 * lines up. A │ covers 21 of a line's 27 px, so one box alone has gappy walls; the walls are drawn twice,
 * the second copy in another text box half a line lower, which closes the gaps:
 *
 *   part a (at y):       ╭────╮      part b (at y + HALF_LINE):   │    │
 *                        │row │                                   │    │
 *                        │row │                                   ╰────╯
 *
 * Rows of words that are not fullwidth go in their own text box laid over the frame instead.
 */

export const CELL = 20
export const LINE = 27
export const HALF_LINE = 13

export interface TextFrame {
  /** Top edge and the rows (with their contents). */
  a: string
  /** Bare walls for the same rows, and the bottom edge; shown HALF_LINE lower. */
  b: string
}

/** Characters in a string, counting each code point once (fullwidth glyphs are one cell each). */
export function cellCount(s: string): number {
  return [...s].length
}

/**
 * @param cells inner width in 20 px cells.
 * @param rows the inner rows: a count of blank rows, or contents made only of 20 px glyphs, each padded or
 *   checked to exactly `cells` cells.
 */
export function textFrame(cells: number, rows: number | readonly string[]): TextFrame {
  const blank = '　'.repeat(cells)
  const inner = typeof rows === 'number' ? Array.from({ length: rows }, () => blank) : rows
  for (const r of inner) if (cellCount(r) !== cells) throw new Error(`frame row is ${cellCount(r)} cells, not ${cells}: ${r}`)
  const edge = '─'.repeat(cells)
  return {
    a: [`╭${edge}╮`, ...inner.map((r) => `│${r}│`)].join('\n'),
    b: [...inner.map(() => `│${blank}│`), `╰${edge}╯`].join('\n'),
  }
}

/** Height of each part's text box for a frame with this many rows. */
export function frameBoxHeight(rows: number): number {
  return (rows + 1) * LINE + 6
}
