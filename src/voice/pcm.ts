/**
 * Microphone frames → samples for the recogniser. Pure.
 *
 * The SDK types `audioPcm` as a Uint8Array, but notes that the host's bytes arrive through JSON and can be a
 * number[] or a base64 string, so every shape is accepted. The bytes are taken to be signed 16-bit
 * little-endian mono at VOICE.sampleRate (config.ts); the engine logs bytes per second of each recording so a device log can confirm
 * that (16 kHz s16le mono is 32,000 B/s).
 */

export function pcmBytes(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
  if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
  if (Array.isArray(raw)) return Uint8Array.from(raw as number[])
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const bin = atob(raw)
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
      return out
    } catch {
      return null
    }
  }
  return null
}

/** Joins frames and converts s16le to floats in [-1, 1). An odd trailing byte is dropped. */
export function s16leToFloat(chunks: readonly Uint8Array[]): Float32Array {
  let total = 0
  for (const c of chunks) total += c.length
  const joined = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    joined.set(c, at)
    at += c.length
  }
  const n = Math.floor(total / 2)
  const out = new Float32Array(n)
  const view = new DataView(joined.buffer)
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768
  return out
}

/** Peak absolute sample: a clip that is all near-silence is not worth decoding. */
export function peak(samples: Float32Array): number {
  let m = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > m) m = a
  }
  return m
}
