import {
  Box,
  Flex,
  HStack,
  IconButton,
  Kbd,
  Text,
  Tooltip,
  useColorModeValue
} from '@chakra-ui/react'
import { AddIcon, MinusIcon } from '@chakra-ui/icons'
import React, {
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useMacroContext } from '../../../../contexts/macroContext'
import { HIDLookup } from '../../../../constants/HIDmap'
import { mouseEnumLookup } from '../../../../constants/MouseMap'
import { getElementDisplayString } from '../../../../constants/utils'
import { DefaultMacroDelay } from '../../../../constants'
import { ActionEventType } from '../../../../types'
import {
  Bar,
  compile,
  decompile,
  EVENTS_TRACK,
  Instant,
  keyTrack,
  mouseTrack,
  Schedule,
  Track
} from '../../../../utils/schedule'
import TimelineMenu, { MenuItem } from './TimelineMenu'
import KeyPickerModal from './KeyPickerModal'
import {
  addBar,
  addInstant,
  barsOnTrack,
  duplicateItems,
  findItem,
  itemsForElements,
  itemsInRect,
  moveBarToTrack,
  moveItems,
  removeItems,
  resizeBar,
  retrackBars,
  setTotal,
  snap
} from '../../../../utils/scheduleEdit'
import { iterationLength } from '../../../../utils/simulation'
import {
  canvasWidth,
  clampZoom,
  fitZoom,
  formatMs,
  tickStep,
  ticks
} from '../../../../utils/timelineMath'
import useBorderColour from '../../../../hooks/useBorderColour'
import useScrollbarStyles from '../../../../hooks/useScrollbarStyles'

const LABEL_WIDTH = 96
const ROW_HEIGHT = 34
const RULER_HEIGHT = 24
const BRACKET_HEIGHT = 28
const BAR_INSET = 7
const EDGE_PX = 6
const SNAP_PX = 6
const DRAG_THRESHOLD_PX = 3
/** MIME type of palette elements dragged onto the timeline. */
export const ELEMENT_DRAG_TYPE = 'application/x-wootomation-element'

interface Props {
  recording: boolean
  /** Simulation or recording position within the iteration, drawn as a moving line. */
  playhead?: number | null
  /** Where the next recording is inserted; null means the end of the sequence. */
  recordCursor?: number | null
  /** A click on empty space sets the record cursor. */
  onRecordCursor?: (ms: number | null) => void
}

type Drag =
  | {
      kind: 'move'
      ids: Set<string>
      primary: Bar | Instant
      startX: number
      startY: number
      row: number
      moved: boolean
      shift: boolean
    }
  | { kind: 'resize'; id: string; edge: 'start' | 'end'; track: string }
  | { kind: 'draw'; track: string; anchor: number; moved: boolean; startX: number }
  | { kind: 'end' }
  | { kind: 'band'; startX: number; startY: number }

interface Reselect {
  track: string
  at: number
}

interface BandRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Per-key timeline of the sequence: one row per key, one bar per press,
 * system events on an Events row, the trigger press at 0 and the end of one
 * iteration at `total`. Bars can be dragged, resized and drawn; every edit
 * is decompiled back into the sequence.
 */
