import {
  HStack,
  IconButton,
  NumberDecrementStepper,
  NumberIncrementStepper,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  Select,
  StackDivider,
  Text,
  Tooltip,
  useColorModeValue
} from '@chakra-ui/react'
import { HiArrowDownTray, HiArrowPath, HiArrowRight } from 'react-icons/hi2'
import { useMacroContext } from '../../../contexts/macroContext'
import {
  DEFAULT_HOLD_THRESHOLD_MS,
  MacroType,
  MacroTypeDefinitions,
  MacroTypeNames
} from '../../../constants/enums'
import { checkIfStringIsNonNumeric } from '../../../constants/utils'
import { TapMode } from '../../../types'

export default function MacroTypeArea() {
  const {
    macro,
    updateMacroType,
    updateHoldThreshold,
    updateTapMode,
    updateRepeatCount
  } = useMacroContext()
  const borderColour = useColorModeValue('gray.400', 'gray.600')
  const typeIcons = [<HiArrowRight />, <HiArrowPath />, <HiArrowDownTray />]
  const isOnHold = macro.macro_type === 'OnHold'
  const isSingle = macro.macro_type === 'Single'
  const isToggle = macro.macro_type === 'Toggle'
  const repeatCount = macro.repeat_count ?? (isSingle ? 1 : 0)
  const holdThreshold = macro.hold_threshold_ms ?? DEFAULT_HOLD_THRESHOLD_MS
  const tapMode: TapMode = macro.tap_mode ?? 'DeferredTap'

  return (
    <HStack
      w="fit"
      h="fit"
      p="2"
      border="1px"
      borderColor={borderColour}
      divider={<StackDivider />}
      rounded="md"
      spacing="16px"
    >
      <Text fontWeight="semibold" fontSize={['sm', 'md']}>
        Macro Type
      </Text>
      <HStack>
        {(Object.keys(MacroType) as Array<keyof typeof MacroType>)
          .filter(checkIfStringIsNonNumeric)
          .map((value: string, index: number) => (
            <Tooltip
              variant="brand"
              label={`${MacroTypeNames[index]}: ${MacroTypeDefinitions[index]}`}
              placement="bottom"
              hasArrow
              key={value}
            >
              <IconButton
                icon={typeIcons[index]}
                aria-label={`${MacroTypeNames[index]} macro type`}
                size="sm"
                colorScheme={
                  macro.macro_type === value ? 'primary-accent' : 'gray'
                }
                onClick={() => updateMacroType(index)}
              ></IconButton>
            </Tooltip>
          ))}
      </HStack>
      {(isSingle || isToggle) && (
        <HStack spacing="8px">
          <Tooltip
            variant="brand"
            placement="bottom"
            hasArrow
            label={
              isSingle
                ? 'How many times the sequence plays each time the trigger is pressed.'
                : 'How many times the sequence loops before stopping on its own. 0 keeps looping until the trigger is pressed again.'
            }
          >
            <Text fontSize={['xs', 'sm']} whiteSpace="nowrap">
              {isSingle ? 'Play' : 'Loop'}
            </Text>
          </Tooltip>
          <NumberInput
            size="sm"
            w="80px"
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
          <Text fontSize={['xs', 'sm']}>{isSingle ? 'times' : 'loops'}</Text>
        </HStack>
      )}
      {isOnHold && (
        <HStack spacing="8px">
          <Tooltip
            variant="brand"
            placement="bottom"
            hasArrow
            label="How long the trigger must be held before the macro starts repeating. Shorter presses are normal taps. 0 starts on press and swallows taps."
          >
            <Text fontSize={['xs', 'sm']} whiteSpace="nowrap">
              Hold after
            </Text>
          </Tooltip>
          <NumberInput
            size="sm"
            w="90px"
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
          <Text fontSize={['xs', 'sm']}>ms</Text>
          <Tooltip
            variant="brand"
            placement="bottom"
            hasArrow
            label="Deferred tap: a short press is delivered as one tap when released, so the trigger key is never seen held. Pass through: the press reaches the application immediately, which also sees the key held until the macro starts."
          >
            <Select
              size="sm"
              w="150px"
              value={tapMode}
              isDisabled={holdThreshold === 0}
              onChange={(event) => updateTapMode(event.target.value as TapMode)}
            >
              <option value="DeferredTap">Deferred tap</option>
              <option value="PassThrough">Pass through</option>
            </Select>
          </Tooltip>
        </HStack>
      )}
    </HStack>
  )
}
