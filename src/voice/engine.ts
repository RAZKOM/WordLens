/**
 * Offline speech recognition with vosk-browser (Kaldi compiled to WebAssembly, in a Web Worker).
 *
 * Every decode is restricted to a grammar, which is what makes a small model accurate here:
 *  - words: the allowed guesses the model knows (src/words/spoken.ts), so it picks among ~5.5k words, not
 *    all of English;
 *  - spelling: letters and the NATO alphabet (spell.ts).
 * Vosk gives one answer per decode, so runner-ups come from decoding the clip again with the answers so
 * far removed from the grammar. A clip is ~1 s and a decode ~0.1 s on a laptop, so that is affordable.
 *
 * The model (public/vosk/model.tar.gz, from `npm run voice-model`) is unpacked by the worker into
 * IndexedDB on first use, keyed by URL, so later launches skip the unpacking.
 */
import { Model } from 'vosk-browser'
import { VOICE } from '../config'
import { SPOKEN } from '../words'
import { preferSpelling, type Heard, type Hyp } from './candidates'
import type { Recognizer } from './session'
import { SPELL_TOKENS } from './spell'

const UNK = '[unk]'

type VoskModel = InstanceType<typeof Model>
type VoskRecognizer = InstanceType<VoskModel['KaldiRecognizer']>

interface VoskWord {
  word: string
  conf: number
}

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'failed'

export class VoskEngine implements Recognizer {
  private model: Promise<VoskModel> | null = null

  constructor(
    private modelUrl: string,
    private onStatus: (s: EngineStatus, detail?: string) => void = () => {},
    private words: readonly string[] = SPOKEN,
  ) {}

  prepare(): void {
    this.load().catch(() => {})
  }

  private load(): Promise<VoskModel> {
    if (!this.model) {
      this.onStatus('loading')
      const t0 = performance.now()
      this.model = loadModel(this.modelUrl, VOICE.loadTimeoutMs).then(
        async (m) => {
          // The first decode in a fresh worker is several times slower than the rest; pay for it now,
          // on silence, rather than on the player's first hold.
          await decode(m, new Float32Array(VOICE.sampleRate / 2), VOICE.sampleRate, this.words).catch(() => null)
          this.onStatus('ready', `${Math.round(performance.now() - t0)} ms`)
          return m
        },
        (err: unknown) => {
          this.model = null // a later hold retries
          this.onStatus('failed', String(err))
          throw err
        },
      )
    }
    return this.model
  }

  async recognise(samples: Float32Array, typedLen: number): Promise<Heard> {
    const model = await this.load()
    const t0 = performance.now()
    const rate = VOICE.sampleRate
    const w1 = await decode(model, samples, rate, this.words)
    const s1 = await decode(model, samples, rate, SPELL_TOKENS)
    const heard: Heard = { words: w1 ? [w1] : [], spell: s1 ? [s1] : [] }

    // Runner-ups only for the side that will be shown first, and only for single-token answers:
    // a several-word answer is not a guess, and a spelled run has no useful "next best".
    if (preferSpelling(heard, typedLen)) {
      await this.runnerUps(model, samples, rate, SPELL_TOKENS, heard.spell, VOICE.spellPasses)
    } else {
      await this.runnerUps(model, samples, rate, this.words, heard.words, VOICE.wordPasses)
    }
    console.info(
      `[wordlens] heard in ${Math.round(performance.now() - t0)} ms:`,
      heard.words.map((h) => `${h.tokens.join('+')}:${h.conf.toFixed(2)}`).join(' '),
      '|',
      heard.spell.map((h) => `${h.tokens.join('+')}:${h.conf.toFixed(2)}`).join(' '),
    )
    return heard
  }

  private async runnerUps(
    model: VoskModel,
    samples: Float32Array,
    rate: number,
    grammar: readonly string[],
    found: Hyp[],
    passes: number,
  ): Promise<void> {
    const excluded = new Set<string>()
    while (found.length > 0 && found.length < passes && found[found.length - 1].tokens.length === 1) {
      for (const h of found) for (const t of h.tokens) excluded.add(t)
      const next = await decode(
        model,
        samples,
        rate,
        grammar.filter((w) => !excluded.has(w)),
      )
      if (!next) break
      found.push(next)
    }
  }
}

/** createModel() never rejects on a load error, so listen for both outcomes, with a timeout. */
function loadModel(url: string, timeoutMs: number): Promise<VoskModel> {
  return new Promise((resolve, reject) => {
    const model = new Model(url, -1)
    const timer = setTimeout(() => {
      model.terminate()
      reject(new Error('model load timed out'))
    }, timeoutMs)
    model.on('load', (m) => {
      clearTimeout(timer)
      if ('result' in m && m.result) resolve(model)
      else {
        model.terminate()
        reject(new Error('model load failed'))
      }
    })
    model.on('error', (m) => {
      clearTimeout(timer)
      model.terminate()
      reject(new Error('error' in m ? m.error : 'model error'))
    })
  })
}

/**
 * One decode of a whole clip against a grammar. The worker answers every audio chunk with exactly one
 * message (result or partial result), in order, then one final result: so the (chunks + 1)th reply is the
 * last, with no timing guesses. Mid-clip results (after a pause) are kept too.
 */
function decode(model: VoskModel, samples: Float32Array, rate: number, grammar: readonly string[]): Promise<Hyp | null> {
  return new Promise((resolve, reject) => {
    let rec: VoskRecognizer
    try {
      rec = new model.KaldiRecognizer(rate, JSON.stringify([...grammar, UNK]))
    } catch (err) {
      reject(err)
      return
    }
    rec.setWords(true)
    const chunk = rate // 1 s per message
    const chunks = Math.max(1, Math.ceil(samples.length / chunk))
    const words: VoskWord[] = []
    let replies = 0
    let finished = false
    const timer = setTimeout(() => finish(new Error('decode timed out')), VOICE.decodeTimeoutMs)

    function finish(err?: Error): void {
      if (finished) return
      finished = true
      clearTimeout(timer)
      try {
        rec.remove()
      } catch {
        // already gone
      }
      if (err) return reject(err)
      const known = words.filter((w) => w.word !== UNK)
      if (known.length === 0) return resolve(null)
      const conf = known.reduce((a, w) => a + w.conf, 0) / known.length
      resolve({ tokens: known.map((w) => w.word), conf })
    }

    const counted = () => {
      if (++replies === chunks + 1) finish()
    }
    rec.on('result', (m) => {
      if (finished) return
      if (m.event === 'result') words.push(...((m.result.result ?? []) as VoskWord[]))
      counted()
    })
    rec.on('partialresult', () => {
      if (!finished) counted()
    })
    rec.on('error', (m) => finish(new Error(m.event === 'error' ? m.error : 'recognizer error')))

    for (let i = 0; i < chunks; i++) rec.acceptWaveformFloat(samples.subarray(i * chunk, (i + 1) * chunk), rate)
    rec.retrieveFinalResult()
  })
}
