import {
  Badge,
  Box,
  Button,
  ButtonGroup,
  HStack,
  Kbd,
  Tag,
  Textarea,
  Text,
  Tooltip,
  useColorModeValue,
  VStack,
  Wrap,
  WrapItem
} from '@chakra-ui/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api'
import { error } from 'tauri-plugin-log'
import { useMacroContext } from '../../../../contexts/macroContext'
import { HIDLookup } from '../../../../constants/HIDmap'
import { mouseEnumLookup } from '../../../../constants/MouseMap'
import { getElementDisplayString } from '../../../../constants/utils'
import { DEFAULT_HOLD_THRESHOLD_MS } from '../../../../constants/enums'
import useSchedule from '../../../../hooks/useSchedule'
import { keyTrack, mouseTrack } from '../../../../utils/schedule'
import {
  HistoryEntry,
  Simulation,
  SimulationPhase,
  SimulationState
} from '../../../../utils/simulation'
import { isShiftTrack, typedText } from '../../../../utils/keyText'
import { formatMs } from '../../../../utils/timelineMath'

interface Props {
  /** Reports the playhead within the current iteration, or null when idle. */
  onPlayhead: (ms: number | null) => void
}

const PHASE_LABEL: Record<SimulationPhase, string> = {
  idle: 'IDLE',
  holding: 'HOLDING',
  running: 'RUNNING',
  completed: 'COMPLETED',
  stopped: 'STOPPED'
}
const PHASE_COLOUR: Record<SimulationPhase, string> = {
  idle: 'gray',
  holding: 'purple',
  running: 'green',
  completed: 'blue',
  stopped: 'orange'
}
const HISTORY_LIMIT = 80

function trackLabel(track: string): string {
  const code = Number(track.slice(2))
  if (track.startsWith('k:')) return HIDLookup.get(code)?.displayString ?? '?'
  return mouseEnumLookup.get(code)?.displayString ?? '?'
}

/**
 * Plays the macro virtually: Start presses the trigger, Release lets it go,
 * and the panel shows the keys the macro holds and everything it has sent.
 */
