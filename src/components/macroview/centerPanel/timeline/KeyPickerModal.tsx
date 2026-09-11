import {
  Input,
  Kbd,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  SimpleGrid,
  Text,
  useColorModeValue,
  VStack
} from '@chakra-ui/react'
import { useMemo, useState } from 'react'
import { Hid } from '../../../../constants/HIDmap'
import { MouseInput } from '../../../../constants/MouseMap'
import { keyTrack, mouseTrack } from '../../../../utils/schedule'
import useScrollbarStyles from '../../../../hooks/useScrollbarStyles'

interface Props {
  isOpen: boolean
  title: string
  onClose: () => void
  /** Receives the chosen track id (`k:<hid>` or `m:<button>`). */
  onPick: (track: string) => void
}

/** Searchable list of every key and mouse button, for re-keying presses. */
export default function KeyPickerModal({ isOpen, title, onClose, onPick }: Props) {
  const [query, setQuery] = useState('')
  const hoverBg = useColorModeValue('primary-light.100', 'primary-dark.600')
  const scrollbar = useScrollbarStyles()

  const choices = useMemo(() => {
    const q = query.trim().toLowerCase()
    const keys = Hid.all
      .filter((k) => q === '' || k.displayString.toLowerCase().includes(q))
      .map((k) => ({ track: keyTrack(k.HIDcode), label: k.displayString }))
    const buttons = MouseInput.all
      .filter((b) => b.enumVal !== undefined)
      .filter((b) => q === '' || b.displayString.toLowerCase().includes(q))
      .map((b) => ({ track: mouseTrack(b.enumVal), label: b.displayString }))
    return [...keys, ...buttons]
  }, [query])

  return (
    <Modal variant="brand" isOpen={isOpen} onClose={onClose} isCentered size="lg">
      <ModalOverlay />
      <ModalContent p={2}>
        <ModalHeader>{title}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack align="stretch" spacing={3}>
            <Input
              size="sm"
              placeholder="Search for a key or mouse button"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
            />
            {choices.length === 0 ? (
              <Text fontSize="sm" opacity={0.7}>
                Nothing matches.
              </Text>
            ) : (
              <SimpleGrid minChildWidth="72px" spacing={2} maxH="320px" overflowY="auto" sx={scrollbar} p={1}>
                {choices.map((choice) => (
                  <Kbd
                    key={choice.track}
                    as="button"
                    fontSize="xs"
                    textAlign="center"
                    py={2}
                    cursor="pointer"
                    _hover={{ bg: hoverBg }}
                    onClick={() => {
                      onPick(choice.track)
                      onClose()
                    }}
                  >
                    {choice.label}
                  </Kbd>
                ))}
              </SimpleGrid>
            )}
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}
