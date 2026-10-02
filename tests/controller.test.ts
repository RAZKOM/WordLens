import { describe, expect, it } from 'vitest'
import { Wordlens, type Host, type Timers } from '../src/controller'
import { MENU, listPages, stripItems, type Settings } from '../src/config'

const LIST_PAGES = listPages('frequency')
import { EV } from '../src/input'
import type { PageContainers } from '../src/pages'
import { KEYS, type KeyValueStore } from '../src/storage'
import { KB_KEYS, kbText } from '../src/textkb'

const WORDS = ['crane', 'slate', 'abbey', 'eerie', 'mourn']
const VALID = new Set([...WORDS, 'babes', 'ghoul', 'fizzy', 'wacky', 'llama'])

class MemKV implements KeyValueStore {
  data = new Map<string, string>()
  async get(k: string) {
    return this.data.get(k) ?? ''
  }
  async set(k: string, v: string) {
    this.data.set(k, v)
    return true
  }
}

class ManualTimers implements Timers {
  private next = 1
  pending = new Map<number, () => void>()
  set(fn: () => void) {
    const id = this.next++
    this.pending.set(id, fn)
    return id
  }
  clear(h: unknown) {
    this.pending.delete(h as number)
  }
  fireAll() {
    const fns = [...this.pending.values()]
    this.pending.clear()
    fns.forEach((f) => f())
  }
}

function makeHost(kv = new MemKV(), createOk = true) {
  const log: string[] = []
  const rebuilds: PageContainers[] = []
  const texts: string[] = []
  let inFlight = 0
  let overlap = false
  const host: Host = {
    async createPage(c) {
      log.push('create')
      rebuilds.push(c)
      return createOk
    },
    async rebuildPage(c) {
      if (inFlight > 0) overlap = true
      log.push('rebuild')
      rebuilds.push(c)
      return true
    },
    async sendImage(t, bytes) {
      if (inFlight > 0) overlap = true
      inFlight++
      await Promise.resolve()
      inFlight--
      expect([...bytes.slice(0, 4)]).toEqual([137, 80, 78, 71]) // PNG signature
      log.push(`img:${t.containerName}`)
      return true
    },
    async updateText(t, content) {
      if (inFlight > 0) overlap = true
      inFlight++
      await Promise.resolve()
      inFlight--
      texts.push(content)
      log.push(`text:${t.containerName}`)
      return true
    },
    async shutDown(mode) {
      log.push(`shutdown:${mode}`)
      return true
    },
    kv,
  }
  return { host, kv, log, rebuilds, texts, overlapped: () => overlap }
}

async function boot(
  kv = new MemKV(),
  seed = 1,
  createOk = true,
  settings: Partial<Settings> = { picker: 'vertical', letterOrder: 'frequency' },
) {
  const h = makeHost(kv, createOk)
  const timers = new ManualTimers()
  let s = seed
  const app = new Wordlens(h.host, {
    timers,
    sleep: async () => {},
    seed: () => s++,
    words: WORDS,
    isValid: (w) => VALID.has(w),
    settings,
  })
  await app.start()
  await app.settle()
  return { app, timers, ...h }
}

/** Tap list items by label, resolving the page swap when needed. */
function typeWord(app: Wordlens, word: string) {
  for (const ch of word.toUpperCase()) {
    let items: readonly string[] = LIST_PAGES[app.listPage]
    if (!items.includes(ch)) {
      tapItem(app, app.listPage === 'A' ? 'MORE >>' : '<< BACK')
      items = LIST_PAGES[app.listPage]
    }
    tapItem(app, ch)
  }
}

function tapItem(app: Wordlens, label: string) {
  const items = LIST_PAGES[app.listPage] as readonly string[]
  const index = items.indexOf(label)
  if (index < 0) throw new Error(`${label} not on page ${app.listPage}`)
  // Mimic the wire: index 0 and CLICK are omitted.
  app.handle({ listEvent: { containerID: 3, currentSelectItemIndex: index === 0 ? undefined : index, currentSelectItemName: label } })
}

