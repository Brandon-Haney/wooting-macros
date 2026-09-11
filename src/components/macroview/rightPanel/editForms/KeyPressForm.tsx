import {
  Divider,
  Grid,
  GridItem,
  HStack,
  IconButton,
  Input,
  Text,
  Tooltip,
  useColorModeValue,
  useToast,
  Kbd
} from '@chakra-ui/react'
import React, { useCallback, useEffect, useState } from 'react'
import { useMacroContext } from '../../../../contexts/macroContext'
import { KeyType } from '../../../../constants/enums'
import { ResetDefaultIcon } from '../../../icons'
import PressTypeControl from './PressTypeControl'
import { KeyPressEventAction } from '../../../../types'

import { HIDLookup } from '../../../../constants/HIDmap'
import { DefaultMacroDelay } from "../../../../constants";

interface Props {
  selectedElementId: number
  selectedElement: KeyPressEventAction
}

export default function KeyPressForm({
  selectedElementId,
  selectedElement
}: Props) {
  const [keypressDuration, setKeypressDuration] = useState(DefaultMacroDelay)
  const [keypressType, setKeypressType] = useState<KeyType>()
  const { updateElement } = useMacroContext()
  const bg = useColorModeValue('primary-light.50', 'primary-dark.700')
  const kebabColour = useColorModeValue('primary-light.500', 'primary-dark.500')
  const toast = useToast()

  useEffect(() => {
    if (
      selectedElement === undefined ||
      selectedElement.type !== 'KeyPressEventAction'
    )
      return

    const typeString = selectedElement.data.keytype as keyof typeof KeyType
    setKeypressType(KeyType[typeString])
    setKeypressDuration(keypressDuration)
  }, [bg, kebabColour, selectedElement, keypressDuration])

  const onKeypressDurationChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setKeypressDuration(Number(event.target.value))
    },
    [setKeypressDuration]
  )

  const onInputBlur = useCallback(() => {
    let duration = DefaultMacroDelay

    if (keypressDuration >= DefaultMacroDelay) {
      duration = keypressDuration
    } else {
      toast({
        title: 'Minimum duration',
        description: `Duration must be at least ${DefaultMacroDelay}ms`,
        status: 'warning',
        duration: 4000,
        isClosable: true
      })
      if (Number.isNaN(duration)) {
        return
      }
    }

    const temp: KeyPressEventAction = {
      ...selectedElement,
      data: { ...selectedElement.data, press_duration: duration }
    }
    updateElement(temp, selectedElementId)
  }, [
    keypressDuration,
    selectedElement,
    selectedElementId,
    toast,
    updateElement
  ])

  const onResetClick = useCallback(() => {
    toast({
      title: 'Default duration applied',
      description: `Applied default duration of ${DefaultMacroDelay}ms`,
      status: 'info',
      duration: 4000,
      isClosable: true
    })

    setKeypressDuration(DefaultMacroDelay)

    const temp: KeyPressEventAction = {
      ...selectedElement,
      data: { ...selectedElement.data, press_duration: DefaultMacroDelay }
    }
    updateElement(temp, selectedElementId)
  }, [toast, selectedElement, updateElement, selectedElementId])

  const onKeypressTypeChange = useCallback(
    (newType: KeyType) => {
      setKeypressType(newType)
      const temp: KeyPressEventAction = {
        ...selectedElement,
        data: { ...selectedElement.data, keytype: KeyType[newType].toString() }
      }
      updateElement(temp, selectedElementId)
    },
    [selectedElement, selectedElementId, updateElement]
  )

  return (
    <>
      <HStack justifyContent="center" p={1}>
        <Text>Editing element</Text>
        <Kbd variant="brand" fontSize="md">{HIDLookup.get(selectedElement.data.keypress)?.displayString ?? ''}</Kbd>
      </HStack>
      <Divider />
      <Grid templateRows="20px 1fr" gap="2" w="full">
        <GridItem w="full" h="8px" alignItems="center" justifyContent="center">
          <Text fontSize={['xs', 'sm', 'md']} fontWeight="semibold">
            Type of keystroke
          </Text>
        </GridItem>
        <GridItem w="full">
          <PressTypeControl value={keypressType} onChange={onKeypressTypeChange} noun="Key" />
        </GridItem>
      </Grid>
      {keypressType === KeyType.DownUp && (
        <Grid templateRows="20px 1fr" gap={2} w="full">
          <GridItem
            w="full"
            h="8px"
            alignItems="center"
            justifyContent="center"
          >
            <Text fontSize={['xs', 'sm', 'md']} fontWeight="semibold">
              Duration (ms)
            </Text>
          </GridItem>
          <HStack w="full" spacing={2}>
            <Input
              type="number"
              size={{ base: 'sm', md: 'md' }}
              placeholder={String(DefaultMacroDelay)}
              variant="brandAccent"
              value={keypressDuration}
              onChange={onKeypressDurationChange}
              onBlur={onInputBlur}
              isInvalid={Number.isNaN(keypressDuration)}
            />
            <Tooltip label={`Reset to the default ${DefaultMacroDelay} ms`} hasArrow variant="brand">
              <IconButton
                variant="brandTertiary"
                aria-label="Reset to default"
                icon={<ResetDefaultIcon />}
                size={{ base: 'sm', md: 'md' }}
                onClick={onResetClick}
                flexShrink={0}
              />
            </Tooltip>
          </HStack>
        </Grid>
      )}
    </>
  )
}
