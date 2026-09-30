/**
 * Store-listing frames: the shipped layout (board on the right, horizontal
 * letter strip), rendered with the same code the glasses use.
 *   npx tsx scripts/listing-shots.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { stripItems } from '../src/config'
import { keyMarks, type Round, type Stats } from '../src/game'
import { renderBoard, type Message } from '../src/render/board'
import { renderDistribution } from '../src/render/chart'
import { Framebuffer } from '../src/render/framebuffer'
import { renderHelp } from '../src/render/help'
import { renderKeys } from '../src/render/keys'
import { IMAGE_H, IMAGE_W } from '../src/render/layout'
import { encodeDisplayPng } from '../src/render/png'
import { renderStrip } from '../src/render/strip'
import { STRIP_POS, statsText } from '../src/pages'

const OUT = 'docs/screenshots'
const SCALE = 1

function blit(dst: Framebuffer, src: Framebuffer, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) dst.set(dx + x, dy + y, src.get(x, y))
}

function scaled(fb: Framebuffer): Uint8Array {
  const big = new Framebuffer(fb.width * SCALE, fb.height * SCALE)
  for (let y = 0; y < big.height; y++) for (let x = 0; x < big.width; x++) big.set(x, y, fb.get(Math.floor(x / SCALE), Math.floor(y / SCALE)))
  return encodeDisplayPng(big)
}

function playScreen(round: Round, message: Message | null, stats: Stats, stripLabel: string): Framebuffer {
  const items = stripItems('alphabetical')
  const screen = new Framebuffer(576, 288)
  blit(screen, renderKeys(keyMarks(round.guesses, round.target), stats), 0, 0)
  blit(screen, renderBoard(round, message), IMAGE_W, 0)
  blit(screen, renderStrip(items, items.indexOf(stripLabel)), STRIP_POS.x, STRIP_POS.y)
  return screen
}

/** Firmware text band, drawn in the same pixel font so the shot is readable. */
function drawLines(fb: Framebuffer, text: string, x: number, y: number, maxW: number): void {
  const scale = 2
  const lineH = 18
  let row = 0
  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) {
      row++
      continue
    }
    const words = paragraph.split(' ')
    let line = ''
    const flush = () => {
      if (line) fb.text(line, x, y + row * lineH, scale, 15)
      row++
      line = ''
    }
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (next.length * 12 <= maxW) line = next
      else {
        flush()
        line = word
      }
    }
    flush()
  }
}

/** A long run: wins in every bucket, and enough losses that the outline bar is obvious. */
const HISTORY: Stats = {
  streak: 9,
  best: 23,
  played: 186,
  wins: 142,
  dist: [8, 22, 41, 38, 21, 12, 44],
  last: 3,
}

const shots: Array<[string, Framebuffer]> = [
  [
    '01-playing',
    playScreen({ target: 'crane', guesses: ['slate', 'eerie'], typed: 'cra' }, null, HISTORY, 'N'),
  ],
  [
    '02-win',
    playScreen(
      { target: 'crane', guesses: ['slate', 'eerie', 'crane'], typed: '' },
      { kind: 'win', guesses: 3 },
      { ...HISTORY, streak: 10 },
      'A',
    ),
  ],
  [
    '03-not-in-list',
    playScreen(
      { target: 'crane', guesses: ['slate'], typed: 'xxxxx' },
      { kind: 'invalid', text: 'NOT IN LIST' },
      HISTORY,
      'ENTER',
    ),
  ],
  [
    '06-mid-guess',
    playScreen({ target: 'crane', guesses: ['slate'], typed: 'mo' }, null, HISTORY, 'U'),
  ],
  [
    '07-mid-guess-late',
    playScreen({ target: 'crane', guesses: ['slate', 'mourn', 'eerie'], typed: 'cr' }, null, HISTORY, 'A'),
  ],
  [
    '08-winner',
    playScreen(
      { target: 'crane', guesses: ['slate', 'mourn', 'eerie', 'crane'], typed: '' },
      { kind: 'win', guesses: 4 },
      { ...HISTORY, streak: 10, best: 23 },
      'A',
    ),
  ],
  [
    '09-loser',
    playScreen(
      { target: 'abbey', guesses: ['slate', 'crane', 'mourn', 'ghoul', 'fizzy', 'wacky'], typed: '' },
      { kind: 'loss', answer: 'abbey' },
      { ...HISTORY, streak: 0, last: 6 },
      'A',
    ),
  ],
]

const help = new Framebuffer(576, 288)
blit(help, renderHelp(), (576 - IMAGE_W) / 2, 0)
drawLines(
  help,
  'SWIPE TO MOVE ALONG THE LETTERS.\nTAP TO TYPE. HOLD TO DELETE.\nMENU: TAP THEN HOLD.\nDOUBLE-TAP TO EXIT.',
  16,
  IMAGE_H + 20,
  544,
)
shots.push(['04-help', help])

const stats = new Framebuffer(576, 288)
drawLines(stats, statsText(HISTORY), 16, 20, IMAGE_W - 28)
blit(stats, renderDistribution(HISTORY.dist, HISTORY.last), IMAGE_W, (288 - IMAGE_H) / 2)
shots.push(['05-stats', stats])

mkdirSync(OUT, { recursive: true })
for (const [name, fb] of shots) writeFileSync(`${OUT}/${name}.png`, scaled(fb))
console.log(`wrote ${shots.length} frames to ${OUT}/`)
