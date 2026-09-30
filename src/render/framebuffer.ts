import { GLYPH_H, GLYPH_W, advance, glyph, textWidth } from './font'

/** 4-bit greyscale framebuffer: one byte per pixel, values 0 (off) to 15 (full). */
export class Framebuffer {
  readonly px: Uint8Array
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.px = new Uint8Array(width * height)
  }

  set(x: number, y: number, level: number): void {
    x = Math.round(x)
    y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    this.px[y * this.width + x] = level
  }

  get(x: number, y: number): number {
    return this.px[y * this.width + x]
  }

  fillRect(x: number, y: number, w: number, h: number, level: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, level)
  }

  /** Outline of `thickness` px drawn inside the w×h box. */
  strokeRect(x: number, y: number, w: number, h: number, level: number, thickness = 1): void {
    for (let t = 0; t < thickness; t++) {
      this.fillRect(x + t, y + t, w - 2 * t, 1, level)
      this.fillRect(x + t, y + h - 1 - t, w - 2 * t, 1, level)
      this.fillRect(x + t, y + t, 1, h - 2 * t, level)
      this.fillRect(x + w - 1 - t, y + t, 1, h - 2 * t, level)
    }
  }

  /** Ring centred on (cx, cy): pixels whose centres lie within `half` of radius r. */
  strokeCircle(cx: number, cy: number, r: number, level: number, half = 0.75): void {
    const x0 = Math.floor(cx - r - 2)
    const x1 = Math.ceil(cx + r + 2)
    const y0 = Math.floor(cy - r - 2)
    const y1 = Math.ceil(cy + r + 2)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
        if (Math.abs(d - r) <= half) this.set(x, y, level)
      }
  }

  /** Straight line (Bresenham), 1 px. */
  line(x0: number, y0: number, x1: number, y1: number, level: number): void {
    x0 = Math.round(x0)
    y0 = Math.round(y0)
    x1 = Math.round(x1)
    y1 = Math.round(y1)
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    for (;;) {
      this.set(x0, y0, level)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x0 += sx
      }
      if (e2 <= dx) {
        err += dx
        y0 += sy
      }
    }
  }

  char(ch: string, x: number, y: number, scale: number, level: number): void {
    const g = glyph(ch)
    for (let row = 0; row < GLYPH_H; row++)
      for (let col = 0; col < GLYPH_W; col++)
        if (g[row * GLYPH_W + col] === '#') this.fillRect(x + col * scale, y + row * scale, scale, scale, level)
  }

  text(s: string, x: number, y: number, scale: number, level: number): void {
    for (let i = 0; i < s.length; i++) this.char(s[i], x + i * advance(scale), y, scale, level)
  }

  /** Text horizontally centred on cx. */
  textCentered(s: string, cx: number, y: number, scale: number, level: number): void {
    this.text(s, Math.round(cx - textWidth(s, scale) / 2), y, scale, level)
  }
}
