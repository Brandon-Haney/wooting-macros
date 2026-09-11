import { Box, Divider, Portal, Text, useColorModeValue, VStack } from '@chakra-ui/react'
import { useEffect, useRef } from 'react'

export interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

interface Props {
  x: number
  y: number
  title?: string
  items: (MenuItem | 'divider')[]
  onClose: () => void
}

/** A small context menu at a pointer position; closes on outside click, Escape or scroll. */
export default function TimelineMenu({ x, y, title, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const bg = useColorModeValue('white', 'primary-dark.700')
  const border = useColorModeValue('primary-light.300', 'primary-dark.500')
  const hover = useColorModeValue('primary-light.100', 'primary-dark.600')
  const dangerColour = useColorModeValue('red.600', 'red.300')
  const muted = useColorModeValue('gray.600', 'gray.400')

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onClose, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  // Keep the menu inside the window.
  const width = 220
  const left = Math.min(x, window.innerWidth - width - 8)
  const top = Math.min(y, window.innerHeight - 8 - 40 * items.length)

  return (
    <Portal>
      <VStack
        ref={ref}
        position="fixed"
        left={`${left}px`}
        top={`${Math.max(8, top)}px`}
        w={`${width}px`}
        zIndex={2000}
        bg={bg}
        border="1px solid"
        borderColor={border}
        rounded="md"
        shadow="lg"
        py={1}
        spacing={0}
        align="stretch"
        onContextMenu={(event) => event.preventDefault()}
      >
        {title && (
          <Text fontSize="xs" color={muted} px={3} py={1} noOfLines={1}>
            {title}
          </Text>
        )}
        {items.map((item, index) =>
          item === 'divider' ? (
            <Divider key={index} my={1} />
          ) : (
            <Box
              key={index}
              as="button"
              textAlign="left"
              fontSize="sm"
              px={3}
              py={1.5}
              color={item.danger ? dangerColour : undefined}
              opacity={item.disabled ? 0.5 : 1}
              cursor={item.disabled ? 'default' : 'pointer'}
              _hover={item.disabled ? undefined : { bg: hover }}
              onClick={() => {
                if (item.disabled) return
                onClose()
                item.onClick()
              }}
            >
              {item.label}
            </Box>
          )
        )}
      </VStack>
    </Portal>
  )
}
