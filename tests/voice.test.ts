import { describe, expect, it } from 'vitest'
import { VOICE } from '../src/config'
import { buildCandidates, candidateLabel, preferSpelling, previewTyped, type Heard } from '../src/voice/candidates'
import { pcmBytes, peak, s16leToFloat } from '../src/voice/pcm'
import { VoiceSession, type Mic, type Recognizer } from '../src/voice/session'
import { SPELL_TOKENS, spellLetters } from '../src/voice/spell'
import { SPOKEN, isValidGuess } from '../src/words'
import { FRAME, idleCardText, panelFrame } from '../src/voice/modal'
import { cellCount, textFrame } from '../src/textframe'
import { panelSpot, playPage } from '../src/pages'
import { DEFAULT_SETTINGS } from '../src/config'

const hyp = (s: string, conf = 1) => ({ tokens: s.split(' '), conf })

describe('spelling', () => {
  it('maps letters and NATO words, x-ray as "x ray"', () => {
    expect(spellLetters(['c', 'romeo', 'a', 'november', 'echo'])).toBe('crane')
    expect(spellLetters(['x', 'ray', 'ray', '[unk]', 'zulu'])).toBe('xz')
  })
  it('the grammar has 26 letters, 25 NATO words and "ray"', () => {
    expect(SPELL_TOKENS.length).toBe(52)
    expect(new Set(SPELL_TOKENS).size).toBe(52)
  })
})

describe('spoken word list', () => {
  it('holds only valid guesses, sorted and unique', () => {
    expect(SPOKEN.length).toBeGreaterThan(5000)
    expect(new Set(SPOKEN).size).toBe(SPOKEN.length)
    expect([...SPOKEN].sort()).toEqual(SPOKEN)
    for (const w of SPOKEN) expect(isValidGuess(w)).toBe(true)
    for (const w of ['crane', 'there', 'their', 'pride', 'flour']) expect(SPOKEN).toContain(w)
  })
})

describe('pcm', () => {
  it('accepts Uint8Array, number[], base64 and ArrayBuffer', () => {
    const bytes = new Uint8Array([1, 2, 255])
    expect(pcmBytes(bytes)).toBe(bytes)
    expect([...pcmBytes([1, 2, 255])!]).toEqual([1, 2, 255])
    expect([...pcmBytes(btoa(String.fromCharCode(1, 2, 255)))!]).toEqual([1, 2, 255])
    expect([...pcmBytes(bytes.buffer)!]).toEqual([1, 2, 255])
    expect(pcmBytes(null)).toBeNull()
    expect(pcmBytes('%%%')).toBeNull()
  })
  it('joins frames and converts s16le, across a frame split mid-sample', () => {
    // 0x4000 = 0.5, 0xC000 = -0.5, 0x7FFF ≈ 1; the second sample straddles two frames.
    const f = s16leToFloat([new Uint8Array([0x00, 0x40, 0x00]), new Uint8Array([0xc0, 0xff, 0x7f, 0x01])])
    expect(Array.from(f)).toEqual([0.5, -0.5, 32767 / 32768])
    expect(peak(f)).toBeCloseTo(1, 3)
  })
})

