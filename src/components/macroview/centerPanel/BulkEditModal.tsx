import {
  Button,
  Divider,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  NumberDecrementStepper,
  NumberIncrementStepper,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  Text,
  VStack
} from '@chakra-ui/react'
import { useCallback, useMemo, useState } from 'react'
import { useMacroContext } from '../../../contexts/macroContext'
import { useSettingsContext } from '../../../contexts/settingsContext'
import { ActionEventType } from '../../../types'

interface Props {
  isOpen: boolean
  onClose: () => void
}

/** Edits every element of the sequence at once: delays and press durations. */
export default function BulkEditModal({ isOpen, onClose }: Props) {
  const { sequence, ids, overwriteSequence, overwriteIds, updateSelectedElementId } =
    useMacroContext()
  const { config } = useSettingsContext()
  const [delayValue, setDelayValue] = useState(config.DefaultDelayValue)
  const [durationValue, setDurationValue] = useState(20)

  // Elements in display order (ids are 1-based indexes into the sequence, in drag order).
  const ordered = useMemo(
    () => ids.map((id) => sequence[id - 1]).filter(Boolean),
    [ids, sequence]
  )
  const delayCount = ordered.filter((e) => e.type === 'DelayEventAction').length
  const pressCount = ordered.filter(
    (e) =>
      (e.type === 'KeyPressEventAction' && e.data.keytype === 'DownUp') ||
      (e.type === 'MouseEventAction' && e.data.data.type === 'DownUp')
  ).length

  /** Replaces the sequence with `next` (in display order) and renumbers the ids. */
  const apply = useCallback(
    (next: ActionEventType[]) => {
      overwriteSequence(next)
      overwriteIds(next.map((_, index) => index + 1))
      updateSelectedElementId(undefined)
    },
    [overwriteIds, overwriteSequence, updateSelectedElementId]
  )

  const setAllDelays = useCallback(() => {
    apply(
      ordered.map((e) =>
        e.type === 'DelayEventAction' ? { ...e, data: delayValue } : e
      )
    )
  }, [apply, delayValue, ordered])

  const removeAllDelays = useCallback(() => {
    apply(ordered.filter((e) => e.type !== 'DelayEventAction'))
  }, [apply, ordered])

  const compactDelays = useCallback(() => {
    const next: ActionEventType[] = []
    for (const element of ordered) {
      const last = next[next.length - 1]
      if (element.type === 'DelayEventAction') {
        if (next.length === 0) continue // leading delay
        if (last && last.type === 'DelayEventAction') {
          next[next.length - 1] = { ...last, data: last.data + element.data }
          continue
        }
      }
      next.push(element)
    }
    while (next.length > 0 && next[next.length - 1].type === 'DelayEventAction') {
      next.pop() // trailing delay
    }
    apply(next)
  }, [apply, ordered])

  const setAllDurations = useCallback(() => {
    apply(
      ordered.map((e) => {
        if (e.type === 'KeyPressEventAction' && e.data.keytype === 'DownUp') {
          return { ...e, data: { ...e.data, press_duration: durationValue } }
        }
        if (e.type === 'MouseEventAction' && e.data.data.type === 'DownUp') {
          return {
            ...e,
            data: { ...e.data, data: { ...e.data.data, duration: durationValue } }
          }
        }
        return e
      })
    )
  }, [apply, durationValue, ordered])

  const numberInput = (
    value: number,
    onChange: (value: number) => void
  ) => (
    <NumberInput
      size="sm"
      w="110px"
      min={0}
      max={60000}
      value={value}
      onChange={(_, n) => {
        if (!Number.isNaN(n)) onChange(n)
      }}
    >
      <NumberInputField />
      <NumberInputStepper>
        <NumberIncrementStepper />
        <NumberDecrementStepper />
      </NumberInputStepper>
    </NumberInput>
  )

  return (
    <Modal variant="brand" isOpen={isOpen} onClose={onClose} isCentered size="lg">
      <ModalOverlay />
      <ModalContent p={2}>
        <ModalHeader>Edit all elements</ModalHeader>
        <Divider w="90%" alignSelf="center" />
        <ModalBody>
          <VStack align="stretch" spacing={4}>
            <VStack align="stretch" spacing={1}>
              <Text fontWeight="semibold">
                Delays ({delayCount} in the sequence)
              </Text>
              <HStack>
                <Text fontSize="sm">Set every delay to</Text>
                {numberInput(delayValue, setDelayValue)}
                <Text fontSize="sm">ms</Text>
                <Button size="sm" onClick={setAllDelays} isDisabled={delayCount === 0}>
                  Apply
                </Button>
              </HStack>
              <HStack>
                <Button size="sm" onClick={compactDelays} isDisabled={delayCount === 0}>
                  Compact delays
                </Button>
                <Text fontSize="xs" opacity={0.7}>
                  Merges delays that follow each other and drops leading and
                  trailing ones.
                </Text>
              </HStack>
              <HStack>
                <Button
                  size="sm"
                  variant="brandWarning"
                  onClick={removeAllDelays}
                  isDisabled={delayCount === 0}
                >
                  Remove all delays
                </Button>
              </HStack>
            </VStack>
            <Divider />
            <VStack align="stretch" spacing={1}>
              <Text fontWeight="semibold">
                Key and mouse press durations ({pressCount} full presses)
              </Text>
              <HStack>
                <Text fontSize="sm">Set every press duration to</Text>
                {numberInput(durationValue, setDurationValue)}
                <Text fontSize="sm">ms</Text>
                <Button size="sm" onClick={setAllDurations} isDisabled={pressCount === 0}>
                  Apply
                </Button>
              </HStack>
            </VStack>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose}>Done</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
