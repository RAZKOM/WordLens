/**
 * The text keyboard: letters are firmware text, key frames and letter marks are
 * an image underneath. A swipe moves the focus by updating the text (~60 ms on
 * G2) instead of sending an image (~350 ms); the image only changes after a
 * guess.
 *
 * It works because fullwidth characters (Ｑ, ［, ］, the ideographic space) are
 * monospaced in the G2 firmware font: 20 px each from the box's left edge,
 * lines 27 px apart (measured in evenhub-simulator 0.9.5, lined up on G2
 * glasses with g2-kit's hub-probe H7). So the text is a grid, and the frames
 * are drawn on the same grid. Each row is spacer, key, spacer, key, …, spacer;
 * focus swaps the two spacers around a key for ［ ］, which are as wide as the
 * spacers, so nothing on the line moves.
 *
 * Marks follow the board: a ring (wrong spot) sits around the text letter; a
 * right-spot letter is a filled block with a dark letter, and a not-in-word
 * letter is dim with a strike, both drawn by the image with their text blanked
 * (text has one brightness, so it can't be dark on a fill or dimmed). The fill
 * and strike stay inside the brackets, so focus always shows.
 */
import type { Mark } from './game'
import { DEL, ENTER } from './config'
import { GLYPH_H, GLYPH_W } from './render/font'
import { Framebuffer } from './render/framebuffer'
import { CANVAS_H, CANVAS_W, IMAGE_H, IMAGE_W } from './render/layout'

/** Grid metrics: the text box's left/top edge, cell width, line pitch, glyph middle below the line top. */
export const KB = {
  boxX: 8,
  boxY: IMAGE_H + 31,
  cell: 20,
  line: 27,
  mid: 16,
  /** Cells per line in a 560 px box. */
  cols: 28,
} as const

const ROWS: readonly (readonly string[])[] = [
  [...'QWERTYUIOP'],
  [...'ASDFGHJKL'],
  [ENTER, ...'ZXCVBNM', DEL],
]

export interface KbKey {
  /** 'A'–'Z', ENTER or DEL (the labels the controller already handles). */
  label: string
  row: number
  /** First cell and width in cells. */
  start: number
  len: number
}

const IDEO_SPACE = '　'
const fullwidth = (s: string) => [...s].map((c) => String.fromCharCode(c.charCodeAt(0) - 0x21 + 0xff01)).join('')

/** Keys in scan order (row by row, left to right), each row centred on the grid. */
export const KB_KEYS: readonly KbKey[] = ROWS.flatMap((row, r) => {
  const width = 1 + row.reduce((a, k) => a + k.length + 1, 0)
  let cell = Math.floor((KB.cols - width) / 2) + 1
  return row.map((label) => {
    const key = { label, row: r, start: cell, len: label.length }
    cell += label.length + 1
    return key
  })
})

/** Letters whose text is blanked because the image draws them (right spot, or not in the word). */
export function drawnByImage(marks: ReadonlyMap<string, Mark>): Set<string> {
  const out = new Set<string>()
  for (const [letter, mark] of marks) if (mark === 'correct' || mark === 'absent') out.add(letter.toUpperCase())
  return out
}

/** The keyboard as text, one line per row, with ［ ］ around the focused key. */
export function kbText(focus: number, hidden: ReadonlySet<string> = new Set()): string {
  const lines = ROWS.map(() => [] as string[])
  KB_KEYS.forEach((k) => {
    const line = lines[k.row]
    while (line.length < k.start + k.len + 1) line.push(IDEO_SPACE)
    const shown = hidden.has(k.label) ? IDEO_SPACE.repeat(k.len) : fullwidth(k.label)
    ;[...shown].forEach((c, i) => (line[k.start + i] = c))
  })
  const f = KB_KEYS[focus]
  if (f) {
    lines[f.row][f.start - 1] = '［'
    lines[f.row][f.start + f.len] = '］'
  }
  return lines.map((l) => l.join('')).join('\n')
}

/** Centre of a key on the canvas. */
export function keyCentre(k: KbKey): { x: number; y: number } {
  return { x: KB.boxX + (k.start + k.len / 2) * KB.cell, y: KB.boxY + KB.mid + k.row * KB.line }
}

const LV = { frame: 5, present: 15, correctFill: 15, absentLetter: 5, absentStrike: 7 } as const
/** The fill and strike stay within ±9 px of a letter's centre: the brackets start at ±11. */
const INNER = 9

/**
 * Key frames and marks for the bottom band (576×144, canvas y 144–288). Split it with `kbHalf` into the two
 * 288×144 images.
 */
export function renderKbBand(marks: ReadonlyMap<string, Mark>): Framebuffer {
  const fb = new Framebuffer(CANVAS_W, CANVAS_H - IMAGE_H)
  for (const k of KB_KEYS) {
    const c = keyCentre(k)
    const cx = c.x
    const cy = c.y - IMAGE_H
    const halfW = (k.len * KB.cell) / 2 + 7
    const mark = k.len === 1 ? marks.get(k.label.toLowerCase()) : undefined
    if (mark !== 'absent') fb.strokeRect(Math.round(cx - halfW), cy - 12, Math.round(halfW * 2), 24, LV.frame, 1)
    const gx = Math.round(cx - GLYPH_W)
    const gy = Math.round(cy - GLYPH_H)
    if (mark === 'present') fb.strokeCircle(cx, cy, 11.5, LV.present)
    else if (mark === 'correct') {
      fb.fillRect(cx - INNER, cy - 10, INNER * 2, 20, LV.correctFill)
      fb.char(k.label, gx, gy, 2, 0)
    } else if (mark === 'absent') {
      fb.char(k.label, gx, gy, 2, LV.absentLetter)
      fb.line(cx - INNER, cy + 8, cx + INNER, cy - 8, LV.absentStrike)
    }
  }
  return fb
}

/** Left or right 288×144 half of the band. */
export function kbHalf(band: Framebuffer, side: 'left' | 'right'): Framebuffer {
  const out = new Framebuffer(IMAGE_W, IMAGE_H)
  const x0 = side === 'left' ? 0 : IMAGE_W
  for (let y = 0; y < IMAGE_H; y++) for (let x = 0; x < IMAGE_W; x++) out.set(x, y, band.get(x0 + x, y))
  return out
}
