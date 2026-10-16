/**
 * Container layouts for each page, as plain objects in the SDK's shape.
 * Every page: ≤4 images, ≤8 others, exactly one isEventCapture: 1, a unique
 * zOrderIndex on every container, and a menuObject (omitting it on rebuild
 * clears the custom menu).
 */
import { IDS, MENU, NAMES, listPages, type ListPage, type Settings } from './config'
import { winRate, type Stats } from './game'
import { CANVAS_H, CANVAS_W, IMAGE_H, IMAGE_W } from './render/layout'
import { STRIP_IMG } from './render/strip'
import { KB, kbText } from './textkb'
import { FRAME, panelFrame } from './voice/modal'
import { CELL, HALF_LINE, LINE, frameBoxHeight } from './textframe'
import { CONTROLS_CELLS, controlsFrame, controlsRow } from './controls'

export type PageName = 'play' | 'help' | 'stats'

export interface MenuItem {
  itemID: number
  itemName: string
}

export interface PageContainers {
  containerTotalNum: number
  listObject?: Array<Record<string, unknown>>
  textObject?: Array<Record<string, unknown>>
  imageObject?: Array<Record<string, unknown>>
  menuObject: { menuItems: MenuItem[] }
}

const PLAY_MENU: MenuItem[] = [
  { itemID: MENU.enter, itemName: 'Enter guess' },
  { itemID: MENU.backspace, itemName: 'Backspace' },
  { itemID: MENU.help, itemName: 'Help' },
  { itemID: MENU.stats, itemName: 'Stats' },
  { itemID: MENU.giveUp, itemName: 'Give up' },
  { itemID: MENU.quit, itemName: 'Quit' },
]

/** Can push-to-talk be used? Needs voice input, and a picker that can step through the choices with swipes. */
export function voiceUsable(settings: Settings, hasVoice: boolean): boolean {
  return hasVoice && settings.picker !== 'vertical'
}

/** ENTER / DEL controls instead of the keyboard: chosen, keyboard picker, and push-to-talk on (letters by voice). */
export function controlsShown(settings: Settings, hasVoice: boolean): boolean {
  return settings.keys === 'controls' && settings.picker === 'keyboard' && settings.hold === 'talk' && voiceUsable(settings, hasVoice)
}

/**
 * Play menu; with voice, toggles (each named for what it switches to) sit after Backspace: hold talk/delete,
 * and with push-to-talk on the keyboard picker, full keyboard / ENTER and DEL only.
 */
export function playMenu(settings: Settings, hasVoice: boolean): MenuItem[] {
  if (!voiceUsable(settings, hasVoice)) return PLAY_MENU
  const toggles: MenuItem[] = [{ itemID: MENU.hold, itemName: settings.hold === 'talk' ? 'Hold to delete' : 'Hold to talk' }]
  if (settings.picker === 'keyboard' && settings.hold === 'talk') {
    toggles.push({ itemID: MENU.keys, itemName: settings.keys === 'controls' ? 'Full keyboard' : 'Enter and Del only' })
  }
  return [...PLAY_MENU.slice(0, 2), ...toggles, ...PLAY_MENU.slice(2)]
}

/**
 * The bottom band in controls mode (see controls.ts): the controls box, a blank one-row frame (two boxes)
 * with the row in its own box, and under it the alphabet with its marks. The frame's edges are drawn ~14 px
 * and ~54 px below its top, so it starts below the card (whose bottom edge is at ~170 px); caps sit ~6 px
 * into a line and are ~18 px tall, so the row's box starts ~20 px down (measured: 11 px above and below the
 * caps). The alphabet's two lines (letters, marks) end above 288.
 */
export const CONTROLS_BOX = { top: 166, rowTop: 20, lettersTop: 224 } as const

export function controlsBoxes(focus: number, letters: string, zOrderIndex: number): Array<Record<string, unknown>> {
  const w = (CONTROLS_CELLS + 2) * CELL
  const x = Math.round((CANVAS_W - w) / 2)
  const y = CONTROLS_BOX.top
  const lettersW = 26 * CELL
  const f = controlsFrame()
  const box = (id: number, name: string, yPosition: number, content: string, z: number, xPosition = x, width = w + 6) => ({
    xPosition,
    yPosition,
    width,
    height: frameBoxHeight(1),
    borderWidth: 0,
    paddingLength: 0,
    containerID: id,
    containerName: name,
    content,
    isEventCapture: 0,
    zOrderIndex: z,
  })
  return [
    box(IDS.play.ctrl, NAMES.ctrl, y, f.a, zOrderIndex),
    box(IDS.play.ctrlB, NAMES.ctrlB, y + HALF_LINE, f.b, zOrderIndex + 1),
    box(IDS.play.ctrlText, NAMES.ctrlText, y + CONTROLS_BOX.rowTop, controlsRow(focus), zOrderIndex + 2, x + CELL, CONTROLS_CELLS * CELL + 6),
    {
      ...box(IDS.play.ctrlLetters, NAMES.ctrlLetters, CONTROLS_BOX.lettersTop, letters, zOrderIndex + 3, Math.round((CANVAS_W - lettersW) / 2), lettersW + 6),
      height: CANVAS_H - CONTROLS_BOX.lettersTop,
    },
  ]
}

