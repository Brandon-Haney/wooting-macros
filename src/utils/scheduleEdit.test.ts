import { describe, expect, it } from 'vitest'
import { ActionEventType } from '../types'
import { compile, decompile, keyTrack } from './schedule'
import {
  addBar,
  moveItems,
  removeItems,
  resizeBar,
  setTotal,
  snap
} from './scheduleEdit'

const A = 4
const B = 5
const press = (hid: number, duration: number): ActionEventType => ({
  type: 'KeyPressEventAction',
  data: { keypress: hid, press_duration: duration, keytype: 'DownUp' }
})
const delay = (ms: number): ActionEventType => ({ type: 'DelayEventAction', data: ms })

const base = () => compile([press(A, 20), delay(30), press(B, 10)])

describe('schedule edits', () => {
  it('moves a bar and re-emits the delays', () => {
    const s = base()
    const moved = moveItems(s, new Set([s.bars[1].id]), 40)
    expect(decompile(moved)).toEqual([press(A, 20), delay(70), press(B, 10)])
    expect(moved.total).toBe(100)
  })

  it('never moves before zero', () => {
    const s = base()
    const moved = moveItems(s, new Set([s.bars[0].id]), -50)
    expect(moved.bars[0].start).toBe(0)
  })

  it('moves a bar into an overlap, which becomes Down/Up pairs', () => {
    const s = base()
    const moved = moveItems(s, new Set([s.bars[1].id]), -40)
    const key = (hid: number, keytype: 'Down' | 'Up'): ActionEventType => ({
      type: 'KeyPressEventAction',
      data: { keypress: hid, press_duration: 0, keytype }
    })
    expect(decompile(moved)).toEqual([
      key(A, 'Down'),
      delay(10),
      key(B, 'Down'),
      delay(10),
      key(A, 'Up'),
      key(B, 'Up'),
      delay(40)
    ])
  })

  it('resizes an edge without inverting the bar', () => {
    const s = base()
    const longer = resizeBar(s, s.bars[0].id, 'end', 35)
    expect(decompile(longer)).toEqual([press(A, 35), delay(15), press(B, 10)])
    const inverted = resizeBar(s, s.bars[0].id, 'end', -5)
    expect(inverted.bars[0]).toMatchObject({ start: 0, end: 0 })
  })

  it('adds and removes bars, maintaining tracks', () => {
    const s = base()
    const added = addBar(s, keyTrack(9), 70, 5)
    expect(added.tracks.map((t) => t.id)).toEqual([keyTrack(A), keyTrack(B), keyTrack(9)])
    expect(added.total).toBe(75)
    const removed = removeItems(added, new Set([s.bars[1].id]))
    expect(removed.tracks.map((t) => t.id)).toEqual([keyTrack(A), keyTrack(9)])
  })

  it('moves the end marker to set the loop gap', () => {
    const s = base()
    expect(decompile(setTotal(s, 100))).toEqual([press(A, 20), delay(30), press(B, 10), delay(40)])
    expect(setTotal(s, 10).total).toBe(60)
  })

  it('snaps to nearby edges and otherwise to the grid', () => {
    const s = base()
    expect(snap(s, 52, 5, new Set())).toBe(50)
    expect(snap(s, 33.4, 2, new Set())).toBe(33)
    expect(snap(s, 33.4, 2, new Set(), 10)).toBe(30)
    expect(snap(s, 21, 5, new Set([s.bars[0].id]))).toBe(21)
  })
})
