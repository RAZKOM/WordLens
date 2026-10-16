/**
 * Push-to-talk recording: opens the glasses mic for the length of a hold, buffers the frames, and hands the
 * clip to a recogniser on release. SDK-free (the mic and recogniser are injected), so it is unit-tested.
 *
 * Races handled:
 *  - The hold can end before the mic has finished opening: the mic is closed again once open resolves.
 *  - A new hold, or a cancel, while a clip is still being decoded: the stale result is dropped (null).
 */
import { VOICE } from '../config'
import type { Heard } from './candidates'
import { pcmBytes, peak, s16leToFloat } from './pcm'

export interface Mic {
  open(): Promise<boolean>
  close(): Promise<unknown>
}

export interface Recognizer {
  /** Start loading the model in the background (idempotent). */
  prepare(): void
  /** Decode a clip. `typedLen` (letters already in the row) steers which runner-ups are worth decoding. */
  recognise(samples: Float32Array, typedLen: number): Promise<Heard>
}

/** What the controller sees. */
export interface VoiceInput {
  prepare(): void
  /** Open the mic and start buffering. False if the mic could not be opened. */
  start(): Promise<boolean>
  /** Close the mic and decode the clip. Null for a clip too short or silent, or one superseded meanwhile. */
  stop(typedLen: number): Promise<Heard | null>
  /** Close the mic and drop any clip or pending result. */
  cancel(): void
}

export class VoiceSession implements VoiceInput {
  private recording = false
  private session = 0
  private chunks: Uint8Array[] = []
  private bytes = 0
  private startedAt = 0

  constructor(
    private mic: Mic,
    private recognizer: Recognizer,
    private now: () => number = () => Date.now(),
    private log: (msg: string) => void = (m) => console.info(m),
  ) {}

  prepare(): void {
    this.recognizer.prepare()
  }

  /** Feed one `audioEvent.audioPcm` (any shape the host sends). Ignored unless recording. */
  push(raw: unknown): void {
    if (!this.recording) return
    const bytes = pcmBytes(raw)
    if (!bytes || bytes.length === 0) return
    if (this.bytes + bytes.length > VOICE.maxSeconds * VOICE.sampleRate * 2) return
    this.chunks.push(bytes)
    this.bytes += bytes.length
  }

  async start(): Promise<boolean> {
    this.recognizer.prepare()
    const id = ++this.session
    this.chunks = []
    this.bytes = 0
    this.startedAt = this.now()
    this.recording = true
    let ok = false
    try {
      ok = await this.mic.open()
    } catch (err) {
      this.log(`[wordlens] mic open threw: ${String(err)}`)
    }
    if (!ok) {
      if (id === this.session) this.recording = false
      return false
    }
    // Released (or cancelled) while the mic was opening: close it again.
    if (id !== this.session || !this.recording) void this.closeMic()
    return true
  }

  async stop(typedLen: number): Promise<Heard | null> {
    if (!this.recording) return null
    this.recording = false
    const id = this.session
    void this.closeMic()
    const seconds = (this.now() - this.startedAt) / 1000
    const samples = s16leToFloat(this.chunks)
    this.log(
      `[wordlens] voice clip: ${this.bytes} bytes in ${seconds.toFixed(2)} s` +
        (seconds > 0 ? ` (${Math.round(this.bytes / seconds)} B/s)` : ''),
    )
    this.chunks = []
    this.bytes = 0
    if (samples.length < VOICE.minSeconds * VOICE.sampleRate || peak(samples) < VOICE.silencePeak) return null
    // Trailing silence lets the decoder close the last word cleanly.
    const padded = new Float32Array(samples.length + Math.round(VOICE.padSeconds * VOICE.sampleRate))
    padded.set(samples)
    const heard = await this.recognizer.recognise(padded, typedLen)
    return id === this.session ? heard : null
  }

  cancel(): void {
    this.session++
    this.chunks = []
    this.bytes = 0
    if (this.recording) {
      this.recording = false
      void this.closeMic()
    }
  }

  private async closeMic(): Promise<void> {
    try {
      await this.mic.close()
    } catch (err) {
      this.log(`[wordlens] mic close threw: ${String(err)}`)
    }
  }
}
