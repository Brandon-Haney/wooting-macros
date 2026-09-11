import { Bar, Instant, Schedule, Track, EVENTS_TRACK } from './schedule'
import { SystemEventAction } from '../types'

/**
 * Pure edits on a schedule, used by the timeline's drag interactions. Each
 * returns a new schedule; the caller decompiles it into the sequence.
 */

const trackFor = (id: string): Track => ({
  id,
  kind: id === EVENTS_TRACK ? 'events' : id.startsWith('k:') ? 'key' : 'mouse',
  code: id === EVENTS_TRACK ? 0 : Number(id.slice(2))
})

function withTracks(schedule: Schedule): Schedule {
  // Keep track order, drop tracks without items, add tracks items refer to.
  const used = new Set<string>()
  for (const bar of schedule.bars) used.add(bar.track)
  if (schedule.instants.length > 0) used.add(EVENTS_TRACK)
  const tracks = schedule.tracks.filter((t) => used.has(t.id))
  for (const id of used) {
    if (!tracks.some((t) => t.id === id)) tracks.push(trackFor(id))
  }
  return { ...schedule, tracks }
}

function withTotal(schedule: Schedule): Schedule {
  let end = 0
  for (const bar of schedule.bars) end = Math.max(end, bar.end)
  for (const instant of schedule.instants) end = Math.max(end, instant.at)
  return { ...schedule, total: Math.max(schedule.total, end) }
}

/** Shifts the given bars and instants by `delta` ms; nothing may go below 0. */
export function moveItems(schedule: Schedule, ids: Set<string>, delta: number): Schedule {
  let minStart = Infinity
  for (const bar of schedule.bars) if (ids.has(bar.id)) minStart = Math.min(minStart, bar.start)
  for (const i of schedule.instants) if (ids.has(i.id)) minStart = Math.min(minStart, i.at)
  if (minStart === Infinity) return schedule
  const shift = Math.max(delta, -minStart)
  if (shift === 0) return schedule
  return withTotal({
    ...schedule,
    bars: schedule.bars.map((bar) =>
      ids.has(bar.id) ? { ...bar, start: bar.start + shift, end: bar.end + shift } : bar
    ),
    instants: schedule.instants.map((i) => (ids.has(i.id) ? { ...i, at: i.at + shift } : i))
  })
}

/** Moves one edge of a bar; the bar keeps at least zero length. */
export function resizeBar(
  schedule: Schedule,
  id: string,
  edge: 'start' | 'end',
  at: number
): Schedule {
  return withTotal({
    ...schedule,
    bars: schedule.bars.map((bar) => {
      if (bar.id !== id) return bar
      if (edge === 'start') {
        return { ...bar, start: Math.min(Math.max(0, at), bar.end), openStart: false }
      }
      return { ...bar, end: Math.max(bar.start, at), openEnd: false }
    })
  })
}

/** Adds a press on `track`. */
export function addBar(schedule: Schedule, track: string, start: number, length: number): Schedule {
  const bar: Bar = {
    id: `n${Date.now()}${schedule.bars.length}`,
    track,
    start: Math.max(0, start),
    end: Math.max(0, start) + Math.max(0, length),
    openEnd: false,
    openStart: false,
    source: []
  }
  return withTotal(withTracks({ ...schedule, bars: [...schedule.bars, bar] }))
}

export function removeItems(schedule: Schedule, ids: Set<string>): Schedule {
  return withTracks({
    ...schedule,
    bars: schedule.bars.filter((bar) => !ids.has(bar.id)),
    instants: schedule.instants.filter((i) => !ids.has(i.id))
  })
}

/** Moves the end-of-iteration marker; it cannot precede the last item. */
export function setTotal(schedule: Schedule, total: number): Schedule {
  return withTotal({ ...schedule, total: Math.max(0, total) })
}

/** Puts a bar on another key or mouse track. */
export function moveBarToTrack(schedule: Schedule, id: string, track: string): Schedule {
  if (track === EVENTS_TRACK) return schedule
  return withTracks({
    ...schedule,
    bars: schedule.bars.map((bar) => (bar.id === id ? { ...bar, track } : bar))
  })
}

/** Ids of the bars and instants produced by `elementIndexes` (source order). */
export function itemsForElements(schedule: Schedule, elementIndexes: Set<number>): Set<string> {
  const ids = new Set<string>()
  for (const bar of schedule.bars) {
    if (bar.source.some((s) => elementIndexes.has(s))) ids.add(bar.id)
  }
  for (const i of schedule.instants) if (elementIndexes.has(i.source)) ids.add(i.id)
  return ids
}

/** The item (bar or instant) nearest to `track` and `at` after a re-compile. */
export function findItem(schedule: Schedule, track: string, at: number): Bar | Instant | undefined {
  let best: Bar | Instant | undefined
  let bestDistance = Infinity
  for (const bar of schedule.bars) {
    if (bar.track !== track) continue
    const d = Math.abs(bar.start - at)
    if (d < bestDistance) {
      best = bar
      bestDistance = d
    }
  }
  if (track === EVENTS_TRACK) {
    for (const i of schedule.instants) {
      const d = Math.abs(i.at - at)
      if (d < bestDistance) {
        best = i
        bestDistance = d
      }
    }
  }
  return best
}

/** Snap `ms` to the nearest bar edge or instant within `tolerance` ms, else round it. */
export function snap(
  schedule: Schedule,
  ms: number,
  tolerance: number,
  ignore: Set<string>,
  grid = 1
): number {
  let best = Math.round(ms / grid) * grid
  let bestDistance = tolerance
  const consider = (candidate: number) => {
    const d = Math.abs(candidate - ms)
    if (d < bestDistance) {
      best = candidate
      bestDistance = d
    }
  }
  consider(0)
  consider(schedule.total)
  for (const bar of schedule.bars) {
    if (ignore.has(bar.id)) continue
    consider(bar.start)
    consider(bar.end)
  }
  for (const i of schedule.instants) if (!ignore.has(i.id)) consider(i.at)
  return Math.max(0, best)
}

/** Adds a system event on the Events track. */
export function addInstant(schedule: Schedule, element: SystemEventAction, at: number): Schedule {
  const instant: Instant = {
    id: `n${Date.now()}${schedule.instants.length}`,
    at: Math.max(0, at),
    width: 0,
    source: -1,
    element
  }
  return withTotal(withTracks({ ...schedule, instants: [...schedule.instants, instant] }))
}

/** Bars and instants whose extent intersects the rectangle (ms × row). */
export function itemsInRect(
  schedule: Schedule,
  fromMs: number,
  toMs: number,
  fromRow: number,
  toRow: number
): Set<string> {
  const rowOf = (track: string) => schedule.tracks.findIndex((t) => t.id === track)
  const ids = new Set<string>()
  for (const bar of schedule.bars) {
    const row = rowOf(bar.track)
    if (row < fromRow || row > toRow) continue
    if (bar.end >= fromMs && bar.start <= toMs) ids.add(bar.id)
  }
  const eventsRow = rowOf(EVENTS_TRACK)
  if (eventsRow >= fromRow && eventsRow <= toRow) {
    for (const i of schedule.instants) if (i.at >= fromMs && i.at <= toMs) ids.add(i.id)
  }
  return ids
}
