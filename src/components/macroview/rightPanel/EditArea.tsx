import { Box, Button, HStack, Kbd, Text, useColorModeValue, VStack } from '@chakra-ui/react'
import { DeleteIcon } from '@chakra-ui/icons'
import React, { useMemo } from 'react'
import { useMacroContext } from '../../../contexts/macroContext'
import { useSelectedElement } from '../../../contexts/selectors'
import useMainBgColour from '../../../hooks/useMainBgColour'
import DelayForm from './editForms/DelayForm'
import EmptyForm from './editForms/EmptyForm'
import KeyPressForm from './editForms/KeyPressForm'
import MousePressForm from './editForms/MousePressForm'
import SystemEventActionForm from './editForms/SystemEventActionForm'

export function BoxText({ children }: { children: string }) {
  const bg = useColorModeValue('primary-light.50', 'primary-dark.700')
  const kebabColour = useColorModeValue('primary-light.500', 'primary-dark.500')

  return (
    <HStack justifyContent="center" p={1}>
      <Text>Editing element</Text>
      <Box
        h="32px"
        w="fit-content"
        bg={bg}
        border="1px solid"
        py={1}
        px={3}
        borderColor={kebabColour}
        rounded="md"
      >
        <Text
          w="fit-content"
          whiteSpace="nowrap"
          fontSize={['sm', 'md', 'md']}
          fontWeight="bold"
        >
          {children}
        </Text>
      </Box>
    </HStack>
  )
}

export default function EditArea() {
  const selectedElement = useSelectedElement()
  const {
    selectedElementId,
    selectedElementIds,
    onElementDelete,
    onElementsDelete,
    updateSelectedElementId
  } = useMacroContext()
  const multi = selectedElementIds.length > 1

  const SelectedElementFormComponent = useMemo(() => {
    if (!selectedElement || selectedElementId === undefined) {
      return <EmptyForm />
    }

    switch (selectedElement.type) {
      case 'SystemEventAction':
        return (
          <SystemEventActionForm
            selectedElementId={selectedElementId}
            selectedElement={selectedElement}
          />
        )
      case 'DelayEventAction':
        return (
          <DelayForm
            selectedElementId={selectedElementId}
            selectedElement={selectedElement}
          />
        )
      case 'KeyPressEventAction':
        return (
          <KeyPressForm
            selectedElementId={selectedElementId}
            selectedElement={selectedElement}
          />
        )
      case 'MouseEventAction':
        return (
          <MousePressForm
            selectedElementId={selectedElementId}
            selectedElement={selectedElement}
          />
        )
      default:
        return <EmptyForm />
    }
  }, [selectedElement, selectedElementId])

  return (
    <VStack
      position="relative"
      w="26%"
      maxW="420px"
      minW="220px"
      flexShrink={0}
      h="full"
      bg={useMainBgColour()}
      px={[2, 4, 6]}
      pt={[2, 4]}
    >
      {multi ? (
        <VStack w="full" spacing={3} pt={2}>
          <Text fontWeight="semibold">{selectedElementIds.length} elements selected</Text>
          <Text fontSize="sm" textAlign="center" opacity={0.8}>
            Drag them together on the timeline, nudge with the arrow keys, or delete them all.
          </Text>
          <HStack>
            <Button
              size="sm"
              variant="brandWarning"
              leftIcon={<DeleteIcon />}
              onClick={() => onElementsDelete(selectedElementIds)}
            >
              Delete all
            </Button>
            <Button size="sm" variant="brand" onClick={() => updateSelectedElementId(undefined)}>
              Clear selection
            </Button>
          </HStack>
        </VStack>
      ) : (
        <>
          {SelectedElementFormComponent}
          {selectedElement && selectedElementId !== undefined && (
            <HStack w="full" pt={4} justify="space-between" flexWrap="wrap" rowGap={2}>
              <Text fontSize="xs" opacity={0.7}>
                <Kbd fontSize="xs">Del</Kbd> also removes it
              </Text>
              <Button
                size="sm"
                variant="brandWarning"
                leftIcon={<DeleteIcon />}
                onClick={() => {
                  onElementDelete(selectedElementId)
                  updateSelectedElementId(undefined)
                }}
              >
                Delete element
              </Button>
            </HStack>
          )}
        </>
      )}
    </VStack>
  )
}
