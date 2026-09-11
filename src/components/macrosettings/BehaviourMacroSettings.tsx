import {
  Button,
  Divider,
  HStack,
  Tag,
  TagLabel,
  useDisclosure,
  Wrap,
  WrapItem,
  NumberDecrementStepper,
  NumberIncrementStepper,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  Select,
  Text,
  VStack
} from '@chakra-ui/react'
import { useOptionalMacroContext } from '../../contexts/macroContext'
import {
  DEFAULT_HOLD_THRESHOLD_MS,
  MacroTypeDefinitions,
  MacroTypeNames,
  MacroType
} from '../../constants/enums'
import { TapMode } from '../../types'
import ApplicationPickerModal from '../ApplicationPickerModal'

/** Settings that depend on the macro type: repeat count, hold threshold and tap mode. */
export default function BehaviourMacroSettings() {
  const context = useOptionalMacroContext()
  if (!context) {
    return (
      <Text fontSize="sm" opacity={0.8}>
        Open a macro in the editor to change its behaviour settings.
      </Text>
    )
  }
  return <BehaviourMacroSettingsInner />
}

function BehaviourMacroSettingsInner() {
  const {
    macro,
    updateHoldThreshold,
    updateTapMode,
    updateRepeatCount,
    updateMacroLinkedProcesses
  } = useOptionalMacroContext()!
  const {
    isOpen: isPickerOpen,
    onOpen: onPickerOpen,
    onClose: onPickerClose
  } = useDisclosure()
  const linked = macro.linked_processes ?? []
  const isSingle = macro.macro_type === 'Single'
  const isToggle = macro.macro_type === 'Toggle'
  const isOnHold = macro.macro_type === 'OnHold'
  const typeIndex = MacroType[macro.macro_type as keyof typeof MacroType] ?? 0
  const repeatCount = macro.repeat_count ?? (isSingle ? 1 : 0)
  const holdThreshold = macro.hold_threshold_ms ?? DEFAULT_HOLD_THRESHOLD_MS
  const tapMode: TapMode = macro.tap_mode ?? 'DeferredTap'

  return (
    <VStack w="full" align="stretch" spacing={4} pr={4}>
      <VStack align="stretch" spacing={0}>
        <Text fontWeight="semibold">
          Macro type: {MacroTypeNames[typeIndex]}
        </Text>
        <Text fontSize="sm" opacity={0.8}>
          {MacroTypeDefinitions[typeIndex]} Change the type with the buttons
          in the macro header.
        </Text>
      </VStack>
      <Divider />

      <VStack align="stretch" spacing={1}>
        <Text fontWeight="semibold">Only in these applications</Text>
        <Text fontSize="sm" opacity={0.8}>
          Optional. The macro fires only while one of these applications is
          the focused window, on top of its collection being on. Leave empty
          to follow the collection.
        </Text>
        <Wrap>
          {linked.length === 0 && (
            <Text fontSize="sm" opacity={0.6}>
              Follows the collection.
            </Text>
          )}
          {linked.map((name) => (
            <WrapItem key={name}>
              <Tag size="sm" variant="subtle" colorScheme="primary-accent">
                <TagLabel>{name}</TagLabel>
              </Tag>
            </WrapItem>
          ))}
        </Wrap>
        <Button size="sm" alignSelf="flex-start" onClick={onPickerOpen}>
          Choose applications…
        </Button>
        <ApplicationPickerModal
          isOpen={isPickerOpen}
          onClose={onPickerClose}
          title="Applications for this macro"
          description="The macro fires only while one of these applications is the focused window. Leave the list empty to follow the collection."
          linked={linked}
          onChange={updateMacroLinkedProcesses}
        />
      </VStack>
      <Divider />

      {(isSingle || isToggle) && (
        <VStack align="stretch" spacing={1}>
          <Text fontWeight="semibold">
            {isSingle ? 'Play count' : 'Loop limit'}
          </Text>
          <Text fontSize="sm" opacity={0.8}>
            {isSingle
              ? 'How many times the sequence plays each time the trigger is pressed.'
              : 'How many times the sequence loops before the macro stops on its own. 0 keeps it looping until the trigger is pressed again.'}
          </Text>
          <HStack>
            <NumberInput
              size="sm"
              w="110px"
              min={isSingle ? 1 : 0}
              max={10000}
              value={repeatCount}
              onChange={(_, valueAsNumber) => {
                if (Number.isNaN(valueAsNumber)) return
                if (isSingle) updateRepeatCount(Math.max(1, valueAsNumber))
                else updateRepeatCount(valueAsNumber === 0 ? null : valueAsNumber)
              }}
            >
              <NumberInputField />
              <NumberInputStepper>
                <NumberIncrementStepper />
                <NumberDecrementStepper />
              </NumberInputStepper>
            </NumberInput>
            <Text fontSize="sm">{isSingle ? 'times' : 'loops'}</Text>
          </HStack>
        </VStack>
      )}

      {isOnHold && (
        <>
          <VStack align="stretch" spacing={1}>
            <Text fontWeight="semibold">Hold threshold</Text>
            <Text fontSize="sm" opacity={0.8}>
              How long the trigger key must be held before the macro starts. A
              shorter press is treated as a normal tap of the key. 0 starts
              the macro on press and never passes taps through.
            </Text>
            <HStack>
              <NumberInput
                size="sm"
                w="110px"
                min={0}
                max={5000}
                step={10}
                value={holdThreshold}
                onChange={(_, valueAsNumber) => {
                  if (!Number.isNaN(valueAsNumber)) {
                    updateHoldThreshold(valueAsNumber)
                  }
                }}
              >
                <NumberInputField />
                <NumberInputStepper>
                  <NumberIncrementStepper />
                  <NumberDecrementStepper />
                </NumberInputStepper>
              </NumberInput>
              <Text fontSize="sm">ms</Text>
            </HStack>
          </VStack>
          <VStack align="stretch" spacing={1}>
            <Text fontWeight="semibold">Tap mode</Text>
            <Text fontSize="sm" opacity={0.8}>
              What happens to the trigger press during the hold time, before
              it is known whether you are tapping or holding.
            </Text>
            <Select
              size="sm"
              w="220px"
              value={tapMode}
              isDisabled={holdThreshold === 0}
              onChange={(event) =>
                updateTapMode(event.target.value as TapMode)
              }
            >
              <option value="DeferredTap">Deferred tap</option>
              <option value="PassThrough">Pass through</option>
            </Select>
            <Text fontSize="sm" opacity={0.8}>
              <b>Deferred tap:</b> the press is held back. A short press is
              sent as one quick tap when you release; a long press starts the
              macro without the game ever seeing the key held down.
            </Text>
            <Text fontSize="sm" opacity={0.8}>
              <b>Pass through:</b> the press reaches the game immediately, so
              taps have no delay, but the game sees the key held down until
              the macro starts.
            </Text>
          </VStack>
        </>
      )}
    </VStack>
  )
}
