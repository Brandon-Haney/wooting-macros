import {
  Badge,
  Box,
  HStack,
  Switch,
  Text,
  Tooltip,
  useColorModeValue
} from '@chakra-ui/react'
import { Collection } from '../../types'

interface Props {
  collection: Collection
  index: number
  isFocused: boolean
  isMacroOutputEnabled: boolean
  setFocus: (index: number) => void
  toggleCollection: (index: number) => void
}

export default function CollectionButton({
  collection,
  index,
  isFocused,
  isMacroOutputEnabled,
  setFocus,
  toggleCollection
}: Props) {
  const buttonBg = useColorModeValue('primary-accent.50', 'primary-accent.800')
  const selectedTextColour = useColorModeValue(
    'primary-accent.700',
    'primary-accent.200'
  )
  const isLinked = (collection.linked_processes ?? []).length > 0

  return (
    <Box
      pos="relative"
      w="full"
      bg={isFocused ? buttonBg : ''}
      p="2"
      rounded='md'
      _hover={{ bg: buttonBg }}
      transition="ease-out 150ms"
    >
      <HStack
        pos="relative"
        w="full"
        justifyContent="space-between"
        textAlign="left"
        gap={2}
        spacing={0}
      >
        <Box
          as="button"
          pos="absolute"
          w="full"
          h="full"
          zIndex={10}
          onClick={() => setFocus(index)}
        ></Box>
        <Box maxHeight="32px" m={0}>
          <em-emoji shortcodes={collection.icon} size="32px" />
        </Box>
        <Text
          w="full"
          noOfLines={1}
          fontWeight="semibold"
          textColor={isFocused ? selectedTextColour : ''}
        >
          {collection.name}
        </Text>
        {isLinked ? (
          // Focus controls a linked collection, so its state replaces the switch.
          <Tooltip
            variant="brand"
            placement="bottom"
            hasArrow
            label={`Controlled by the linked applications: armed while ${(
              collection.linked_processes ?? []
            ).join(', ')} is focused`}
          >
            <Badge
              zIndex={10}
              fontSize="2xs"
              flexShrink={0}
              colorScheme={collection.active ? 'green' : 'gray'}
            >
              {collection.active ? 'Armed' : 'Off'}
            </Badge>
          </Tooltip>
        ) : (
          <Tooltip
            variant="brand"
            placement="bottom"
            hasArrow
            label={
              !isMacroOutputEnabled
                ? 'Re-enable Macro Output!'
                : collection.active
                  ? 'Disable Collection'
                  : 'Enable Collection'
            }
          >
            <Box>
              <Switch
                size="sm"
                variant="brand"
                zIndex={10}
                defaultChecked={collection.active}
                isChecked={isMacroOutputEnabled ? collection.active : false}
                isDisabled={!isMacroOutputEnabled}
                onChange={() => toggleCollection(index)}
                aria-label="Collection Toggle"
              />
            </Box>
          </Tooltip>
        )}
      </HStack>
    </Box>
  )
}
