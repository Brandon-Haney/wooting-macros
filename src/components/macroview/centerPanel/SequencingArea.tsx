import {
  Alert,
  AlertDescription,
  Box,
  AlertIcon,
  Button,
  ButtonGroup,
  Divider,
  HStack,
  IconButton,
  Stack,
  Tooltip,
  useDisclosure,
  VStack
} from '@chakra-ui/react'
import { DeleteIcon, EditIcon, SettingsIcon, TimeIcon } from '@chakra-ui/icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMacroContext } from '../../../contexts/macroContext'
import useRecordingSequence from '../../../hooks/useRecordingSequence'
import { useSettingsContext } from '../../../contexts/settingsContext'
import { checkIfElementIsEditable } from '../../../constants/utils'
import { compile, decompile, Schedule } from '../../../utils/schedule'
import ClearSequenceModal from './ClearSequenceModal'
import BulkEditModal from './BulkEditModal'
import { RecordIcon, StopIcon } from '../../icons'
import SortableList from './SortableList'
import Timeline from './timeline/Timeline'
import SimulationPanel from './timeline/SimulationPanel'
import { ListIcon, SimulateIcon, TimelineIcon } from '../../icons'
import useMainBgColour from '../../../hooks/useMainBgColour'

interface Props {
  onOpenMacroSettingsModal: () => void
}

