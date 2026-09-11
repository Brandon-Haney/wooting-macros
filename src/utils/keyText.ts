import { HistoryEntry } from './simulation'

/**
 * Text a sequence of key presses would type on a US layout. Letters, digits,
 * punctuation, Space, Enter and Backspace are understood; Shift held by the
 * macro (a bar on the Shift row) changes the case. Anything else is skipped.
 */

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
const DIGITS = '1234567890'
const DIGITS_SHIFTED = '!@#$%^&*()'
const PUNCTUATION: Record<number, [string, string]> = {
  45: ['-', '_'],
  46: ['=', '+'],
  47: ['[', '{'],
  48: [']', '}'],
  49: ['\\', '|'],
  51: [';', ':'],
  52: ["'", '"'],
  53: ['`', '~'],
  54: [',', '<'],
  55: ['.', '>'],
  56: ['/', '?']
}
const SHIFT_LEFT = 225
const SHIFT_RIGHT = 229
const SPACE = 44
const ENTER = 40
const BACKSPACE = 42
const TAB = 43

export function charForHid(hid: number, shifted: boolean): string | undefined {
  if (hid >= 4 && hid <= 29) {
    const letter = LETTERS[hid - 4]
    return shifted ? letter.toUpperCase() : letter
  }
  if (hid >= 30 && hid <= 39) {
    return shifted ? DIGITS_SHIFTED[hid - 30] : DIGITS[hid - 30]
  }
  if (hid === SPACE) return ' '
  if (hid === ENTER) return '\n'
  if (hid === TAB) return '\t'
  const punctuation = PUNCTUATION[hid]
  if (punctuation) return shifted ? punctuation[1] : punctuation[0]
  return undefined
}

function hidOf(track: string): number | undefined {
  return track.startsWith('k:') ? Number(track.slice(2)) : undefined
}

/** Text typed by the key entries of a history, given which tracks were held at each point. */
export function typedText(history: HistoryEntry[], shiftHeldAt: (at: number) => boolean): string {
  let out = ''
  for (const entry of history) {
    if (entry.kind !== 'key') continue
    const hid = hidOf(entry.track)
    if (hid === undefined) continue
    if (hid === BACKSPACE) {
      out = out.slice(0, -1)
      continue
    }
    if (hid === SHIFT_LEFT || hid === SHIFT_RIGHT) continue
    const char = charForHid(hid, shiftHeldAt(entry.at))
    if (char !== undefined) out += char
  }
  return out
}

export function isShiftTrack(track: string): boolean {
  const hid = hidOf(track)
  return hid === SHIFT_LEFT || hid === SHIFT_RIGHT
}
