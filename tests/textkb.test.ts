import { describe, expect, it } from 'vitest'
import { KB, KB_KEYS, drawnByImage, kbHalf, kbText, keyCentre, renderKbBand } from '../src/textkb'

describe('text keyboard', () => {
  it('has QWERTY plus ENTER and DEL, every key inside the grid', () => {
    expect(KB_KEYS.map((k) => k.label).join(' ')).toBe('Q W E R T Y U I O P A S D F G H J K L ENTER Z X C V B N M DEL')
    for (const k of KB_KEYS) {
      expect(k.start).toBeGreaterThanOrEqual(1)
      expect(k.start + k.len + 1).toBeLessThanOrEqual(KB.cols)
    }
  })

  it('focus swaps spacers for brackets: every line keeps its length, whatever is focused', () => {
    const lengths = (t: string) => t.split('\n').map((l) => [...l].length)
    const base = lengths(kbText(-1))
    KB_KEYS.forEach((_, i) => expect(lengths(kbText(i))).toEqual(base))
    // Keys share one spacer cell, so the brackets sit between the neighbours.
    expect(kbText(0).split('\n')[0]).toMatch(/^　*［Ｑ］Ｗ　Ｅ/)
    expect(kbText(KB_KEYS.findIndex((k) => k.label === 'ENTER')).split('\n')[2]).toContain('［ＥＮＴＥＲ］')
    // Only fullwidth characters and the ideographic space: the grid holds.
    expect(kbText(3)).toMatch(/^[\uff01-\uff5e\u3000\n]+$/)
  })

  it('blanks letters the image draws (right spot, not in word), keeping the grid', () => {
    const hidden = drawnByImage(new Map([['q', 'correct'], ['w', 'absent'], ['e', 'present']] as const))
    expect([...hidden].sort()).toEqual(['Q', 'W'])
    const line = kbText(1, hidden).split('\n')[0]
    expect(line).not.toContain('Ｑ')
    expect(line).toContain('［　］') // focus still shows on a blanked key
    expect(line).toContain('Ｅ')
    expect([...line].length).toBe([...kbText(1).split('\n')[0]].length)
  })

  it('draws frames and marks on the band; the fill stays inside the brackets', () => {
    const band = renderKbBand(new Map([['q', 'correct'], ['w', 'absent'], ['e', 'present']] as const))
    const q = keyCentre(KB_KEYS[0])
    const y = q.y - 144
    expect(band.get(q.x - 8, y)).toBe(15) // fill
    expect(band.get(q.x - 12, y)).toBe(0) // where the bracket goes
    expect(band.get(Math.round(q.x - 17), y)).toBe(5) // frame
    const left = kbHalf(band, 'left')
    expect([left.width, left.height]).toEqual([288, 144])
    expect(left.get(q.x - 8, y)).toBe(15)
  })
})
