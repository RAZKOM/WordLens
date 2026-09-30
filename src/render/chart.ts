import { DIST_LABELS, LOSS_BUCKET } from '../game'
import { textWidth } from './font'
import { Framebuffer } from './framebuffer'
import { IMAGE_H, IMAGE_W } from './layout'

/** Pixel budget for the guess-distribution chart (one 288×144 image). */
export const CHART = {
  titleY: 2,
  baseline: 124, // bars grow up from here
  labelY: 129,
  barTop: 36, // tallest bar reaches here; counts sit just above each bar
  barW: 24,
  scale: 2,
  levels: { bar: 8, barLast: 15, count: 11, countLast: 15, axis: 5, label: 13 },
} as const

/**
 * Vertical bars for guesses 1–6 plus L (losses and give-ups). Wins are solid,
 * losses are an outline so they read differently without colour. The most
 * recent game's bar is full brightness.
 */
export function renderDistribution(dist: readonly number[], last: number | null): Framebuffer {
  const fb = new Framebuffer(IMAGE_W, IMAGE_H)
  const L = CHART.levels
  fb.textCentered('GUESSES', IMAGE_W / 2, CHART.titleY, CHART.scale, 15)
  fb.fillRect(4, CHART.baseline + 1, IMAGE_W - 8, 1, L.axis)

  const max = Math.max(1, ...dist)
  const colW = IMAGE_W / DIST_LABELS.length
  const maxH = CHART.baseline - CHART.barTop
  DIST_LABELS.forEach((label, i) => {
    const count = dist[i] ?? 0
    const isLast = last === i
    const cx = colW * i + colW / 2
    const h = count === 0 ? 0 : Math.max(3, Math.round((count / max) * maxH))
    const x = Math.round(cx - CHART.barW / 2)
    const y = CHART.baseline - h + 1
    const level = isLast ? L.barLast : L.bar
    if (h > 0) {
      if (i === LOSS_BUCKET) fb.strokeRect(x, y, CHART.barW, h, level, 2)
      else fb.fillRect(x, y, CHART.barW, h, level)
    }
    const text = String(count)
    const countScale = textWidth(text, CHART.scale) <= colW - 2 ? CHART.scale : 1
    fb.textCentered(text, cx, y - 2 - 7 * countScale, countScale, isLast ? L.countLast : L.count)
    fb.textCentered(label, cx, CHART.labelY, CHART.scale, isLast ? 15 : L.label)
  })
  return fb
}
