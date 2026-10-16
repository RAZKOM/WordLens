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
import { CommandQueue, type ImageSend, type Sleep, type TextSend } from './imageQueue'
import { parseEvent, resolveListItem, type Input, type RawEvent } from './input'
import { controlsShown, helpPage, panelSpot, playMenu, playPage, statsPage, voiceUsable, type PageContainers, type PageName } from './pages'
import { CONTROLS, controlsRow, letterStatus, stepControl } from './controls'
import { renderBoard, type Message } from './render/board'
import { renderDistribution } from './render/chart'
import { renderStrip } from './render/strip'
import { renderHelp } from './render/help'
import { renderInfo } from './render/info'
import { renderKeys } from './render/keys'
import { encodePng } from './render/png'
import { Storage, WriteChain, type KeyValueStore } from './storage'
import { KB_KEYS, drawnByImage, kbHalf, kbText, renderKbBand } from './textkb'
import { TARGETS, isValidGuess } from './words'
import { buildCandidates, type Candidate } from './voice/candidates'
import { idleCardText, modalText, panelFrame, type VoicePhase } from './voice/modal'
import type { VoiceInput } from './voice/session'

export interface Host {
  createPage(c: PageContainers): Promise<boolean>
  rebuildPage(c: PageContainers): Promise<boolean>
  sendImage: ImageSend
  /** Text container content (keyboard mode). */
  updateText: TextSend
  shutDown(mode: 0 | 1): Promise<boolean>
  kv: KeyValueStore
  /** Push-to-talk input; without it the hold toggle is not offered and hold always deletes. */
  voice?: VoiceInput
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
  /** Keyboard picker focus (index into KB_KEYS); starts on Q. */
  kbFocus = 0
  /** Keyboard text the glasses show now (set by a page build or a sent update). */
  private kbShown = ''
  private kbPending = false
  voice: VoicePhase = { phase: 'idle' }
  /** Bumped by every new hold or cancel, so late results from an older clip are dropped. */
  private voiceTicket = 0
  private voiceTimer: unknown = null
  /** Spinner on the voice panel while listening or thinking: a frame counter and its tick. */
  private spinFrame = 0
  private spinTimer: unknown = null
  /** True when the caller fixed `hold` (URL parameter): the saved menu choice does not override it. */
  private readonly holdPinned: boolean
  private readonly keysPinned: boolean
  /** ENTER / DEL controls focus (index into CONTROLS); starts on ENTER. */
  ctrlFocus = 0
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
    this.holdPinned = opts.settings?.hold !== undefined
    this.keysPinned = opts.settings?.keys !== undefined
    this.timers = opts.timers ?? realTimers
    this.seed = opts.seed ?? randomSeed
    this.words = opts.words ?? TARGETS
    this.isValid = opts.isValid ?? isValidGuess
    this.storage = new Storage(host.kv)
    this.queue = new CommandQueue(host.sendImage, {
      gapMs: TIMING.imageGapMs,
      retryMs: TIMING.imageRetryMs,
      sleep: opts.sleep,
      sendText: (t, c) => host.updateText(t, c),
    })
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  async start(): Promise<void> {
    const saved = await this.storage.load()
    this.stats = saved.stats
    this.lastAnswer = saved.lastAnswer
    if (saved.hold && !this.holdPinned) this.settings.hold = saved.hold
    if (saved.keys && !this.keysPinned) this.settings.keys = saved.keys
    // Unpacking the model takes a while the first time: start before the first hold.
    if (this.talkMode) this.host.voice?.prepare()
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
      const page = this.containersFor('play')
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
        this.cancelVoice()
        this.exit()
        return
      case 'menu':
        this.cancelVoice()
        this.onMenu(input.itemID)
        return
      case 'foregroundEnter':
        // Fired around contextual-menu open/close too; re-sending is harmless.
        this.redrawCurrentPage()
        return
      case 'exit':
        this.clearMessageTimer()
        this.cancelVoice()
        return
      case 'tap':
        if (this.page !== 'play') this.goto('play')
        else if (this.voice.phase === 'choosing') this.acceptChoice()
        else if (this.voice.phase === 'message') this.closeVoice()
        else if (this.modalOpen) return
        else if (this.controlsMode) this.onListItem(CONTROLS[this.ctrlFocus])
        else if (this.keyboard) this.onListItem(KB_KEYS[this.kbFocus].label)
        else if (this.horizontal) this.onListItem(this.strip[this.stripIndex])
        return
      case 'longPress':
        if (this.page !== 'play') return
        if (this.talkMode) this.startTalk()
        else this.backspace()
        return
      case 'longPressRelease':
        if (this.voice.phase === 'listening') this.stopTalk()
        return
      case 'listSelect':
        if (this.page !== 'play' || this.horizontal || this.keyboard) return
        this.onListItem(resolveListItem(this.listItems, input.index, input.name))
        return
      case 'scrollBottom':
      case 'scrollTop':
        if (this.page !== 'play') return
        if (this.voice.phase === 'choosing') this.moveChoice(input.kind === 'scrollBottom' ? 1 : -1)
        else if (this.modalOpen) return // listening, decoding or a message: a swipe must not move the keys
        else if (this.controlsMode) this.moveCtrl(input.kind === 'scrollBottom' ? 1 : -1)
        else if (this.keyboard) this.moveKb(input.kind === 'scrollBottom' ? 1 : -1)
        else if (this.horizontal) this.moveStrip(input.kind === 'scrollBottom' ? 1 : -1)
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

  private get keyboard(): boolean {
    return this.settings.picker === 'keyboard'
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

  /** Keyboard picker: one key along, wrapping through all rows. Costs a text update, no image. */
  moveKb(step: number): void {
    const n = KB_KEYS.length
    this.kbFocus = (((this.kbFocus + step) % n) + n) % n
    this.drawKbText()
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
    else if (id === MENU.hold) this.toggleHold()
    else if (id === MENU.keys) this.toggleKeys()
  }

  // ───────────────────────────── ENTER / DEL controls ─────────────────────────────

  /** The bottom band shows ENTER / DEL instead of the keyboard (see controlsShown). */
  get controlsMode(): boolean {
    return controlsShown(this.settings, this.host.voice !== undefined)
  }

  toggleKeys(): void {
    if (!this.talkMode || !this.keyboard) return
    const keys = this.settings.keys === 'controls' ? 'full' : 'controls'
    this.settings.keys = keys
    void this.writes.run(() => this.storage.saveKeys(keys))
    // The bottom band changes containers (keyboard images ↔ text box), and the menu names the other choice.
    this.rebuild()
  }

  /** One step along ENTER, DEL, CLEAR: a text update to the controls row, no image. */
  moveCtrl(step: number): void {
    this.ctrlFocus = stepControl(this.ctrlFocus, step)
    if (this.page !== 'play') return
    const row = controlsRow(this.ctrlFocus)
    this.queue.text({ containerID: IDS.play.ctrlText, containerName: NAMES.ctrlText }, () => row)
  }

  private lettersShown = ''

  private currentLetters(): string {
    return letterStatus(keyMarks(this.round.guesses, this.round.target))
  }

  /** Controls mode: the alphabet and its marks, sent only when a guess changed them. */
  private drawLetters(): void {
    if (this.page !== 'play' || !this.controlsMode) return
    const next = this.currentLetters()
    if (next === this.lettersShown) return
    this.lettersShown = next
    this.queue.text({ containerID: IDS.play.ctrlLetters, containerName: NAMES.ctrlLetters }, () => next)
  }

  /** CLEAR: empty the row being typed. */
  clearRow(): void {
    if (this.locked || this.round.typed.length === 0) return
    this.round = { ...this.round, typed: '' }
    this.clearInvalidMessage()
    this.persistRound()
    this.drawBoard()
  }

  // ───────────────────────────── push-to-talk ─────────────────────────────

  /** Hold talks (rather than deletes): chosen, and possible with this host and picker. */
  get talkMode(): boolean {
    return this.settings.hold === 'talk' && this.hasVoice
  }

  private get hasVoice(): boolean {
    return voiceUsable(this.settings, this.host.voice !== undefined)
  }

  /** Push-to-talk is under way (any phase but idle): the voice panel shows it. */
  get modalOpen(): boolean {
    return this.voice.phase !== 'idle'
  }

  toggleHold(): void {
    if (!this.hasVoice) return
    const hold = this.settings.hold === 'talk' ? 'delete' : 'talk'
    this.settings.hold = hold
    void this.writes.run(() => this.storage.saveHold(hold))
    if (hold === 'talk') this.host.voice?.prepare()
    // The menu names the other choice, so the page is rebuilt with the new menu.
    this.rebuild()
  }

  /** Hold started: open the mic and the voice panel. A hold while the panel is up (choosing, a miss) starts over. */
  startTalk(): void {
    const voice = this.host.voice
    if (this.locked || !voice) return
    const wasOpen = this.modalOpen
    if (wasOpen) {
      this.voiceTicket++
      voice.cancel()
      this.clearVoiceTimer()
    }
    const ticket = ++this.voiceTicket
    this.clearInvalidMessage()
    this.setVoice({ phase: 'listening' })
    this.voiceTimer = this.timers.set(() => {
      this.voiceTimer = null
      if (ticket === this.voiceTicket && this.voice.phase === 'listening') this.stopTalk()
    }, TIMING.talkMaxMs)
    voice.start().then(
      (ok) => {
        if (ok || ticket !== this.voiceTicket || this.voice.phase === 'idle') return
        this.voiceFailed('NO MIC')
      },
      (err) => {
        console.warn('[wordlens] voice start failed', err)
        if (ticket === this.voiceTicket && this.modalOpen) this.voiceFailed('NO MIC')
      },
    )
  }

  /** Hold released (or timed out): decode, then list the choices. */
  stopTalk(): void {
    const voice = this.host.voice
    if (!voice || this.voice.phase !== 'listening') return
    const ticket = this.voiceTicket
    this.clearVoiceTimer()
    this.setVoice({ phase: 'thinking' })
    voice.stop(this.round.typed.length).then(
      (heard) => {
        if (ticket !== this.voiceTicket || this.voice.phase !== 'thinking') return
        const items = heard ? buildCandidates(heard, this.round.typed) : []
        if (items.length === 0) return this.voiceFailed('MISSED IT')
        this.setVoice({ phase: 'choosing', items, index: 0 })
      },
      (err) => {
        console.warn('[wordlens] voice recognition failed', err)
        if (ticket === this.voiceTicket && this.voice.phase === 'thinking') this.voiceFailed('NO VOICE')
      },
    )
  }

  /** One step through the choices (wrapping through CANCEL): a text update, no image. */
  moveChoice(step: number): void {
    if (this.voice.phase !== 'choosing') return
    const n = this.voice.items.length + 1
    this.setVoice({ ...this.voice, index: (((this.voice.index + step) % n) + n) % n })
  }

  /** Tap on a choice: a word fills the row and is guessed; letters are added to the row; CANCEL drops it. */
  acceptChoice(): void {
    if (this.voice.phase !== 'choosing') return
    const choice: Candidate | undefined = this.voice.items[this.voice.index]
    this.closeVoice()
    if (!choice || this.locked) return
    if (choice.kind === 'word') {
      this.round = { ...this.round, typed: choice.word }
      this.persistRound()
      this.submit() // draws the guess, or the row with a NOT IN LIST message
      return
    }
    for (const letter of choice.letters) this.type(letter)
  }

  /** Drop any recording, decode or choice list, and clear the panel. */
  cancelVoice(): void {
    if (!this.modalOpen) return
    this.voiceTicket++
    this.host.voice?.cancel()
    this.closeVoice()
  }

  /** Clear the panel (a text update) and its frame (the board). The keys never left. */
  private closeVoice(): void {
    this.clearVoiceTimer()
    this.setVoice({ phase: 'idle' })
  }

  /** Say what went wrong in the panel; it clears on a tap, a new hold, or after a while. */
  private voiceFailed(text: string): void {
    this.host.voice?.cancel()
    this.clearVoiceTimer()
    const ticket = this.voiceTicket
    this.setVoice({ phase: 'message', text })
    this.voiceTimer = this.timers.set(() => {
      this.voiceTimer = null
      if (ticket === this.voiceTicket && this.voice.phase === 'message') this.closeVoice()
    }, TIMING.invalidMs)
  }

  /**
   * New voice state: a text update to the panel's words, plus its frame (two more text updates) when it
   * opens or closes. No image and no rebuild, ever.
   */
  private setVoice(next: VoicePhase): void {
    const wasOpen = this.modalOpen
    const phaseChanged = next.phase !== this.voice.phase
    this.voice = next
    if (phaseChanged) this.syncSpinner()
    this.drawModalText()
    if (wasOpen !== this.modalOpen) this.drawModalFrame()
  }

  /** Run the spinner while listening or thinking, from its first frame; stop it otherwise. */
  private syncSpinner(): void {
    if (this.spinTimer !== null) {
      this.timers.clear(this.spinTimer)
      this.spinTimer = null
    }
    this.spinFrame = 0
    if (this.voice.phase !== 'listening' && this.voice.phase !== 'thinking') return
    const tick = () => {
      this.spinTimer = null
      if (this.voice.phase !== 'listening' && this.voice.phase !== 'thinking') return
      this.spinFrame++
      this.drawModalText()
      this.spinTimer = this.timers.set(tick, TIMING.spinnerMs)
    }
    this.spinTimer = this.timers.set(tick, TIMING.spinnerMs)
  }

  private clearVoiceTimer(): void {
    if (this.voiceTimer !== null) {
      this.timers.clear(this.voiceTimer)
      this.voiceTimer = null
    }
  }

  /** Frame on or off (strip panel only: the card's frame never changes). */
  private drawModalFrame(): void {
    if (this.page !== 'play' || !this.hasVoice) return
    const spot = panelSpot(this.settings)
    if (spot.persistent) return
    const open = this.modalOpen
    const frame = panelFrame(open, spot.cells)
    this.queue.text({ containerID: IDS.play.voiceFrame, containerName: NAMES.voiceFrame }, () => frame.a)
    this.queue.text({ containerID: IDS.play.voiceFrameB, containerName: NAMES.voiceFrameB }, () => frame.b)
  }

  /** Panel words: the voice state, or between holds the card hint (or nothing, in the strip). */
  private panelText(): string {
    const idle = panelSpot(this.settings).persistent ? idleCardText(this.talkMode ? 'talk' : 'delete') : ' '
    return modalText(this.voice, this.spinFrame, idle)
  }

  private drawModalText(): void {
    if (this.page !== 'play' || !this.hasVoice) return
    this.queue.text({ containerID: IDS.play.voice, containerName: NAMES.voice }, () => this.panelText())
  }

  private onListItem(label: string | null): void {
    if (label === null) return
    if (label === MORE || label === BACK) return this.swapList()
    if (this.locked) return
    if (label === DEL) return this.backspace()
    if (label === ENTER) return this.submit()
    if (label === 'CLEAR') return this.clearRow()
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
    const voice = this.host.voice !== undefined
    if (page === 'help') return helpPage(this.settings, voice)
    if (page === 'stats') return statsPage(this.stats)
    const menu = playMenu(this.settings, voice)
    const panel = this.hasVoice ? { content: this.panelText(), open: this.modalOpen } : undefined
    if (this.controlsMode) {
      this.lettersShown = this.currentLetters()
      return playPage(this.listPage, this.settings, undefined, menu, panel, { focus: this.ctrlFocus, letters: this.lettersShown })
    }
    if (!this.keyboard) return playPage(this.listPage, this.settings, undefined, menu, panel)
    // The page is created with the current keyboard text, so it needs no update after the build.
    this.kbShown = this.currentKbText()
    return playPage(this.listPage, this.settings, this.kbShown, menu, panel)
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
    if (this.keyboard) {
      // The info image takes the keys slot; the marks are on the keyboard below.
      this.queue.image({ containerID: IDS.play.keys, containerName: NAMES.keys }, () => encodePng(renderInfo(this.stats, this.hasVoice ? 'card' : 'guide')))
      if (this.controlsMode) return this.drawLetters() // ENTER / DEL / CLEAR are text, built with the page
      const band = () => renderKbBand(keyMarks(this.round.guesses, this.round.target))
      this.queue.image({ containerID: IDS.play.kbLeft, containerName: NAMES.kbLeft }, () => encodePng(kbHalf(band(), 'left')))
      this.queue.image({ containerID: IDS.play.kbRight, containerName: NAMES.kbRight }, () => encodePng(kbHalf(band(), 'right')))
      this.drawKbText()
      return
    }
    this.queue.image({ containerID: IDS.play.keys, containerName: NAMES.keys }, () =>
      encodePng(renderKeys(keyMarks(this.round.guesses, this.round.target), this.stats)),
    )
  }

  private currentKbText(): string {
    return kbText(this.kbFocus, drawnByImage(keyMarks(this.round.guesses, this.round.target)))
  }

  /** Sends the keyboard text if it changed (focus moved, or a guess blanked letters the image now draws). */
  private drawKbText(): void {
    if (this.page !== 'play' || !this.keyboard || this.controlsMode) return
    if (!this.kbPending && this.currentKbText() === this.kbShown) return
    this.kbPending = true
    this.queue.text({ containerID: IDS.play.kbText, containerName: NAMES.kbText }, () => {
      this.kbPending = false
      this.kbShown = this.currentKbText()
      return this.kbShown
    })
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

