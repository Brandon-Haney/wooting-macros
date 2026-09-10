import {
  Button,
  Divider,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  Tag,
  TagCloseButton,
  TagLabel,
  Text,
  VStack,
  Wrap,
  WrapItem
} from '@chakra-ui/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApplicationContext } from '../../contexts/applicationContext'
import { useSelectedCollection } from '../../contexts/selectors'
import { listProcesses } from '../../constants/utils'
import { error } from 'tauri-plugin-log'

interface Props {
  isOpen: boolean
  onClose: () => void
}

/** Lets the user link the selected collection to application executables. */
export default function LinkedAppsModal({ isOpen, onClose }: Props) {
  const { selection, onCollectionUpdate } = useApplicationContext()
  const currentCollection = useSelectedCollection()
  const linked = useMemo(
    () => currentCollection.linked_processes ?? [],
    [currentCollection.linked_processes]
  )
  const [processes, setProcesses] = useState<string[]>([])
  const [manualName, setManualName] = useState('')

  useEffect(() => {
    if (!isOpen) return
    listProcesses()
      .then(setProcesses)
      .catch((e) => {
        error(e)
        setProcesses([])
      })
  }, [isOpen])

  const setLinked = useCallback(
    (linked_processes: string[]) => {
      onCollectionUpdate(
        { ...currentCollection, linked_processes },
        selection.collectionIndex
      )
    },
    [currentCollection, onCollectionUpdate, selection.collectionIndex]
  )

  const addName = useCallback(
    (name: string) => {
      const trimmed = name.trim()
      if (trimmed === '') return
      if (linked.some((l) => l.toLowerCase() === trimmed.toLowerCase())) return
      setLinked([...linked, trimmed])
    },
    [linked, setLinked]
  )

  const removeName = useCallback(
    (name: string) => {
      setLinked(linked.filter((l) => l !== name))
    },
    [linked, setLinked]
  )

  return (
    <Modal variant="brand" isOpen={isOpen} onClose={onClose} isCentered>
      <ModalOverlay />
      <ModalContent p={2}>
        <ModalHeader>Linked applications</ModalHeader>
        <Divider w="90%" alignSelf="center" />
        <ModalBody>
          <VStack align="stretch" spacing={4}>
            <Text fontSize="sm">
              The collection is armed only while one of these applications is
              the focused window, and disarmed otherwise. Leave the list empty
              to control the collection manually.
            </Text>
            <Wrap>
              {linked.length === 0 && (
                <Text fontSize="sm" opacity={0.6}>
                  No linked applications.
                </Text>
              )}
              {linked.map((name) => (
                <WrapItem key={name}>
                  <Tag size="md" variant="subtle" colorScheme="primary-accent">
                    <TagLabel>{name}</TagLabel>
                    <TagCloseButton
                      aria-label={`Unlink ${name}`}
                      onClick={() => removeName(name)}
                    />
                  </Tag>
                </WrapItem>
              ))}
            </Wrap>
            <Select
              size="sm"
              placeholder="Add a running application…"
              value=""
              onChange={(event) => addName(event.target.value)}
            >
              {processes
                .filter(
                  (p) => !linked.some((l) => l.toLowerCase() === p.toLowerCase())
                )
                .map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
            </Select>
            <HStack>
              <Input
                size="sm"
                placeholder="Or type an executable name, e.g. game.exe"
                value={manualName}
                onChange={(event) => setManualName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    addName(manualName)
                    setManualName('')
                  }
                }}
              />
              <Button
                size="sm"
                onClick={() => {
                  addName(manualName)
                  setManualName('')
                }}
              >
                Add
              </Button>
            </HStack>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose}>Done</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
