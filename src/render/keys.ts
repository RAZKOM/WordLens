import type { Mark, Stats } from '../game'
import { Framebuffer } from './framebuffer'
import { drawCell } from './cells'
import { IMAGE_H, IMAGE_W, KEYS } from './layout'

/** Right image: streak line plus the QWERTY status display (display only). */
export function renderKeys(marks: Map<string, Mark>, stats: Stats): Framebuffer {
  const fb = new Framebuffer(IMAGE_W, IMAGE_H)
  fb.textCentered(`STREAK ${stats.streak}   BEST ${stats.best}`, IMAGE_W / 2, KEYS.statsY, KEYS.statsScale, 15)
  KEYS.rows.forEach((row, r) => {
    const rowW = row.length * KEYS.keyW + (row.length - 1) * KEYS.gapX
    const x0 = Math.floor((IMAGE_W - rowW) / 2)
    const y = KEYS.top + r * (KEYS.keyH + KEYS.gapY)
    for (let i = 0; i < row.length; i++) {
      const letter = row[i]
      const x = x0 + i * (KEYS.keyW + KEYS.gapX)
      drawCell(fb, x, y, KEYS.keyW, KEYS.keyH, letter, marks.get(letter) ?? 'unused', KEYS.letterScale)
    }
  })
  return fb
}
