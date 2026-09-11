import { useCallback, useEffect, useRef, useState } from 'react'
import { MouseButton } from '../constants/enums'
import {
  webCodeLocationHidEncode,
  webCodeLocationHIDLookup
} from '../constants/HIDmap'
import { webButtonLookup } from '../constants/MouseMap'
import { error } from 'tauri-plugin-log'
import { useToast } from '@chakra-ui/react'
import { invoke } from '@tauri-apps/api'
import { Bar, keyTrack, mouseTrack, Schedule } from '../utils/schedule'

interface Options {
  /** Every press and gap takes this many ms instead of the measured time. */
  fixedStepMs?: number
}

/**
 * Records keys and mouse buttons pressed while the window is focused into a
 * schedule: one bar per press, overlaps kept. `onChange` receives the
 * schedule after every event (bars still held are open-ended) so the
 * sequence can be shown live; the first event is at t = 0.
 */
export default function useRecordingSequence(
  onChange: (schedule: Schedule) => void,
  { fixedStepMs }: Options = {}
) {
  const [recording, setRecording] = useState(false)
  const toast = useToast()
  const bars = useRef<Bar[]>([])
  const open = useRef(new Map<string, Bar>())
  const origin = useRef<number | undefined>(undefined)
  const events = useRef(0)

  const startRecording = useCallback(() => {
    bars.current = []
    open.current = new Map()
    origin.current = undefined
    events.current = 0
    setRecording(true)
  }, [])

  const stopRecording = useCallback(() => {
    setRecording(false)
  }, [])

  const publish = useCallback(
    (now: number) => {
      const tracks = new Map<string, Bar['track']>()
      for (const bar of bars.current) tracks.set(bar.track, bar.track)
      const schedule: Schedule = {
        tracks: [...tracks.keys()].map((id) => ({
          id,
          kind: id.startsWith('k:') ? 'key' : 'mouse',
          code: Number(id.slice(2))
        })),
        bars: bars.current.map((bar) =>
          bar.openEnd ? { ...bar, end: now } : bar
        ),
        instants: [],
        total: now
      }
      onChange(schedule)
    },
    [onChange]
  )

  const record = useCallback(
    (track: string, isUp: boolean, timeStamp: number) => {
      let at: number
      if (fixedStepMs !== undefined) {
        at = events.current * fixedStepMs
      } else {
        if (origin.current === undefined) origin.current = timeStamp
        at = Math.round(timeStamp - origin.current)
      }
      events.current += 1

      if (isUp) {
        const bar = open.current.get(track)
        if (bar) {
          bar.end = at
          bar.openEnd = false
          open.current.delete(track)
        } else {
          bars.current.push({
            id: `r${bars.current.length}`,
            track,
            start: 0,
            end: at,
            openEnd: false,
            openStart: true,
            source: []
          })
        }
      } else if (!open.current.has(track)) {
        const bar: Bar = {
          id: `r${bars.current.length}`,
          track,
          start: at,
          end: at,
          openEnd: true,
          openStart: false,
          source: []
        }
        bars.current.push(bar)
        open.current.set(track, bar)
      }
      publish(at)
    },
    [fixedStepMs, publish]
  )

  const addKeypress = useCallback(
    (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return

      const HIDIdentifier = webCodeLocationHidEncode(
        event.which,
        event.location
      )
      const HIDcode = webCodeLocationHIDLookup.get(HIDIdentifier)?.HIDcode
      if (HIDcode === undefined) return

      record(keyTrack(HIDcode), event.type === 'keyup', event.timeStamp)
    },
    [record]
  )

  const addMousepress = useCallback(
    (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const target = event.target as HTMLElement
      if (
        target.localName === 'button' ||
        target.localName === 'svg' ||
        target.localName === 'path'
      ) {
        return
      }

      const enumVal = webButtonLookup.get(event.button)?.enumVal
      if (enumVal === undefined) return

      // Left click stops the recording so the UI stays usable.
      if (enumVal === MouseButton.Left) {
        toast({
          title: `Sequence recording stopped`,
          description: `To record Mouse Button 1, insert the button from the left panel.`,
          status: 'info',
          duration: 4000,
          isClosable: true
        })
        setRecording(false)
        return
      }

      record(mouseTrack(enumVal), event.type === 'mouseup', event.timeStamp)
    },
    [record, toast]
  )

  useEffect(() => {
    if (!recording) return

    window.addEventListener('keydown', addKeypress, false)
    window.addEventListener('mousedown', addMousepress, false)
    window.addEventListener('keyup', addKeypress, false)
    window.addEventListener('mouseup', addMousepress, false)
    invoke<void>('control_grabbing', { frontendBool: false }).catch(
      (e: string) => {
        error(e)
      }
    )

    return () => {
      window.removeEventListener('keydown', addKeypress, false)
      window.removeEventListener('mousedown', addMousepress, false)
      window.removeEventListener('keyup', addKeypress, false)
      window.removeEventListener('mouseup', addMousepress, false)
      invoke<void>('control_grabbing', { frontendBool: true }).catch(
        (e: string) => {
          error(e)
        }
      )
    }
  }, [recording, addKeypress, addMousepress])

  /** Ms since the first recorded event, or 0 before it. */
  const elapsed = useCallback(() => {
    if (origin.current === undefined) return 0
    if (fixedStepMs !== undefined) return events.current * fixedStepMs
    return Math.max(0, performance.now() - origin.current)
  }, [fixedStepMs])

  return { recording, startRecording, stopRecording, elapsed }
}