const SUB_MENU: MenuItem[] = [
  { itemID: MENU.back, itemName: 'Back to game' },
  { itemID: MENU.quit, itemName: 'Quit' },
]

/** x positions of the two top images for the chosen board side. */
export function topImageX(settings: Settings): { board: number; keys: number } {
  return settings.boardSide === 'right' ? { board: IMAGE_W, keys: 0 } : { board: 0, keys: IMAGE_W }
}

/** Strip placement for the horizontal picker: centred in the bottom band. */
export const STRIP_POS = {
  x: (CANVAS_W - STRIP_IMG.w) / 2,
  y: IMAGE_H + (CANVAS_H - IMAGE_H - STRIP_IMG.h) / 2,
} as const

/**
 * @param kbContent keyboard mode: the keyboard text to create the page with (focus and blanked letters), so
 *   a rebuild shows the current state without a text update.
 */
/**
 * Where the voice panel goes. Keyboard layout: a wide card in the info slot, under STREAK / BEST, always
 * framed (the marks and gestures it replaced are on the Help page). Horizontal layout: the info slot holds
 * the letter-status keyboard, so the panel sits in the board's blank message strip, framed only while open.
 */
export interface PanelSpot {
  x: number
  y: number
  /** Inner width in 20 px cells. */
  cells: number
  /** Framed even between holds (it then shows a hint). */
  persistent: boolean
}

export function panelSpot(settings: Settings): PanelSpot {
  const P = VOICE_PANEL
  const width = (cells: number) => (cells + 2) * CELL
  const x = topImageX(settings)
  if (settings.picker === 'keyboard') {
    return { x: x.keys + Math.round((IMAGE_W - width(P.wideCells)) / 2), y: P.cardTop, cells: P.wideCells, persistent: true }
  }
  return { x: x.board + IMAGE_W - width(P.stripCells) - P.right, y: 0, cells: P.stripCells, persistent: false }
}

/**
 * The voice panel, all text: a frame (two boxes, see textframe.ts) and the words inside it. Text boxes are
 * see-through and cannot be added or framed without a rebuild, so the three are always on the page. Opening,
 * every step and closing are then text updates: no rebuild and no image, and nothing else on screen moves.
 */
export function voicePanel(settings: Settings, content: string, open: boolean, zOrderIndex: number): Array<Record<string, unknown>> {
  const P = VOICE_PANEL
  const spot = panelSpot(settings)
  const frameW = (spot.cells + 2) * CELL
  const frame = panelFrame(open || spot.persistent, spot.cells)
  const box = (id: number, name: string, xPosition: number, yPosition: number, width: number, height: number, text: string, z: number) => ({
    xPosition,
    yPosition,
    width,
    height,
    borderWidth: 0,
    paddingLength: 0,
    containerID: id,
    containerName: name,
    content: text,
    isEventCapture: 0,
    zOrderIndex: z,
  })
  const frameH = frameBoxHeight(FRAME.rows)
  const { x, y } = spot
  return [
    box(IDS.play.voiceFrame, NAMES.voiceFrame, x, y, frameW + P.slack, frameH, frame.a, zOrderIndex),
    box(IDS.play.voiceFrameB, NAMES.voiceFrameB, x, y + HALF_LINE, frameW + P.slack, frameH, frame.b, zOrderIndex + 1),
    box(IDS.play.voice, NAMES.voice, x + CELL + P.textInset, y + P.textTop, spot.cells * CELL, FRAME.rows * LINE + P.slack, content, zOrderIndex + 2),
  ]
}

/**
 * Panel geometry, in px: where the words start inside the frame (the top edge is drawn mid-line, ~14 px
 * down), the gap to the screen edge (strip), the card's top (its edge then clears STREAK / BEST) and the
 * inner widths in cells.
 */
export const VOICE_PANEL = {
  textInset: 4,
  textTop: 18,
  right: 6,
  slack: 6,
  cardTop: 8,
  wideCells: 11,
  stripCells: 5,
} as const

/**
 * @param voice with push-to-talk available (keyboard and horizontal pickers): the voice panel's words and
 *   whether its frame shows, so the panel is part of the page; undefined leaves it out.
 */
