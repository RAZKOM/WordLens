/**
 * Turns raw `onEvenHubEvent` payloads into app-level inputs. Pure: no SDK
 * import, so it is unit-tested with plain objects.
 *
 * Rules (from the SDK, official templates and field notes):
 *  - CLICK_EVENT is 0 and protobuf omits zero values, so a tap arrives with
 *    `eventType` undefined. Resolve that default PER ENVELOPE, never across
 *    envelopes, or scroll/lifecycle events would fire the tap handler.
 *  - Match explicit types first; CLICK last.
 *  - `currentSelectItemIndex` 0 can also arrive missing.
 *  - Long press deletes one letter. The release is ignored so a hold does not
 *    delete twice. On the glasses that same hold also opens the OS menu.
 */

/** Mirrors OsEventTypeList (checked against the SDK enum in main.ts). */
export const EV = {
  CLICK: 0,
  SCROLL_TOP: 1,
  SCROLL_BOTTOM: 2,
  DOUBLE_CLICK: 3,
  FOREGROUND_ENTER: 4,
  FOREGROUND_EXIT: 5,
  ABNORMAL_EXIT: 6,
  SYSTEM_EXIT: 7,
  IMU: 8,
  LONG_PRESS: 9,
  LONG_PRESS_RELEASE: 10,
} as const

export type Input =
  | { kind: 'menu'; itemID: number }
  | { kind: 'doubleTap' }
  | { kind: 'listSelect'; index: number; name: string | null }
  | { kind: 'tap' }
  | { kind: 'longPress' }
  | { kind: 'scrollTop' }
  | { kind: 'scrollBottom' }
  | { kind: 'foregroundEnter' }
  | { kind: 'exit' }
  | { kind: 'ignore' }

interface Envelope {
  eventType?: number | null
  containerID?: number
  currentSelectItemIndex?: number
  currentSelectItemName?: string
}

export interface RawEvent {
  listEvent?: Envelope
  textEvent?: Envelope
  sysEvent?: Envelope
  menuItemClickEvent?: { itemID?: number }
}

function typeOf(env?: Envelope): number | null {
  if (!env) return null
  return env.eventType ?? EV.CLICK
}

export function parseEvent(e: RawEvent): Input {
  if (e.menuItemClickEvent) {
    const id = e.menuItemClickEvent.itemID
    return typeof id === 'number' && id > 0 ? { kind: 'menu', itemID: id } : { kind: 'ignore' }
  }

  const list = typeOf(e.listEvent)
  const text = typeOf(e.textEvent)
  const sys = typeOf(e.sysEvent)
  const any = (t: number) => list === t || text === t || sys === t

  if (any(EV.LONG_PRESS)) return { kind: 'longPress' }
  if (any(EV.LONG_PRESS_RELEASE)) return { kind: 'ignore' }
  if (any(EV.DOUBLE_CLICK)) return { kind: 'doubleTap' }
  if (sys === EV.SYSTEM_EXIT || sys === EV.ABNORMAL_EXIT) return { kind: 'exit' }
  if (sys === EV.FOREGROUND_ENTER) return { kind: 'foregroundEnter' }
  if (sys === EV.FOREGROUND_EXIT || sys === EV.IMU) return { kind: 'ignore' }
  if (any(EV.SCROLL_BOTTOM)) return { kind: 'scrollBottom' }
  if (any(EV.SCROLL_TOP)) return { kind: 'scrollTop' }

  if (e.listEvent && list === EV.CLICK) {
    const name = e.listEvent.currentSelectItemName
    return {
      kind: 'listSelect',
      index: e.listEvent.currentSelectItemIndex ?? 0,
      name: typeof name === 'string' && name.length > 0 ? name : null,
    }
  }
  if (text === EV.CLICK || sys === EV.CLICK) return { kind: 'tap' }
  return { kind: 'ignore' }
}

/** Resolve a list selection to its label, preferring the reported name. */
export function resolveListItem(items: readonly string[], index: number, name: string | null): string | null {
  if (name !== null) {
    const trimmed = name.trim()
    if (items.includes(trimmed)) return trimmed
  }
  return index >= 0 && index < items.length ? items[index] : null
}
