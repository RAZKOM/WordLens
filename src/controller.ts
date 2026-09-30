/**
 * WordLens controller. Owns game state and turns inputs into state changes,
 * storage writes, image frames and page rebuilds. The host (SDK bridge) and
 * timers are injected, so full play-throughs run in unit tests.
 */
import {
  BACK,
  DEFAULT_SETTINGS,
  DEL,
  EDGE_SCROLL_SWAPS_PAGES,
  ENTER,
  IDS,
  MENU,
  MORE,
  NAMES,
  TIMING,
  listPages,
  stripItems,
  type ListPage,
  type Settings,
} from './config'
import { advance, freshDeck, isValidDeck, randomSeed, wordAt, type DeckState, type SeedSource } from './deck'
import {
  EMPTY_STATS,
  WORD_LENGTH,
  applyLoss,
  applyWin,
  isFinished,
  isLost,
  isWon,
  keyMarks,
  type Round,
  type Stats,
} from './game'
import { CommandQueue, type ImageSend, type Sleep } from './imageQueue'
import { parseEvent, resolveListItem, type Input, type RawEvent } from './input'
import { helpPage, playPage, statsPage, type PageContainers, type PageName } from './pages'
import { renderBoard, type Message } from './render/board'
import { renderDistribution } from './render/chart'
import { renderStrip } from './render/strip'
import { renderHelp } from './render/help'
import { renderKeys } from './render/keys'
import { encodePng } from './render/png'
import { Storage, WriteChain, type KeyValueStore } from './storage'
import { TARGETS, isValidGuess } from './words'

export interface Host {
  createPage(c: PageContainers): Promise<boolean>
  rebuildPage(c: PageContainers): Promise<boolean>
  sendImage: ImageSend
  shutDown(mode: 0 | 1): Promise<boolean>
  kv: KeyValueStore
}

export interface Timers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

export interface Options {
  timers?: Timers
  sleep?: Sleep
  seed?: SeedSource
  words?: readonly string[]
  isValid?: (w: string) => boolean
  settings?: Partial<Settings>
}

export class Wordlens {
  page: PageName = 'play'
  listPage: ListPage = 'A'
  stats: Stats = EMPTY_STATS
  deck: DeckState = { seed: 0, index: 0 }
  lastAnswer: string | null = null
  round: Round = { target: 'aaaaa', guesses: [], typed: '' }
  message: Message | null = null
  /** True while a win/loss message is showing: list input is ignored. */
  locked = false
  /** Horizontal picker position (index into stripItems); starts on the first letter. */
  stripIndex = 2
  readonly settings: Settings

  readonly queue: CommandQueue
  readonly writes = new WriteChain()
  private readonly storage: Storage
  private readonly timers: Timers
  private readonly seed: SeedSource
  private readonly words: readonly string[]
  private readonly isValid: (w: string) => boolean
  private messageTimer: unknown = null
  private started = false