export function playPage(
  listPage: ListPage,
  settings: Settings,
  kbContent = kbText(0),
  menuItems: MenuItem[] = PLAY_MENU,
  voice?: { content: string; open: boolean },
  controls?: { focus: number; letters: string },
): PageContainers {
  const x = topImageX(settings)
  const imageObject: Array<Record<string, unknown>> = [
    {
      xPosition: x.board,
      yPosition: 0,
      width: IMAGE_W,
      height: IMAGE_H,
      containerID: IDS.play.board,
      containerName: NAMES.board,
      zOrderIndex: 2,
    },
    {
      xPosition: x.keys,
      yPosition: 0,
      width: IMAGE_W,
      height: IMAGE_H,
      containerID: IDS.play.keys,
      containerName: NAMES.keys,
      zOrderIndex: 3,
    },
  ]

  if (settings.picker === 'keyboard' && controls) {
    // Bottom band: the ENTER / DEL box only, all text; the blank capture box under it takes the gestures.
    const panel = voice ? voicePanel(settings, voice.content, voice.open, 4) : []
    const textObject = [
      {
        xPosition: 0,
        yPosition: IMAGE_H,
        width: CANVAS_W,
        height: CANVAS_H - IMAGE_H,
        borderWidth: 0,
        paddingLength: 0,
        containerID: IDS.play.capture,
        containerName: NAMES.capture,
        content: ' ',
        isEventCapture: 1,
        zOrderIndex: 1,
      },
      ...controlsBoxes(controls.focus, controls.letters, 7),
      ...panel,
    ]
    return { containerTotalNum: imageObject.length + textObject.length, imageObject, textObject, menuObject: { menuItems } }
  }

  if (settings.picker === 'keyboard') {
    // Bottom band: two images with the key frames and marks; a blank text container under everything catches
    // swipes and taps (a capture box holding text would scroll and bounce on every swipe on G2), and the
    // keyboard text sits on top, sized to its 3 lines.
    imageObject.push(
      { xPosition: 0, yPosition: IMAGE_H, width: IMAGE_W, height: IMAGE_H, containerID: IDS.play.kbLeft, containerName: NAMES.kbLeft, zOrderIndex: 4 },
      { xPosition: IMAGE_W, yPosition: IMAGE_H, width: IMAGE_W, height: IMAGE_H, containerID: IDS.play.kbRight, containerName: NAMES.kbRight, zOrderIndex: 5 },
    )
    const panel = voice ? voicePanel(settings, voice.content, voice.open, 7) : []
    return {
      containerTotalNum: 6 + panel.length,
      imageObject,
      textObject: [
        {
          xPosition: 0,
          yPosition: IMAGE_H,
          width: CANVAS_W,
          height: CANVAS_H - IMAGE_H,
          borderWidth: 0,
          paddingLength: 0,
          containerID: IDS.play.capture,
          containerName: NAMES.capture,
          content: ' ',
          isEventCapture: 1,
          zOrderIndex: 1,
        },
        {
          xPosition: KB.boxX,
          yPosition: KB.boxY,
          width: KB.cols * KB.cell,
          height: CANVAS_H - KB.boxY,
          borderWidth: 0,
          paddingLength: 0,
          containerID: IDS.play.kbText,
          containerName: NAMES.kbText,
          content: kbContent,
          isEventCapture: 0,
          zOrderIndex: 6,
        },
        ...panel,
      ],
      menuObject: { menuItems },
    }
  }

  if (settings.picker === 'horizontal') {
    // A blank text container catches the swipes (each one arrives as a
    // SCROLL_TOP / SCROLL_BOTTOM textEvent) and taps (sysEvent); the carousel
    // itself is an image drawn above it.
    imageObject.push({
      xPosition: STRIP_POS.x,
      yPosition: STRIP_POS.y,
      width: STRIP_IMG.w,
      height: STRIP_IMG.h,
      containerID: IDS.play.strip,
      containerName: NAMES.strip,
      zOrderIndex: 4,
    })
    const panel = voice ? voicePanel(settings, voice.content, voice.open, 5) : []
    return {
      containerTotalNum: 4 + panel.length,
      imageObject,
      textObject: [
        {
          xPosition: 0,
          yPosition: IMAGE_H,
          width: CANVAS_W,
          height: CANVAS_H - IMAGE_H,
          borderWidth: 0,
          paddingLength: 0,
          containerID: IDS.play.capture,
          containerName: NAMES.capture,
          content: ' ',
          isEventCapture: 1,
          zOrderIndex: 1,
        },
        ...panel,
      ],
      menuObject: { menuItems },
    }
  }

  const items = listPages(settings.letterOrder)[listPage]
  return {
    containerTotalNum: 3,
    imageObject,
    listObject: [
      {
        xPosition: 0,
        yPosition: IMAGE_H,
        width: CANVAS_W,
        height: CANVAS_H - IMAGE_H,
        borderWidth: 0,
        paddingLength: 4,
        containerID: IDS.play.list,
        containerName: NAMES.list,
        isEventCapture: 1,
        zOrderIndex: 1,
        itemContainer: {
          itemCount: items.length,
          isItemSelectBorderEn: 1,
          itemName: items,
        },
      },
    ],
    menuObject: { menuItems },
  }
}

