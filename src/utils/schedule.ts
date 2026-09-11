import {
  ActionEventType,
  KeyPressEventAction,
  MouseEventAction,
  SystemEventAction
} from '../types'

/**
 * The schedule is the timeline's view of a sequence: every key or mouse
 * press becomes a bar on that key's track, every system event an instant on
 * the Events track. `compile` walks a sequence the way the backend executor
 * does; `decompile` turns an edited schedule back into a sequence. Both are
 * pure and lossless: the sequence stays the stored format.
 */

export type TrackKind = 'key' | 'mouse' | 'events'

export interface Track {
  /** `k:<hid>`, `m:<button>` or `events`. */
  id: string
  kind: TrackKind
  /** HID code or mouse button, 0 for the events track. */
  code: number
}

export interface Bar {
  id: string
  track: string
  start: number
  end: number
  /** Pressed but never released within the sequence (a Down with no Up). */
  openEnd: boolean
  /** Released without a press in the sequence (an Up with no Down). */
  openStart: boolean
  /** Indexes of the sequence elements that produced the bar (1 or 2). */
  source: number[]
}

export interface Instant {
  id: string
  at: number
  /** Display width hint in ms (typed text), 0 for a true instant. */
  width: number
  source: number
  element: SystemEventAction
}

export interface Schedule {
  tracks: Track[]
  bars: Bar[]
  instants: Instant[]
  /** Length of one iteration in ms. */
  total: number
}

export const EVENTS_TRACK = 'events'
/** The executor types 3 ms per character. */
const TYPING_MS_PER_CHAR = 3

export function keyTrack(hid: number): string {
  return `k:${hid}`
}

export function mouseTrack(button: number): string {
  return `m:${button}`
}

function trackOf(id: string): Track {
  if (id === EVENTS_TRACK) return { id, kind: 'events', code: 0 }
  const code = Number(id.slice(2))
  return { id, kind: id.startsWith('k:') ? 'key' : 'mouse', code }
}

function instantWidth(element: SystemEventAction): number {
  const action = element.data
  if (action.type === 'Text' && action.action.type === 'Type') {
    return action.action.data.length * TYPING_MS_PER_CHAR
  }
  return 0
}

/** Bars and instants in the order the executor reaches them. */
export function compile(sequence: ActionEventType[]): Schedule {
  const bars: Bar[] = []
  const instants: Instant[] = []
  const open = new Map<string, Bar>()
  const trackOrder: string[] = []
  let cursor = 0
  let nextId = 0

  const touchTrack = (id: string) => {
    if (!trackOrder.includes(id)) trackOrder.push(id)
  }
  const down = (track: string, index: number) => {
    touchTrack(track)
    const bar: Bar = {
      id: `b${nextId++}`,
      track,
      start: cursor,
      end: cursor,
      openEnd: true,
      openStart: false,
      source: [index]
    }
    bars.push(bar)
    open.set(track, bar)
  }
  const up = (track: string, index: number) => {
    touchTrack(track)
    const bar = open.get(track)
    if (bar) {
      bar.end = cursor
      bar.openEnd = false
      bar.source.push(index)
      open.delete(track)
    } else {
      bars.push({
        id: `b${nextId++}`,
        track,
        start: 0,
        end: cursor,
        openEnd: false,
        openStart: true,
        source: [index]
      })
    }
  }
  const press = (track: string, index: number, duration: number) => {
    touchTrack(track)
    bars.push({
      id: `b${nextId++}`,
      track,
      start: cursor,
      end: cursor + duration,
      openEnd: false,
      openStart: false,
      source: [index]
    })
    cursor += duration
  }

  sequence.forEach((element, index) => {
    switch (element.type) {
      case 'DelayEventAction':
        cursor += element.data
        break
      case 'KeyPressEventAction': {
        const track = keyTrack(element.data.keypress)
        if (element.data.keytype === 'Down') down(track, index)
        else if (element.data.keytype === 'Up') up(track, index)
        else press(track, index, element.data.press_duration)
        break
      }
      case 'MouseEventAction': {
        const action = element.data.data
        const track = mouseTrack(action.button)
        if (action.type === 'Down') down(track, index)
        else if (action.type === 'Up') up(track, index)
        else press(track, index, action.duration)
        break
      }
      case 'SystemEventAction':
        touchTrack(EVENTS_TRACK)
        instants.push({
          id: `i${nextId++}`,
          at: cursor,
          width: instantWidth(element),
          source: index,
          element
        })
        break
    }
  })

  for (const bar of open.values()) bar.end = cursor

  return {
    tracks: trackOrder.map(trackOf),
    bars,
    instants,
    total: cursor
  }
}

type Boundary = {
  at: number
  /** 0 = release, 1 = press, 2 = instant: releases first at equal times. */
  rank: number
  order: number
  emit: () => ActionEventType
}

function keyEvent(hid: number, keytype: 'Down' | 'Up'): KeyPressEventAction {
  return {
    type: 'KeyPressEventAction',
    data: { keypress: hid, press_duration: 0, keytype }
  }
}