  constructor(
    private host: Host,
    opts: Options = {},
  ) {
    this.settings = { ...DEFAULT_SETTINGS, ...opts.settings }
    this.timers = opts.timers ?? realTimers
    this.seed = opts.seed ?? randomSeed
    this.words = opts.words ?? TARGETS
    this.isValid = opts.isValid ?? isValidGuess
    this.storage = new Storage(host.kv)
    this.queue = new CommandQueue(host.sendImage, {
      gapMs: TIMING.imageGapMs,
      retryMs: TIMING.imageRetryMs,
      sleep: opts.sleep,
    })
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  async start(): Promise<void> {
    const saved = await this.storage.load()
    this.stats = saved.stats
    this.lastAnswer = saved.lastAnswer
    this.deck = saved.deck && isValidDeck(this.words, saved.deck) ? saved.deck : freshDeck(this.words, saved.lastAnswer, this.seed)

    if (saved.round && !isFinished(saved.round)) {
      this.round = saved.round
    } else {
      // A finished round can survive a crash between the stats write and the
      // next deal. Never re-apply its stats; skip past its word if needed.
      if (saved.round && wordAt(this.words, this.deck) === saved.round.target) {
        this.lastAnswer = saved.round.target
        this.deck = advance(this.words, this.deck, this.seed)
      }
      this.round = { target: wordAt(this.words, this.deck), guesses: [], typed: '' }
      this.persistDeck()
      this.persistRound()
    }

    await this.queue.op(async () => {
      const page = playPage(this.listPage, this.settings)
      if (await this.host.createPage(page)) return
      // A WebView reload leaves the startup page in place, so create fails:
      // rebuild over it instead of staying on a stale page.
      console.warn('[wordlens] createStartUpPageContainer failed; rebuilding instead')
      if (!(await this.host.rebuildPage(page))) console.warn('[wordlens] rebuildPageContainer failed too')
    })
    this.started = true
    this.drawPlay()
  }

  handle(raw: RawEvent): void {
    if (!this.started) return
    this.dispatch(parseEvent(raw))
  }

  dispatch(input: Input): void {
    switch (input.kind) {
      case 'doubleTap':
        // Official guidance: double-tap must always reach the exit prompt.
        this.exit()
        return
      case 'menu':
        this.onMenu(input.itemID)
        return
      case 'foregroundEnter':
        // Fired around contextual-menu open/close too; re-sending is harmless.
        this.redrawCurrentPage()
        return
      case 'exit':
        this.clearMessageTimer()
        return
      case 'tap':
        if (this.page !== 'play') this.goto('play')
        else if (this.horizontal) this.onListItem(this.strip[this.stripIndex])
        return
      case 'longPress':
        if (this.page === 'play') this.backspace()
        return
      case 'listSelect':
        if (this.page !== 'play' || this.horizontal) return
        this.onListItem(resolveListItem(this.listItems, input.index, input.name))
        return
      case 'scrollBottom':
      case 'scrollTop':
        if (this.page !== 'play') return
        if (this.horizontal) this.moveStrip(input.kind === 'scrollBottom' ? 1 : -1)
        else if (EDGE_SCROLL_SWAPS_PAGES) this.swapList()
        return
      case 'ignore':
        return
      default: {
        const _exhaustive: never = input
        return _exhaustive
      }
    }
  }

  // ───────────────────────────── input → actions ─────────────────────────────

  private get horizontal(): boolean {
    return this.settings.picker === 'horizontal'
  }

  private get listItems(): readonly string[] {
    return listPages(this.settings.letterOrder)[this.listPage]
  }

  private get strip(): readonly string[] {
    return stripItems(this.settings.letterOrder)
  }

  /** Horizontal picker: one step left/right, wrapping at both ends. */
  moveStrip(step: number): void {
    const n = this.strip.length
    this.stripIndex = (((this.stripIndex + step) % n) + n) % n
    this.drawStrip()
  }

  private onMenu(id: number): void {
    if (id === MENU.quit) return this.exit()
    if (this.page !== 'play') {
      if (id === MENU.back) this.goto('play')
      return
    }
    if (id === MENU.enter) this.submit()
    else if (id === MENU.backspace) this.backspace()
    else if (id === MENU.help) this.goto('help')
    else if (id === MENU.stats) this.goto('stats')
    else if (id === MENU.giveUp) this.giveUp()
  }

  private onListItem(label: string | null): void {
    if (label === null) return
    if (label === MORE || label === BACK) return this.swapList()
    if (this.locked) return
    if (label === DEL) return this.backspace()
    if (label === ENTER) return this.submit()
    if (/^[A-Z]$/.test(label)) this.type(label.toLowerCase())
  }

  type(letter: string): void {
    if (this.locked || this.round.typed.length >= WORD_LENGTH) return
    this.round = { ...this.round, typed: this.round.typed + letter }
    this.clearInvalidMessage()
    this.persistRound()
    this.drawBoard()
  }

  backspace(): void {
    if (this.locked || this.round.typed.length === 0) return
    this.round = { ...this.round, typed: this.round.typed.slice(0, -1) }
    this.clearInvalidMessage()
    this.persistRound()
    this.drawBoard()
  }

  submit(): void {
    if (this.locked) return
    const guess = this.round.typed
    if (guess.length < WORD_LENGTH) return this.showInvalid('NEED 5 LETTERS')
    if (!this.isValid(guess)) return this.showInvalid('NOT IN LIST')

    this.clearMessageTimer()
    this.message = null
    this.round = { ...this.round, guesses: [...this.round.guesses, guess], typed: '' }

    if (isWon(this.round)) return this.endRound(true)
    if (isLost(this.round)) return this.endRound(false)
    this.persistRound()
    this.drawPlay()
  }

  giveUp(): void {
    if (this.locked) return
    this.endRound(false)
  }

  // ───────────────────────────── round flow ─────────────────────────────

  private endRound(won: boolean): void {
    this.clearMessageTimer()
    this.locked = true
    this.stats = won ? applyWin(this.stats, this.round.guesses.length) : applyLoss(this.stats)
    this.message = won ? { kind: 'win', guesses: this.round.guesses.length } : { kind: 'loss', answer: this.round.target }
    // Stats first; the finished round is cleared only by the next deal.
    const stats = this.stats
    void this.writes.run(() => this.storage.saveStats(stats))
    this.drawPlay()
    this.messageTimer = this.timers.set(
      () => {
        this.messageTimer = null
        this.nextRound()
      },
      won ? TIMING.winMs : TIMING.lossMs,
    )
  }

  nextRound(): void {
    this.lastAnswer = this.round.target
    this.deck = advance(this.words, this.deck, this.seed)
    this.round = { target: wordAt(this.words, this.deck), guesses: [], typed: '' }
    this.message = null
    this.locked = false
    this.persistDeck()
    this.persistRound()
    this.drawPlay()
  }

  private showInvalid(text: string): void {
    this.clearMessageTimer()
    this.message = { kind: 'invalid', text }
    this.drawBoard()
    this.messageTimer = this.timers.set(() => {
      this.messageTimer = null
      if (this.message?.kind === 'invalid') {
        this.message = null
        this.drawBoard()
      }
    }, TIMING.invalidMs)
  }

  private clearInvalidMessage(): void {
    if (this.message?.kind !== 'invalid') return
    this.clearMessageTimer()
    this.message = null
  }

  private clearMessageTimer(): void {
    if (this.messageTimer !== null) {
      this.timers.clear(this.messageTimer)
      this.messageTimer = null
    }
  }

  // ───────────────────────────── pages ─────────────────────────────

  private containersFor(page: PageName): PageContainers {
    if (page === 'help') return helpPage(this.settings)
    if (page === 'stats') return statsPage(this.stats)
    return playPage(this.listPage, this.settings)
  }

  goto(page: PageName): void {
    // Coming back to Play always shows list page A (a rebuilt list highlights index 0).
    if (page === 'play' && this.page !== 'play') this.listPage = 'A'
    this.page = page
    this.rebuild()
  }

  private rebuild(): void {
    const page = this.page
    const containers = this.containersFor(page)
    void this.queue
      .op(async () => {
        const ok = await this.host.rebuildPage(containers)
        if (!ok) console.warn('[wordlens] rebuildPageContainer failed for', page)
      })
      .catch((err) => console.warn('[wordlens] rebuild threw', err))
    this.redrawCurrentPage()
  }

  private swapList(): void {
    if (this.horizontal) return
    this.listPage = this.listPage === 'A' ? 'B' : 'A'
    // Lists cannot be updated in place: rebuild, then re-send both images.
    this.rebuild()
  }

  private redrawCurrentPage(): void {
    if (this.page === 'play') this.drawPlay()
    else if (this.page === 'help') {
      this.queue.image({ containerID: IDS.help.image, containerName: NAMES.helpImage }, () => encodePng(renderHelp()))
    } else if (this.page === 'stats') {
      const { dist, last } = this.stats
      this.queue.image({ containerID: IDS.stats.chart, containerName: NAMES.statsChart }, () =>
        encodePng(renderDistribution(dist, last)),
      )
    }
  }

  private exit(): void {
    void this.host.shutDown(1)
  }

  // ───────────────────────────── drawing ─────────────────────────────

  private drawBoard(): void {
    if (this.page !== 'play') return
    this.queue.image({ containerID: IDS.play.board, containerName: NAMES.board }, () =>
      encodePng(renderBoard(this.round, this.message)),
    )
  }

  private drawKeys(): void {
    if (this.page !== 'play') return
    this.queue.image({ containerID: IDS.play.keys, containerName: NAMES.keys }, () =>
      encodePng(renderKeys(keyMarks(this.round.guesses, this.round.target), this.stats)),
    )
  }

  private drawStrip(): void {
    if (this.page !== 'play' || !this.horizontal) return
    this.queue.image({ containerID: IDS.play.strip, containerName: NAMES.strip }, () =>
      encodePng(renderStrip(this.strip, this.stripIndex)),
    )
  }

  private drawPlay(): void {
    this.drawBoard()
    this.drawKeys()
    this.drawStrip()
  }

  // ───────────────────────────── persistence ─────────────────────────────

  private persistRound(): void {
    const r = this.round
    void this.writes.run(() => this.storage.saveRound(r))
  }

  private persistDeck(): void {
    const d = this.deck
    const last = this.lastAnswer
    void this.writes.run(() => this.storage.saveDeck(d, last))
  }

  /** For tests: wait for queued frames, rebuilds and storage writes. */
  async settle(): Promise<void> {
    await this.queue.idle()
    await this.writes.idle()
  }
}