export default function Timeline({
  recording,
  playhead = null,
  recordCursor = null,
  onRecordCursor
}: Props) {
  const {
    macro,
    sequence,
    ids,
    selectedElementId,
    selectedElementIds,
    updateSelectedElementId,
    updateSelectedElementIds,
    overwriteSequence
  } = useMacroContext()

  // Elements in display order; bar sources index into this array.
  const ordered = useMemo(
    () => ids.map((id) => sequence[id - 1]).filter(Boolean),
    [ids, sequence]
  )
  const schedule = useMemo<Schedule>(() => compile(ordered), [ordered])
  /** Storage index (what `selectedElementId` holds) for a source index. */
  const storageIndex = useCallback((source: number) => ids[source] - 1, [ids])

  // Schedule shown while a drag is in progress.
  const [draft, setDraft] = useState<Schedule | null>(null)
  const view = draft ?? schedule
  const dragRef = useRef<Drag | null>(null)
  const pendingSelect = useRef<Reselect | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [band, setBand] = useState<BandRect | null>(null)
  const [dropHint, setDropHint] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; kind: 'bar' | 'row'; id: string } | null>(null)
  const [picker, setPicker] = useState<{ ids: Set<string>; title: string } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState(0)
  const [pxPerMs, setPxPerMs] = useState(1)
  const [zoomed, setZoomed] = useState(false)
  const pxRef = useRef(pxPerMs)
  pxRef.current = pxPerMs

  const looping = macro.macro_type !== 'Single'
  const iteration = useMemo(() => iterationLength(view, macro.macro_type), [view, macro.macro_type])
  /** Time span drawn: one iteration plus a ghost of the next for looping macros. */
  const extent = looping ? iteration + view.total : view.total

  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      // Ignore scrollbar-sized jitter so layout cannot oscillate.
      const next = Math.floor(entry.contentRect.width)
      setViewport((current) => (Math.abs(current - next) > 4 ? next : current))
    })
    observer.observe(node)
    setViewport(node.clientWidth)
    return () => observer.disconnect()
  }, [])

  // Fit on open and whenever the sequence changes until the user zooms.
  const fitTo = looping ? iteration + schedule.total : schedule.total
  useEffect(() => {
    if (zoomed || viewport === 0) return
    setPxPerMs(fitZoom(fitTo, viewport - LABEL_WIDTH - 16))
  }, [fitTo, viewport, zoomed])

  const zoomBy = useCallback((factor: number) => {
    setZoomed(true)
    setPxPerMs((current) => clampZoom(current * factor))
  }, [])
  const fit = useCallback(() => {
    setZoomed(false)
    setPxPerMs(fitZoom(fitTo, viewport - LABEL_WIDTH - 16))
  }, [fitTo, viewport])

  // Ctrl+wheel zooms around the pointer.
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      const factor = Math.pow(1.0015, -event.deltaY)
      const rect = node.getBoundingClientRect()
      const x = event.clientX - rect.left - LABEL_WIDTH + node.scrollLeft
      setZoomed(true)
      setPxPerMs((current) => {
        const next = clampZoom(current * factor)
        const ms = x / current
        requestAnimationFrame(() => {
          node.scrollLeft = Math.max(
            0,
            ms * next - (event.clientX - rect.left - LABEL_WIDTH)
          )
        })
        return next
      })
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  // After an edit the sequence is regenerated; re-select the edited item.
  useEffect(() => {
    const want = pendingSelect.current
    if (!want) return
    pendingSelect.current = null
    const item = findItem(schedule, want.track, want.at)
    if (item) {
      setSelectedIds(new Set([item.id]))
      const source = 'start' in item ? item.source[0] : item.source
      if (source !== undefined && source >= 0) updateSelectedElementId(storageIndex(source))
    }
  }, [schedule, storageIndex, updateSelectedElementId])

  /** Writes a schedule back into the sequence. */
  const commit = useCallback(
    (next: Schedule, reselect?: Reselect) => {
      pendingSelect.current = reselect ?? null
      if (!reselect) {
        setSelectedIds(new Set())
        updateSelectedElementId(undefined)
      }
      overwriteSequence(decompile(next))
      setDraft(null)
    },
    [overwriteSequence, updateSelectedElementId]
  )

  const msAt = useCallback((clientX: number) => {
    const node = scrollRef.current
    if (!node) return 0
    const rect = node.getBoundingClientRect()
    return (clientX - rect.left + node.scrollLeft - LABEL_WIDTH) / pxRef.current
  }, [])
  const rowAt = useCallback((clientY: number) => {
    const node = scrollRef.current
    if (!node) return -1
    const rect = node.getBoundingClientRect()
    return Math.floor((clientY - rect.top + node.scrollTop - RULER_HEIGHT) / ROW_HEIGHT)
  }, [])
  /** Canvas pixel position (relative to the scrolled content) of a client point. */
  const canvasPoint = useCallback((clientX: number, clientY: number) => {
    const node = scrollRef.current
    if (!node) return { x: 0, y: 0 }
    const rect = node.getBoundingClientRect()
    return {
      x: clientX - rect.left + node.scrollLeft,
      y: clientY - rect.top + node.scrollTop - RULER_HEIGHT
    }
  }, [])
  const snapMs = useCallback(
    (base: Schedule, ms: number, ignore: Set<string>, shift: boolean) =>
      snap(base, ms, SNAP_PX / pxRef.current, ignore, shift ? 10 : 1),
    []
  )

  const scheduleRef = useRef(schedule)
  scheduleRef.current = schedule

  const selectItem = useCallback(
    (item: Bar | Instant, additive: boolean) => {
      const id = item.id
      setSelectedIds((current) => {
        if (additive) {
          const next = new Set(current)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        }
        return new Set([id])
      })
      const source = 'start' in item ? item.source[0] : item.source
      if (source !== undefined && source >= 0) updateSelectedElementId(storageIndex(source))
    },
    [storageIndex, updateSelectedElementId]
  )

  const beginDrag = useCallback(
    (drag: Drag, event: ReactPointerEvent) => {
      if (recording || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      dragRef.current = drag
      const base = scheduleRef.current
      let latest: Schedule = base
      let lastMs = 0
      let bandIds = new Set<string>()

      const onMove = (e: PointerEvent) => {
        const d = dragRef.current
        if (!d) return
        const shift = e.shiftKey
        switch (d.kind) {
          case 'move': {
            if (
              !d.moved &&
              Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD_PX &&
              Math.abs(e.clientY - d.startY) < DRAG_THRESHOLD_PX
            ) {
              return
            }
            d.moved = true
            const primaryStart = 'start' in d.primary ? d.primary.start : d.primary.at
            const wanted = primaryStart + msAt(e.clientX) - msAt(d.startX)
            const start = snapMs(base, wanted, d.ids, shift)
            latest = moveItems(base, d.ids, start - primaryStart)
            lastMs = start
            if (d.ids.size === 1 && 'start' in d.primary) {
              const row = rowAt(e.clientY)
              const track = base.tracks[row]
              if (track && track.kind !== 'events' && row !== d.row) {
                latest = moveBarToTrack(latest, d.primary.id, track.id)
              }
            }
            setDraft(latest)
            return
          }
          case 'resize': {
            const at = snapMs(base, msAt(e.clientX), new Set([d.id]), shift)
            latest = resizeBar(base, d.id, d.edge, at)
            setDraft(latest)
            return
          }
          case 'draw': {
            if (!d.moved && Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD_PX) return
            d.moved = true
            const at = snapMs(base, msAt(e.clientX), new Set(), shift)
            latest = addBar(base, d.track, Math.min(at, d.anchor), Math.abs(at - d.anchor))
            setDraft(latest)
            return
          }
          case 'end': {
            latest = setTotal(base, snapMs(base, msAt(e.clientX), new Set(), shift))
            setDraft(latest)
            return
          }
          case 'band': {
            const a = canvasPoint(d.startX, d.startY)
            const b = canvasPoint(e.clientX, e.clientY)
            const left = Math.min(a.x, b.x)
            const right = Math.max(a.x, b.x)
            const top = Math.max(0, Math.min(a.y, b.y))
            const bottom = Math.max(a.y, b.y)
            setBand({ left, top, width: right - left, height: bottom - top })
            const px = pxRef.current
            bandIds = itemsInRect(
              base,
              (left - LABEL_WIDTH) / px,
              (right - LABEL_WIDTH) / px,
              Math.floor(top / ROW_HEIGHT),
              Math.floor(bottom / ROW_HEIGHT)
            )
            setSelectedIds(new Set(bandIds))
            return
          }
        }
      }

      const onUp = (e: PointerEvent) => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        const d = dragRef.current
        dragRef.current = null
        if (!d) return
        switch (d.kind) {
          case 'move': {
            if (!d.moved) {
              setDraft(null)
              selectItem(d.primary, d.shift)
              return
            }
            const bar = latest.bars.find((b) => b.id === d.primary.id)
            const instant = latest.instants.find((i) => i.id === d.primary.id)
            commit(latest, {
              track: bar ? bar.track : EVENTS_TRACK,
              at: bar ? bar.start : instant ? instant.at : lastMs
            })
            return
          }
          case 'resize': {
            const bar = latest.bars.find((b) => b.id === d.id)
            commit(latest, bar ? { track: bar.track, at: bar.start } : undefined)
            return
          }
          case 'draw': {
            if (!d.moved) {
              // A click on empty space: place the record cursor there.
              setDraft(null)
              setSelectedIds(new Set())
              updateSelectedElementId(undefined)
              onRecordCursor?.(Math.round(d.anchor))
              return
            }
            const added = latest.bars[latest.bars.length - 1]
            commit(latest, { track: d.track, at: added.start })
            return
          }
          case 'end':
            commit(latest)
            return
          case 'band': {
            setBand(null)
            const first = [...bandIds][0]
            const item =
              base.bars.find((b) => b.id === first) ?? base.instants.find((i) => i.id === first)
            if (item) {
              const source = 'start' in item ? item.source[0] : item.source
              if (source !== undefined && source >= 0) updateSelectedElementId(storageIndex(source))
            } else if (!e.shiftKey) {
              updateSelectedElementId(undefined)
            }
            return
          }
        }
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [
      canvasPoint,
      commit,
      msAt,
      onRecordCursor,
      recording,
      rowAt,
      selectItem,
      snapMs,
      storageIndex,
      updateSelectedElementId
    ]
  )

  const isSelected = useCallback(
    (item: Bar | Instant) => {
      if (selectedIds.size > 0) return selectedIds.has(item.id)
      if (selectedElementId === undefined) return false
      const sources = 'start' in item ? item.source : [item.source]
      return sources.some((s) => storageIndex(s) === selectedElementId)
    },
    [selectedElementId, selectedIds, storageIndex]
  )

  /** A row counts as selected when every press on it is. */
  const rowSelected = useCallback(
    (track: string) => {
      const bars = barsOnTrack(view, track)
      return bars.size > 0 && [...bars].every((id) => selectedIds.has(id))
    },
    [selectedIds, view]
  )

  /** Selects every press on a row; `additive` keeps the current selection. */
  const selectRow = useCallback(
    (track: string, additive: boolean) => {
      const bars = barsOnTrack(schedule, track)
      if (bars.size === 0) return
      setSelectedIds((current) => {
        const next = additive ? new Set(current) : new Set<string>()
        const allIn = [...bars].every((id) => current.has(id))
        for (const id of bars) {
          if (additive && allIn) next.delete(id)
          else next.add(id)
        }
        return next
      })
      const first = schedule.bars.find((b) => b.track === track)
      if (first && first.source[0] !== undefined) updateSelectedElementId(storageIndex(first.source[0]))
    },
    [schedule, storageIndex, updateSelectedElementId]
  )

  // Publish the multi-selection (storage indexes) so the right panel can act on it.
  useEffect(() => {
    const indexes = new Set<number>()
    for (const bar of schedule.bars) {
      if (selectedIds.has(bar.id)) for (const src of bar.source) indexes.add(storageIndex(src))
    }
    for (const i of schedule.instants) {
      if (selectedIds.has(i.id) && i.source >= 0) indexes.add(storageIndex(i.source))
    }
    updateSelectedElementIds([...indexes].sort((a, b) => a - b))
  }, [schedule, selectedIds, storageIndex, updateSelectedElementIds])

  // The right panel cleared the selection.
  useEffect(() => {
    if (selectedElementIds.length === 0 && selectedElementId === undefined) {
      setSelectedIds((current) => (current.size === 0 ? current : new Set()))
    }
  }, [selectedElementId, selectedElementIds])

  const deleteIds = useCallback(
    (target: Set<string>) => {
      if (target.size > 0) commit(removeItems(schedule, target))
    },
    [commit, schedule]
  )
  const duplicateIds = useCallback(
    (target: Set<string>) => {
      const { schedule: next, added } = duplicateItems(schedule, target)
      const first = next.bars.find((b) => added.has(b.id))
      commit(next, first ? { track: first.track, at: first.start } : undefined)
    },
    [commit, schedule]
  )
  const rekey = useCallback(
    (target: Set<string>, track: string) => {
      const next = retrackBars(schedule, target, track)
      const first = next.bars.find((b) => target.has(b.id))
      commit(next, first ? { track, at: first.start } : undefined)
    },
    [commit, schedule]
  )

  const menuItems = useMemo((): (MenuItem | 'divider')[] => {
    if (!menu) return []
    if (menu.kind === 'row') {
      const rowIds = barsOnTrack(schedule, menu.id)
      return [
        { label: 'Select row', onClick: () => selectRow(menu.id, false) },
        {
          label: 'Change key…',
          onClick: () => setPicker({ ids: rowIds, title: 'Move every press on this row to' })
        },
        'divider',
        { label: `Delete row (${rowIds.size})`, onClick: () => deleteIds(rowIds), danger: true }
      ]
    }
    const target = selectedIds.has(menu.id) ? selectedIds : new Set([menu.id])
    const bar = schedule.bars.find((b) => b.id === menu.id)
    const count = target.size
    const plural = count > 1 ? ` (${count})` : ''
    return [
      { label: `Duplicate${plural}`, onClick: () => duplicateIds(target) },
      ...(bar
        ? [
            { label: 'Select all on this row', onClick: () => selectRow(bar.track, false) },
            {
              label: `Move to another key…${plural}`,
              onClick: () => setPicker({ ids: target, title: 'Move the press to' })
            }
          ]
        : []),
      'divider',
      { label: `Delete${plural}`, onClick: () => deleteIds(target), danger: true }
    ]
  }, [deleteIds, duplicateIds, menu, schedule, selectRow, selectedIds])

  const openItemMenu = useCallback(
    (item: Bar | Instant, event: React.MouseEvent) => {
      if (recording) return
      event.preventDefault()
      event.stopPropagation()
      if (!selectedIds.has(item.id)) selectItem(item, false)
      setMenu({ x: event.clientX, y: event.clientY, kind: 'bar', id: item.id })
    },
    [recording, selectItem, selectedIds]
  )

  /** Ids to act on for keyboard edits. */
  const activeIds = useCallback((): Set<string> => {
    if (selectedIds.size > 0) return selectedIds
    if (selectedElementId === undefined) return new Set()
    const source = ids.indexOf(selectedElementId + 1)
    return itemsForElements(schedule, new Set([source]))
  }, [ids, schedule, selectedElementId, selectedIds])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    updateSelectedElementId(undefined)
  }, [updateSelectedElementId])

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (recording) return
      const target = activeIds()
      if (event.key === 'Escape') {
        clearSelection()
        onRecordCursor?.(null)
        event.stopPropagation()
        return
      }
      if (target.size === 0) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        event.stopPropagation()
        commit(removeItems(schedule, target))
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        event.stopPropagation()
        const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowLeft' ? -1 : 1)
        const next = moveItems(schedule, target, step)
        const first = [...target][0]
        const bar = next.bars.find((b) => b.id === first)
        const instant = next.instants.find((i) => i.id === first)
        commit(
          next,
          bar
            ? { track: bar.track, at: bar.start }
            : instant
              ? { track: EVENTS_TRACK, at: instant.at }
              : undefined
        )
      }
    },
    [activeIds, clearSelection, commit, onRecordCursor, recording, schedule]
  )

  // Elements dragged in from the palette.
  const onDragOver = useCallback(
    (event: ReactDragEvent) => {
      if (recording || !event.dataTransfer.types.includes(ELEMENT_DRAG_TYPE)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setDropHint(Math.max(0, msAt(event.clientX)))
    },
    [msAt, recording]
  )
  const onDrop = useCallback(
    (event: ReactDragEvent) => {
      setDropHint(null)
      const raw = event.dataTransfer.getData(ELEMENT_DRAG_TYPE)
      if (!raw || recording) return
      event.preventDefault()
      let element: ActionEventType
      try {
        element = JSON.parse(raw) as ActionEventType
      } catch {
        return
      }
      const at = snapMs(schedule, msAt(event.clientX), new Set(), event.shiftKey)
      if (element.type === 'KeyPressEventAction') {
        const track = keyTrack(element.data.keypress)
        commit(addBar(schedule, track, at, element.data.press_duration || DefaultMacroDelay), {
          track,
          at
        })
      } else if (element.type === 'MouseEventAction') {
        const action = element.data.data
        const track = mouseTrack(action.button)
        const length = action.type === 'DownUp' ? action.duration : DefaultMacroDelay
        commit(addBar(schedule, track, at, length), { track, at })
      } else if (element.type === 'SystemEventAction') {
        commit(addInstant(schedule, element, at), { track: EVENTS_TRACK, at })
      } else if (element.type === 'DelayEventAction') {
        // A delay is a gap: push everything at or after the drop point.
        const later = new Set<string>()
        for (const bar of schedule.bars) if (bar.start >= at) later.add(bar.id)
        for (const i of schedule.instants) if (i.at >= at) later.add(i.id)
        const next = later.size > 0 ? moveItems(schedule, later, element.data) : setTotal(schedule, schedule.total + element.data)
        commit(next)
      }
    },
    [commit, msAt, recording, schedule, snapMs]
  )

  const width = canvasWidth(extent, pxPerMs, 0)
  const step = tickStep(pxPerMs)
  const tickList = ticks(width / pxPerMs, step)

  const scrollbarStyles = useScrollbarStyles()
  const borderColour = useBorderColour()
  // Same panel background as the list view, so switching views does not change the tone.
  const panelBg = useColorModeValue('primary-light.100', 'bg-dark')
  const rowBg = useColorModeValue('primary-light.50', 'primary-dark.800')
  const rowAltBg = useColorModeValue('primary-light.100', 'primary-dark.700')
  const gridColour = useColorModeValue('blackAlpha.200', 'whiteAlpha.200')
  const barColour = useColorModeValue('primary-accent.500', 'primary-accent.400')
  const barSelected = useColorModeValue('primary-accent.700', 'primary-accent.200')
  const triggerColour = useColorModeValue('purple.500', 'purple.300')
  const endColour = useColorModeValue('primary-accent.600', 'primary-accent.400')
  const mutedText = useColorModeValue('gray.600', 'gray.400')
  const playheadColour = useColorModeValue('green.500', 'green.300')
  const recordColour = useColorModeValue('red.500', 'red.300')
  const bandColour = useColorModeValue('rgba(66, 153, 225, 0.2)', 'rgba(144, 205, 244, 0.2)')
  const bandBorder = useColorModeValue('blue.400', 'blue.200')
  const rowSelectedBg = useColorModeValue('primary-accent.100', 'primary-accent.800')

  const bracketLabel = useMemo(() => {
    const count = macro.repeat_count ?? null
    switch (macro.macro_type) {
      case 'OnHold':
        return 'While held'
      case 'Toggle':
        return count ? `× ${count}, or until toggled` : 'Until toggled'
      default:
        return count && count > 1 ? `× ${count}` : 'Once'
    }
  }, [macro.macro_type, macro.repeat_count])

  if (ordered.length === 0) {
    return (
      <Flex
        w="full"
        h="full"
        align="center"
        justify="center"
        px={4}
        bg={panelBg}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(ELEMENT_DRAG_TYPE)) event.preventDefault()
        }}
        onDrop={(event) => {
          const raw = event.dataTransfer.getData(ELEMENT_DRAG_TYPE)
          if (!raw) return
          event.preventDefault()
          try {
            const element = JSON.parse(raw) as ActionEventType
            overwriteSequence([element])
          } catch {
            /* ignore */
          }
        }}
      >
        <Text fontSize="sm" color={mutedText} textAlign="center">
          No elements yet. Record a sequence, click a key in the palette or drag one
          here; each press becomes a bar on its key&apos;s row.
        </Text>
      </Flex>
    )
  }

  const totalX = view.total * pxPerMs
  const tracksHeight = view.tracks.length * ROW_HEIGHT
  const rowOf = (track: string) => view.tracks.findIndex((t) => t.id === track)
  const ghostOffset = looping ? iteration : null

  return (
    <Flex direction="column" w="full" h="full" minH={0} bg={panelBg}>
      <HStack w="full" px={[2, 4, 6]} py={1} justify="space-between" spacing={2}>
        <Tooltip
          label="Drag a bar to move it (Shift snaps to 10 ms), its edges to resize; right-click a bar for duplicate, delete and move-to-key. Click a row label to select the whole row, right-click it to change its key or delete it. Drag on empty space to add a press, click to place the record cursor, Ctrl+drag to select several. Drag the end marker to set the gap before the next loop. Delete removes, arrows nudge."
          hasArrow
          variant="brand"
          openDelay={300}
        >
          <Text fontSize="xs" color={mutedText} noOfLines={1} cursor="help">
            One iteration: {formatMs(view.total)}
            {looping && iteration > view.total
              ? `, loops every ${formatMs(iteration)} (minimum loop time)`
              : ''}
            . Hover for editing help.
          </Text>
        </Tooltip>
        <HStack spacing={1} flexShrink={0}>
          <Tooltip label="Zoom out (Ctrl + wheel)" hasArrow variant="brand">
            <IconButton
              aria-label="Zoom out"
              icon={<MinusIcon boxSize={2.5} />}
              size="xs"
              variant="brand"
              onClick={() => zoomBy(1 / 1.5)}
            />
          </Tooltip>
          <Tooltip label="Fit the whole macro" hasArrow variant="brand">
            <Box as="button" fontSize="xs" px={2} onClick={fit}>
              Fit
            </Box>
          </Tooltip>
          <Tooltip label="Zoom in (Ctrl + wheel)" hasArrow variant="brand">
            <IconButton
              aria-label="Zoom in"
              icon={<AddIcon boxSize={2.5} />}
              size="xs"
              variant="brand"
              onClick={() => zoomBy(1.5)}
            />
          </Tooltip>
        </HStack>
      </HStack>

      <Box
        ref={scrollRef}
        flex="1"
        minH={0}
        w="full"
        overflow="auto"
        sx={scrollbarStyles}
        position="relative"
        tabIndex={0}
        outline="none"
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) clearSelection()
        }}
        onDragOver={onDragOver}
        onDragLeave={() => setDropHint(null)}
        onDrop={onDrop}
      >
        <Box position="relative" w={`${LABEL_WIDTH + width}px`} minW="100%" minH="full">
          {/* Ruler */}
          <Box
            position="sticky"
            top={0}
            zIndex={3}
            h={`${RULER_HEIGHT}px`}
            bg={rowBg}
            borderBottom="1px solid"
            borderColor={borderColour}
          >
            <Box
              position="sticky"
              left={0}
              zIndex={4}
              w={`${LABEL_WIDTH}px`}
              h="full"
              bg={rowBg}
              float="left"
            />
            {tickList.map((t) => (
              <Text
                key={t}
                position="absolute"
                left={`${LABEL_WIDTH + t * pxPerMs}px`}
                top="4px"
                fontSize="10px"
                color={mutedText}
                pl={1}
                borderLeft="1px solid"
                borderColor={gridColour}
                lineHeight="1"
                userSelect="none"
                pointerEvents="none"
              >
                {formatMs(t)}
              </Text>
            ))}
          </Box>

          {/* Tracks */}
          <Box position="relative" h={`${tracksHeight}px`}>
            {view.tracks.map((track, row) => (
              <TrackRow
                key={track.id}
                track={track}
                top={row * ROW_HEIGHT}
                bg={row % 2 === 0 ? rowBg : rowAltBg}
                labelBg={rowBg}
                selected={track.kind !== 'events' && rowSelected(track.id)}
                selectedBg={rowSelectedBg}
                width={width}
                onLabelClick={(event) => {
                  if (recording || track.kind === 'events') return
                  selectRow(track.id, event.ctrlKey || event.metaKey || event.shiftKey)
                  scrollRef.current?.focus()
                }}
                onLabelContextMenu={(event) => {
                  if (recording || track.kind === 'events') return
                  event.preventDefault()
                  setMenu({ x: event.clientX, y: event.clientY, kind: 'row', id: track.id })
                }}
                onPointerDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  if (event.ctrlKey || event.metaKey) {
                    beginDrag({ kind: 'band', startX: event.clientX, startY: event.clientY }, event)
                    return
                  }
                  const anchor = snapMs(schedule, msAt(event.clientX), new Set(), event.shiftKey)
                  if (track.kind === 'events') {
                    clearSelection()
                    onRecordCursor?.(Math.round(anchor))
                    return
                  }
                  beginDrag(
                    { kind: 'draw', track: track.id, anchor, moved: false, startX: event.clientX },
                    event
                  )
                }}
              />
            ))}
            {tickList.map((t) => (
              <Box
                key={t}
                position="absolute"
                left={`${LABEL_WIDTH + t * pxPerMs}px`}
                top={0}
                h="full"
                borderLeft="1px solid"
                borderColor={gridColour}
                pointerEvents="none"
              />
            ))}
            {/* Ghost of the next iteration */}
            {ghostOffset !== null &&
              view.bars.map((bar) => (
                <Box
                  key={`g${bar.id}`}
                  position="absolute"
                  left={`${LABEL_WIDTH + (ghostOffset + bar.start) * pxPerMs}px`}
                  top={`${rowOf(bar.track) * ROW_HEIGHT + BAR_INSET}px`}
                  w={`${Math.max((bar.end - bar.start) * pxPerMs, 3)}px`}
                  h={`${ROW_HEIGHT - BAR_INSET * 2}px`}
                  bg={barColour}
                  opacity={0.25}
                  rounded="sm"
                  pointerEvents="none"
                />
              ))}
            {ghostOffset !== null &&
              view.instants.map((instant) => (
                <Box
                  key={`g${instant.id}`}
                  position="absolute"
                  left={`${LABEL_WIDTH + (ghostOffset + instant.at) * pxPerMs - 6}px`}
                  top={`${rowOf(EVENTS_TRACK) * ROW_HEIGHT + BAR_INSET + 4}px`}
                  w="12px"
                  h="12px"
                  bg={barColour}
                  opacity={0.25}
                  transform="rotate(45deg)"
                  rounded="2px"
                  pointerEvents="none"
                />
              ))}
            {view.bars.map((bar) => (
              <BarView
                key={bar.id}
                bar={bar}
                row={rowOf(bar.track)}
                pxPerMs={pxPerMs}
                colour={isSelected(bar) ? barSelected : barColour}
                selected={isSelected(bar)}
                onContextMenu={(event) => openItemMenu(bar, event)}
                onPointerDown={(event, edge) => {
                  if (edge) {
                    beginDrag({ kind: 'resize', id: bar.id, edge, track: bar.track }, event)
                    return
                  }
                  const group = selectedIds.has(bar.id) ? selectedIds : new Set([bar.id])
                  beginDrag(
                    {
                      kind: 'move',
                      ids: group,
                      primary: bar,
                      startX: event.clientX,
                      startY: event.clientY,
                      row: rowOf(bar.track),
                      moved: false,
                      shift: event.shiftKey
                    },
                    event
                  )
                }}
              />
            ))}
            {view.instants.map((instant) => (
              <InstantView
                key={instant.id}
                instant={instant}
                row={rowOf(EVENTS_TRACK)}
                pxPerMs={pxPerMs}
                colour={isSelected(instant) ? barSelected : barColour}
                selected={isSelected(instant)}
                onContextMenu={(event) => openItemMenu(instant, event)}
                onPointerDown={(event) => {
                  const group = selectedIds.has(instant.id) ? selectedIds : new Set([instant.id])
                  beginDrag(
                    {
                      kind: 'move',
                      ids: group,
                      primary: instant,
                      startX: event.clientX,
                      startY: event.clientY,
                      row: rowOf(EVENTS_TRACK),
                      moved: false,
                      shift: event.shiftKey
                    },
                    event
                  )
                }}
              />
            ))}
            {playhead !== null && (
              <Box
                position="absolute"
                left={`${LABEL_WIDTH + Math.min(playhead, extent) * pxPerMs - 1}px`}
                top={0}
                h="full"
                w="2px"
                bg={recording ? recordColour : playheadColour}
                zIndex={2}
                pointerEvents="none"
              />
            )}
            {recordCursor !== null && !recording && (
              <Tooltip label={`Recording starts here, at ${formatMs(recordCursor)}. Escape clears.`} hasArrow variant="brand">
                <Box
                  position="absolute"
                  left={`${LABEL_WIDTH + recordCursor * pxPerMs - 1}px`}
                  top={0}
                  h="full"
                  w="2px"
                  borderLeft="2px dashed"
                  borderColor={recordColour}
                  zIndex={2}
                />
              </Tooltip>
            )}
            {dropHint !== null && (
              <Box
                position="absolute"
                left={`${LABEL_WIDTH + dropHint * pxPerMs - 1}px`}
                top={0}
                h="full"
                w="2px"
                bg={playheadColour}
                opacity={0.7}
                zIndex={2}
                pointerEvents="none"
              />
            )}
            {band && (
              <Box
                position="absolute"
                left={`${band.left}px`}
                top={`${band.top}px`}
                w={`${band.width}px`}
                h={`${band.height}px`}
                bg={bandColour}
                border="1px solid"
                borderColor={bandBorder}
                zIndex={3}
                pointerEvents="none"
              />
            )}
            <Marker x={LABEL_WIDTH} colour={triggerColour} label="Trigger press" />
            <Marker
              x={LABEL_WIDTH + totalX}
              colour={endColour}
              label={`End of the sequence, ${formatMs(view.total)}. Drag to set the gap before the next loop.`}
              onPointerDown={(event) => beginDrag({ kind: 'end' }, event)}
            />
            {ghostOffset !== null && (
              <Marker
                x={LABEL_WIDTH + ghostOffset * pxPerMs}
                colour={triggerColour}
                label={`Next iteration starts here (${formatMs(iteration)}) while the macro keeps looping`}
                faint
              />
            )}
          </Box>

          {/* Bracket */}
          <Box position="relative" h={`${BRACKET_HEIGHT}px`} pointerEvents="none">
            <Box
              position="absolute"
              left={`${LABEL_WIDTH}px`}
              w={`${Math.max(totalX, 1)}px`}
              top="8px"
              h="10px"
              borderLeft="2px solid"
              borderRight="2px solid"
              borderBottom="1px solid"
              borderLeftColor={triggerColour}
              borderRightColor={endColour}
              borderBottomColor={mutedText}
            />
            <Text
              position="absolute"
              left={`${LABEL_WIDTH + Math.max(totalX, 1) / 2}px`}
              transform="translateX(-50%)"
              top="10px"
              fontSize="10px"
              color={mutedText}
              px={1}
              bg={rowBg}
              whiteSpace="nowrap"
              userSelect="none"
            >
              {bracketLabel}
            </Text>
          </Box>
        </Box>
      </Box>
      {menu && (
        <TimelineMenu
          x={menu.x}
          y={menu.y}
          title={
            menu.kind === 'row'
              ? `Row ${trackLabel(view.tracks.find((t) => t.id === menu.id) ?? { id: menu.id, kind: 'key', code: 0 })}`
              : undefined
          }
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
      <KeyPickerModal
        isOpen={picker !== null}
        title={picker?.title ?? ''}
        onClose={() => setPicker(null)}
        onPick={(track) => {
          if (picker) rekey(picker.ids, track)
        }}
      />
    </Flex>
  )
}

