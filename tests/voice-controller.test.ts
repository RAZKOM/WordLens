import { describe, expect, it } from 'vitest'
import { Wordlens, type Host, type Timers } from '../src/controller'
import { MENU, TIMING, type Settings } from '../src/config'
import { EV } from '../src/input'
import type { PageContainers } from '../src/pages'
import { KEYS, type KeyValueStore } from '../src/storage'
import type { Heard } from '../src/voice/candidates'
import type { VoiceInput } from '../src/voice/session'
import { NAMES } from '../src/config'

const WORDS = ['crane', 'slate', 'abbey', 'eerie', 'mourn']
const VALID = new Set([...WORDS, 'brain', 'grain', 'there', 'their'])

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
  delays = new Map<number, number>()
  set(fn: () => void, ms: number) {
    const id = this.next++
    this.pending.set(id, fn)
    this.delays.set(id, ms)
    return id
  }
  clear(h: unknown) {
    this.pending.delete(h as number)
  }
  /** Fire only the timers set for `ms` (e.g. the spinner tick). */
  fire(ms: number) {
    const due = [...this.pending].filter(([id]) => this.delays.get(id) === ms)
    due.forEach(([id]) => this.pending.delete(id))
    due.forEach(([, f]) => f())
  }
  fireAll() {
    const fns = [...this.pending.values()]
    this.pending.clear()
    fns.forEach((f) => f())
  }
}

