import { describe, expect, it } from 'vitest'
import { EV, parseEvent, resolveListItem } from '../src/input'
import { listPages } from '../src/config'

const LIST_PAGES = listPages('frequency')

describe('parseEvent', () => {
  it('a list tap with eventType and index omitted is a select of item 0', () => {
    expect(parseEvent({ listEvent: {} })).toEqual({ kind: 'listSelect', index: 0, name: null })
  })
  it('the click default is resolved per envelope, not across envelopes', () => {
    expect(parseEvent({ sysEvent: { eventType: EV.FOREGROUND_EXIT } })).toEqual({ kind: 'ignore' })
    expect(parseEvent({ textEvent: { eventType: EV.SCROLL_BOTTOM } })).toEqual({ kind: 'scrollBottom' })
    expect(parseEvent({})).toEqual({ kind: 'ignore' })
  })
  it('double-tap wins in any envelope', () => {
    for (const env of ['listEvent', 'textEvent', 'sysEvent'] as const)
      expect(parseEvent({ [env]: { eventType: EV.DOUBLE_CLICK } })).toEqual({ kind: 'doubleTap' })
  })
  it('long press deletes; the release does not fire again', () => {
    expect(parseEvent({ sysEvent: { eventType: EV.LONG_PRESS } })).toEqual({ kind: 'longPress' })
    expect(parseEvent({ textEvent: { eventType: EV.LONG_PRESS } })).toEqual({ kind: 'longPress' })
    expect(parseEvent({ listEvent: { eventType: EV.LONG_PRESS_RELEASE } })).toEqual({ kind: 'ignore' })
  })
  it('menu clicks carry the item id', () => {
    expect(parseEvent({ menuItemClickEvent: { itemID: 4 } })).toEqual({ kind: 'menu', itemID: 4 })
    expect(parseEvent({ menuItemClickEvent: {} })).toEqual({ kind: 'ignore' })
  })
  it('text-container swipes (horizontal picker) arrive as scroll events', () => {
    expect(parseEvent({ textEvent: { containerID: 5, eventType: EV.SCROLL_BOTTOM } })).toEqual({ kind: 'scrollBottom' })
    expect(parseEvent({ textEvent: { containerID: 5, eventType: EV.SCROLL_TOP } })).toEqual({ kind: 'scrollTop' })
  })
  it('sys/text taps are plain taps', () => {
    expect(parseEvent({ sysEvent: {} })).toEqual({ kind: 'tap' })
    expect(parseEvent({ textEvent: { eventType: null } })).toEqual({ kind: 'tap' })
  })
})

describe('resolveListItem', () => {
  it('prefers the reported name, falls back to index', () => {
    expect(resolveListItem(LIST_PAGES.A, 5, 'ENTER')).toBe('ENTER')
    expect(resolveListItem(LIST_PAGES.A, 2, null)).toBe('E')
    expect(resolveListItem(LIST_PAGES.A, 99, 'nope')).toBeNull()
  })
})
