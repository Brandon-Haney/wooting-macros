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
import {
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
import {
  Bar,
  compile,
  decompile,
  EVENTS_TRACK,
  Instant,
  Schedule,
  Track
} from '../../../../utils/schedule'
import {
  addBar,
  findItem,
  itemsForElements,
  moveBarToTrack,
  moveItems,
  removeItems,
  resizeBar,
  setTotal,
  snap
} from '../../../../utils/scheduleEdit'
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

interface Props {
  recording: boolean
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
  | { kind: 'draw'; track: string; anchor: number; moved: boolean }
  | { kind: 'end' }

interface Reselect {
  track: string
  at: number
}

/**
 * Per-key timeline of the sequence: one row per key, one bar per press,
 * system events on an Events row, the trigger press at 0 and the end of one
 * iteration at `total`. Bars can be dragged, resized and drawn; every edit
 * is decompiled back into the sequence.
 */
export default function Timeline({ recording }: Props) {
  const {
    macro,
    sequence,
    ids,
    selectedElementId,
    updateSelectedElementId,
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

  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState(0)
  const [pxPerMs, setPxPerMs] = useState(1)
  const [zoomed, setZoomed] = useState(false)
  const pxRef = useRef(pxPerMs)
  pxRef.current = pxPerMs

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
  useEffect(() => {
    if (zoomed || viewport === 0) return
    setPxPerMs(fitZoom(schedule.total, viewport - LABEL_WIDTH - 16))
  }, [schedule.total, viewport, zoomed])

  const zoomBy = useCallback((factor: number) => {
    setZoomed(true)
    setPxPerMs((current) => clampZoom(current * factor))
  }, [])
  const fit = useCallback(() => {
    setZoomed(false)
    setPxPerMs(fitZoom(schedule.total, viewport - LABEL_WIDTH - 16))
  }, [schedule.total, viewport])

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
      if (source !== undefined) updateSelectedElementId(storageIndex(source))
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
  const snapMs = useCallback(
    (base: Schedule, ms: number, ignore: Set<string>, shift: boolean) =>
      snap(base, ms, SNAP_PX / pxRef.current, ignore, shift ? 10 : 1),
    []
  )

  const scheduleRef = useRef(schedule)
  scheduleRef.current = schedule

  const beginDrag = useCallback(
    (drag: Drag, event: ReactPointerEvent) => {
      if (recording || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      dragRef.current = drag
      const base = scheduleRef.current
      let latest: Schedule = base
      let lastMs = 0

      const onMove = (e: PointerEvent) => {
        const d = dragRef.current
        if (!d) return
        const shift = e.shiftKey
        switch (d.kind) {
          case 'move': {
            if (!d.moved && Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD_PX && Math.abs(e.clientY - d.startY) < DRAG_THRESHOLD_PX) {
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
            break
          }
          case 'resize': {
            const at = snapMs(base, msAt(e.clientX), new Set([d.id]), shift)
            latest = resizeBar(base, d.id, d.edge, at)
            break
          }
          case 'draw': {
            const at = snapMs(base, msAt(e.clientX), new Set(), shift)
            if (Math.abs(at - d.anchor) >= 1) d.moved = true
            latest = addBar(base, d.track, Math.min(at, d.anchor), Math.abs(at - d.anchor))
            break
          }
          case 'end': {
            latest = setTotal(base, snapMs(base, msAt(e.clientX), new Set(), shift))
            break
          }
        }
        setDraft(latest)
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
              // A click: select, Shift adds to the selection.
              setDraft(null)
              const id = d.primary.id
              setSelectedIds((current) => {
                if (d.shift) {
                  const next = new Set(current)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                }
                return new Set([id])
              })
              const source = 'start' in d.primary ? d.primary.source[0] : d.primary.source
              if (source !== undefined) updateSelectedElementId(storageIndex(source))
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
              const at = snapMs(base, msAt(e.clientX), new Set(), e.shiftKey)
              latest = addBar(base, d.track, at, DefaultMacroDelay)
              commit(latest, { track: d.track, at })
              return
            }
            const added = latest.bars[latest.bars.length - 1]
            commit(latest, { track: d.track, at: added.start })
            return
          }
          case 'end':
            commit(latest)
            return
        }
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [commit, msAt, recording, rowAt, snapMs, storageIndex, updateSelectedElementId]
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
        commit(next, bar ? { track: bar.track, at: bar.start } : instant ? { track: EVENTS_TRACK, at: instant.at } : undefined)
      }
    },
    [activeIds, clearSelection, commit, recording, schedule]
  )

  const width = canvasWidth(view.total, pxPerMs, 0)
  const step = tickStep(pxPerMs)
  const tickList = ticks(width / pxPerMs, step)

  const scrollbarStyles = useScrollbarStyles()
  const borderColour = useBorderColour()
  const rowBg = useColorModeValue('primary-light.50', 'primary-dark.800')
  const rowAltBg = useColorModeValue('primary-light.100', 'primary-dark.700')
  const gridColour = useColorModeValue('blackAlpha.200', 'whiteAlpha.200')
  const barColour = useColorModeValue('primary-accent.500', 'primary-accent.400')
  const barSelected = useColorModeValue('primary-accent.700', 'primary-accent.200')
  const triggerColour = useColorModeValue('purple.500', 'purple.300')
  const endColour = useColorModeValue('primary-accent.600', 'primary-accent.400')
  const mutedText = useColorModeValue('gray.600', 'gray.400')

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
      <Flex w="full" h="full" align="center" justify="center" px={4}>
        <Text fontSize="sm" color={mutedText} textAlign="center">
          No elements yet. Record a sequence or add keys from the palette; each
          press becomes a bar on its key&apos;s row.
        </Text>
      </Flex>
    )
  }

  const totalX = view.total * pxPerMs
  const tracksHeight = view.tracks.length * ROW_HEIGHT
  const rowOf = (track: string) => view.tracks.findIndex((t) => t.id === track)

  return (
    <Flex direction="column" w="full" h="full" minH={0}>
      <HStack w="full" px={[2, 4, 6]} py={1} justify="space-between" spacing={2}>
        <Text fontSize="xs" color={mutedText} noOfLines={1}>
          One iteration: {formatMs(view.total)}. Drag bars to move, edges to resize, empty
          space to add; drag the end marker for the loop gap.
        </Text>
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
                width={width}
                onPointerDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  if (track.kind === 'events') {
                    clearSelection()
                    return
                  }
                  const anchor = snapMs(schedule, msAt(event.clientX), new Set(), event.shiftKey)
                  beginDrag({ kind: 'draw', track: track.id, anchor, moved: false }, event)
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
            {view.bars.map((bar) => (
              <BarView
                key={bar.id}
                bar={bar}
                row={rowOf(bar.track)}
                pxPerMs={pxPerMs}
                colour={isSelected(bar) ? barSelected : barColour}
                selected={isSelected(bar)}
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
            <Marker x={LABEL_WIDTH} colour={triggerColour} label="Trigger press" />
            <Marker
              x={LABEL_WIDTH + totalX}
              colour={endColour}
              label={`End of iteration, ${formatMs(view.total)}. Drag to set the gap before the next loop.`}
              onPointerDown={(event) => beginDrag({ kind: 'end' }, event)}
            />
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
  width,
  onPointerDown
}: {
  track: Track
  top: number
  bg: string
  labelBg: string
  width: number
  onPointerDown: (event: ReactPointerEvent) => void
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
        bg={labelBg}
        borderRight="1px solid"
        borderColor="blackAlpha.200"
        cursor="default"
        onPointerDown={(event) => event.stopPropagation()}
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
  onPointerDown
}: {
  bar: Bar
  row: number
  pxPerMs: number
  colour: string
  selected: boolean
  onPointerDown: (event: ReactPointerEvent, edge?: 'start' | 'end') => void
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
  onPointerDown
}: {
  instant: Instant
  row: number
  pxPerMs: number
  colour: string
  selected: boolean
  onPointerDown: (event: ReactPointerEvent) => void
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
  onPointerDown
}: {
  x: number
  colour: string
  label: string
  onPointerDown?: (event: ReactPointerEvent) => void
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
        cursor={onPointerDown ? 'ew-resize' : 'default'}
        onPointerDown={onPointerDown}
      >
        <Box position="absolute" left="3px" top={0} h="full" w="2px" bg={colour} />
        <Box
          position="absolute"
          top="-5px"
          left="-1px"
          w="10px"
          h="10px"
          rounded="full"
          bg={colour}
        />
      </Box>
    </Tooltip>
  )
}