describe('Wordlens controller', () => {
  it('boots: creates the play page, sends both images, persists a new round', async () => {
    const { app, log, kv } = await boot()
    expect(log[0]).toBe('create')
    expect(log).toContain('img:board')
    expect(log).toContain('img:keys')
    expect(WORDS).toContain(app.round.target)
    expect(JSON.parse(kv.data.get(KEYS.round)!).target).toBe(app.round.target)
  })

  it('falls back to a rebuild when the startup page already exists (WebView reload)', async () => {
    const { log } = await boot(new MemKV(), 1, false)
    expect(log.slice(0, 2)).toEqual(['create', 'rebuild'])
    expect(log).toContain('img:board')
  })

  it('win: streak increments, then the next word is dealt after the message', async () => {
    const { app, timers, kv } = await boot()
    const first = app.round.target
    typeWord(app, first)
    tapItem(app, 'ENTER')
    expect(app.message).toEqual({ kind: 'win', guesses: 1 })
    expect(app.locked).toBe(true)
    expect(app.stats).toMatchObject({ streak: 1, best: 1, played: 1, wins: 1, dist: [1, 0, 0, 0, 0, 0, 0], last: 0 })
    tapItem(app, 'E') // locked: ignored
    expect(app.round.typed).toBe('')
    timers.fireAll()
    await app.settle()
    expect(app.locked).toBe(false)
    expect(app.round.guesses).toEqual([])
    expect(app.round.target).not.toBe(first)
    expect(kv.data.get(KEYS.streak)).toBe('1')
    expect(kv.data.get(KEYS.lastAnswer)).toBe(first)
  })

  it('invalid guesses never consume a row and the message clears', async () => {
    const { app, timers } = await boot()
    typeWord(app, 'cra')
    tapItem(app, 'ENTER')
    expect(app.message).toEqual({ kind: 'invalid', text: 'NEED 5 LETTERS' })
    typeWord(app, 'ab') // typing clears the message
    expect(app.message).toBeNull()
    expect(app.round.typed).toBe('craab')
    tapItem(app, 'ENTER')
    expect(app.message).toEqual({ kind: 'invalid', text: 'NOT IN LIST' })
    expect(app.round.guesses).toEqual([])
    timers.fireAll()
    expect(app.message).toBeNull()
    for (let i = 0; i < 5; i++) tapItem(app, 'DEL')
    expect(app.round.typed).toBe('')
  })

  it('loss after six wrong guesses resets the streak and shows the answer', async () => {
    const kv = new MemKV()
    kv.data.set(KEYS.streak, '4')
    kv.data.set(KEYS.best, '4')
    kv.data.set(KEYS.played, '4')
    kv.data.set(KEYS.wins, '4')
    const { app, timers } = await boot(kv)
    const wrong = [...VALID].filter((w) => w !== app.round.target).slice(0, 6)
    for (const w of wrong) {
      typeWord(app, w)
      tapItem(app, 'ENTER')
    }
    expect(app.message).toEqual({ kind: 'loss', answer: app.round.target })
    expect(app.stats).toMatchObject({ streak: 0, best: 4, played: 5, wins: 4, dist: [0, 0, 0, 0, 0, 0, 1], last: 6 })
    timers.fireAll()
    expect(app.round.guesses).toEqual([])
  })

  it('give up from the menu counts as a loss', async () => {
    const { app } = await boot()
    app.handle({ menuItemClickEvent: { itemID: MENU.giveUp } })
    expect(app.message?.kind).toBe('loss')
    expect(app.stats.played).toBe(1)
    expect(app.stats.streak).toBe(0)
  })

  it('menu Enter submits like the list ENTER item', async () => {
    const { app } = await boot()
    typeWord(app, app.round.target)
    app.handle({ menuItemClickEvent: { itemID: MENU.enter } })
    expect(app.message?.kind).toBe('win')
  })

  it('menu Backspace deletes one letter', async () => {
    const { app } = await boot()
    typeWord(app, 'cr')
    app.handle({ menuItemClickEvent: { itemID: MENU.backspace } })
    expect(app.round.typed).toBe('c')
  })

  it('MORE >> rebuilds with list page B, and rare letters type from it', async () => {
    const { app, rebuilds, log, overlapped } = await boot()
    tapItem(app, 'MORE >>')
    await app.settle()
    expect(app.listPage).toBe('B')
    const list = rebuilds.at(-1)!.listObject![0] as { itemContainer: { itemName: string[] } }
    expect(list.itemContainer.itemName).toEqual([...LIST_PAGES.B])
    // images are re-sent after the rebuild
    expect(log.slice(log.lastIndexOf('rebuild'))).toEqual(expect.arrayContaining(['img:board', 'img:keys']))
    tapItem(app, 'Z')
    expect(app.round.typed).toBe('z')
    expect(overlapped()).toBe(false)
  })

  it('long press deletes one letter; release does not delete another', async () => {
    const { app, log } = await boot()
    typeWord(app, 'cr')
    app.handle({ sysEvent: { eventType: EV.LONG_PRESS } })
    expect(app.round.typed).toBe('c')
    app.handle({ sysEvent: { eventType: EV.LONG_PRESS_RELEASE } })
    expect(app.round.typed).toBe('c')
    app.handle({ listEvent: { eventType: EV.DOUBLE_CLICK } })
    expect(log).toContain('shutdown:1')
  })

  it('long press off the play page does not delete', async () => {
    const { app } = await boot()
    typeWord(app, 'cr')
    app.handle({ menuItemClickEvent: { itemID: MENU.help } })
    app.handle({ sysEvent: { eventType: EV.LONG_PRESS } })
    expect(app.round.typed).toBe('cr')
  })

  it('Help and Stats pages: tap returns to Play on list page A', async () => {
    const { app, rebuilds } = await boot()
    tapItem(app, 'MORE >>')
    app.handle({ menuItemClickEvent: { itemID: MENU.stats } })
    await app.settle()
    expect(app.page).toBe('stats')
    expect(rebuilds.at(-1)!.textObject![0].content).toContain('Streak: 0')
    app.handle({ listEvent: { currentSelectItemIndex: 3 } }) // stale list event: ignored
    expect(app.round.typed).toBe('')
    app.handle({ sysEvent: {} }) // tap
    await app.settle()
    expect(app.page).toBe('play')
    expect(app.listPage).toBe('A')
    app.handle({ menuItemClickEvent: { itemID: MENU.help } })
    app.handle({ menuItemClickEvent: { itemID: MENU.back } })
    expect(app.page).toBe('play')
  })

  it('resumes an in-progress round after restart', async () => {
    const first = await boot()
    const target = first.app.round.target
    const wrong = WORDS.find((w) => w !== target)!
    typeWord(first.app, wrong)
    tapItem(first.app, 'ENTER')
    typeWord(first.app, 'cr')
    await first.app.settle()
    const again = await boot(first.kv)
    expect(again.app.round.target).toBe(target)
    expect(again.app.round.typed).toBe('cr')
    expect(again.app.round.guesses).toEqual([wrong])
  })

  it('a finished round saved before a crash is not counted twice', async () => {
    const first = await boot()
    const target = first.app.round.target
    typeWord(first.app, target)
    tapItem(first.app, 'ENTER')
    await first.app.settle()
    // Simulate a crash before the next deal: the finished round is still stored.
    first.kv.data.set(KEYS.round, JSON.stringify({ v: 1, target, guesses: [target], typed: '' }))
    const again = await boot(first.kv)
    expect(again.app.stats).toMatchObject({ streak: 1, best: 1, played: 1, wins: 1, dist: [1, 0, 0, 0, 0, 0, 0] })
    expect(again.app.round.target).not.toBe(target)
    expect(again.app.round.guesses).toEqual([])
  })

  it('stats page shows the chart image and persists the distribution', async () => {
    const { app, log, rebuilds, kv } = await boot()
    const wrong = WORDS.find((w) => w !== app.round.target)!
    typeWord(app, wrong)
    tapItem(app, 'ENTER')
    typeWord(app, app.round.target)
    tapItem(app, 'ENTER')
    await app.settle()
    expect(JSON.parse(kv.data.get(KEYS.dist)!)).toEqual({ v: 1, counts: [0, 1, 0, 0, 0, 0, 0], last: 1 })
    app.handle({ menuItemClickEvent: { itemID: MENU.stats } })
    await app.settle()
    expect(rebuilds.at(-1)!.imageObject![0].containerName).toBe('stats-chart')
    expect(log.at(-1)).toBe('img:stats-chart')
  })

  it('keyboard picker: swipes move the focus with text updates only, taps type, marks blank letters', async () => {
    const { app, rebuilds, log, texts } = await boot(new MemKV(), 1, true, { picker: 'keyboard' })
    const page = rebuilds[0]
    expect(page.listObject).toBeUndefined()
    expect(page.imageObject!.map((i) => i.containerName)).toEqual(['board', 'keys', 'kb-left', 'kb-right'])
    const [capture, kb] = page.textObject!
    expect([capture.isEventCapture, capture.content, kb.isEventCapture]).toEqual([1, ' ', 0])
    expect(kb.content).toBe(kbText(0))
    expect(log).toEqual(expect.arrayContaining(['img:board', 'img:keys', 'img:kb-left', 'img:kb-right']))
    expect(texts).toEqual([]) // the page was built with the current keyboard text

    const swipe = (dir: 1 | -1) => app.handle({ textEvent: { containerID: 5, eventType: dir === 1 ? 2 : 1 } })
    const goTo = (label: string) => {
      while (KB_KEYS[app.kbFocus].label !== label) swipe(1)
    }
    log.length = 0
    swipe(1)
    await app.settle()
    expect(log).toEqual(['text:kb-text']) // no image for a focus move
    expect(texts.at(-1)!.split('\n')[0]).toContain('［Ｗ］')
    swipe(-1)
    swipe(-1) // wraps to DEL
    expect(KB_KEYS[app.kbFocus].label).toBe('DEL')

    const wrong = WORDS.find((w) => w !== app.round.target && ![...w].some((c) => app.round.target.includes(c)))
    const guess = wrong ?? WORDS.find((w) => w !== app.round.target)!
    for (const ch of guess.toUpperCase()) {
      goTo(ch)
      app.handle({ sysEvent: {} }) // tap
    }
    expect(app.round.typed).toBe(guess)
    app.handle({ sysEvent: { eventType: 9 } }) // hold deletes
    expect(app.round.typed).toBe(guess.slice(0, -1))
    goTo(guess.at(-1)!.toUpperCase())
    app.handle({ sysEvent: {} })
    log.length = 0
    goTo('ENTER')
    app.handle({ sysEvent: {} })
    await app.settle()
    expect(app.round.guesses).toEqual([guess])
    // The marks changed: the key images are re-sent and the text blanks the letters the image now draws.
    expect(log).toEqual(expect.arrayContaining(['img:kb-left', 'img:kb-right', 'text:kb-text']))
    const absent = [...guess].find((c) => !app.round.target.includes(c))
    if (absent) expect(texts.at(-1)).not.toContain(String.fromCharCode(absent.toUpperCase().charCodeAt(0) - 0x21 + 0xff01))
    // native list events are ignored in keyboard mode
    app.handle({ listEvent: { currentSelectItemIndex: 5 } })
    await app.settle()
  })

  it('horizontal picker: swipes move a wrapping carousel, tap types, no list pages', async () => {
    const { app, rebuilds, log } = await boot(new MemKV(), 1, true, { picker: 'horizontal', letterOrder: 'alphabetical' })
    const page = rebuilds[0]
    expect(page.listObject).toBeUndefined()
    expect(page.textObject![0].isEventCapture).toBe(1)
    expect(log).toContain('img:strip')
    const items = stripItems('alphabetical')
    const goTo = (label: string) => {
      const target = items.indexOf(label)
      while (app.stripIndex !== target) app.handle({ textEvent: { containerID: 5, eventType: 2 } })
    }
    expect(items[app.stripIndex]).toBe('A')
    app.handle({ textEvent: { containerID: 5, eventType: 1 } }) // up → back one
    expect(items[app.stripIndex]).toBe('ENTER')
    app.handle({ textEvent: { containerID: 5, eventType: 1 } })
    app.handle({ textEvent: { containerID: 5, eventType: 1 } }) // wraps past DEL
    expect(items[app.stripIndex]).toBe('Z')
    const target = app.round.target
    for (const ch of target.toUpperCase()) {
      goTo(ch)
      app.handle({ sysEvent: {} }) // tap
    }
    expect(app.round.typed).toBe(target)
    goTo('ENTER')
    app.handle({ sysEvent: {} })
    expect(app.message?.kind).toBe('win')
    // native list events are ignored in horizontal mode
    app.handle({ listEvent: { currentSelectItemIndex: 5 } })
    await app.settle()
  })

  it('corrupt storage boots cleanly with defaults', async () => {
    const kv = new MemKV()
    kv.data.set(KEYS.streak, 'banana')
    kv.data.set(KEYS.round, '{not json')
    kv.data.set(KEYS.deckIndex, '999999')
    kv.data.set(KEYS.deckSeed, 'x')
    const { app } = await boot(kv)
    expect(app.stats.streak).toBe(0)
    expect(WORDS).toContain(app.round.target)
  })
})