describe('candidates', () => {
  // Shapes taken from real decodes of synthesised speech (see README, Voice input).
  const crane: Heard = { words: [hyp('brain', 0.85), hyp('grain', 0.68), hyp('drain'), hyp('crane')], spell: [] }
  const there: Heard = { words: [hyp('there', 0.5), hyp('their'), hyp('chair', 0.2)], spell: [hyp('[unk]')] }

  it('whole words, best first, with homophones as runner-ups', () => {
    expect(buildCandidates(crane, '').map(candidateLabel)).toEqual(['BRAIN', 'GRAIN', 'DRAIN', 'CRANE'])
    expect(buildCandidates(there, '').map(candidateLabel)).toEqual(['THERE', 'THEIR', 'CHAIR'])
  })

  it('a spelled run comes first and is cut to the free cells', () => {
    const h: Heard = { words: [hyp('seedy', 0.4)], spell: [hyp('c r a n e')] }
    expect(preferSpelling(h, 0)).toBe(true)
    expect(buildCandidates(h, '').map(candidateLabel)).toEqual(['+CRANE', 'SEEDY'])
    expect(buildCandidates(h, 'ab').map(candidateLabel)).toEqual(['+CRA', 'SEEDY'])
    expect(buildCandidates(h, 'abcde').map(candidateLabel)).toEqual(['SEEDY'])
  })

  it('a lone letter wins when it is the more confident decode', () => {
    const b: Heard = { words: [hyp('hooey', 0.36)], spell: [hyp('b', 0.7), hyp('d', 0.5), hyp('e', 0.4)] }
    expect(buildCandidates(b, '').map(candidateLabel)).toEqual(['+B', '+D', '+E', 'HOOEY'])
    const plumb: Heard = { words: [hyp('thumb', 0.88), hyp('plumb')], spell: [hyp('m', 0.51)] }
    expect(buildCandidates(plumb, '').map(candidateLabel)).toEqual(['THUMB', 'PLUMB', '+M'])
  })

  it('a NATO word is a guess on an empty row, a letter mid-row', () => {
    const delta: Heard = { words: [hyp('delta')], spell: [hyp('delta')] }
    expect(buildCandidates(delta, '').map(candidateLabel)).toEqual(['DELTA', '+D'])
    expect(buildCandidates(delta, 'cr').map(candidateLabel)).toEqual(['+D', 'DELTA'])
  })

  it('several words in a row are not a guess', () => {
    const h: Heard = { words: [hyp('bravo wacko')], spell: [hyp('bravo echo')] }
    expect(buildCandidates(h, '').map(candidateLabel)).toEqual(['+BE'])
  })

  it('nothing heard → no candidates; at most four (the panel holds four and CANCEL)', () => {
    expect(buildCandidates({ words: [], spell: [] }, '')).toEqual([])
    const many: Heard = { words: ['aaaaa', 'bbbbb', 'ccccc', 'ddddd', 'eeeee', 'fffff'].map((w) => hyp(w)), spell: [] }
    expect(buildCandidates(many, '')).toHaveLength(4)
  })

  it('previews: a word replaces the row, letters extend it', () => {
    expect(previewTyped({ kind: 'word', word: 'crane' }, 'sl')).toBe('crane')
    expect(previewTyped({ kind: 'letters', letters: 'ate' }, 'sl')).toBe('slate')
  })
})

/** A promise with its resolver exposed. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

function fakes() {
  const calls: string[] = []
  let open = deferred<boolean>()
  const mic: Mic = {
    open: () => {
      calls.push('open')
      return open.promise
    },
    close: async () => {
      calls.push('close')
    },
  }
  const clips: Float32Array[] = []
  let result = deferred<Heard>()
  const recognizer: Recognizer = {
    prepare: () => calls.push('prepare'),
    recognise: (samples) => {
      clips.push(samples)
      return result.promise
    },
  }
  let t = 0
  const session = new VoiceSession(mic, recognizer, () => t, () => {})
  return {
    session,
    calls,
    clips,
    openMic: (ok = true) => open.resolve(ok),
    heard: (h: Heard) => result.resolve(h),
    reset: () => {
      open = deferred()
      result = deferred()
    },
    advance: (ms: number) => (t += ms),
  }
}

/** n seconds of a loud square wave as s16le bytes. */
function loud(seconds: number): Uint8Array {
  const n = Math.round(seconds * VOICE.sampleRate)
  const b = new Uint8Array(n * 2)
  for (let i = 0; i < n; i++) b[i * 2 + 1] = i % 20 < 10 ? 0x20 : 0xe0
  return b
}

