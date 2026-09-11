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
import {
  Bar,
  compile,
  EVENTS_TRACK,
  Instant,
  Schedule,
  Track
} from '../../../../utils/schedule'
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

interface Props {
  recording: boolean
}

/**
 * Per-key timeline of the sequence: one row per key, one bar per press,
 * system events on an Events row, the trigger press at 0 and the end of one
 * iteration at `total`. Read-only for now; clicking selects the element.
 */
export default function Timeline({ recording }: Props) {
  const { macro, sequence, ids, selectedElementId, updateSelectedElementId } =
    useMacroContext()

  // Elements in display order; bar sources index into this array.
  const ordered = useMemo(
    () => ids.map((id) => sequence[id - 1]).filter(Boolean),
    [ids, sequence]
  )
  const schedule = useMemo<Schedule>(() => compile(ordered), [ordered])
  /** Storage index (what `selectedElementId` holds) for a source index. */
  const storageIndex = useCallback((source: number) => ids[source] - 1, [ids])

  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState(0)
  const [pxPerMs, setPxPerMs] = useState(1)
  const [zoomed, setZoomed] = useState(false)

  // Fit on open and whenever the sequence changes until the user zooms.
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
        // Keep the ms under the pointer in place.
        const ms = x / current
        requestAnimationFrame(() => {
          node.scrollLeft = Math.max(0, ms * next - (event.clientX - rect.left - LABEL_WIDTH))
        })
        return next
      })
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  const width = canvasWidth(schedule.total, pxPerMs, 0)
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

  const isSelected = useCallback(
    (source: number[]) =>
      selectedElementId !== undefined &&
      source.some((s) => storageIndex(s) === selectedElementId),
    [selectedElementId, storageIndex]
  )

  const select = useCallback(
    (source: number[]) => {
      if (recording) return
      updateSelectedElementId(storageIndex(source[0]))
    },
    [recording, storageIndex, updateSelectedElementId]
  )

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

  const totalX = schedule.total * pxPerMs
  const tracksHeight = schedule.tracks.length * ROW_HEIGHT

  return (
    <Flex direction="column" w="full" h="full" minH={0}>
      <HStack w="full" px={[2, 4, 6]} py={1} justify="space-between" spacing={2}>
        <Text fontSize="xs" color={mutedText}>
          One iteration: {formatMs(schedule.total)}
        </Text>
        <HStack spacing={1}>
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
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            updateSelectedElementId(undefined)
          }
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
              >
                {formatMs(t)}
              </Text>
            ))}
          </Box>

          {/* Tracks */}
          <Box position="relative" h={`${tracksHeight}px`}>
            {schedule.tracks.map((track, row) => (
              <TrackRow
                key={track.id}
                track={track}
                top={row * ROW_HEIGHT}
                bg={row % 2 === 0 ? rowBg : rowAltBg}
                labelBg={rowBg}
                width={width}
                onClickEmpty={() => updateSelectedElementId(undefined)}
              />
            ))}
            {/* Grid lines */}
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
            {schedule.bars.map((bar) => (
              <BarView
                key={bar.id}
                bar={bar}
                row={schedule.tracks.findIndex((t) => t.id === bar.track)}
                pxPerMs={pxPerMs}
                colour={isSelected(bar.source) ? barSelected : barColour}
                selected={isSelected(bar.source)}
                onSelect={() => select(bar.source)}
              />
            ))}
            {schedule.instants.map((instant) => (
              <InstantView
                key={instant.id}
                instant={instant}
                row={schedule.tracks.findIndex((t) => t.id === EVENTS_TRACK)}
                pxPerMs={pxPerMs}
                colour={isSelected([instant.source]) ? barSelected : barColour}
                selected={isSelected([instant.source])}
                onSelect={() => select([instant.source])}
              />
            ))}
            {/* Markers */}
            <Marker x={LABEL_WIDTH} colour={triggerColour} label="Trigger" />
            <Marker x={LABEL_WIDTH + totalX} colour={endColour} label="End" />
          </Box>

          {/* Bracket */}
          <Box position="relative" h={`${BRACKET_HEIGHT}px`}>
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
              pointerEvents="none"
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
  onClickEmpty
}: {
  track: Track
  top: number
  bg: string
  labelBg: string
  width: number
  onClickEmpty: () => void
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
      onClick={onClickEmpty}
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
  onSelect
}: {
  bar: Bar
  row: number
  pxPerMs: number
  colour: string
  selected: boolean
  onSelect: () => void
}) {
  const length = bar.end - bar.start
  const widthPx = Math.max(length * pxPerMs, 3)
  const label = `${formatMs(length)} at ${formatMs(bar.start)}${
    bar.openEnd ? ', held after the sequence' : ''
  }${bar.openStart ? ', released without a press' : ''}`
  return (
    <Tooltip label={label} hasArrow variant="brand" openDelay={300}>
      <Box
        position="absolute"
        left={`${LABEL_WIDTH + bar.start * pxPerMs}px`}
        top={`${row * ROW_HEIGHT + BAR_INSET}px`}
        w={`${widthPx}px`}
        h={`${ROW_HEIGHT - BAR_INSET * 2}px`}
        bg={colour}
        rounded="sm"
        cursor="pointer"
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
        onClick={(event) => {
          event.stopPropagation()
          onSelect()
        }}
      />
    </Tooltip>
  )
}

function InstantView({
  instant,
  row,
  pxPerMs,
  colour,
  selected,
  onSelect
}: {
  instant: Instant
  row: number
  pxPerMs: number
  colour: string
  selected: boolean
  onSelect: () => void
}) {
  const label = getElementDisplayString(instant.element)
  const widthPx = Math.max(instant.width * pxPerMs, 0)
  return (
    <Tooltip label={`${label} at ${formatMs(instant.at)}`} hasArrow variant="brand" openDelay={300}>
      <HStack
        position="absolute"
        left={`${LABEL_WIDTH + instant.at * pxPerMs - 6}px`}
        top={`${row * ROW_HEIGHT + BAR_INSET}px`}
        h={`${ROW_HEIGHT - BAR_INSET * 2}px`}
        spacing={1}
        cursor="pointer"
        onClick={(event) => {
          event.stopPropagation()
          onSelect()
        }}
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

function Marker({ x, colour, label }: { x: number; colour: string; label: string }) {
  return (
    <Tooltip label={label} hasArrow variant="brand" openDelay={300}>
      <Box
        position="absolute"
        left={`${x - 1}px`}
        top={0}
        h="full"
        w="2px"
        bg={colour}
        zIndex={1}
        pointerEvents="auto"
        cursor="default"
      >
        <Box
          position="absolute"
          top="-5px"
          left="-4px"
          w="10px"
          h="10px"
          rounded="full"
          bg={colour}
        />
      </Box>
    </Tooltip>
  )
}
