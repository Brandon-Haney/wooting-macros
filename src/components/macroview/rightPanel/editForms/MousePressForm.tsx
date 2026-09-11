import {
  Divider,
  Grid,
  GridItem,
  IconButton,
  Input,
  Text,
  Tooltip,
  useColorModeValue,
  useToast,
  Kbd,
  HStack
} from '@chakra-ui/react'
import React, { useCallback, useEffect, useState } from 'react'
import { useMacroContext } from '../../../../contexts/macroContext'
import { KeyType } from '../../../../constants/enums'
import { mouseEnumLookup } from '../../../../constants/MouseMap'
import { ResetDefaultIcon } from '../../../icons'
import PressTypeControl from './PressTypeControl'
import { MouseEventAction } from '../../../../types'

import { DefaultMouseDelay } from '../../../../constants'

interface Props {
  selectedElementId: number
  selectedElement: MouseEventAction
}

export default function MousePressForm({
  selectedElementId,
  selectedElement
}: Props) {
  const [headingText, setHeadingText] = useState<JSX.Element | string>('')
  const [mousepressDuration, setMousepressDuration] =
    useState(DefaultMouseDelay)
  const [mousepressType, setMousepressType] = useState<KeyType>()
  const { updateElement } = useMacroContext()
  const bg = useColorModeValue('primary-light.50', 'primary-dark.700')
  const kebabColour = useColorModeValue('primary-light.500', 'primary-dark.500')
  const toast = useToast()

  useEffect(() => {
    const typeString: keyof typeof KeyType = selectedElement.data.data
      .type as keyof typeof KeyType
    setMousepressType(KeyType[typeString])
    if (selectedElement.data.data.type === 'DownUp') {
      setMousepressDuration(selectedElement.data.data.duration)
    }

    setHeadingText(
      <HStack justifyContent="center" p={1}>
        <Text>Editing element</Text>
        <Kbd variant="brand" fontSize="md">{mouseEnumLookup.get(selectedElement.data.data.button)?.displayString ??
          ''}</Kbd>
      </HStack>
    )
  }, [bg, kebabColour, selectedElement])

  const onMousepressDurationChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setMousepressDuration(Number(event.target.value))
    },
    [setMousepressDuration]
  )

  const onInputBlur = useCallback(() => {
    if (selectedElement.data.data.type !== 'DownUp') {
      return
    }
    let duration = DefaultMouseDelay

    if (mousepressDuration >= DefaultMouseDelay) {
      duration = mousepressDuration
    } else if (mousepressDuration < DefaultMouseDelay) {
      toast({
        title: 'Minimum duration',
        description: `Duration must be at least ${DefaultMouseDelay}ms`,
        status: 'warning',
        duration: 4000,
        isClosable: true
      })
    } else if (Number.isNaN(duration)) {
      return
    }

    const temp: MouseEventAction = {
      ...selectedElement,
      data: {
        ...selectedElement.data,
        data: {
          ...selectedElement.data.data,
          duration
        }
      }
    }
    updateElement(temp, selectedElementId)
  }, [
    mousepressDuration,
    selectedElement,
    selectedElementId,
    toast,
    updateElement
  ])

  const onMousepressTypeChange = useCallback(
    (newType: KeyType) => {
      setMousepressType(newType)
      let temp: MouseEventAction = { ...selectedElement }
      switch (newType) {
        case KeyType.Down:
          temp = {
            ...temp,
            data: { ...temp.data, data: { ...temp.data.data, type: 'Down' } }
          }
          break
        case KeyType.Up:
          temp = {
            ...temp,
            data: { ...temp.data, data: { ...temp.data.data, type: 'Up' } }
          }
          break
        case KeyType.DownUp:
          temp = {
            ...temp,
            data: {
              ...temp.data,
              data: {
                ...temp.data.data,
                type: 'DownUp',
                duration:
                  temp.data.data.type === 'DownUp'
                    ? temp.data.data.duration
                    : DefaultMouseDelay
              }
            }
          }
          break
        default:
          break
      }
      updateElement(temp, selectedElementId)
    },
    [selectedElement, selectedElementId, updateElement]
  )

  const onResetClick = useCallback(() => {
    if (selectedElement.data.data.type !== 'DownUp') {
      return
    }

    toast({
      title: 'Default duration applied',
      description: `Applied default duration of ${DefaultMouseDelay}ms`,
      status: 'info',
      duration: 4000,
      isClosable: true
    })

    setMousepressDuration(DefaultMouseDelay)

    const temp: MouseEventAction = {
      ...selectedElement,
      data: {
        ...selectedElement.data,
        data: {
          ...selectedElement.data.data,
          duration: DefaultMouseDelay
        }
      }
    }
    updateElement(temp, selectedElementId)
  }, [toast, selectedElement, updateElement, selectedElementId])

  return (
    <>
      <Text w="full" fontWeight="semibold" fontSize={['sm', 'md']}>
        {headingText}
      </Text>
      <Divider />
      <Grid templateRows="20px 1fr" gap="2" w="full">
        <GridItem w="full" h="8px" alignItems="center" justifyContent="center">
          <Text fontSize={['xs', 'sm', 'md']} fontWeight="semibold">
            Type of keystroke
          </Text>
        </GridItem>
        <GridItem w="full">
          <PressTypeControl value={mousepressType} onChange={onMousepressTypeChange} noun="Mouse" />
        </GridItem>
      </Grid>
      {mousepressType === KeyType.DownUp && (
        <Grid templateRows="20px 1fr" gap="2" w="full">
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
              placeholder={String(DefaultMouseDelay)}
              variant="brandAccent"
              value={mousepressDuration}
              onChange={onMousepressDurationChange}
              onBlur={onInputBlur}
              isInvalid={Number.isNaN(mousepressDuration)}
            />
            <Tooltip label={`Reset to the default ${DefaultMouseDelay} ms`} hasArrow variant="brand">
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