/**
 * Help page text (the marks are drawn large in the image above it). Five 27 px lines at most: the box is
 * 144 px tall with 4 px padding. Written for the current setup: push-to-talk or not, keyboard or the
 * ENTER / DEL / CLEAR controls, and the voice toggles in the menu.
 */
export function helpText(settings: Settings, hasVoice = false): string {
  const back = 'Tap to go back. Double-tap to exit.'
  if (settings.hold === 'talk' && voiceUsable(settings, hasVoice)) {
    const talk = ['Hold and say a word, or spell it (alpha, bravo...). Let go.', 'Swipe to what you meant, tap to confirm it.']
    if (controlsShown(settings, hasVoice)) {
      return [
        ...talk,
        'Swipe across ENTER, DEL and CLEAR; tap to press.',
        'Letters below: ● right spot  ○ wrong spot  ・ not in word.',
        back,
      ].join('\n')
    }
    const keys =
      settings.picker === 'keyboard'
        ? ['Swipe to walk the keys, tap to type. ENTER guesses.', 'Menu (tap, then hold): Enter and Del only, Hold to delete.']
        : ['Swipe along the letters, tap to type. ENTER guesses.', 'Menu (tap, then hold): Hold to delete, Help, Stats.']
    return [...talk, ...keys, back].join('\n')
  }
  const picking =
    settings.picker === 'keyboard'
      ? ['Swipe to walk the keys. Tap types. Hold deletes.', 'Tap ENTER to guess. Menu: tap then hold.']
      : settings.picker === 'horizontal'
      ? ['Swipe to move along the letters, tap to type. Hold to delete.', 'Pick ENTER to guess. Menu: tap, then hold.']
      : ['Swipe to pick a letter, tap to type it. Hold to delete.', 'More letters: MORE >>.  Menu: tap, then hold.']
  const voice = voiceUsable(settings, hasVoice) ? ['Talk instead of typing: Hold to talk, in the menu.'] : []
  return [...picking, ...voice, back].join('\n')
}

export function helpPage(settings: Settings, hasVoice = false): PageContainers {
  return {
    containerTotalNum: 2,
    imageObject: [
      {
        xPosition: (CANVAS_W - IMAGE_W) / 2,
        yPosition: 0,
        width: IMAGE_W,
        height: IMAGE_H,
        containerID: IDS.help.image,
        containerName: NAMES.helpImage,
        zOrderIndex: 2,
      },
    ],
    textObject: [
      {
        xPosition: 0,
        yPosition: IMAGE_H,
        width: CANVAS_W,
        height: CANVAS_H - IMAGE_H,
        borderWidth: 0,
        paddingLength: 4,
        containerID: IDS.help.text,
        containerName: NAMES.helpText,
        content: helpText(settings, hasVoice),
        isEventCapture: 1,
        zOrderIndex: 1,
      },
    ],
    menuObject: { menuItems: SUB_MENU },
  }
}

export function statsText(s: Stats): string {
  const rate = winRate(s)
  return [
    'STATS',
    `Streak: ${s.streak}`,
    `Best streak: ${s.best}`,
    `Played: ${s.played}`,
    `Wins: ${s.wins}`,
    `Win rate: ${rate === null ? '-' : `${rate}%`}`,
    '',
    'Tap to go back.',
    'Double-tap to exit.',
  ].join('\n')
}

/** Stats: numbers on the left, guess-distribution chart on the right. */
export function statsPage(s: Stats): PageContainers {
  return {
    containerTotalNum: 2,
    textObject: [
      {
        xPosition: 0,
        yPosition: 0,
        width: CANVAS_W - IMAGE_W,
        height: CANVAS_H,
        borderWidth: 0,
        paddingLength: 12,
        containerID: IDS.stats.text,
        containerName: NAMES.statsText,
        content: statsText(s),
        isEventCapture: 1,
        zOrderIndex: 1,
      },
    ],
    imageObject: [
      {
        xPosition: CANVAS_W - IMAGE_W,
        yPosition: (CANVAS_H - IMAGE_H) / 2,
        width: IMAGE_W,
        height: IMAGE_H,
        containerID: IDS.stats.chart,
        containerName: NAMES.statsChart,
        zOrderIndex: 2,
      },
    ],
    menuObject: { menuItems: SUB_MENU },
  }
}