function trackLabel(track: Track): string {
  if (track.kind === 'events') return 'Events'
  if (track.kind === 'key') return HIDLookup.get(track.code)?.displayString ?? '?'
  return mouseEnumLookup.get(track.code)?.displayString ?? '?'
}

function TrackRow({
  track,
  top,
  bg,
  labelBg,
  selected,
  selectedBg,
  width,
  onPointerDown,
  onLabelClick,
  onLabelContextMenu
}: {
  track: Track
  top: number
  bg: string
  labelBg: string
  selected: boolean
  selectedBg: string
  width: number
  onPointerDown: (event: ReactPointerEvent) => void
  onLabelClick: (event: React.MouseEvent) => void
  onLabelContextMenu: (event: React.MouseEvent) => void
}) {
  const label = trackLabel(track)
  return (
    <Box
      position="absolute"
      top={`${top}px`}
      left={0}
      h={`${ROW_HEIGHT}px`}
      minW="100%"
      w={`${LABEL_WIDTH + width}px`}
      bg={bg}
      cursor={track.kind === 'events' ? 'default' : 'crosshair'}
      onPointerDown={onPointerDown}
    >
      <Flex
        position="sticky"
        left={0}
        zIndex={2}
        w={`${LABEL_WIDTH}px`}
        h="full"
        align="center"
        px={2}
        bg={selected ? selectedBg : labelBg}
        borderRight="1px solid"
        borderColor="blackAlpha.200"
        cursor={track.kind === 'events' ? 'default' : 'pointer'}
        title={track.kind === 'events' ? undefined : 'Click to select the whole row, right-click for more'}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onLabelClick}
        onContextMenu={onLabelContextMenu}
      >
        {track.kind === 'events' ? (
          <Text fontSize="xs" fontWeight="semibold" noOfLines={1}>
            {label}
          </Text>
        ) : (
          <Kbd fontSize="xs" maxW="full" overflow="hidden" textOverflow="ellipsis">
            {label}
          </Kbd>
        )}
      </Flex>
    </Box>
  )
}