export default function SequencingArea({ onOpenMacroSettingsModal }: Props) {
  const {
    sequence,
    ids,
    willCauseTriggerLooping,
    onElementAdd,
    overwriteSequence,
    updateSelectedElementId
  } = useMacroContext()
  const { config, updateSequenceView } = useSettingsContext()
  const timelineView = config.SequenceView === 'Timeline'
  const [simulate, setSimulate] = useState(false)
  const [playhead, setPlayhead] = useState<number | null>(null)
  // Where a recording is inserted on the timeline; null appends at the end.
  const [recordCursor, setRecordCursor] = useState<number | null>(null)
  const [recordingPlayhead, setRecordingPlayhead] = useState<number | null>(null)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const {
    isOpen: isBulkOpen,
    onOpen: onBulkOpen,
    onClose: onBulkClose
  } = useDisclosure()

  // The schedule as it was when recording started and where the recording
  // goes; recorded bars are merged in after every key so both views update live.
  const base = useRef<Schedule>(compile([]))
  const insertAt = useRef(0)

  const onRecorded = useCallback(
    (recorded: Schedule) => {
      const offset = insertAt.current
      const merged: Schedule = {
        tracks: [
          ...base.current.tracks,
          ...recorded.tracks.filter((t) => !base.current.tracks.some((b) => b.id === t.id))
        ],
        bars: [
          ...base.current.bars,
          ...recorded.bars.map((bar) => ({
            ...bar,
            id: `rec${bar.id}`,
            start: bar.start + offset,
            end: bar.end + offset
          }))
        ],
        instants: base.current.instants,
        total: Math.max(base.current.total, offset + recorded.total)
      }
      const next = decompile(merged)
      overwriteSequence(next)
      const last = next[next.length - 1]
      if (config.AutoSelectElement && last && checkIfElementIsEditable(last)) {
        updateSelectedElementId(next.length - 1)
      } else {
        updateSelectedElementId(undefined)
      }
    },
    [config.AutoSelectElement, overwriteSequence, updateSelectedElementId]
  )

  const recorder = useRecordingSequence(onRecorded, {
    fixedStepMs: config.RecordFixedTimings ? config.DefaultDelayValue : undefined
  })
  const { recording, stopRecording, elapsed } = recorder
  const startRecording = useCallback(() => {
    base.current = compile(ids.map((id) => sequence[id - 1]).filter(Boolean))
    insertAt.current = timelineView && recordCursor !== null ? recordCursor : base.current.total
    recorder.startRecording()
  }, [ids, recordCursor, recorder, sequence, timelineView])

  // Live playhead while recording.
  useEffect(() => {
    if (!recording) {
      setRecordingPlayhead(null)
      return
    }
    let frame = 0
    const tick = () => {
      setRecordingPlayhead(insertAt.current + elapsed())
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [elapsed, recording])

  return (
    <VStack flex="1" minW={0} h="full" bg={useMainBgColour()} justifyContent="top">
      {/** Header */}
      <VStack w="full" px={[2, 4, 6]} pt={[2, 4]}>
        <Stack
          direction={['column', 'row']}
          w="full"
          textAlign="left"
          justifyContent="space-between"
          alignItems={['start', 'center']}
        >
          {willCauseTriggerLooping && (
            <Alert
              status="info"
              w={['full', 'fit']}
              rounded="md"
              py="1"
              px={['2', '3']}
            >
              <AlertIcon boxSize={['16px', '20px']} />
              <AlertDescription fontSize={['xs', 'sm']}>
                The sequence contains a trigger key. The macro&apos;s own output
                never re-triggers it, but it can trigger other macros.
              </AlertDescription>
            </Alert>
          )}
        </Stack>
      </VStack>
      <HStack w="full" px={[2, 4, 6]} justifyContent="space-between" spacing={2}>
        {/* View switch */}
        <ButtonGroup size="sm" isAttached variant="brandRecord" flexShrink={0}>
          <Tooltip label="List view" hasArrow variant="brand">
            <IconButton
              aria-label="List view"
              icon={<ListIcon />}
              isActive={!timelineView}
              onClick={() => updateSequenceView('List')}
            />
          </Tooltip>
          <Tooltip label="Timeline view: presses on a per-key timeline" hasArrow variant="brand">
            <IconButton
              aria-label="Timeline view"
              icon={<TimelineIcon />}
              isActive={timelineView}
              onClick={() => updateSequenceView('Timeline')}
            />
          </Tooltip>
        </ButtonGroup>

        {/* Primary action */}
        <Button
          variant="brandRecord"
          leftIcon={recording ? <StopIcon /> : <RecordIcon />}
          size="sm"
          fontSize="sm"
          isActive={recording}
          onClick={recording ? stopRecording : startRecording}
          flexShrink={0}
        >
          {recording ? 'Stop' : 'Record'}
        </Button>

        {/* Secondary actions: icons only below the md breakpoint */}
        <HStack spacing={1} flexShrink={0}>
          {!timelineView && (
            <Tooltip label="Add a delay" hasArrow variant="brand">
              <IconButton
                variant="brandRecord"
                aria-label="Add delay"
                icon={<TimeIcon />}
                size="sm"
                onClick={() => {
                  onElementAdd({
                    type: 'DelayEventAction',
                    data: config.DefaultDelayValue
                  })
                }}
              />
            </Tooltip>
          )}
          <Tooltip label="Edit all elements: delays and durations at once" hasArrow variant="brand">
            <Button
              variant="brandRecord"
              leftIcon={<EditIcon />}
              iconSpacing={{ base: 0, md: 2 }}
              size="sm"
              fontSize="sm"
              onClick={onBulkOpen}
              isDisabled={sequence.length === 0}
              aria-label="Edit all"
            >
              <Box as="span" display={{ base: 'none', md: 'inline' }}>
                Edit All
              </Box>
            </Button>
          </Tooltip>
          <Tooltip label="Clear the whole sequence" hasArrow variant="brand">
            <Button
              variant="brandWarning"
              leftIcon={<DeleteIcon />}
              iconSpacing={{ base: 0, md: 2 }}
              size="sm"
              fontSize="sm"
              onClick={onOpen}
              isDisabled={sequence.length === 0}
              aria-label="Clear all"
            >
              <Box as="span" display={{ base: 'none', md: 'inline' }}>
                Clear All
              </Box>
            </Button>
          </Tooltip>
          <Tooltip label="Simulate: play the macro virtually and see what it sends" hasArrow variant="brand">
            <IconButton
              variant="brand"
              aria-label="Simulate"
              icon={<SimulateIcon />}
              size="sm"
              isActive={simulate}
              onClick={() => {
                setSimulate((value) => !value)
                setPlayhead(null)
              }}
              isDisabled={sequence.length === 0}
            />
          </Tooltip>
          <Tooltip
            label="Macro settings: repeat count, hold threshold, tap mode"
            hasArrow
            variant="brand"
          >
            <IconButton
              variant="brand"
              aria-label="MacroSettings"
              icon={<SettingsIcon />}
              size="sm"
              onClick={onOpenMacroSettingsModal}
            />
          </Tooltip>
        </HStack>
      </HStack>
      {/** Header End */}
      <BulkEditModal isOpen={isBulkOpen} onClose={onBulkClose} />
      <ClearSequenceModal
        isOpen={isOpen}
        onClose={onClose}
        stopRecording={stopRecording}
      />
      <Divider w="full" />
      {timelineView ? (
        <Timeline
          recording={recording}
          playhead={recording ? recordingPlayhead : simulate ? playhead : null}
          recordCursor={recordCursor}
          onRecordCursor={setRecordCursor}
        />
      ) : (
        <SortableList recording={recording} stopRecording={stopRecording} />
      )}
      {simulate && sequence.length > 0 && (
        <>
          <Divider w="full" />
          <SimulationPanel onPlayhead={setPlayhead} />
        </>
      )}
    </VStack>
  )
}
