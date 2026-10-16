/**
 * Push-to-talk state and the text of the voice panel. Pure.
 *
 * The panel is a firmware text box over the board's message strip (pages.ts, voicePanel), always on the
 * page: every change (listening → one moment → the choices, and each focus move) is a ~60 ms text update,
 * with no rebuild and no image. Image frames lag behind fast swipes, which made it easy to confirm the wrong
 * word; text keeps the focus where the swipes put it, as on the text keyboard.
 *
 * The strip is 144 px tall: five 27 px lines, so at most four choices plus CANCEL, and short lines.
 */
import { textFrame, type TextFrame } from '../textframe'
import { candidateLabel, type Candidate } from './candidates'

/** Choosing: `index` runs over the candidates plus a trailing CANCEL. */
export type VoicePhase =
  | { phase: 'idle' }
  | { phase: 'listening' }
  | { phase: 'thinking' }
  | { phase: 'choosing'; items: Candidate[]; index: number }
  /** Nothing usable heard (or no mic): the panel says so until a tap, a new hold or a timeout. */
  | { phase: 'message'; text: string }

export const CANCEL = 'CANCEL'

/** Same marks as the text keyboard: fullwidth brackets around the focus, an ideographic space of equal width elsewhere. */
const FOCUS_L = '［'
const FOCUS_R = '］'
const PAD = '　'

/**
 * Text spinners: a line of three dots, one frame per text update. Only glyphs the G2 firmware font has
 * (checked in the simulator, which drops unknown glyphs like the firmware): ● and ○ are in it; braille
 * spinners, quadrant blocks and ◓ ◒ are not. Listening bounces a dot like a level meter; thinking fills up.
 */
export const SPINNERS = {
  listening: ['●○○', '○●○', '○○●', '○●○'],
  thinking: ['○○○', '●○○', '●●○', '●●●'],
} as const

/** The spinner frame for a phase (frames wrap). */
export function spinnerFrame(kind: keyof typeof SPINNERS, frame: number): string {
  const frames = SPINNERS[kind]
  return frames[((frame % frames.length) + frames.length) % frames.length]
}

/** The panel's frame (textframe.ts): five rows, for the five lines of words laid over it. */
export const FRAME = { rows: 5 } as const

const BLANK_FRAME: TextFrame = { a: ' ', b: ' ' }

/** @param cells inner width in 20 px cells (the panel is wider on the left than in the strip). */
export function panelFrame(open: boolean, cells: number): TextFrame {
  return open ? textFrame(cells, FRAME.rows) : BLANK_FRAME
}

/** One line per choice, in list order, with the focused one bracketed. */
export function choiceLines(labels: readonly string[], index: number): string[] {
  return labels.map((l, i) => (i === index ? `${FOCUS_L}${l}${FOCUS_R}` : `${PAD}${l}`))
}

/**
 * What the always-on card (keyboard layout) says between holds: only what hold does, centred in its five
 * lines. Swiping and tapping need no explaining; the marks and full gestures are on the Help page.
 */
export function idleCardText(hold: 'delete' | 'talk'): string {
  return (hold === 'talk'
    ? ['', 'HOLD TO TALK', 'Say a word, or spell it', '(alpha, bravo...)']
    : ['', '', 'TAP TO TYPE', 'Hold to delete']
  ).join('\n')
}

/**
 * @param frame spinner frame, advanced by the controller while listening or thinking.
 * @param idle what the panel holds between holds (blank in the strip, the card hint on the left).
 */
export function modalText(v: VoicePhase, frame = 0, idle = ' '): string {
  switch (v.phase) {
    case 'idle':
      return idle
    case 'listening':
      return ['LISTENING', spinnerFrame('listening', frame), 'Say it, then', 'let go.'].join('\n')
    case 'thinking':
      return ['THINKING', spinnerFrame('thinking', frame), 'Hang on.'].join('\n')
    case 'choosing':
      return choiceLines([...v.items.map(candidateLabel), CANCEL], v.index).join('\n')
    case 'message':
      return [v.text, 'Hold: retry', 'Tap: close'].join('\n')
  }
}
