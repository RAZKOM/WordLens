import { textWidth } from './font'
import { Framebuffer } from './framebuffer'
import { IMAGE_W } from './layout'

/** Horizontal carousel strip: one image, selection fixed in the centre. */
export const STRIP_IMG = {
  w: IMAGE_W,
  h: 64,
  padX: 8,
  gap: 6,
  selScale: 3,
  itemScale: 2,
  levels: { sel: 15, selBox: 15, near: 11, far: 6 },
} as const

const wrap = (i: number, n: number) => ((i % n) + n) % n

function slotWidth(label: string, scale: number): number {
  return textWidth(label, scale) + 2 * STRIP_IMG.padX
}

/**
 * The selected item sits boxed in the centre at a larger size; neighbours run
 * out to both edges and wrap around, so the strip has no ends.
 */
export function renderStrip(items: readonly string[], index: number): Framebuffer {
  const fb = new Framebuffer(STRIP_IMG.w, STRIP_IMG.h)
  const S = STRIP_IMG
  const n = items.length
  const sel = items[wrap(index, n)]
  const selW = slotWidth(sel, S.selScale)
  const selH = 7 * S.selScale + 16
  const x0 = Math.round((S.w - selW) / 2)
  const y0 = Math.round((S.h - selH) / 2)
  fb.strokeRect(x0, y0, selW, selH, S.levels.selBox, 2)
  fb.textCentered(sel, S.w / 2, y0 + 8, S.selScale, S.levels.sel)

  const itemY = Math.round((S.h - 7 * S.itemScale) / 2)
  for (const dir of [1, -1]) {
    let edge = dir === 1 ? x0 + selW : x0
    for (let k = 1; k < n; k++) {
      const label = items[wrap(index + dir * k, n)]
      const w = slotWidth(label, S.itemScale)
      const left = dir === 1 ? edge + S.gap : edge - S.gap - w
      // Only draw items whose text fits entirely; a clipped glyph reads as noise.
      if (left + S.padX < 0 || left + w - S.padX > S.w) break
      const level = k === 1 ? S.levels.near : S.levels.far
      fb.textCentered(label, left + w / 2, itemY, S.itemScale, level)
      edge = dir === 1 ? left + w : left
    }
  }
  return fb
}
