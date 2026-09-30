/** Pixel budget for every image. All images are ≤ 288×144. */

export const CANVAS_W = 576
export const CANVAS_H = 288
export const IMAGE_W = 288
export const IMAGE_H = 144

export const BOARD = {
  x: 8,
  y: 4,
  cell: 21,
  gap: 2,
  letterScale: 2,
} as const

/** Message strip to the right of the board; never overlaps it. */
export const STRIP = { x: 132, y: 0, w: 152, h: IMAGE_H } as const

export const KEYS = {
  statsY: 3,
  statsScale: 2,
  top: 22,
  keyW: 26,
  keyH: 36,
  gapX: 2,
  gapY: 4,
  letterScale: 2,
  rows: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'],
} as const
