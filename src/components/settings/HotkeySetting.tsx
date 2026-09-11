import { Button, HStack, Kbd, Text, VStack } from '@chakra-ui/react'
import { useEffect } from 'react'
import useRecordingTrigger from '../../hooks/useRecordingTrigger'
import { HIDLookup } from '../../constants/HIDmap'
import { checkIfMouseButtonArray } from '../../constants/utils'
import { RecordIcon, StopIcon } from '../icons'

interface Props {
  title: string
  description: string
  /** HID codes of the hotkey, empty for none. */
  value: number[]
  onChange: (keys: number[]) => void
}

/** A keyboard hotkey setting recorded the same way as macro triggers. */
export default function HotkeySetting({
  title,
  description,
  value,
  onChange
}: Props) {
  const { recording, startRecording, stopRecording, items } =
    useRecordingTrigger(value)

  // Recording stops on its own after a non-modifier key; commit keyboard results only.
  useEffect(() => {
    if (recording) return
    if (items.length > 0 && checkIfMouseButtonArray(items)) return
    if (
      items.length !== value.length ||
      items.some((key, index) => key !== value[index])
    ) {
      onChange(items)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, items])

  const shown = recording ? items : value

  return (
    <HStack w="full" justifyContent="space-between" spacing={16}>
      <VStack spacing={0} textAlign="left">
        <Text w="full" fontSize="md" fontWeight="semibold">
          {title}
        </Text>
        <Text w="full" fontSize="sm">
          {description}
        </Text>
      </VStack>
      <HStack flexShrink={0}>
        {shown.length === 0 ? (
          <Text fontSize="sm" opacity={0.6}>
            {recording ? 'Press keys…' : 'None'}
          </Text>
        ) : (
          shown.map((key) => (
            <Kbd key={key} variant="brand">
              {HIDLookup.get(key)?.displayString ?? key}
            </Kbd>
          ))
        )}
        <Button
          size="sm"
          variant="brandRecord"
          leftIcon={recording ? <StopIcon /> : <RecordIcon />}
          onClick={recording ? stopRecording : startRecording}
          isActive={recording}
        >
          {recording ? 'Stop' : 'Record'}
        </Button>
        {!recording && value.length > 0 && (
          <Button size="sm" onClick={() => onChange([])}>
            Clear
          </Button>
        )}
      </HStack>
    </HStack>
  )
}