function mouseEvent(button: number, type: 'Down' | 'Up'): MouseEventAction {
  return {
    type: 'MouseEventAction',
    data: { type: 'Press', data: { type, button } }
  }
}

function pressEvent(track: Track, keytype: 'Down' | 'Up'): ActionEventType {
  return track.kind === 'key'
    ? keyEvent(track.code, keytype)
    : mouseEvent(track.code, keytype)
}

/**
 * Sequence for a schedule. Times are rounded to whole milliseconds, gaps
 * become delays, and a press followed only by its own release becomes a
 * single DownUp element so the list stays readable.
 */
export function decompile(schedule: Schedule): ActionEventType[] {
  const tracks = new Map(schedule.tracks.map((t) => [t.id, t]))
  const boundaries: Boundary[] = []
  let order = 0

  schedule.bars.forEach((bar) => {
    const track = tracks.get(bar.track) ?? trackOf(bar.track)
    const start = Math.max(0, Math.round(bar.start))
    const end = Math.max(start, Math.round(bar.end))
    if (!bar.openStart) {
      boundaries.push({
        at: start,
        rank: 1,
        order: order++,
        emit: () => pressEvent(track, 'Down')
      })
    }
    if (!bar.openEnd) {
      // A zero-length press must still press before it releases.
      boundaries.push({
        at: end,
        rank: end === start && !bar.openStart ? 1 : 0,
        order: order++,
        emit: () => pressEvent(track, 'Up')
      })
    }
  })
  schedule.instants.forEach((instant) => {
    boundaries.push({
      at: Math.max(0, Math.round(instant.at)),
      rank: 2,
      order: order++,
      emit: () => instant.element
    })
  })

  boundaries.sort((a, b) => a.at - b.at || a.rank - b.rank || a.order - b.order)

  const out: ActionEventType[] = []
  let cursor = 0
  for (const boundary of boundaries) {
    if (boundary.at > cursor) {
      out.push({ type: 'DelayEventAction', data: boundary.at - cursor })
      cursor = boundary.at
    }
    out.push(boundary.emit())
  }
  const total = Math.max(cursor, Math.round(schedule.total))
  if (total > cursor) {
    out.push({ type: 'DelayEventAction', data: total - cursor })
  }
  return tidy(out)
}

function sameKey(a: ActionEventType, b: ActionEventType): boolean {
  if (a.type === 'KeyPressEventAction' && b.type === 'KeyPressEventAction') {
    return a.data.keypress === b.data.keypress
  }
  if (a.type === 'MouseEventAction' && b.type === 'MouseEventAction') {
    return a.data.data.button === b.data.data.button
  }
  return false
}

function isDown(e: ActionEventType): boolean {
  return (
    (e.type === 'KeyPressEventAction' && e.data.keytype === 'Down') ||
    (e.type === 'MouseEventAction' && e.data.data.type === 'Down')
  )
}

function isUp(e: ActionEventType): boolean {
  return (
    (e.type === 'KeyPressEventAction' && e.data.keytype === 'Up') ||
    (e.type === 'MouseEventAction' && e.data.data.type === 'Up')
  )
}

function downUp(down: ActionEventType, duration: number): ActionEventType {
  if (down.type === 'KeyPressEventAction') {
    return {
      type: 'KeyPressEventAction',
      data: {
        keypress: down.data.keypress,
        keytype: 'DownUp',
        press_duration: duration
      }
    }
  }
  if (down.type === 'MouseEventAction') {
    return {
      type: 'MouseEventAction',
      data: {
        type: 'Press',
        data: { type: 'DownUp', button: down.data.data.button, duration }
      }
    }
  }
  return down
}

/** Merges `Down, [Delay], Up` of the same key into one DownUp. */
export function tidy(sequence: ActionEventType[]): ActionEventType[] {
  const out: ActionEventType[] = []
  for (let i = 0; i < sequence.length; i++) {
    const element = sequence[i]
    if (isDown(element)) {
      const next = sequence[i + 1]
      if (next && isUp(next) && sameKey(element, next)) {
        out.push(downUp(element, 0))
        i += 1
        continue
      }
      const after = sequence[i + 2]
      if (
        next &&
        next.type === 'DelayEventAction' &&
        after &&
        isUp(after) &&
        sameKey(element, after)
      ) {
        out.push(downUp(element, next.data))
        i += 2
        continue
      }
    }
    out.push(element)
  }
  return out
}

/** Bars and instants sorted by start time, for iteration in time order. */
export function timeOrdered(schedule: Schedule): (Bar | Instant)[] {
  const items: (Bar | Instant)[] = [...schedule.bars, ...schedule.instants]
  return items.sort((a, b) => startOf(a) - startOf(b))
}

export function startOf(item: Bar | Instant): number {
  return 'start' in item ? item.start : item.at
}

export function isBar(item: Bar | Instant): item is Bar {
  return 'start' in item
}
