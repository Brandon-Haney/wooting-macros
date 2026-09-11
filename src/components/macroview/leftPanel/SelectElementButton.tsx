import { Box, Text, Tooltip, useColorModeValue } from '@chakra-ui/react'
import { useCallback } from 'react'
import { useMacroContext } from '../../../contexts/macroContext'
import { useSettingsContext } from '../../../contexts/settingsContext'
import { ActionEventType } from '../../../types'
import { ELEMENT_DRAG_TYPE } from '../centerPanel/timeline/Timeline'

interface Props {
  properties: ActionEventType
  nameText: string
  descText?: string
}

export default function SelectElementButton({
  properties,
  nameText,
  descText = ''
}: Props) {
  const { sequence, onElementAdd, onElementsAdd } = useMacroContext()
  const { config } = useSettingsContext()
  const bg = useColorModeValue('primary-light.50', 'primary-dark.700')
  const textColor = useColorModeValue('bg-dark', 'bg-light')
  const hoverBg = useColorModeValue('primary-light.100', 'primary-dark.600')
  const borderColour = useColorModeValue(
    'primary-light.300',
    'primary-dark.600'
  )
  const keycapShadow = useColorModeValue(
    '0 1px 1px rgba(0, 0, 0, 0.12)',
    '0 1px 1px rgba(0, 0, 0, 0.5)'
  )
  const isKeycap =
    properties.type === 'KeyPressEventAction' ||
    properties.type === 'MouseEventAction'

  const handleAddElement = useCallback(() => {
    if (config.AutoAddDelay) {
      if (sequence.at(-1)?.type !== 'DelayEventAction' && sequence.length > 0) {
        onElementsAdd([
          {
            type: 'DelayEventAction',
            data: config.DefaultDelayValue
          },
          properties
        ])
      } else {
        onElementAdd(properties)
      }
    } else {
      onElementAdd(properties)
    }
  }, [
    config.AutoAddDelay,
    config.DefaultDelayValue,
    onElementAdd,
    onElementsAdd,
    properties,
    sequence
  ])

  return (
    <Tooltip
      label={descText === '' ? '' : descText}
      hasArrow
      variant="brandSecondary"
      textAlign="center"
    >
      <Box
        w="full"
        h="full"
        as="button"
        bg={bg}
        px={1}
        py={isKeycap ? 1 : 2}
        minH={isKeycap ? undefined : '44px'}
        _hover={{ bg: hoverBg }}
        color={textColor}
        border="1px"
        borderColor={borderColour}
        rounded="md"
        onClick={handleAddElement}
        draggable
        onDragStart={(event) => {
          // Dropping on the timeline places the element at that time.
          event.dataTransfer.setData(ELEMENT_DRAG_TYPE, JSON.stringify(properties))
          event.dataTransfer.effectAllowed = 'copy'
        }}
        transition="ease-out 150ms"
        // Keys and mouse buttons look like keycaps, matching the Kbd element used elsewhere.
        {...(isKeycap
          ? {
              borderBottomWidth: '3px',
              boxShadow: keycapShadow,
              _active: {
                transform: 'translateY(2px)',
                borderBottomWidth: '1px',
                boxShadow: 'none'
              }
            }
          : {})}
      >
        <Text
          w="full"
          fontWeight="semibold"
          fontSize={isKeycap ? ['xs', 'sm', 'sm'] : ['xs', 'sm', 'md']}
          lineHeight="short"
          cursor="pointer"
          overflowWrap="normal"
          wordBreak="normal"
          whiteSpace={isKeycap && !nameText.includes(' ') ? 'nowrap' : 'normal'}
        >
          {nameText}
        </Text>
      </Box>
    </Tooltip>
  )
}
