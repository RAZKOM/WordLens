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

export function playPage(listPage: ListPage, settings: Settings): PageContainers {
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
    return {
      containerTotalNum: 4,
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
      ],
      menuObject: { menuItems: PLAY_MENU },
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
    menuObject: { menuItems: PLAY_MENU },
  }
}

export function helpText(settings: Settings): string {
  const picking =
    settings.picker === 'horizontal'
      ? ['Swipe to move along the letters, tap to type. Hold to delete.', 'Pick ENTER to guess. Menu: tap, then hold.']
      : ['Swipe to pick a letter, tap to type it. Hold to delete.', 'More letters: MORE >>.  Menu: tap, then hold.']
  return [...picking, 'Tap to go back. Double-tap to exit.'].join('\n')
}

export function helpPage(settings: Settings): PageContainers {
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
        paddingLength: 8,
        containerID: IDS.help.text,
        containerName: NAMES.helpText,
        content: helpText(settings),
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
