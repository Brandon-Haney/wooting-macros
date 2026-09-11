import {
  Alert,
  AlertDescription,
  AlertIcon,
  Button,
  Divider,
  HStack,
  IconButton,
  Stack,
  Text,
  Tooltip,
  useDisclosure,
  VStack
} from '@chakra-ui/react'
import { DeleteIcon, EditIcon, SettingsIcon, TimeIcon } from '@chakra-ui/icons'
import { useCallback, useRef } from 'react'
import { ActionEventType } from '../../../types'
import { useMacroContext } from '../../../contexts/macroContext'
import useRecordingSequence from '../../../hooks/useRecordingSequence'
import { useSettingsContext } from '../../../contexts/settingsContext'
import { checkIfElementIsEditable } from '../../../constants/utils'
import { decompile, Schedule } from '../../../utils/schedule'
import ClearSequenceModal from './ClearSequenceModal'
import BulkEditModal from './BulkEditModal'
import { RecordIcon, StopIcon } from '../../icons'
import SortableList from './SortableList'
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
  const { config } = useSettingsContext()
  const { isOpen, onOpen, onClose } = useDisclosure()
  const {
    isOpen: isBulkOpen,
    onOpen: onBulkOpen,
    onClose: onBulkClose
  } = useDisclosure()

  // The sequence as it was when recording started; recorded events are
  // appended to it after every key so the list updates live.
  const base = useRef<ActionEventType[]>([])

  const onRecorded = useCallback(
    (recorded: Schedule) => {
      const next = [...base.current, ...decompile(recorded)]
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
  const { recording, stopRecording } = recorder
  const startRecording = useCallback(() => {
    base.current = ids.map((id) => sequence[id - 1]).filter(Boolean)
    recorder.startRecording()
  }, [ids, recorder, sequence])

  return (
    <VStack w="41%" h="full" bg={useMainBgColour()} justifyContent="top">
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
      <HStack
        justifyContent="center"
        w="full"
        alignItems="center"
        flexWrap="wrap"
        rowGap={2}
        spacing={2}
        px={[2, 4, 6]}
      >
        <Text fontWeight="semibold" fontSize={['sm', 'md']}>
          Sequence
        </Text>
        <Button
          variant="brandRecord"
          leftIcon={recording ? <StopIcon /> : <RecordIcon />}
          size="sm"
          fontSize="sm"
          isActive={recording}
          onClick={recording ? stopRecording : startRecording}
        >
          {recording ? 'Stop' : 'Record'}
        </Button>
        <Button
          variant="brandRecord"
          leftIcon={<TimeIcon />}
          size="sm"
          fontSize="sm"
          onClick={() => {
            onElementAdd({
              type: 'DelayEventAction',
              data: config.DefaultDelayValue
            })
          }}
        >
          Add Delay
        </Button>
        <Button
          variant="brandRecord"
          leftIcon={<EditIcon />}
          size="sm"
          fontSize="sm"
          onClick={onBulkOpen}
          isDisabled={sequence.length === 0}
        >
          Edit All
        </Button>
        <Button
          variant="brandWarning"
          leftIcon={<DeleteIcon />}
          size="sm"
          fontSize="sm"
          onClick={onOpen}
          isDisabled={sequence.length === 0}
        >
          Clear All
        </Button>

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
      {/** Header End */}
      <BulkEditModal isOpen={isBulkOpen} onClose={onBulkClose} />
      <ClearSequenceModal
        isOpen={isOpen}
        onClose={onClose}
        stopRecording={stopRecording}
      />
      <Divider w="full" />
      <SortableList recording={recording} stopRecording={stopRecording} />
    </VStack>
  )
}
