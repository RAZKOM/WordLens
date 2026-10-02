import type { Stats } from '../game'
import { drawCell } from './cells'
import { Framebuffer } from './framebuffer'
import { IMAGE_H, IMAGE_W } from './layout'

/**
 * Keyboard mode's second top image: streak and best, what the marks mean, the gestures. The keyboard below
 * shows the letter marks, so the QWERTY display is not needed here.
 */
export function renderInfo(stats: Stats): Framebuffer {
  const fb = new Framebuffer(IMAGE_W, IMAGE_H)
  fb.textCentered(`STREAK ${stats.streak}   BEST ${stats.best}`, IMAGE_W / 2, 3, 2, 15)
  const legend: Array<['correct' | 'present' | 'absent', string, string]> = [
    ['correct', 'A', 'RIGHT SPOT'],
    ['present', 'B', 'WRONG SPOT'],
    ['absent', 'C', 'NOT IN WORD'],
  ]
  legend.forEach(([mark, letter, text], i) => {
    const y = 26 + i * 25
    drawCell(fb, 24, y, 21, 21, letter, mark, 2)
    fb.text(text, 56, y + 4, 2, 10)
  })
  // The 5×7 font has no comma.
  fb.textCentered('TAP: TYPE  HOLD: DELETE', IMAGE_W / 2, 104, 2, 10)
  fb.textCentered('MENU: TAP THEN HOLD', IMAGE_W / 2, 124, 2, 10)
  return fb
}
