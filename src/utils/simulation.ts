import { Bar, Instant, Schedule, EVENTS_TRACK } from './schedule'
import { SystemEventAction } from '../types'

/**
 * Virtual player for a macro: applies the backend's trigger rules (macro
 * type, hold threshold, tap mode, repeat count, minimum iteration) to a
 * schedule and reports what the macro would send, without touching the OS.
 * Deterministic and time-driven: call `press`, `release` and `advance`.
 */

/** Mirrors MIN_LOOP_ITERATION_DELAY and STANDARD_KEYPRESS_DELAY (Windows) in the backend. */
export const MIN_LOOP_ITERATION_MS = 10
export const KEYPRESS_DELAY_MS = 10

export type SimulationPhase =
  | 'idle'
  | 'holding'
  | 'running'
  | 'completed'
  | 'stopped'

export interface SimulationConfig {
  schedule: Schedule
  macroType: string
  holdThresholdMs: number
  tapMode: 'DeferredTap' | 'PassThrough'
  repeatCount: number | null
  /** Trigger keys as track ids (`k:<hid>` or `m:<button>`). */
  triggerTracks: string[]
}

export type HistoryEntry =
  | { kind: 'key'; track: string; at: number; note?: string }
  | { kind: 'event'; element: SystemEventAction; at: number }
  | { kind: 'note'; label: string; at: number }

export interface SimulationState {
  phase: SimulationPhase
  /** Virtual ms since the trigger was pressed. */
  now: number
  /** Iterations completed. */
  loops: number
  /** Position within the current iteration, for the playhead; null when not running. */
  playhead: number | null
  /** Tracks currently held down by the macro. */
  active: string[]
  history: HistoryEntry[]
  /** Whether the trigger is held (On Hold). */
  triggerHeld: boolean
}

type Edge =
  | { at: number; order: number; type: 'down' | 'up'; track: string }
  | { at: number; order: number; type: 'instant'; instant: Instant }

function edgesOf(schedule: Schedule): Edge[] {
  const edges: Edge[] = []
  let order = 0
  for (const bar of schedule.bars) {
    if (!bar.openStart) edges.push({ at: bar.start, order: order++, type: 'down', track: bar.track })
    if (!bar.openEnd) edges.push({ at: bar.end, order: order++, type: 'up', track: bar.track })
  }
  for (const instant of schedule.instants) {
    edges.push({ at: instant.at, order: order++, type: 'instant', instant })
  }
  // Same order the decompiler uses: releases, presses, then events.
  const rank = (e: Edge) => (e.type === 'up' ? 0 : e.type === 'down' ? 1 : 2)
  return edges.sort((a, b) => a.at - b.at || rank(a) - rank(b) || a.order - b.order)
}

function injectedEvents(bars: Bar[]): number {
  let count = 0
  for (const bar of bars) count += (bar.openStart ? 0 : 1) + (bar.openEnd ? 0 : 1)
  return count
}

/** Length of one loop iteration: the sequence, or the loop's minimum time if longer. */
export function iterationLength(schedule: Schedule, macroType: string): number {
  if (macroType === 'Single') return schedule.total
  const minimum = Math.max(MIN_LOOP_ITERATION_MS, injectedEvents(schedule.bars) * KEYPRESS_DELAY_MS)
  return Math.max(schedule.total, minimum)
}

export class Simulation {
  readonly config: SimulationConfig
  private edges: Edge[]
  /** Length of one iteration, including the loop's minimum time. */
  readonly iterationMs: number
  private state: SimulationState
  private nextEdge = 0
  private iterationStart = 0
  private stopAfterIteration = false
  private maxLoops: number | null

  constructor(config: SimulationConfig) {
    this.config = config
    this.edges = edgesOf(config.schedule)
    this.iterationMs = iterationLength(config.schedule, config.macroType)
    this.maxLoops =
      config.macroType === 'Single'
        ? Math.max(1, config.repeatCount ?? 1)
        : config.macroType === 'Toggle'
          ? config.repeatCount || null
          : null
    this.state = Simulation.initial()
  }

  private static initial(): SimulationState {
    return {
      phase: 'idle',
      now: 0,
      loops: 0,
      playhead: null,
      active: [],
      history: [],
      triggerHeld: false
    }
  }

  get current(): SimulationState {
    return this.state
  }

