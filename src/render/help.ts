import { Framebuffer } from './framebuffer'
import { drawCell, type CellState } from './cells'
import { IMAGE_H, IMAGE_W } from './layout'

const EXAMPLES: Array<{ letter: string; state: CellState; label: string[] }> = [
  { letter: 'r', state: 'correct', label: ['RIGHT', 'SPOT'] },
  { letter: 'a', state: 'present', label: ['WRONG', 'SPOT'] },
  { letter: 't', state: 'absent', label: ['NOT IN', 'WORD'] },
]

/** Help page image: the three marks at large size, drawn by the board's own renderer. */
export function renderHelp(): Framebuffer {
  const fb = new Framebuffer(IMAGE_W, IMAGE_H)
  const size = 48
  const slot = IMAGE_W / EXAMPLES.length
  EXAMPLES.forEach((ex, i) => {
    const cx = slot * i + slot / 2
    drawCell(fb, Math.round(cx - size / 2), 12, size, size, ex.letter, ex.state, 4)
    ex.label.forEach((line, j) => fb.textCentered(line, cx, 12 + size + 12 + j * 20, 2, 15))
  })
  return fb
}
