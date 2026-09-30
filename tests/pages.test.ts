import { describe, expect, it } from 'vitest'
import { validateEvenHubPageContainer } from '@evenrealities/even_hub_sdk'
import { DEFAULT_SETTINGS, listPages, stripItems, type Settings } from '../src/config'
import { EMPTY_STATS } from '../src/game'
import { helpPage, playPage, statsPage, type PageContainers } from '../src/pages'

const H: Settings = { ...DEFAULT_SETTINGS, picker: 'horizontal' }
const LEFT: Settings = { ...DEFAULT_SETTINGS, boardSide: 'left' }
const pages: Array<[string, PageContainers]> = [
  ['play A', playPage('A', DEFAULT_SETTINGS)],
  ['play B', playPage('B', DEFAULT_SETTINGS)],
  ['play A, board left', playPage('A', LEFT)],
  ['play horizontal', playPage('A', H)],
  ['help', helpPage(DEFAULT_SETTINGS)],
  ['help horizontal', helpPage(H)],
  ['stats', statsPage({ ...EMPTY_STATS, streak: 12, best: 40, played: 300, wins: 250 })],
]

describe('page containers', () => {
  it.each(pages)('%s passes the SDK validator and platform limits', (_name, p) => {
    expect(validateEvenHubPageContainer(p as never)).toEqual({ valid: true })
    const images = p.imageObject ?? []
    const others = [...(p.listObject ?? []), ...(p.textObject ?? [])]
    expect(images.length).toBeLessThanOrEqual(4)
    expect(others.length).toBeLessThanOrEqual(8)
    expect(p.containerTotalNum).toBe(images.length + others.length)
    expect([...images, ...others].filter((c) => c.isEventCapture === 1)).toHaveLength(1)
    for (const img of images) {
      expect(img.width).toBeLessThanOrEqual(288)
      expect(img.height).toBeLessThanOrEqual(144)
    }
    for (const c of [...images, ...others]) {
      expect((c.xPosition as number) + (c.width as number)).toBeLessThanOrEqual(576)
      expect((c.yPosition as number) + (c.height as number)).toBeLessThanOrEqual(288)
    }
    expect(p.menuObject.menuItems.length).toBeLessThanOrEqual(10)
  })

  it.each(['frequency', 'alphabetical'] as const)('%s list pages fit 20 items, ASCII labels, every letter once', (order) => {
    const pagesFor = listPages(order)
    for (const items of Object.values(pagesFor)) {
      expect(items.length).toBeLessThanOrEqual(20)
      for (const label of items) expect(label).toMatch(/^[\x20-\x7e]+$/)
    }
    const all = [...pagesFor.A, ...pagesFor.B].filter((l) => /^[A-Z]$/.test(l))
    expect([...all].sort().join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
    expect(new Set(all).size).toBe(26)
    if (order === 'alphabetical') expect(all.join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
    expect(stripItems(order)).toHaveLength(28)
  })

  it('board side puts the board image on the chosen side', () => {
    const right = playPage('A', DEFAULT_SETTINGS).imageObject!
    expect(right.find((i) => i.containerName === 'board')!.xPosition).toBe(288)
    expect(right.find((i) => i.containerName === 'keys')!.xPosition).toBe(0)
    const left = playPage('A', LEFT).imageObject!
    expect(left.find((i) => i.containerName === 'board')!.xPosition).toBe(0)
  })
})
