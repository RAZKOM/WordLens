/**
 * Store-listing Help and Stats frames, rendered with the same code the glasses use (firmware text drawn in
 * the pixel font so the shot is readable). The play shots come from the simulator, because the keyboard's
 * letters are firmware text: scripts/listing-sim.ts.
 *   npx tsx scripts/listing-shots.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { DEFAULT_SETTINGS } from '../src/config'
import { DEMO_HISTORY } from '../src/demo'
import { renderDistribution } from '../src/render/chart'
import { Framebuffer } from '../src/render/framebuffer'
import { renderHelp } from '../src/render/help'
import { IMAGE_H, IMAGE_W } from '../src/render/layout'
import { encodeDisplayPng } from '../src/render/png'
import { helpText, statsText } from '../src/pages'

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

const shots: Array<[string, Framebuffer]> = []

const help = new Framebuffer(576, 288)
blit(help, renderHelp(), (576 - IMAGE_W) / 2, 0)
// The pixel font has no comma; the firmware text on the glasses does.
drawLines(help, helpText(DEFAULT_SETTINGS).toUpperCase().replaceAll(',', ''), 16, IMAGE_H + 20, 544)
shots.push(['04-help', help])

const stats = new Framebuffer(576, 288)
drawLines(stats, statsText(DEMO_HISTORY), 16, 20, IMAGE_W - 28)
blit(stats, renderDistribution(DEMO_HISTORY.dist, DEMO_HISTORY.last), IMAGE_W, (288 - IMAGE_H) / 2)
shots.push(['05-stats', stats])

mkdirSync(OUT, { recursive: true })
for (const [name, fb] of shots) writeFileSync(`${OUT}/${name}.png`, scaled(fb))
console.log(`wrote ${shots.length} frames to ${OUT}/`)
