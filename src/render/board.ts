import { MAX_GUESSES, WORD_LENGTH, scoreGuess, type Round } from '../game'
import { advance, textWidth } from './font'
import { Framebuffer } from './framebuffer'
import { drawCell } from './cells'
import { BOARD, IMAGE_H, IMAGE_W, STRIP } from './layout'

export type Message =
  | { kind: 'invalid'; text: string }
  | { kind: 'win'; guesses: number }
  | { kind: 'loss'; answer: string }

/** Left image: 6×5 board plus the transient message strip. */
export function renderBoard(round: Round, message: Message | null): Framebuffer {
  const fb = new Framebuffer(IMAGE_W, IMAGE_H)
  const step = BOARD.cell + BOARD.gap
  for (let row = 0; row < MAX_GUESSES; row++) {
    const y = BOARD.y + row * step
    const guess = round.guesses[row]
    const marks = guess ? scoreGuess(guess, round.target) : null
    const typing = row === round.guesses.length ? round.typed : ''
    for (let col = 0; col < WORD_LENGTH; col++) {
      const x = BOARD.x + col * step
      if (guess && marks) drawCell(fb, x, y, BOARD.cell, BOARD.cell, guess[col], marks[col], BOARD.letterScale)
      else if (typing[col]) drawCell(fb, x, y, BOARD.cell, BOARD.cell, typing[col], 'typed', BOARD.letterScale)
      else drawCell(fb, x, y, BOARD.cell, BOARD.cell, '', 'empty', BOARD.letterScale)
    }
  }
  if (message) drawMessage(fb, message)
  return fb
}

interface Line {
  text: string
  scale: number
}

function wrap(text: string, scale: number, width: number): Line[] {
  const perLine = Math.max(1, Math.floor((width + scale) / advance(scale)))
  const lines: Line[] = []
  let cur = ''
  for (const word of text.split(' ')) {
    const next = cur ? `${cur} ${word}` : word
    if (next.length <= perLine) cur = next
    else {
      if (cur) lines.push({ text: cur, scale })
      cur = word
    }
  }
  if (cur) lines.push({ text: cur, scale })
  return lines
}

export function messageLines(m: Message): Line[] {
  switch (m.kind) {
    case 'invalid':
      return wrap(m.text, 2, STRIP.w - 8)
    case 'win':
      return [
        { text: 'NICE!', scale: 3 },
        { text: `${m.guesses}/6`, scale: 3 },
      ]
    case 'loss':
      return [
        { text: 'ANSWER', scale: 2 },
        { text: m.answer.toUpperCase(), scale: 3 },
      ]
  }
}

function drawMessage(fb: Framebuffer, m: Message): void {
  const lines = messageLines(m)
  const gap = 8
  const heights = lines.map((l) => 7 * l.scale)
  const total = heights.reduce((a, b) => a + b, 0) + gap * (lines.length - 1)
  let y = STRIP.y + Math.round((STRIP.h - total) / 2)
  const cx = STRIP.x + STRIP.w / 2
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (textWidth(l.text, l.scale) > STRIP.w) throw new Error(`message too wide: ${l.text}`)
    fb.textCentered(l.text, cx, y, l.scale, 15)
    y += heights[i] + gap
  }
}