export default function SimulationPanel({ onPlayhead }: Props) {
  const { macro } = useMacroContext()
  const { schedule, ordered } = useSchedule()
  const [padText, setPadText] = useState('')
  const pad = useRef<HTMLTextAreaElement>(null)
  const [speed, setSpeed] = useState(1)
  const [state, setState] = useState<SimulationState | null>(null)
  const simulation = useRef<Simulation | null>(null)
  const frame = useRef<number | null>(null)
  const lastTick = useRef(0)

  const triggerTracks = useMemo(() => {
    if (macro.trigger.type === 'KeyPressEvent') return macro.trigger.data.map(keyTrack)
    return macro.trigger.data === undefined ? [] : [mouseTrack(macro.trigger.data)]
  }, [macro.trigger])

  const publish = useCallback(() => {
    const sim = simulation.current
    if (!sim) return
    const current = sim.current
    setState({ ...current })
    onPlayhead(current.playhead)
  }, [onPlayhead])

  const stopLoop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }, [])

  const tick = useCallback(
    (time: number) => {
      const sim = simulation.current
      if (!sim) return
      const dt = (time - lastTick.current) * speed
      lastTick.current = time
      sim.advance(dt)
      publish()
      const phase = sim.current.phase
      if (phase === 'running' || phase === 'holding') {
        frame.current = requestAnimationFrame(tick)
      } else {
        frame.current = null
      }
    },
    [publish, speed]
  )

  const startLoop = useCallback(() => {
    if (frame.current !== null) return
    lastTick.current = performance.now()
    frame.current = requestAnimationFrame(tick)
  }, [tick])

  // Rebuild the player whenever the macro or its sequence changes.
  useEffect(() => {
    stopLoop()
    simulation.current = new Simulation({
      schedule,
      macroType: macro.macro_type,
      holdThresholdMs: macro.hold_threshold_ms ?? DEFAULT_HOLD_THRESHOLD_MS,
      tapMode: macro.tap_mode ?? 'DeferredTap',
      repeatCount: macro.repeat_count ?? null,
      triggerTracks
    })
    publish()
    return stopLoop
  }, [
    macro.hold_threshold_ms,
    macro.macro_type,
    macro.repeat_count,
    macro.tap_mode,
    publish,
    schedule,
    stopLoop,
    triggerTracks
  ])

  const onStart = useCallback(() => {
    simulation.current?.press()
    publish()
    startLoop()
  }, [publish, startLoop])
  const onRelease = useCallback(() => {
    simulation.current?.release()
    publish()
    startLoop()
  }, [publish, startLoop])
  const onReset = useCallback(() => {
    stopLoop()
    simulation.current?.reset()
    publish()
  }, [publish, stopLoop])

  /** Plays the macro through the real executor with focus in the text box below. */
  const runForReal = useCallback(() => {
    pad.current?.focus()
    invoke<void>('run_macro', { macros: { ...macro, sequence: ordered } }).catch((e: string) =>
      error(e)
    )
  }, [macro, ordered])

  const mutedText = useColorModeValue('gray.600', 'gray.400')
  const panelBg = useColorModeValue('primary-light.50', 'primary-dark.800')
  const noteColour = useColorModeValue('purple.600', 'purple.200')

  if (!state) return null

  const isOnHold = macro.macro_type === 'OnHold'
  const isToggle = macro.macro_type === 'Toggle'
  const busy = state.phase === 'running' || state.phase === 'holding'
  const startLabel = isToggle && state.phase === 'running' ? 'Trigger again' : 'Start'

  // Shift held by the macro at a time: a Shift bar covering it.
  const shiftHeldAt = (at: number) =>
    schedule.bars.some(
      (bar) => isShiftTrack(bar.track) && bar.start <= at % Math.max(1, schedule.total) && at % Math.max(1, schedule.total) < bar.end
    )
  const text = typedText(state.history, shiftHeldAt)
  const history = state.history.slice(-HISTORY_LIMIT)

  return (
    <VStack align="stretch" w="full" px={[2, 4, 6]} py={2} spacing={2} bg={panelBg} fontSize="sm">
      <HStack spacing={3} flexWrap="wrap" rowGap={2}>
        <Text fontWeight="semibold">Simulation</Text>
        <Badge colorScheme={PHASE_COLOUR[state.phase]} variant="subtle">
          {PHASE_LABEL[state.phase]}
        </Badge>
        <Text fontSize="xs" color={mutedText}>
          {formatMs(Math.round(state.now))} · loop {state.loops}
          {busy && state.playhead !== null ? ` · ${formatMs(Math.round(state.playhead))} in` : ''}
        </Text>
        <HStack ml="auto" spacing={2}>
          <ButtonGroup size="xs" isAttached variant="brand">
            <Tooltip label="Real time" hasArrow variant="brand">
              <Button isActive={speed === 1} onClick={() => setSpeed(1)}>
                1×
              </Button>
            </Tooltip>
            <Tooltip label="Quarter speed" hasArrow variant="brand">
              <Button isActive={speed === 0.25} onClick={() => setSpeed(0.25)}>
                ¼×
              </Button>
            </Tooltip>
          </ButtonGroup>
          <Tooltip label="Press the trigger" hasArrow variant="brand">
            <Button
              size="xs"
              variant="yellowGradient"
              onClick={onStart}
              isDisabled={busy && !isToggle}
            >
              {startLabel}
            </Button>
          </Tooltip>
          {isOnHold && (
            <Tooltip label="Let go of the trigger" hasArrow variant="brand">
              <Button size="xs" variant="brand" onClick={onRelease} isDisabled={!busy}>
                Release
              </Button>
            </Tooltip>
          )}
          <Button size="xs" variant="brand" onClick={onReset} isDisabled={state.phase === 'idle'}>
            Reset
          </Button>
        </HStack>
      </HStack>

      <HStack align="start" spacing={6} flexWrap="wrap" rowGap={2}>
        <VStack align="start" spacing={1} minW="120px">
          <Text fontSize="xs" color={mutedText}>
            Active keys
          </Text>
          {state.active.length === 0 ? (
            <Text fontSize="xs" fontStyle="italic" color={mutedText}>
              None
            </Text>
          ) : (
            <Wrap spacing={1}>
              {state.active.map((track) => (
                <WrapItem key={track}>
                  <Kbd fontSize="xs">{trackLabel(track)}</Kbd>
                </WrapItem>
              ))}
            </Wrap>
          )}
        </VStack>
        <VStack align="start" spacing={1} flex="1" minW="200px">
          <Text fontSize="xs" color={mutedText}>
            Output preview (US layout)
          </Text>
          <Box
            as="pre"
            fontSize="xs"
            fontFamily="mono"
            whiteSpace="pre-wrap"
            wordBreak="break-all"
            maxH="60px"
            overflowY="auto"
            w="full"
            m={0}
          >
            {text || ' '}
          </Box>
        </VStack>
      </HStack>

      <VStack align="start" spacing={1} w="full">
        <HStack w="full" justify="space-between">
          <Text fontSize="xs" color={mutedText}>
            Test pad: the sequence is sent for real, once, with the cursor in this box
          </Text>
          <Tooltip
            label="Runs the sequence through the same executor as a trigger would. Keep the cursor in the box; whatever has focus receives the keys."
            hasArrow
            variant="brand"
          >
            <Button size="xs" variant="brand" onClick={runForReal}>
              Run for real
            </Button>
          </Tooltip>
        </HStack>
        <Textarea
          ref={pad}
          size="xs"
          rows={2}
          resize="vertical"
          value={padText}
          onChange={(event) => setPadText(event.target.value)}
          placeholder="Click here, then Run for real"
          fontFamily="mono"
        />
      </VStack>

      <VStack align="start" spacing={1}>
        <Text fontSize="xs" color={mutedText}>
          Key history{state.history.length > HISTORY_LIMIT ? ` (last ${HISTORY_LIMIT})` : ''}
        </Text>
        {history.length === 0 ? (
          <Text fontSize="xs" fontStyle="italic" color={mutedText}>
            Nothing sent yet. Press Start.
          </Text>
        ) : (
          <Wrap spacing={1} maxH="96px" overflowY="auto" w="full">
            {history.map((entry, index) => (
              <WrapItem key={index}>
                <HistoryChip entry={entry} noteColour={noteColour} />
              </WrapItem>
            ))}
          </Wrap>
        )}
      </VStack>
    </VStack>
  )
}

function HistoryChip({ entry, noteColour }: { entry: HistoryEntry; noteColour: string }) {
  switch (entry.kind) {
    case 'key':
      return (
        <Tooltip
          label={`${formatMs(Math.round(entry.at))}${entry.note ? `, ${entry.note}` : ''}`}
          hasArrow
          variant="brand"
          openDelay={300}
        >
          <Kbd fontSize="xs" opacity={entry.note ? 0.75 : 1}>
            {trackLabel(entry.track)}
          </Kbd>
        </Tooltip>
      )
    case 'event':
      return (
        <Tag size="sm" variant="subtle" colorScheme="yellow">
          {getElementDisplayString(entry.element)}
        </Tag>
      )
    default:
      return (
        <Text fontSize="xs" color={noteColour} px={1}>
          {entry.label}
        </Text>
      )
  }
}