/** Voice input whose stop() answers with whatever the test queues. */
class FakeVoice implements VoiceInput {
  calls: string[] = []
  micOk = true
  next: Heard | null = null
  prepare() {
    this.calls.push('prepare')
  }
  async start() {
    this.calls.push('start')
    return this.micOk
  }
  async stop(typedLen: number) {
    this.calls.push(`stop:${typedLen}`)
    return this.next
  }
  cancel() {
    this.calls.push('cancel')
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const hyp = (s: string, conf = 1) => ({ tokens: s.split(' '), conf })

async function boot(settings: Partial<Settings> = { hold: 'talk' }, kv = new MemKV(), withVoice = true) {
  const voice = new FakeVoice()
  const rebuilds: PageContainers[] = []
  const texts: Array<{ name: string; content: string }> = []
  const images: string[] = []
  const host: Host = {
    async createPage(c) {
      rebuilds.push(c)
      return true
    },
    async rebuildPage(c) {
      rebuilds.push(c)
      return true
    },
    async sendImage(target) {
      images.push(target.containerName)
      return true
    },
    async updateText(target, content) {
      texts.push({ name: target.containerName, content })
      return true
    },
    async shutDown() {
      return true
    },
    kv,
    voice: withVoice ? voice : undefined,
  }
  const timers = new ManualTimers()
  let s = 1
  const app = new Wordlens(host, {
    timers,
    sleep: async () => {},
    seed: () => s++,
    words: WORDS,
    isValid: (w) => VALID.has(w),
    settings: { picker: 'keyboard', ...settings },
  })
  await app.start()
  await app.settle()
  const hold = () => app.handle({ sysEvent: { eventType: EV.LONG_PRESS } })
  const release = () => app.handle({ sysEvent: { eventType: EV.LONG_PRESS_RELEASE } })
  const swipe = (dir: 1 | -1) => app.handle({ textEvent: { eventType: dir === 1 ? EV.SCROLL_BOTTOM : EV.SCROLL_TOP } })
  const tap = () => app.handle({ sysEvent: {} })
  /** Hold, speak (queued result), release, and wait for the choices. */
  async function say(heard: Heard | null) {
    voice.next = heard
    hold()
    await flush()
    release()
    await flush()
  }
  /** What the voice panel shows now: the last text sent to it, or its content in the last page build. */
  function panel(): string | null {
    const sent = texts.filter((x) => x.name === NAMES.voice)
    if (sent.length) return sent[sent.length - 1].content
    const box = rebuilds[rebuilds.length - 1].textObject?.find((c) => c.containerName === NAMES.voice)
    return box ? (box.content as string) : null
  }
  return { app, voice, kv, timers, rebuilds, texts, images, hold, release, swipe, tap, say, panel }
}

const menuNames = (c: PageContainers) => c.menuObject.menuItems.map((m) => m.itemName)

describe('push-to-talk', () => {
  it('the panel works by text updates over the game: no rebuild, keys stay; tap guesses the word', async () => {
    const t = await boot()
    expect(t.voice.calls).toContain('prepare') // model warmed up at start in talk mode
    const page = t.rebuilds[t.rebuilds.length - 1]
    expect(page.textObject?.some((c) => c.containerName === NAMES.voice)).toBe(true) // the panel is always there
    const before = t.rebuilds.length
    t.hold()
    await t.app.settle()
    expect(t.app.voice.phase).toBe('listening')
    expect(t.panel()).toContain('LISTENING')
    expect(t.app.message).toBeNull()

    t.voice.next = { words: [hyp('brain'), hyp('grain'), hyp('crane')], spell: [] }
    t.release()
    expect(t.app.voice.phase).toBe('thinking')
    await flush()
    await t.app.settle()
    expect(t.app.voice).toMatchObject({ phase: 'choosing', index: 0 })
    expect(t.panel()).toBe('［BRAIN］\n　GRAIN\n　CRANE\n　CANCEL')

    const imagesBefore = t.images.length
    t.swipe(1)
    t.swipe(1)
    await t.app.settle()
    expect(t.panel()).toContain('［CRANE］')
    expect(t.images.length).toBe(imagesBefore) // a swipe sends text only

    t.tap()
    await t.app.settle()
    expect(t.app.voice.phase).toBe('idle')
    expect(t.app.round.guesses).toEqual(['crane'])
    expect(t.app.round.typed).toBe('')
    expect(t.panel()).toContain('HOLD TO TALK') // back to the card hint
    expect(t.rebuilds.length).toBe(before) // never rebuilt
  })

  it('a text spinner runs while listening and thinking, and stops for the choices', async () => {
    const t = await boot()
    t.hold()
    await t.app.settle()
    expect(t.panel()).toContain('●○○')
    t.timers.fire(TIMING.spinnerMs)
    await t.app.settle()
    expect(t.panel()).toContain('○●○')
    t.timers.fire(TIMING.spinnerMs)
    await t.app.settle()
    expect(t.panel()).toContain('○○●')

    t.voice.next = { words: [hyp('slate')], spell: [] }
    let resolveStop!: () => void
    const gate = new Promise<void>((r) => (resolveStop = r))
    const stop = t.voice.stop.bind(t.voice)
    t.voice.stop = async (n) => {
      await gate
      return stop(n)
    }
    t.release()
    await t.app.settle()
    expect(t.panel()).toContain('THINKING\n○○○') // restarts from the first frame
    t.timers.fire(TIMING.spinnerMs)
    await t.app.settle()
    expect(t.panel()).toContain('●○○')

    resolveStop()
    await flush()
    await t.app.settle()
    expect(t.app.voice.phase).toBe('choosing')
    const sent = t.texts.length
    t.timers.fire(TIMING.spinnerMs) // nothing pending: the spinner stopped
    await t.app.settle()
    expect(t.texts.length).toBe(sent)
  })

  it('choices wrap, and CANCEL leaves the row as it was', async () => {
    const t = await boot()
    await t.say({ words: [hyp('there'), hyp('their')], spell: [] })
    t.swipe(-1)
    expect(t.app.voice).toMatchObject({ index: 2 }) // CANCEL
    t.tap()
    expect(t.app.voice.phase).toBe('idle')
    expect(t.app.message).toBeNull()
    expect(t.app.round.guesses).toEqual([])
  })

  it('spelled letters are added to the row, not guessed', async () => {
    const t = await boot()
    await t.say({ words: [], spell: [hyp('s l')] })
    await t.app.settle()
    expect(t.panel()).toContain('［+SL］')
    t.tap()
    expect(t.app.round.typed).toBe('sl')
    await t.say({ words: [], spell: [hyp('alpha tango echo')] })
    expect(t.voice.calls).toContain('stop:2')
    t.tap()
    expect(t.app.round.typed).toBe('slate')
    expect(t.app.round.guesses).toEqual([])
  })

  it('nothing heard: the modal says so, and a tap closes it', async () => {
    const t = await boot()
    await t.say(null)
    await t.app.settle()
    expect(t.app.voice).toEqual({ phase: 'message', text: 'MISSED IT' })
    expect(t.panel()).toContain('MISSED IT')
    t.tap()
    await t.app.settle()
    expect(t.app.voice.phase).toBe('idle')
    expect(t.panel()).toContain('HOLD TO TALK') // back to the card hint
    expect(t.app.round.typed).toBe('') // the tap did not type a key
  })

  it('a miss clears by itself after a while, and a new hold starts over', async () => {
    const t = await boot()
    await t.say(null)
    t.hold()
    expect(t.app.voice.phase).toBe('listening')
    t.release()
    await flush()
    t.timers.fireAll() // the message timeout
    expect(t.app.voice.phase).toBe('idle')
  })

  it('a mic that will not open shows a message', async () => {
    const t = await boot()
    t.voice.micOk = false
    t.hold()
    await flush()
    expect(t.app.voice).toEqual({ phase: 'message', text: 'NO MIC' })
  })

  it('a menu choice clears the panel', async () => {
    const t = await boot()
    await t.say({ words: [hyp('slate')], spell: [] })
    t.app.handle({ menuItemClickEvent: { itemID: MENU.backspace } })
    await t.app.settle()
    expect(t.app.voice.phase).toBe('idle')
    expect(t.panel()).toContain('HOLD TO TALK') // back to the card hint
  })

  it('a lost release is covered by the time limit', async () => {
    const t = await boot()
    t.voice.next = { words: [hyp('slate')], spell: [] }
    t.hold()
    await flush()
    t.timers.fireAll()
    await flush()
    expect(t.app.voice.phase).toBe('choosing')
  })

  it('a new hold while choosing starts over; double-tap cancels and exits', async () => {
    const t = await boot()
    await t.say({ words: [hyp('slate')], spell: [] })
    t.hold()
    expect(t.app.voice.phase).toBe('listening')
    expect(t.voice.calls.filter((c) => c === 'cancel')).toHaveLength(1)
    t.app.handle({ sysEvent: { eventType: EV.DOUBLE_CLICK } })
    expect(t.app.voice.phase).toBe('idle')
    expect(t.voice.calls.filter((c) => c === 'cancel')).toHaveLength(2)
  })

  it('a result that arrives after a cancel is dropped', async () => {
    const t = await boot()
    t.voice.next = { words: [hyp('slate')], spell: [] }
    t.hold()
    await flush()
    t.release()
    t.app.handle({ menuItemClickEvent: { itemID: MENU.help } }) // cancels while decoding
    await flush()
    expect(t.app.voice.phase).toBe('idle')
    expect(t.app.page).toBe('help')
  })

  it('swipes while listening or decoding do not move the keys', async () => {
    const t = await boot()
    const focus = t.app.kbFocus
    t.hold()
    t.swipe(1)
    await flush()
    t.voice.next = { words: [hyp('slate')], spell: [] }
    t.release()
    t.swipe(1) // still decoding
    expect(t.app.kbFocus).toBe(focus)
    await flush()
    expect(t.app.voice).toMatchObject({ phase: 'choosing', index: 0 })
  })

  it('swipes and taps go to the keyboard again after a choice', async () => {
    const t = await boot()
    await t.say({ words: [hyp('slate')], spell: [] })
    t.tap()
    const focus = t.app.kbFocus
    t.swipe(1)
    expect(t.app.kbFocus).toBe(focus + 1)
  })
})

describe('ENTER / DEL controls', () => {
  const names = (c: PageContainers) => [...(c.imageObject ?? []), ...(c.textObject ?? [])].map((o) => o.containerName)

  it('the menu swaps the keyboard for the controls box (saved), and back', async () => {
    const t = await boot({}, new MemKV())
    expect(menuNames(t.rebuilds[0])).toContain('Enter and Del only')
    t.app.handle({ menuItemClickEvent: { itemID: MENU.keys } })
    await t.app.settle()
    const page = t.rebuilds[t.rebuilds.length - 1]
    expect(names(page)).toContain(NAMES.ctrl)
    expect(names(page)).not.toContain(NAMES.kbLeft)
    expect(names(page)).not.toContain(NAMES.kbText)
    expect(menuNames(page)).toContain('Full keyboard')
    expect(t.kv.data.get(KEYS.keys)).toBe('controls')

    const again = await boot({}, t.kv)
    expect(again.app.controlsMode).toBe(true)

    t.app.handle({ menuItemClickEvent: { itemID: MENU.keys } })
    await t.app.settle()
    expect(names(t.rebuilds[t.rebuilds.length - 1])).toContain(NAMES.kbLeft)
  })

  it('swipes move between ENTER and DEL with text updates; taps press them', async () => {
    const t = await boot({ keys: 'controls' })
    t.app.type('c')
    t.app.type('r')
    const images = t.images.length
    t.swipe(1)
    await t.app.settle()
    expect(t.app.ctrlFocus).toBe(1)
    expect(t.texts[t.texts.length - 1]).toEqual({ name: NAMES.ctrlText, content: expect.stringContaining('［ＤＥＬ］') })
    t.tap()
    expect(t.app.round.typed).toBe('c')
    t.app.type('r')
    t.swipe(1)
    t.tap() // CLEAR
    expect(t.app.round.typed).toBe('')
    t.app.type('c')
    t.swipe(1) // wraps to ENTER
    t.tap() // ENTER with one letter: the board says it needs five
    expect(t.app.message).toEqual({ kind: 'invalid', text: 'NEED 5 LETTERS' })
    await t.app.settle()
    expect(t.images.filter((n) => n === NAMES.kbLeft || n === NAMES.kbRight)).toHaveLength(0)
    expect(t.images.length).toBeGreaterThan(images) // only the board redrew
  })

  it('voice still works over the controls, and swipes go to the choices while choosing', async () => {
    const t = await boot({ keys: 'controls' })
    await t.say({ words: [hyp('slate'), hyp('crane')], spell: [] })
    t.swipe(1)
    expect(t.app.voice).toMatchObject({ phase: 'choosing', index: 1 })
    expect(t.app.ctrlFocus).toBe(0)
    t.tap()
    expect(t.app.round.guesses).toEqual(['crane'])
  })

  it('the alphabet under the controls updates after a guess, by text', async () => {
    const t = await boot({ keys: 'controls' })
    const page = t.rebuilds[t.rebuilds.length - 1]
    expect(page.textObject?.find((c) => c.containerName === NAMES.ctrlLetters)?.content).toMatch(/^ＡＢＣ/)
    const target = t.app.round.target
    const guess = target === 'slate' ? 'crane' : 'slate'
    for (const ch of guess) t.app.type(ch)
    t.app.submit()
    await t.app.settle()
    const sent = t.texts.filter((x) => x.name === NAMES.ctrlLetters)
    expect(sent).toHaveLength(1)
    expect(sent[0].content).not.toBe(page.textObject?.find((c) => c.containerName === NAMES.ctrlLetters)?.content)
    // Swiping the controls does not resend the alphabet.
    t.swipe(1)
    await t.app.settle()
    expect(t.texts.filter((x) => x.name === NAMES.ctrlLetters)).toHaveLength(1)
  })

  it('with hold set to delete the full keyboard comes back (letters are needed)', async () => {
    const t = await boot({ keys: 'controls' })
    expect(t.app.controlsMode).toBe(true)
    t.app.handle({ menuItemClickEvent: { itemID: MENU.hold } })
    await t.app.settle()
    expect(t.app.controlsMode).toBe(false)
    const page = t.rebuilds[t.rebuilds.length - 1]
    expect(names(page)).toContain(NAMES.kbLeft)
    expect(menuNames(page).some((n) => n === 'Full keyboard' || n === 'Enter and Del only')).toBe(false)
  })
})

describe('hold toggle', () => {
  it('hold talks by default; the menu toggle switches it, saves it, and renames itself', async () => {
    const t = await boot({}, new MemKV())
    expect(t.app.settings.hold).toBe('talk')
    expect(menuNames(t.rebuilds[0])).toContain('Hold to delete')
    t.app.handle({ menuItemClickEvent: { itemID: MENU.hold } })
    await t.app.settle()
    expect(t.app.settings.hold).toBe('delete')
    expect(t.kv.data.get(KEYS.hold)).toBe('delete')
    expect(menuNames(t.rebuilds[t.rebuilds.length - 1])).toContain('Hold to talk')
    expect(t.panel()).toContain('Hold to delete') // the card hint follows

    // Restart: the saved choice comes back.
    const again = await boot({}, t.kv)
    expect(again.app.settings.hold).toBe('delete')
  })

  it('a URL override wins over the saved choice', async () => {
    const kv = new MemKV()
    kv.data.set(KEYS.hold, 'talk')
    const t = await boot({ hold: 'delete' }, kv)
    expect(t.app.settings.hold).toBe('delete')
  })

  it('hold deletes in delete mode', async () => {
    const t = await boot({ hold: 'delete' })
    t.app.type('c')
    t.hold()
    expect(t.app.round.typed).toBe('')
    expect(t.voice.calls).not.toContain('start')
  })

  it('without voice, or with the native list, hold deletes and the toggle is not offered', async () => {
    const noVoice = await boot({ hold: 'talk' }, new MemKV(), false)
    expect(menuNames(noVoice.rebuilds[0])).not.toContain('Hold to delete')
    noVoice.app.type('c')
    noVoice.hold()
    expect(noVoice.app.round.typed).toBe('')

    const list = await boot({ hold: 'talk', picker: 'vertical' })
    expect(menuNames(list.rebuilds[0]).some((n) => n.startsWith('Hold'))).toBe(false)
    list.app.type('c')
    list.hold()
    expect(list.app.round.typed).toBe('')
  })

  it('menu labels fit the firmware limit', async () => {
    const t = await boot()
    for (const name of menuNames(t.rebuilds[0])) expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(32)
  })
})
