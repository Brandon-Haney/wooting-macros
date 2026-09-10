import {
  Box,
  Button,
  Checkbox,
  Divider,
  HStack,
  Input,
  InputGroup,
  InputLeftElement,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Spinner,
  Tag,
  TagCloseButton,
  TagLabel,
  Text,
  useColorModeValue,
  VStack,
  Wrap,
  WrapItem
} from '@chakra-ui/react'
import { SearchIcon } from '@chakra-ui/icons'
import { open } from '@tauri-apps/api/dialog'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApplicationContext } from '../../contexts/applicationContext'
import { useSelectedCollection } from '../../contexts/selectors'
import { listApplications } from '../../constants/utils'
import { ApplicationEntry } from '../../types'
import { error } from 'tauri-plugin-log'
import useScrollbarStyles from '../../hooks/useScrollbarStyles'

interface Props {
  isOpen: boolean
  onClose: () => void
}

const sameExe = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Lets the user link the selected collection to application executables. */
export default function LinkedAppsModal({ isOpen, onClose }: Props) {
  const { selection, onCollectionUpdate } = useApplicationContext()
  const currentCollection = useSelectedCollection()
  const linked = useMemo(
    () => currentCollection.linked_processes ?? [],
    [currentCollection.linked_processes]
  )
  const [applications, setApplications] = useState<ApplicationEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showBackground, setShowBackground] = useState(false)
  const [manualName, setManualName] = useState('')
  const rowHover = useColorModeValue('primary-light.100', 'primary-dark.600')
  const listBg = useColorModeValue('primary-light.50', 'primary-dark.800')
  const scrollbar = useScrollbarStyles()

  const refresh = useCallback(() => {
    setLoading(true)
    listApplications()
      .then(setApplications)
      .catch((e) => {
        error(e)
        setApplications([])
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!isOpen) return
    setSearch('')
    setManualName('')
    refresh()
  }, [isOpen, refresh])

  const setLinked = useCallback(
    (linked_processes: string[]) => {
      onCollectionUpdate(
        { ...currentCollection, linked_processes },
        selection.collectionIndex
      )
    },
    [currentCollection, onCollectionUpdate, selection.collectionIndex]
  )

  const isLinked = useCallback(
    (exe: string) => linked.some((l) => sameExe(l, exe)),
    [linked]
  )

  const toggleExe = useCallback(
    (exe: string) => {
      const trimmed = exe.trim()
      if (trimmed === '') return
      if (isLinked(trimmed)) {
        setLinked(linked.filter((l) => !sameExe(l, trimmed)))
      } else {
        setLinked([...linked, trimmed])
      }
    },
    [isLinked, linked, setLinked]
  )

  const browseForExe = useCallback(async () => {
    try {
      const picked = await open({
        multiple: false,
        title: 'Choose the application executable',
        filters: [{ name: 'Applications', extensions: ['exe'] }]
      })
      if (typeof picked !== 'string') return
      const name = picked.split(/[\\/]/).pop() ?? ''
      if (name && !isLinked(name)) setLinked([...linked, name])
    } catch (e) {
      error(String(e))
    }
  }, [isLinked, linked, setLinked])

  const query = search.trim().toLowerCase()
  const matches = useCallback(
    (entry: ApplicationEntry) =>
      query === '' ||
      entry.exe.toLowerCase().includes(query) ||
      entry.label.toLowerCase().includes(query),
    [query]
  )

  const running = useMemo(
    () => applications.filter((a) => a.source === 'running' && matches(a)),
    [applications, matches]
  )
  const background = useMemo(
    () => applications.filter((a) => a.source === 'background' && matches(a)),
    [applications, matches]
  )
  const installed = useMemo(
    () => applications.filter((a) => a.source === 'steam' && matches(a)),
    [applications, matches]
  )

  const renderRow = (entry: ApplicationEntry, key: string) => (
    <HStack
      key={key}
      w="full"
      px={3}
      py={1.5}
      spacing={3}
      cursor="pointer"
      _hover={{ bg: rowHover }}
      onClick={() => toggleExe(entry.exe)}
    >
      <Checkbox
        isChecked={isLinked(entry.exe)}
        pointerEvents="none"
        colorScheme="primary-accent"
      />
      <VStack spacing={0} align="start" flex={1} minW={0}>
        <Text fontSize="sm" fontWeight="semibold" noOfLines={1}>
          {entry.label}
        </Text>
        {entry.label.toLowerCase() !== entry.exe.toLowerCase() && (
          <Text fontSize="xs" opacity={0.7} noOfLines={1}>
            {entry.exe}
          </Text>
        )}
      </VStack>
    </HStack>
  )

  const renderSection = (
    title: string,
    entries: ApplicationEntry[],
    empty: string
  ) => (
    <VStack w="full" align="stretch" spacing={0}>
      <Text fontSize="xs" fontWeight="bold" px={3} pt={2} pb={1} opacity={0.7}>
        {title.toUpperCase()}
      </Text>
      {entries.length === 0 ? (
        <Text fontSize="sm" px={3} pb={2} opacity={0.6}>
          {empty}
        </Text>
      ) : (
        entries.map((entry) =>
          renderRow(entry, `${entry.source}-${entry.exe}-${entry.label}`)
        )
      )}
    </VStack>
  )

  return (
    <Modal
      variant="brand"
      isOpen={isOpen}
      onClose={onClose}
      isCentered
      size="xl"
      scrollBehavior="inside"
    >
      <ModalOverlay />
      <ModalContent p={2}>
        <ModalHeader>
          Linked applications
          <Text fontSize="sm" fontWeight="normal" opacity={0.8} mt={1}>
            The collection is armed only while one of these applications is
            the focused window, and disarmed otherwise. Leave the list empty
            to control the collection manually.
          </Text>
        </ModalHeader>
        <Divider w="90%" alignSelf="center" />
        <ModalBody>
          <VStack align="stretch" spacing={3}>
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
                      onClick={() => toggleExe(name)}
                    />
                  </Tag>
                </WrapItem>
              ))}
            </Wrap>
            <InputGroup size="sm">
              <InputLeftElement pointerEvents="none">
                <SearchIcon opacity={0.6} />
              </InputLeftElement>
              <Input
                placeholder="Search running apps and installed games…"
                value={search}
                autoFocus
                onChange={(event) => setSearch(event.target.value)}
              />
            </InputGroup>
            <Box
              bg={listBg}
              rounded="md"
              maxH="300px"
              overflowY="auto"
              sx={scrollbar}
            >
              {loading ? (
                <HStack p={3}>
                  <Spinner size="sm" />
                  <Text fontSize="sm">Looking for applications…</Text>
                </HStack>
              ) : (
                <>
                  {renderSection(
                    'Running',
                    running,
                    'No running application with a window matches.'
                  )}
                  {renderSection(
                    'Installed (Steam)',
                    installed,
                    'No installed game matches. Games from other stores can be picked below.'
                  )}
                  {showBackground &&
                    renderSection(
                      'Background processes',
                      background,
                      'No background process matches.'
                    )}
                </>
              )}
            </Box>
            <HStack justifyContent="space-between">
              <Checkbox
                size="sm"
                isChecked={showBackground}
                onChange={(event) => setShowBackground(event.target.checked)}
              >
                <Text fontSize="xs">Show background processes</Text>
              </Checkbox>
              <Button size="xs" variant="ghost" onClick={refresh}>
                Refresh
              </Button>
            </HStack>
            <Divider />
            <Text fontSize="sm" fontWeight="semibold">
              App not listed?
            </Text>
            <HStack>
              <Button size="sm" onClick={browseForExe}>
                Browse for an .exe…
              </Button>
              <Input
                size="sm"
                placeholder="or type its executable name, e.g. game.exe"
                value={manualName}
                onChange={(event) => setManualName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    toggleExe(manualName)
                    setManualName('')
                  }
                }}
              />
              <Button
                size="sm"
                onClick={() => {
                  toggleExe(manualName)
                  setManualName('')
                }}
              >
                Add
              </Button>
            </HStack>
            <Text fontSize="xs" opacity={0.7}>
              Tip: some games start through a launcher whose process differs
              from the game. If a linked game does not arm the collection,
              start the game and pick it from Running.
            </Text>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose}>Done</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
