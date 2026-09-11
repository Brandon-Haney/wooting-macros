import { describe, expect, it } from 'vitest'
import { ActionEventType } from '../types'
import { compile, keyTrack } from './schedule'
import { Simulation, SimulationConfig } from './simulation'
import { typedText } from './keyText'

const H = 11
const I = 12
const X = 27
const press = (hid: number, duration: number): ActionEventType => ({
  type: 'KeyPressEventAction',
  data: { keypress: hid, press_duration: duration, keytype: 'DownUp' }
})
const delay = (ms: number): ActionEventType => ({ type: 'DelayEventAction', data: ms })

const hi = compile([press(H, 20), delay(10), press(I, 20), delay(50)]) // 100 ms

const config = (over: Partial<SimulationConfig>): SimulationConfig => ({
  schedule: hi,
  macroType: 'Single',
  holdThresholdMs: 250,
  tapMode: 'DeferredTap',
  repeatCount: null,
  triggerTracks: [keyTrack(X)],
  ...over
})

const keys = (sim: Simulation) =>
  sim.current.history.filter((e) => e.kind === 'key').map((e) => (e.kind === 'key' ? e.track : ''))

describe('simulation', () => {
  it('plays a Single macro once and completes', () => {
    const sim = new Simulation(config({}))
    sim.press()
    sim.advance(25)
    expect(sim.current.active).toEqual([])
    expect(sim.current.phase).toBe('running')
    sim.advance(1000)
    expect(sim.current.phase).toBe('completed')
    expect(sim.current.loops).toBe(1)
    expect(keys(sim)).toEqual([keyTrack(H), keyTrack(I)])
  })

  it('reports held keys mid-press', () => {
    const sim = new Simulation(config({}))
    sim.press()
    sim.advance(10)
    expect(sim.current.active).toEqual([keyTrack(H)])
    expect(sim.current.playhead).toBe(10)
  })

  it('repeats a Single macro N times', () => {
    const sim = new Simulation(config({ repeatCount: 3 }))
    sim.press()
    sim.advance(10000)
    expect(sim.current.loops).toBe(3)
    expect(keys(sim)).toHaveLength(6)
  })

  it('On Hold: a short tap replays the trigger (Deferred tap) and never runs', () => {
    const sim = new Simulation(config({ macroType: 'OnHold' }))
    sim.press()
    sim.advance(100)
    expect(sim.current.phase).toBe('holding')
    sim.release()
    expect(sim.current.phase).toBe('completed')
    expect(keys(sim)).toEqual([keyTrack(X)])
  })

  it('On Hold: Pass through shows the trigger at press time and nothing on a tap', () => {
    const sim = new Simulation(config({ macroType: 'OnHold', tapMode: 'PassThrough' }))
    sim.press()
    expect(keys(sim)).toEqual([keyTrack(X)])
    sim.advance(50)
    sim.release()
    expect(keys(sim)).toEqual([keyTrack(X)])
  })

  it('On Hold: runs after the threshold and stops after the iteration in progress', () => {
    const sim = new Simulation(config({ macroType: 'OnHold' }))
    sim.press()
    sim.advance(250)
    expect(sim.current.phase).toBe('running')
    sim.advance(150) // 1 full iteration + half of the next
    expect(sim.current.loops).toBe(1)
    sim.release()
    sim.advance(1000)
    expect(sim.current.phase).toBe('stopped')
    expect(sim.current.loops).toBe(2)
  })

  it('Toggle: second press stops after the current iteration; loop limit completes', () => {
    const sim = new Simulation(config({ macroType: 'Toggle' }))
    sim.press()
    sim.advance(120)
    sim.press()
    sim.advance(1000)
    expect(sim.current.phase).toBe('stopped')
    expect(sim.current.loops).toBe(2)

    const limited = new Simulation(config({ macroType: 'Toggle', repeatCount: 2 }))
    limited.press()
    limited.advance(5000)
    expect(limited.current.phase).toBe('completed')
    expect(limited.current.loops).toBe(2)
  })

  it('applies the minimum iteration time to loops', () => {
    const fast = compile([press(H, 0)])
    const sim = new Simulation(config({ schedule: fast, macroType: 'Toggle' }))
    expect(sim.iterationMs).toBe(20) // 2 injected events × 10 ms
    sim.press()
    sim.advance(100)
    expect(sim.current.loops).toBe(5)
  })

  it('types text for the key history', () => {
    const sim = new Simulation(config({}))
    sim.press()
    sim.advance(1000)
    expect(typedText(sim.current.history, () => false)).toBe('hi')
    expect(typedText(sim.current.history, () => true)).toBe('HI')
  })
})