  reset() {
    this.state = Simulation.initial()
    this.nextEdge = 0
    this.iterationStart = 0
    this.stopAfterIteration = false
  }

  /** The trigger is pressed. */
  press() {
    const s = this.state
    switch (this.config.macroType) {
      case 'OnHold':
        if (s.phase === 'running' || s.phase === 'holding') return
        this.reset()
        this.state.triggerHeld = true
        if (this.config.tapMode === 'PassThrough') {
          for (const track of this.config.triggerTracks) {
            this.state.history.push({ kind: 'key', track, at: 0, note: 'passed through' })
          }
        }
        if (this.config.holdThresholdMs <= 0) this.startRunning()
        else this.state.phase = 'holding'
        return
      case 'Toggle':
        if (s.phase === 'running') {
          // Second press stops after the current iteration.
          this.stopAfterIteration = true
          this.state.history.push({ kind: 'note', label: 'Toggled off', at: s.now })
          return
        }
        this.reset()
        this.startRunning()
        return
      default:
        if (s.phase === 'running') return
        this.reset()
        this.startRunning()
    }
  }

  /** The trigger is released (On Hold only). */
  release() {
    const s = this.state
    s.triggerHeld = false
    if (this.config.macroType !== 'OnHold') return
    if (s.phase === 'holding') {
      // Tap shorter than the threshold.
      if (this.config.tapMode === 'DeferredTap') {
        for (const track of this.config.triggerTracks) {
          s.history.push({ kind: 'key', track, at: s.now, note: 'replayed tap' })
        }
      }
      s.phase = 'completed'
      s.history.push({
        kind: 'note',
        label: `Tap (${Math.round(s.now)} ms < ${this.config.holdThresholdMs} ms threshold)`,
        at: s.now
      })
      return
    }
    if (s.phase === 'running') this.stopAfterIteration = true
  }

  private startRunning() {
    const s = this.state
    s.phase = 'running'
    s.playhead = 0
    this.iterationStart = s.now
    this.nextEdge = 0
    if (this.config.macroType === 'OnHold' && s.now > 0) {
      s.history.push({ kind: 'note', label: 'Hold confirmed', at: s.now })
    }
  }

  /** Moves virtual time forward and applies everything that happens. */
  advance(dt: number) {
    const s = this.state
    if (dt <= 0) return
    const target = s.now + dt

    if (s.phase === 'holding') {
      if (target >= this.config.holdThresholdMs) {
        s.now = this.config.holdThresholdMs
        this.startRunning()
        this.advance(target - s.now)
      } else {
        s.now = target
      }
      return
    }

    if (s.phase !== 'running') {
      s.now = target
      return
    }

    while (s.now < target) {
      const edge = this.edges[this.nextEdge]
      const edgeAt = edge ? this.iterationStart + edge.at : Infinity
      const iterationEnd = this.iterationStart + this.iterationMs
      if (edge && edgeAt <= target && edgeAt <= iterationEnd) {
        s.now = edgeAt
        this.apply(edge)
        this.nextEdge += 1
        continue
      }
      if (iterationEnd <= target) {
        s.now = iterationEnd
        this.finishIteration()
        if (s.phase !== 'running') {
          s.now = target
          return
        }
        continue
      }
      s.now = target
    }
    s.playhead = s.now - this.iterationStart
  }

  private apply(edge: Edge) {
    const s = this.state
    switch (edge.type) {
      case 'down':
        if (!s.active.includes(edge.track)) s.active = [...s.active, edge.track]
        s.history.push({ kind: 'key', track: edge.track, at: s.now })
        break
      case 'up':
        s.active = s.active.filter((t) => t !== edge.track)
        break
      case 'instant':
        s.history.push({ kind: 'event', element: edge.instant.element, at: s.now })
        break
    }
  }

  private finishIteration() {
    const s = this.state
    s.loops += 1
    const limitReached = this.maxLoops !== null && s.loops >= this.maxLoops
    const stop =
      limitReached ||
      this.stopAfterIteration ||
      (this.config.macroType === 'OnHold' && !s.triggerHeld)
    if (stop) {
      s.phase = this.config.macroType === 'Single' || limitReached ? 'completed' : 'stopped'
      s.playhead = null
      this.stopAfterIteration = false
      return
    }
    this.iterationStart = s.now
    this.nextEdge = 0
    s.playhead = 0
  }
}

export function isEventsTrack(track: string): boolean {
  return track === EVENTS_TRACK
}
