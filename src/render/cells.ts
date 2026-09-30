import type { Mark } from '../game'
import { GLYPH_H, GLYPH_W } from './font'
import type { Framebuffer } from './framebuffer'

/** Visual state of one board cell or keyboard key. */
export type CellState = 'empty' | 'typed' | 'unused' | Mark

/** Greyscale levels (0–15) per state. Tune here after checking on device. */
export const LEVELS = {
  emptyOutline: 6,
  typedOutline: 15,
  typedLetter: 15,
  correctFill: 15,
  correctLetter: 0,
  presentOutline: 5,
  presentCircle: 15,
  presentLetter: 15,
  absentLetter: 5,
  absentStrike: 7,
  unusedOutline: 6,
  unusedLetter: 12,
} as const

/**
 * Draws one cell/key. The same marks are used on the board, the QWERTY display
 * and the Help page, so all three always agree.
 */
export function drawCell(
  fb: Framebuffer,
  x: number,
  y: number,
  w: number,
  h: number,
  letter: string,
  state: CellState,
  scale: number,
): void {
  const lw = GLYPH_W * scale
  const lh = GLYPH_H * scale
  const lx = x + Math.floor((w - lw) / 2)
  const ly = y + Math.floor((h - lh) / 2)
  const cx = x + w / 2
  const cy = y + h / 2

  switch (state) {
    case 'empty':
      fb.strokeRect(x, y, w, h, LEVELS.emptyOutline, 1)
      return
    case 'typed':
      fb.strokeRect(x, y, w, h, LEVELS.typedOutline, 2)
      if (letter) fb.char(letter, lx, ly, scale, LEVELS.typedLetter)
      return
    case 'unused':
      fb.strokeRect(x, y, w, h, LEVELS.unusedOutline, 1)
      if (letter) fb.char(letter, lx, ly, scale, LEVELS.unusedLetter)
      return
    case 'correct':
      fb.fillRect(x, y, w, h, LEVELS.correctFill)
      if (letter) fb.char(letter, lx, ly, scale, LEVELS.correctLetter)
      return
    case 'present': {
      fb.strokeRect(x, y, w, h, LEVELS.presentOutline, 1)
      // Circle must clear the glyph's box by ≥1 px and stay inside the cell.
      const r = Math.min(Math.hypot(lw, lh) / 2 + 1, Math.min(w, h) / 2 - 1.5)
      fb.strokeCircle(cx, cy, r, LEVELS.presentCircle)
      if (letter) fb.char(letter, lx, ly, scale, LEVELS.presentLetter)
      return
    }
    case 'absent': {
      if (letter) fb.char(letter, lx, ly, scale, LEVELS.absentLetter)
      const inset = Math.max(2, Math.round(Math.min(w, h) * 0.15))
      fb.line(x + inset, y + h - 1 - inset, x + w - 1 - inset, y + inset, LEVELS.absentStrike)
      return
    }
  }
}