function BarView({
  bar,
  row,
  pxPerMs,
  colour,
  selected,
  onPointerDown,
  onContextMenu
}: {
  bar: Bar
  row: number
  pxPerMs: number
  colour: string
  selected: boolean
  onPointerDown: (event: ReactPointerEvent, edge?: 'start' | 'end') => void
  onContextMenu: (event: React.MouseEvent) => void
}) {
  const length = bar.end - bar.start
  const widthPx = Math.max(length * pxPerMs, 3)
  const label = `${formatMs(length)} at ${formatMs(bar.start)}${
    bar.openEnd ? ', held after the sequence' : ''
  }${bar.openStart ? ', released without a press' : ''}`
  const edges = widthPx >= EDGE_PX * 3
  return (
    <Tooltip label={label} hasArrow variant="brand" openDelay={400} isDisabled={selected}>
      <Box
        position="absolute"
        left={`${LABEL_WIDTH + bar.start * pxPerMs}px`}
        top={`${row * ROW_HEIGHT + BAR_INSET}px`}
        w={`${widthPx}px`}
        h={`${ROW_HEIGHT - BAR_INSET * 2}px`}
        bg={colour}
        rounded="sm"
        cursor="grab"
        zIndex={1}
        outline={selected ? '2px solid' : undefined}
        outlineColor="whiteAlpha.900"
        outlineOffset="1px"
        sx={
          bar.openEnd
            ? { maskImage: 'linear-gradient(to right, black 60%, transparent)' }
            : bar.openStart
              ? { maskImage: 'linear-gradient(to left, black 60%, transparent)' }
              : undefined
        }
        onPointerDown={(event) => onPointerDown(event)}
        onContextMenu={onContextMenu}
      >
        {edges && !bar.openStart && (
          <Box
            position="absolute"
            left={0}
            top={0}
            w={`${EDGE_PX}px`}
            h="full"
            cursor="ew-resize"
            onPointerDown={(event) => onPointerDown(event, 'start')}
          />
        )}
        {edges && !bar.openEnd && (
          <Box
            position="absolute"
            right={0}
            top={0}
            w={`${EDGE_PX}px`}
            h="full"
            cursor="ew-resize"
            onPointerDown={(event) => onPointerDown(event, 'end')}
          />
        )}
      </Box>
    </Tooltip>
  )
}