describe('voice session', () => {
  const HEARD: Heard = { words: [hyp('crane')], spell: [] }

  it('records between start and stop, pads the clip, and closes the mic', async () => {
    const f = fakes()
    const started = f.session.start()
    f.openMic()
    expect(await started).toBe(true)
    f.session.push(loud(0.5))
    f.advance(500)
    const stopped = f.session.stop(0)
    f.heard(HEARD)
    expect(await stopped).toEqual(HEARD)
    expect(f.calls).toEqual(['prepare', 'open', 'close'])
    expect(f.clips[0].length).toBe(Math.round((0.5 + VOICE.padSeconds) * VOICE.sampleRate))
    // Frames after the stop are ignored.
    f.session.push(loud(0.5))
    expect(f.clips).toHaveLength(1)
  })

  it('ignores frames before start', async () => {
    const f = fakes()
    f.session.push(loud(1))
    f.openMic()
    await f.session.start()
    expect(await f.session.stop(0)).toBeNull() // nothing recorded: too short
  })

  it('a too-short or silent clip is not decoded', async () => {
    const f = fakes()
    f.openMic()
    await f.session.start()
    f.session.push(loud(0.1))
    expect(await f.session.stop(0)).toBeNull()
    f.reset()
    f.openMic()
    await f.session.start()
    f.session.push(new Uint8Array(VOICE.sampleRate * 2)) // 1 s of digital silence
    expect(await f.session.stop(0)).toBeNull()
    expect(f.clips).toHaveLength(0)
  })

  it('a release before the mic opens closes it again once it does', async () => {
    const f = fakes()
    const started = f.session.start()
    expect(await f.session.stop(0)).toBeNull()
    f.openMic()
    await started
    expect(f.calls.filter((c) => c === 'close')).toHaveLength(2)
    expect(f.calls.indexOf('close', f.calls.indexOf('open'))).toBeGreaterThan(-1)
  })

  it('a failed mic open reports false', async () => {
    const f = fakes()
    f.openMic(false)
    expect(await f.session.start()).toBe(false)
  })

  it('cancel during decoding drops the result', async () => {
    const f = fakes()
    f.openMic()
    await f.session.start()
    f.session.push(loud(0.5))
    const stopped = f.session.stop(0)
    f.session.cancel()
    f.heard(HEARD)
    expect(await stopped).toBeNull()
  })

  it('caps the clip length', async () => {
    const f = fakes()
    f.openMic()
    await f.session.start()
    for (let i = 0; i < VOICE.maxSeconds + 3; i++) f.session.push(loud(1))
    const stopped = f.session.stop(0)
    f.heard(HEARD)
    await stopped
    expect(f.clips[0].length).toBe(Math.round((VOICE.maxSeconds + VOICE.padSeconds) * VOICE.sampleRate))
  })
})

describe('voice panel frame', () => {
  it('frames: 20 px glyphs only, every row the same width; walls twice, edges once', () => {
    for (const cells of [5, 11]) {
      const f = panelFrame(true, cells)
      const a = f.a.split('\n')
      const b = f.b.split('\n')
      expect(a[0]).toBe(`╭${'─'.repeat(cells)}╮`)
      expect(b[b.length - 1]).toBe(`╰${'─'.repeat(cells)}╯`)
      expect(a).toHaveLength(FRAME.rows + 1)
      expect(b).toHaveLength(FRAME.rows + 1)
      for (const row of [...a, ...b]) {
        expect(cellCount(row)).toBe(cells + 2)
        expect(row).toMatch(/^[╭╮╯╰│─　]+$/)
      }
    }
    expect(panelFrame(false, 5)).toEqual({ a: ' ', b: ' ' })
    expect(() => textFrame(3, ['ab'])).toThrow()
    expect(textFrame(3, ['ＤＥＬ']).a).toBe('╭───╮\n│ＤＥＬ│')
  })

  it('keyboard layout: a framed card in the info slot, under the stats line; horizontal: the strip, unframed', () => {
    const kb = panelSpot({ ...DEFAULT_SETTINGS, picker: 'keyboard', boardSide: 'right' })
    expect(kb).toMatchObject({ persistent: true, cells: 11 })
    expect(kb.x).toBeGreaterThanOrEqual(0)
    expect(kb.x + 13 * 20).toBeLessThanOrEqual(288) // stays in the info slot, off the board
    const left = panelSpot({ ...DEFAULT_SETTINGS, picker: 'keyboard', boardSide: 'left' })
    expect(left.x).toBeGreaterThanOrEqual(288)
    expect(panelSpot({ ...DEFAULT_SETTINGS, picker: 'horizontal' })).toMatchObject({ persistent: false, cells: 5 })
  })

  it('the card hint follows the hold mode', () => {
    expect(idleCardText('talk')).toContain('HOLD TO TALK')
    expect(idleCardText('delete')).toContain('Hold to delete')
    expect(idleCardText('talk')).not.toContain('Help')
  })

  it('keeps the keyboard page within 4 images and 8 other containers', () => {
    const page = playPage('A', DEFAULT_SETTINGS, undefined, undefined, { content: ' ', open: false })
    expect(page.imageObject).toHaveLength(4)
    expect(page.textObject!.length).toBeLessThanOrEqual(8)
    expect(page.containerTotalNum).toBe(page.imageObject!.length + page.textObject!.length)
    const z = [...page.imageObject!, ...page.textObject!].map((c) => c.zOrderIndex)
    expect(new Set(z).size).toBe(z.length)
  })
})
