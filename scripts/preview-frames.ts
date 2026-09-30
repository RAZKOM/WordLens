/**
 * Renders sample frames to ./previews as PNGs, including a 2× full-screen
 * mock (green-tinted, list band sketched) so layout can be checked without
 * hardware:  npm run preview-frames
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { keyMarks, type Round } from '../src/game'
import { renderBoard, type Message } from '../src/render/board'
import { renderHelp } from '../src/render/help'
import { renderKeys } from '../src/render/keys'
import { Framebuffer } from '../src/render/framebuffer'
import { encodePng } from '../src/render/png'

const out = 'previews'
mkdirSync(out, { recursive: true })

function screen(left: Framebuffer, right: Framebuffer, listRows: string[], focus: number): Framebuffer {
  const s = new Framebuffer(576, 288)
  for (let y = 0; y < 144; y++)
    for (let x = 0; x < 288; x++) {
      s.set(x, y, left.get(x, y))
      s.set(288 + x, y, right.get(x, y))
    }
  // Sketch of the native list: 40 px rows, vertically centred, 3 visible.
  const top = 144 + (144 - 3 * 40) / 2
  listRows.forEach((label, i) => {
    const y = top + i * 40
    if (i === focus) s.strokeRect(8, y + 2, 560, 36, 15, 2)
    s.text(label, 24, y + 13, 2, 12)
  })
  return s
}

function scaled(fb: Framebuffer, k: number): Uint8Array {
  const big = new Framebuffer(fb.width * k, fb.height * k)
  for (let y = 0; y < big.height; y++) for (let x = 0; x < big.width; x++) big.set(x, y, fb.get(Math.floor(x / k), Math.floor(y / k)))
  return encodePng(big)
}

const states: Array<{ name: string; round: Round; msg: Message | null }> = [
  { name: 'typing', round: { target: 'crane', guesses: ['slate', 'eerie'], typed: 'cra' }, msg: null },
  { name: 'invalid', round: { target: 'crane', guesses: ['slate'], typed: 'xxxxx' }, msg: { kind: 'invalid', text: 'NOT IN LIST' } },
  { name: 'short', round: { target: 'crane', guesses: ['slate'], typed: 'cr' }, msg: { kind: 'invalid', text: 'NEED 5 LETTERS' } },
  { name: 'win', round: { target: 'crane', guesses: ['slate', 'eerie', 'crane'], typed: '' }, msg: { kind: 'win', guesses: 3 } },
  {
    name: 'loss',
    round: { target: 'abbey', guesses: ['babes', 'slate', 'mourn', 'ghoul', 'fizzy', 'wacky'], typed: '' },
    msg: { kind: 'loss', answer: 'abbey' },
  },
]

for (const st of states) {
  const left = renderBoard(st.round, st.msg)
  const right = renderKeys(keyMarks(st.round.guesses, st.round.target), { streak: 4, best: 12, played: 20, wins: 15, dist: [0, 2, 5, 6, 1, 1, 5], last: 3 })
  writeFileSync(`${out}/${st.name}-board.png`, encodePng(left))
  writeFileSync(`${out}/${st.name}-keys.png`, encodePng(right))
  writeFileSync(`${out}/${st.name}-screen@2x.png`, scaled(screen(left, right, ['DEL', 'ENTER', 'E'], 1), 2))
}
writeFileSync(`${out}/help@2x.png`, scaled(renderHelp(), 2))
console.log('wrote previews/')