function InstantView({
  instant,
  row,
  pxPerMs,
  colour,
  selected,
  onPointerDown,
  onContextMenu
}: {
  instant: Instant
  row: number
  pxPerMs: number
  colour: string
  selected: boolean
  onPointerDown: (event: ReactPointerEvent) => void
  onContextMenu: (event: React.MouseEvent) => void
}) {
  const label = getElementDisplayString(instant.element)
  const widthPx = Math.max(instant.width * pxPerMs, 0)
  return (
    <Tooltip label={`${label} at ${formatMs(instant.at)}`} hasArrow variant="brand" openDelay={400}>
      <HStack
        position="absolute"
        left={`${LABEL_WIDTH + instant.at * pxPerMs - 6}px`}
        top={`${row * ROW_HEIGHT + BAR_INSET}px`}
        h={`${ROW_HEIGHT - BAR_INSET * 2}px`}
        spacing={1}
        cursor="grab"
        zIndex={1}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
      >
        <Box
          w="12px"
          h="12px"
          bg={colour}
          transform="rotate(45deg)"
          rounded="2px"
          outline={selected ? '2px solid' : undefined}
          outlineColor="whiteAlpha.900"
          flexShrink={0}
        />
        {widthPx > 0 && <Box h="4px" w={`${widthPx}px`} bg={colour} opacity={0.6} />}
        <Text fontSize="10px" whiteSpace="nowrap" userSelect="none">
          {label}
        </Text>
      </HStack>
    </Tooltip>
  )
}

function Marker({
  x,
  colour,
  label,
  onPointerDown,
  faint = false
}: {
  x: number
  colour: string
  label: string
  onPointerDown?: (event: ReactPointerEvent) => void
  faint?: boolean
}) {
  return (
    <Tooltip label={label} hasArrow variant="brand" openDelay={300}>
      <Box
        position="absolute"
        left={`${x - 4}px`}
        top={0}
        h="full"
        w="8px"
        zIndex={2}
        opacity={faint ? 0.4 : 1}
        cursor={onPointerDown ? 'ew-resize' : 'default'}
        onPointerDown={onPointerDown}
      >
        <Box
          position="absolute"
          left="3px"
          top={0}
          h="full"
          w="2px"
          bg={faint ? undefined : colour}
          borderLeft={faint ? '2px dashed' : undefined}
          borderColor={colour}
        />
        {!faint && (
          <Box
            position="absolute"
            top="-5px"
            left="-1px"
            w="10px"
            h="10px"
            rounded="full"
            bg={colour}
          />
        )}
      </Box>
    </Tooltip>
  )
}
