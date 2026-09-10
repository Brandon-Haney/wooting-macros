import {
  HStack,
  IconButton,
  StackDivider,
  Text,
  Tooltip,
  useColorModeValue,
  VStack
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

export default function MacroTypeArea() {
  const { macro, updateMacroType } = useMacroContext()
  const borderColour = useColorModeValue('gray.400', 'gray.600')
  const typeIcons = [<HiArrowRight />, <HiArrowPath />, <HiArrowDownTray />]

  // One-line summary of the type-specific settings, which live in the macro settings (gear).
  const summary = (() => {
    switch (macro.macro_type) {
      case 'OnHold': {
        const threshold = macro.hold_threshold_ms ?? DEFAULT_HOLD_THRESHOLD_MS
        if (threshold === 0) return 'starts on press'
        const mode =
          (macro.tap_mode ?? 'DeferredTap') === 'PassThrough'
            ? 'pass through'
            : 'deferred tap'
        return `hold ${threshold} ms · ${mode}`
      }
      case 'Toggle': {
        const loops = macro.repeat_count ?? 0
        return loops > 0 ? `${loops} loops` : 'until pressed again'
      }
      default: {
        const plays = macro.repeat_count ?? 1
        return plays > 1 ? `plays ${plays}×` : 'plays once'
      }
    }
  })()

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
      <VStack spacing={0} alignItems="start">
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
        <Tooltip
          variant="brand"
          label="Change these in the macro settings (gear button above the sequence)."
          placement="bottom"
          hasArrow
        >
          <Text fontSize="xs" opacity={0.7} whiteSpace="nowrap">
            {summary}
          </Text>
        </Tooltip>
      </VStack>
    </HStack>
  )
}
