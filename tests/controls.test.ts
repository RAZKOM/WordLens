import { describe, expect, it } from 'vitest'
import { CONTROLS_CELLS, LETTER_MARKS, controlsFrame, controlsRow, fullwidth, letterStatus, stepControl } from '../src/controls'
import { keyMarks } from '../src/game'
import { DEFAULT_SETTINGS } from '../src/config'
import { playPage } from '../src/pages'
import { cellCount } from '../src/textframe'

describe('ENTER / DEL / CLEAR controls', () => {
  it('fullwidth letters', () => {
    expect(fullwidth('DEL')).toBe('ＤＥＬ')
  })

  it('the row keeps its width whichever control has the focus, and is symmetric about DEL', () => {
    expect(controlsRow(0)).toBe('　［ＥＮＴＥＲ］　　ＤＥＬ　　　ＣＬＥＡＲ　　')
    expect(controlsRow(2)).toBe('　　ＥＮＴＥＲ　　　ＤＥＬ　　［ＣＬＥＡＲ］　')
    for (const f of [0, 1, 2]) expect(cellCount(controlsRow(f))).toBe(CONTROLS_CELLS)
    // Unfocused, the row reads the same from both ends in cell widths: ENTER and CLEAR are both five.
    const widths = controlsRow(-1).split(/[　［］]+/).filter(Boolean).map((w) => [...w].length)
    expect(widths).toEqual([5, 3, 5])
    expect(CONTROLS_CELLS).toBe(23)
  })

  it('the frame is blank: the row is its own text box', () => {
    const f = controlsFrame()
    expect(f.a.split('\n')).toEqual([`╭${'─'.repeat(CONTROLS_CELLS)}╮`, `│${'　'.repeat(CONTROLS_CELLS)}│`])
    expect(f.b.split('\n')[1]).toBe(`╰${'─'.repeat(CONTROLS_CELLS)}╯`)
  })

  it('steps wrap', () => {
    expect(stepControl(2, 1)).toBe(0)
    expect(stepControl(0, -1)).toBe(2)
  })
})

describe('alphabet under the controls', () => {
  it('marks sit under their letters; absent letters drop out', () => {
    // Target CRANE. SLATE: A and E in the right spot, S L T not in it. REACT: R in the wrong spot.
    const [letters, under] = letterStatus(keyMarks(['slate', 'react'], 'crane')).split('\n')
    expect(cellCount(letters)).toBe(26)
    expect(cellCount(under)).toBe(26)
    const at = (ch: string) => ch.charCodeAt(0) - 97
    expect([...letters][at('s')]).toBe(LETTER_MARKS.absent)
    expect([...letters][at('t')]).toBe(LETTER_MARKS.absent)
    expect([...letters][at('b')]).toBe('Ｂ')
    expect([...under][at('a')]).toBe(LETTER_MARKS.correct)
    expect([...under][at('r')]).toBe(LETTER_MARKS.present) // R: 1st in REACT, 2nd in CRANE
    expect([...under][at('b')]).toBe(LETTER_MARKS.none)
  })

  it('a fresh round is the plain alphabet', () => {
    expect(letterStatus(new Map()).split('\n')[0]).toBe('ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ')
  })

  it('the controls page stays within 4 images and 8 other containers, z-orders unique', () => {
    const page = playPage('A', DEFAULT_SETTINGS, undefined, undefined, { content: ' ', open: false }, { focus: 0, letters: letterStatus(new Map()) })
    expect(page.imageObject!.length).toBeLessThanOrEqual(4)
    expect(page.textObject!.length).toBeLessThanOrEqual(8)
    const z = [...page.imageObject!, ...page.textObject!].map((c) => c.zOrderIndex)
    expect(new Set(z).size).toBe(z.length)
    expect(page.containerTotalNum).toBe(page.imageObject!.length + page.textObject!.length)
  })
})

describe('help page text', () => {
  const lines = (s: string) => s.split('\n')
  it('fits five lines in every mode and describes the current controls', async () => {
    const { helpText } = await import('../src/pages')
    const base = { ...DEFAULT_SETTINGS }
    const controls = helpText({ ...base, keys: 'controls' }, true)
    expect(controls).toContain('CLEAR')
    expect(controls).toContain('● right spot')
    expect(helpText({ ...base, keys: 'full' }, true)).toContain('Enter and Del only')
    expect(helpText({ ...base, hold: 'delete' }, true)).toContain('Hold to talk')
    expect(helpText({ ...base, hold: 'talk' }, false)).not.toContain('say a word') // no voice: typing help
    for (const s of [
      controls,
      helpText(base, true),
      helpText({ ...base, hold: 'delete' }, true),
      helpText({ ...base, picker: 'horizontal' }, true),
      helpText({ ...base, picker: 'vertical' }, false),
    ]) {
      expect(lines(s).length).toBeLessThanOrEqual(5)
      expect(s).toContain('Double-tap to exit')
    }
  })
})
