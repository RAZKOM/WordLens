/**
 * Minimal PNG encoder for 8-bit greyscale. `updateImageRawData` takes encoded
 * image bytes (the host decodes and converts to 4-bit), so frames are sent as
 * PNG. Deflate uses stored (uncompressed) blocks: payload size barely affects
 * send time, and this keeps the encoder dependency-free and deterministic.
 */
import { Framebuffer } from './framebuffer'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

function zlibStored(data: Uint8Array): Uint8Array {
  const MAX = 65535
  const blocks = Math.max(1, Math.ceil(data.length / MAX))
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4)
  let o = 0
  out[o++] = 0x78
  out[o++] = 0x01
  for (let b = 0; b < blocks; b++) {
    const start = b * MAX
    const len = Math.min(MAX, data.length - start)
    out[o++] = b === blocks - 1 ? 1 : 0
    out[o++] = len & 0xff
    out[o++] = (len >>> 8) & 0xff
    out[o++] = ~len & 0xff
    out[o++] = (~len >>> 8) & 0xff
    out.set(data.subarray(start, start + len), o)
    o += len
  }
  const ad = adler32(data)
  out[o++] = (ad >>> 24) & 0xff
  out[o++] = (ad >>> 16) & 0xff
  out[o++] = (ad >>> 8) & 0xff
  out[o++] = ad & 0xff
  return out
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length))
  return out
}

/** Encode a 4-bit framebuffer as an 8-bit greyscale PNG (level × 17). */
export function encodePng(fb: Framebuffer): Uint8Array {
  const { width, height, px } = fb
  const raw = new Uint8Array((width + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0 // filter: none
    for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = Math.min(15, px[y * width + x]) * 17
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // greyscale
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', zlibStored(raw)), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/**
 * Pure green ramp, brightest at #00FF00. The phone-page CSS tint is a
 * yellow-green; listing shots should match the glasses green instead.
 * Level 0 stays transparent in encodeDisplayPng.
 */
const DISPLAY_GREEN: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [0, 17, 0],
  [0, 34, 0],
  [0, 51, 0],
  [0, 68, 0],
  [0, 85, 0],
  [0, 102, 0],
  [0, 119, 0],
  [0, 136, 0],
  [0, 153, 0],
  [0, 170, 0],
  [0, 187, 0],
  [0, 204, 0],
  [0, 221, 0],
  [0, 238, 0],
  [0, 255, 0],
]

/** Same frame as `encodePng`, green where a pixel is on and transparent where it is off. */
export function encodeDisplayPng(fb: Framebuffer): Uint8Array {
  const { width, height, px } = fb
  const raw = new Uint8Array((1 + width * 4) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4)
    raw[row] = 0
    for (let x = 0; x < width; x++) {
      const level = Math.min(15, px[y * width + x])
      const [r, g, b] = DISPLAY_GREEN[level]
      const i = row + 1 + x * 4
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
      raw[i + 3] = level === 0 ? 0 : 255
    }
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 6 // truecolor with alpha
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const pieces = [signature, chunk('IHDR', ihdr), chunk('IDAT', zlibStored(raw)), chunk('IEND', new Uint8Array(0))]
  const bytes = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of pieces) {
    bytes.set(p, offset)
    offset += p.length
  }
  return bytes
}
