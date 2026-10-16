/**
 * Text controls: ENTER, DEL and CLEAR in a text-drawn box, in place of the keyboard, for push-to-talk play
 * (the letters come from voice, so the 26 keys mostly sit unused). Pure.
 *
 * The row is all 20 px glyphs (fullwidth letters, ［ ］, the ideographic space), so the focus brackets never
 * shift it and moving the focus is one text update, as on the keyboard. ENTER and CLEAR are the same width,
 * so the row is symmetric about DEL. It sits in its own text box, laid over a blank frame (textframe.ts) at
 * the frame's vertical middle:
 *
 *   ╭──────────────────────╮
 *   │ ［ＥＮＴＥＲ］ ＤＥＬ  ＣＬＥＡＲ │
 *   ╰──────────────────────╯
 */
import type { Mark } from './game'
import { textFrame, type TextFrame } from './textframe'

export const CONTROLS = ['ENTER', 'DEL', 'CLEAR'] as const
export type Control = (typeof CONTROLS)[number]

/** A–Z → fullwidth Ａ–Ｚ (20 px each in the G2 font, like the keyboard letters). */
export function fullwidth(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCodePoint(c.charCodeAt(0) - 0x41 + 0xff21))
}

const PAD = '　'

/** The row: each control in its slot, the focused one between ［ ］, the others between spaces. */
export function controlsRow(focus: number): string {
  const slots = CONTROLS.map((label, i) => (i === focus ? `［${fullwidth(label)}］` : `${PAD}${fullwidth(label)}${PAD}`))
  return `${PAD}${slots.join(PAD)}${PAD}`
}

/** Inner width of the controls frame, in cells (the same for every focus). */
export const CONTROLS_CELLS = [...controlsRow(0)].length

/** The blank frame around the row (one row tall). */
export function controlsFrame(): TextFrame {
  return textFrame(CONTROLS_CELLS, 1)
}

/**
 * The alphabet under the controls, so the marks are not lost with the keyboard: A–Z on one line (26 × 20 px
 * fits the 576 px screen) and a mark line under it. Each glyph is 20 px (measured: ● ○ ・ are, × and • are
 * not), so every mark sits under its letter:
 *   right spot ● under the letter · wrong spot ○ under it · not in the word: the letter becomes ・
 */
export const LETTER_MARKS = { correct: '●', present: '○', absent: '・', none: '　' } as const

export function letterStatus(marks: ReadonlyMap<string, Mark>): string {
  const letters: string[] = []
  const under: string[] = []
  for (let c = 0; c < 26; c++) {
    const letter = String.fromCharCode(0x61 + c)
    const mark = marks.get(letter)
    letters.push(mark === 'absent' ? LETTER_MARKS.absent : fullwidth(letter.toUpperCase()))
    under.push(mark === 'correct' ? LETTER_MARKS.correct : mark === 'present' ? LETTER_MARKS.present : LETTER_MARKS.none)
  }
  return `${letters.join('')}\n${under.join('')}`
}

/** One step through the controls, wrapping. */
export function stepControl(focus: number, step: number): number {
  const n = CONTROLS.length
  return (((focus + step) % n) + n) % n
}
