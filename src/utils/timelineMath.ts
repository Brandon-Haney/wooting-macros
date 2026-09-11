/** Pure helpers for the timeline view: ruler ticks, zoom limits, labels. */

export const MIN_PX_PER_MS = 0.01
export const MAX_PX_PER_MS = 40
/** Extra room after the end marker so it never sits on the edge. */
export const TAIL_MS_FRACTION = 0.08

const STEPS = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000
]

/** Smallest tick step whose spacing is at least `minPx` pixels. */
export function tickStep(pxPerMs: number, minPx = 64): number {
  for (const step of STEPS) {
    if (step * pxPerMs >= minPx) return step
  }
  return STEPS[STEPS.length - 1]
}

/** Tick positions in ms from 0 to `total`, inclusive of the last tick before total. */
export function ticks(total: number, step: number): number[] {
  const out: number[] = []
  for (let t = 0; t <= total; t += step) out.push(t)
  return out
}

/** `50ms`, `1.2s`, `2min`. */
export function formatMs(ms: number): string {
  if (ms >= 60000 && ms % 60000 === 0) return `${ms / 60000}min`
  if (ms >= 1000) {
    const seconds = ms / 1000
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(seconds < 10 ? 2 : 1)}s`
  }
  return `${Math.round(ms)}ms`
}

/** Pixels per ms so `total` fits in `widthPx` with the tail margin. */
export function fitZoom(total: number, widthPx: number): number {
  const span = Math.max(total, 1) * (1 + TAIL_MS_FRACTION)
  return clampZoom(widthPx / span)
}

export function clampZoom(pxPerMs: number): number {
  return Math.min(MAX_PX_PER_MS, Math.max(MIN_PX_PER_MS, pxPerMs))
}

/** Width of the drawable area for a schedule of `total` ms. */
export function canvasWidth(total: number, pxPerMs: number, minPx: number): number {
  return Math.max(minPx, Math.ceil(Math.max(total, 1) * (1 + TAIL_MS_FRACTION) * pxPerMs))
}
