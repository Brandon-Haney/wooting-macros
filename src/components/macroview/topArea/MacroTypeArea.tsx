import {
  HStack,
  IconButton,
  StackDivider,
  Text,
  Tooltip,
  useColorModeValue
} from '@chakra-ui/react'
import { HiArrowDownTray, HiArrowPath, HiArrowRight } from 'react-icons/hi2'
import { useMacroContext } from '../../../contexts/macroContext'
import {
  MacroType,
  MacroTypeDefinitions,
  MacroTypeNames
} from '../../../constants/enums'
import { checkIfStringIsNonNumeric } from '../../../constants/utils'

export default function MacroTypeArea() {
  const { macro, updateMacroType } = useMacroContext()
  const borderColour = useColorModeValue('gray.400', 'gray.600')
  const typeIcons = [<HiArrowRight />, <HiArrowPath />, <HiArrowDownTray />]

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
    </HStack>
  )
}
