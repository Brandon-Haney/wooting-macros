import { DeleteIcon, LinkIcon } from '@chakra-ui/icons'
import {
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  IconButton,
  useToast
} from '@chakra-ui/react'
import { KebabVertical } from '../icons'
import { exportCollection, importFile } from '../../constants/transfer'
import { error } from 'tauri-plugin-log'
import {
  Box,
  Button,
  Flex,
  HStack,
  Input,
  Text,
  Tooltip,
  useDisclosure,
  VStack
} from '@chakra-ui/react'
import { useApplicationContext } from '../../contexts/applicationContext'
import { useSelectedCollection } from '../../contexts/selectors'
import DeleteCollectionModal from './DeleteCollectionModal'
import LinkedAppsModal from './LinkedAppsModal'
import MacroList from './MacroList'
import { useCallback, useEffect, useMemo, useState } from 'react'
import EmojiPopover from '../EmojiPopover'
import useMainBgColour from '../../hooks/useMainBgColour'
import useBorderColour from '../../hooks/useBorderColour'

interface Props {
  searchValue: string
}

export default function CollectionPanel({ searchValue }: Props) {
  const {
    collections,
    selection,
    onCollectionUpdate,
    onCollectionAdd,
    onSelectedCollectionDelete
  } = useApplicationContext()
  const toast = useToast()
  const currentCollection = useSelectedCollection()
  const {
    isOpen: isDeleteModalOpen,
    onOpen: onDeleteModalOpen,
    onClose: onDeleteModalClose
  } = useDisclosure()
  const {
    isOpen: isEmojiPopoverOpen,
    onOpen: onEmojiPopoverOpen,
    onClose: onEmojiPopoverClose
  } = useDisclosure()
  const {
    isOpen: isLinkedAppsModalOpen,
    onOpen: onLinkedAppsModalOpen,
    onClose: onLinkedAppsModalClose
  } = useDisclosure()
  const linkedCount = (currentCollection.linked_processes ?? []).length

  const onExportCollection = useCallback(() => {
    exportCollection(currentCollection)
      .then((saved) => {
        if (saved)
          toast({ title: 'Collection exported', status: 'success', duration: 2500 })
      })
      .catch((e) => {
        error(String(e))
        toast({ title: 'Export failed', description: String(e), status: 'error' })
      })
  }, [currentCollection, toast])

  const onImport = useCallback(
    (intoThisCollection: boolean) => {
      importFile()
        .then((content) => {
          if (!content) return
          let macros = [...content.macros]
          if (intoThisCollection) {
            for (const collection of content.collections) {
              macros = macros.concat(collection.macros)
            }
            if (macros.length === 0) {
              toast({ title: 'Nothing to import', status: 'warning', duration: 2500 })
              return
            }
            onCollectionUpdate(
              { ...currentCollection, macros: [...currentCollection.macros, ...macros] },
              selection.collectionIndex
            )
            toast({
              title: `Imported ${macros.length} macro${macros.length === 1 ? '' : 's'} into ${currentCollection.name}`,
              status: 'success',
              duration: 2500
            })
          } else {
            const newCollections = [...content.collections]
            if (macros.length > 0) {
              newCollections.push({
                name: 'Imported macros',
                icon: ':package:',
                active: true,
                macros,
                linked_processes: []
              })
            }
            if (newCollections.length === 0) {
              toast({ title: 'Nothing to import', status: 'warning', duration: 2500 })
              return
            }
            newCollections.forEach((collection) => onCollectionAdd(collection))
            toast({
              title: `Imported ${newCollections.length} collection${newCollections.length === 1 ? '' : 's'}`,
              status: 'success',
              duration: 2500
            })
          }
        })
        .catch((e) => {
          error(String(e))
          toast({ title: 'Import failed', description: String(e), status: 'error' })
        })
    },
    [currentCollection, onCollectionAdd, onCollectionUpdate, selection.collectionIndex, toast]
  )
  const [collectionName, setCollectionName] = useState('')
  const borderColour = useBorderColour()
  const isCollectionUndeletable = collections.length <= 1
  const isSearching: boolean = useMemo((): boolean => {
    return searchValue.length !== 0
  }, [searchValue])

  useEffect(() => {
    setCollectionName(currentCollection.name)
  }, [currentCollection.name])

  const onEmojiSelect = useCallback(
    (emoji: { shortcodes: string }) => {
      if (emoji.shortcodes === currentCollection.icon) {
        return
      }
      onCollectionUpdate(
        { ...currentCollection, icon: emoji.shortcodes },
        selection.collectionIndex
      )
    },
    [currentCollection, onCollectionUpdate, selection.collectionIndex]
  )

  const onCollectionNameChange = useCallback(() => {
    if (collectionName === currentCollection.name) {
      return
    }

    if (collectionName === '') {
      onCollectionUpdate(
        {
          ...currentCollection,
          name: `Collection ${selection.collectionIndex + 1}`
        },
        selection.collectionIndex
      )
    } else {
      onCollectionUpdate(
        {
          ...currentCollection,
          name: collectionName
        },
        selection.collectionIndex
      )
    }
  }, [
    collectionName,
    currentCollection,
    onCollectionUpdate,
    selection.collectionIndex
  ])

  return (
    <VStack w="full" h="full" spacing="0">
      <Flex
        bg={useMainBgColour()}
        justifyContent="space-between"
        alignItems="center"
        py={2}
        px={4}
        w="full"
        minH="90px"
        borderBottom="1px"
        borderColor={borderColour}
      >
        {!isSearching ? (
          <HStack w="full" justifyContent="space-between" flexWrap="wrap" rowGap={2}>
            <HStack flex={1} minW="240px" spacing={4}>
              <EmojiPopover
                shortcodeToShow={currentCollection.icon}
                isEmojiPopoverOpen={isEmojiPopoverOpen}
                onEmojiPopoverClose={onEmojiPopoverClose}
                onEmojiPopoverOpen={onEmojiPopoverOpen}
                onEmojiSelect={onEmojiSelect}
              />
              <Input
                w="fit"
                variant="flushed"
                onChange={(event) => setCollectionName(event.target.value)}
                onBlur={onCollectionNameChange}
                value={collectionName}
                size="xl"
                fontSize="25px"
                textStyle="name"
                placeholder="Collection Name"
                _placeholder={{ opacity: 1, color: borderColour }}
                _focusVisible={{ borderColor: 'primary-accent.500' }}
              />
            </HStack>
            <HStack w="fit" flexShrink={0}>
              {/* <Button leftIcon={<AddIcon />} size={['xs', 'sm', 'md']} isDisabled>
              Export Collection
            </Button>
            <Button leftIcon={<AddIcon />} size={['xs', 'sm', 'md']} isDisabled>
              Import Macros
            </Button> */}
              <Menu variant="brand">
                <MenuButton
                  as={IconButton}
                  aria-label="Collection options"
                  icon={<KebabVertical />}
                  size="md"
                  variant="brand"
                />
                <MenuList p="2">
                  <MenuItem onClick={onExportCollection}>Export collection…</MenuItem>
                  <MenuItem onClick={() => onImport(true)}>
                    Import macros into this collection…
                  </MenuItem>
                  <MenuItem onClick={() => onImport(false)}>
                    Import as new collection…
                  </MenuItem>
                </MenuList>
              </Menu>
              <Tooltip
                variant="brand"
                label="Arm this collection only while linked applications are focused"
                hasArrow
                placement="bottom-start"
              >
                <Button
                  leftIcon={<LinkIcon />}
                  size="md"
                  onClick={onLinkedAppsModalOpen}
                  aria-label="Linked Applications"
                >
                  {linkedCount === 0
                    ? 'Link Applications'
                    : `Linked Apps (${linkedCount})`}
                </Button>
              </Tooltip>
              <Tooltip
                variant="brand"
                label={
                  isCollectionUndeletable
                    ? "Can't delete your last collection!"
                    : ''
                }
                hasArrow
                placement="bottom-start"
              >
                <Box>
                  <Button
                    leftIcon={<DeleteIcon />}
                    variant="brandWarning"
                    size="md"
                    isDisabled={isCollectionUndeletable}
                    onClick={
                      currentCollection.macros.length !== 0
                        ? onDeleteModalOpen
                        : onSelectedCollectionDelete
                    }
                    aria-label="Delete Collection"
                  >
                    Delete Collection
                  </Button>
                </Box>
              </Tooltip>
            </HStack>
          </HStack>
        ) : (
          <HStack>
            <Text as="b" fontSize="3xl">
              Search
            </Text>
          </HStack>
        )}
      </Flex>
      <DeleteCollectionModal
        isOpen={isDeleteModalOpen}
        onClose={onDeleteModalClose}
      />
      <LinkedAppsModal
        isOpen={isLinkedAppsModalOpen}
        onClose={onLinkedAppsModalClose}
      />
      <MacroList searchValue={searchValue} />
    </VStack>
  )
}
