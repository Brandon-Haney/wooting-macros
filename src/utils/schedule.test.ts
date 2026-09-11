import { describe, expect, it } from 'vitest'
import { ActionEventType } from '../types'
import { compile, decompile, keyTrack, mouseTrack, Schedule } from './schedule'

const A = 4
const B = 5
const LEFT = 257

const press = (
  hid: number,
  duration: number,
  keytype: 'DownUp' | 'Down' | 'Up' = 'DownUp'
): ActionEventType => ({
  type: 'KeyPressEventAction',
  data: { keypress: hid, press_duration: duration, keytype }
})
const down = (hid: number) => press(hid, 0, 'Down')
const up = (hid: number) => press(hid, 0, 'Up')
const delay = (ms: number): ActionEventType => ({
  type: 'DelayEventAction',
  data: ms
})
const click = (duration: number): ActionEventType => ({
  type: 'MouseEventAction',
  data: { type: 'Press', data: { type: 'DownUp', button: LEFT, duration } }
})
const openUrl: ActionEventType = {
  type: 'SystemEventAction',
  data: { type: 'Open', action: { type: 'Website', data: 'https://x' } }
}

describe('compile', () => {
  it('lays presses and delays out along the cursor', () => {
    const s = compile([press(A, 20), delay(30), press(B, 10)])
    expect(s.total).toBe(60)
    expect(s.tracks.map((t) => t.id)).toEqual([keyTrack(A), keyTrack(B)])
    expect(s.bars.map((b) => [b.track, b.start, b.end])).toEqual([
      [keyTrack(A), 0, 20],
      [keyTrack(B), 50, 60]
    ])
  })

  it('pairs Down and Up into one bar and keeps overlaps', () => {
    const s = compile([down(A), delay(10), down(B), delay(10), up(A), delay(10), up(B)])
    expect(s.total).toBe(30)
    expect(s.bars.map((b) => [b.track, b.start, b.end, b.source])).toEqual([
      [keyTrack(A), 0, 20, [0, 4]],
      [keyTrack(B), 10, 30, [2, 6]]
    ])
  })

  it('extends an unreleased key to the end and flags it', () => {
    const s = compile([down(A), delay(40)])
    expect(s.bars[0]).toMatchObject({ start: 0, end: 40, openEnd: true })
  })

  it('represents a release without a press as an open-start bar', () => {
    const s = compile([delay(5), up(A)])
    expect(s.bars[0]).toMatchObject({ start: 0, end: 5, openStart: true })
  })

  it('puts system events on the events track at the cursor', () => {
    const s = compile([press(A, 10), openUrl, delay(5)])
    expect(s.instants).toHaveLength(1)
    expect(s.instants[0]).toMatchObject({ at: 10, source: 1 })
    expect(s.tracks.map((t) => t.kind)).toEqual(['key', 'events'])
    expect(s.total).toBe(15)
  })

  it('treats mouse presses like keys', () => {
    const s = compile([click(25), press(A, 5)])
    expect(s.bars.map((b) => [b.track, b.start, b.end])).toEqual([
      [mouseTrack(LEFT), 0, 25],
      [keyTrack(A), 25, 30]
    ])
  })
})

describe('decompile', () => {
  it('round-trips tidy sequences', () => {
    const cases: ActionEventType[][] = [
      [],
      [press(A, 20)],
      [press(A, 0)],
      [delay(10), press(A, 20)],
      [press(A, 20), delay(50)],
      [press(A, 20), delay(30), press(B, 10)],
      [down(A), delay(10), down(B), delay(10), up(A), delay(10), up(B)],
      [down(A), delay(40)],
      [delay(5), up(A)],
      [press(A, 10), openUrl, delay(5)],
      [openUrl, openUrl],
      [click(25), press(A, 5)],
      [down(A), down(B)],
      [press(A, 10), press(A, 10)]
    ]
    for (const sequence of cases) {
      expect(decompile(compile(sequence))).toEqual(sequence)
    }
  })

  it('is stable under a second round trip', () => {
    const sequence = [down(A), delay(10), down(B), delay(5), up(A), up(B), openUrl]
    const once = decompile(compile(sequence))
    expect(decompile(compile(once))).toEqual(once)
  })

  it('releases before presses at the same instant', () => {
    const schedule: Schedule = {
      tracks: [
        { id: keyTrack(A), kind: 'key', code: A },
        { id: keyTrack(B), kind: 'key', code: B }
      ],
      bars: [
        { id: 'x', track: keyTrack(B), start: 10, end: 20, openEnd: false, openStart: false, source: [] },
        { id: 'y', track: keyTrack(A), start: 0, end: 10, openEnd: false, openStart: false, source: [] }
      ],
      instants: [],
      total: 20
    }
    expect(decompile(schedule)).toEqual([press(A, 10), press(B, 10)])
  })

  it('rounds to whole milliseconds and merges delays', () => {
    const schedule: Schedule = {
      tracks: [{ id: keyTrack(A), kind: 'key', code: A }],
      bars: [
        { id: 'x', track: keyTrack(A), start: 0.4, end: 19.6, openEnd: false, openStart: false, source: [] }
      ],
      instants: [],
      total: 49.7
    }
    expect(decompile(schedule)).toEqual([press(A, 20), delay(30)])
  })

  it('keeps a trailing delay as the loop gap', () => {
    const s = compile([press(A, 10), delay(90)])
    expect(s.total).toBe(100)
    expect(decompile({ ...s, total: 150 })).toEqual([press(A, 10), delay(140)])
  })
})
