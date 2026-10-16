/**
 * Dev only: ?fakemic=<url of a WAV> replaces the glasses mic with that file, so push-to-talk can be tried in
 * the simulator or a browser without speaking. On each open the file plays into the session in 100 ms frames
 * (the simulator's framing), as fast as timers allow; nothing plays after close.
 * The WAV must be 16 kHz, 16-bit mono PCM, e.g.:  say -o crane.wav --data-format=LEI16@16000 crane
 */
import type { Mic } from './session'

/** The PCM bytes of a WAV's data chunk. */
export function wavData(buf: ArrayBuffer): Uint8Array {
  const view = new DataView(buf)
  for (let p = 12; p + 8 <= buf.byteLength; ) {
    const id = String.fromCharCode(...new Uint8Array(buf, p, 4))
    const size = view.getUint32(p + 4, true)
    if (id === 'data') return new Uint8Array(buf, p + 8, Math.min(size, buf.byteLength - p - 8))
    p += 8 + size + (size & 1)
  }
  throw new Error('no data chunk in WAV')
}

export function fakeMic(url: string, push: (frame: Uint8Array) => void): Mic {
  let playing = 0
  const data = fetch(url)
    .then((r) => r.arrayBuffer())
    .then(wavData)
  return {
    async open() {
      const id = ++playing
      const pcm = await data
      void (async () => {
        for (let at = 0; at < pcm.length && id === playing; at += 3200) {
          push(pcm.subarray(at, at + 3200))
          await new Promise((r) => setTimeout(r, 10))
        }
      })()
      return true
    },
    async close() {
      playing++
      return true
    },
  }
}
