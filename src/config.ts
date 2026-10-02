/** Container IDs, settings, list pages and menu IDs shared by pages and input handling. */

// ─────────────────────────── Settings: edit these ───────────────────────────

export interface Settings {
  /**
   * Which side the guess board sits on. 'right' keeps it visible while the OS
   * contextual menu (which opens over the left side) is showing.
   */
  boardSide: 'left' | 'right'
  /** Letter order in the picker: most frequent first, or A–Z. */
  letterOrder: 'frequency' | 'alphabetical'
  /**
   * 'keyboard': a QWERTY keyboard with ENTER and DEL, letters as firmware text over key frames; swipes walk
   * the keys (~60 ms each, no image send) and it shows the letter marks.
   * 'vertical': the native list (firmware-drawn, 20-item limit, so letters span two pages).
   * 'horizontal': a drawn carousel; swipes move left/right through all 28 items, no pages.
   */
  picker: 'keyboard' | 'vertical' | 'horizontal'
}

export const DEFAULT_SETTINGS: Settings = {
  boardSide: 'right',
  letterOrder: 'alphabetical',
  picker: 'keyboard',
}

// ────────────────────────────────────────────────────────────────────────────

export const IDS = {
  play: { board: 1, keys: 2, list: 3, strip: 4, capture: 5, kbLeft: 6, kbRight: 7, kbText: 8 },
  help: { image: 1, text: 2 },
  stats: { text: 1, chart: 2 },
} as const

export const NAMES = {
  board: 'board',
  keys: 'keys',
  list: 'letters',
  strip: 'strip',
  capture: 'capture',
  kbLeft: 'kb-left',
  kbRight: 'kb-right',
  kbText: 'kb-text',
  helpImage: 'help-img',
  helpText: 'help-text',
  statsText: 'stats-text',
  statsChart: 'stats-chart',
} as const

// Labels are plain ASCII: glyphs missing from the firmware font are dropped silently.
export const DEL = 'DEL'
export const ENTER = 'ENTER'
export const MORE = 'MORE >>'
export const BACK = '<< BACK'

const FREQUENCY = 'EAROTLISNCUYDHPMGBFKWVZXQJ'
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function letters(order: Settings['letterOrder']): string[] {
  return (order === 'alphabetical' ? ALPHABET : FREQUENCY).split('')
}

export type ListPage = 'A' | 'B'

/** Letters on native-list page A. With DEL, ENTER and MORE >> that is exactly the 20-item limit. */
const PAGE_A_LETTERS = 17

/**
 * Native-list pages. Native lists hold at most 20 items, so letters are split
 * across two pages. A rebuilt list always highlights index 0.
 */
export function listPages(order: Settings['letterOrder']): Record<ListPage, string[]> {
  const ls = letters(order)
  return {
    A: [DEL, ENTER, ...ls.slice(0, PAGE_A_LETTERS), MORE],
    B: [DEL, ENTER, ...ls.slice(PAGE_A_LETTERS), BACK],
  }
}

/** Horizontal carousel items: everything on one strip, wrapping at both ends. */
export function stripItems(order: Settings['letterOrder']): string[] {
  return [DEL, ENTER, ...letters(order)]
}

export const MENU = {
  enter: 1,
  help: 2,
  stats: 3,
  giveUp: 4,
  quit: 5,
  back: 6,
  backspace: 7,
} as const

/**
 * Vertical picker only: swap list pages when the firmware reports scrolling
 * past a list edge. On hardware the list edges do not emit those events, so
 * this stays off. Pages change with MORE >> and << BACK.
 */
export const EDGE_SCROLL_SWAPS_PAGES = false

export const TIMING = {
  /** How long the right-hand strip keeps a message before the next action. */
  invalidMs: 3600,
  winMs: 4500,
  lossMs: 7500,
  imageGapMs: 100,
  imageRetryMs: 300,
} as const
