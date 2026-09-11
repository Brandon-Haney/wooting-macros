import {
  Box,
  Button,
  Divider,
  HStack,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Text,
  Tooltip,
  useColorMode,
  useColorModeValue,
  VStack
} from '@chakra-ui/react'
import data from '@emoji-mart/data'
import Picker from '@emoji-mart/react'
import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api'
import { open } from '@tauri-apps/api/dialog'
import { error } from 'tauri-plugin-log'
import AppIcon from './AppIcon'
import ApplicationPickerModal from './ApplicationPickerModal'
import { ApplicationEntry } from '../types'

interface Props {
  shortcodeToShow: string
  isEmojiPopoverOpen: boolean
  onEmojiPopoverOpen: () => void
  onEmojiPopoverClose: () => void
  /** Receives an emoji shortcode, or a PNG data URL when an application icon is chosen. */
  onEmojiSelect: (emoji: { shortcodes: string }) => void
  /** Executables whose icons are offered above the emoji grid. */
  linkedProcesses?: string[]
}

interface AppChoice {
  exe: string
  icon: string
}

export default function EmojiPopover({
  shortcodeToShow,
  isEmojiPopoverOpen,
  onEmojiPopoverClose,
  onEmojiPopoverOpen,
  onEmojiSelect,
  linkedProcesses = []
}: Props) {
  const { colorMode } = useColorMode()
  const initialFocusRef = useRef<HTMLDivElement | null>(null)
  const [choices, setChoices] = useState<AppChoice[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const panelBg = useColorModeValue('white', 'primary-dark.800')
  const hoverBg = useColorModeValue('primary-light.100', 'primary-dark.600')
  const muted = useColorModeValue('gray.600', 'gray.400')

  // Icons of the linked applications, fetched when the popover opens.
  useEffect(() => {
    if (!isEmojiPopoverOpen) return
    let cancelled = false
    Promise.all(
      linkedProcesses.map((exe) =>
        invoke<string | null>('get_application_icon', { exe })
          .then((icon) => (icon ? { exe, icon } : null))
          .catch(() => null)
      )
    ).then((results) => {
      if (!cancelled) setChoices(results.filter((r): r is AppChoice => r !== null))
    })
    return () => {
      cancelled = true
    }
  }, [isEmojiPopoverOpen, linkedProcesses])

  const pickApplication = (entry: ApplicationEntry) => {
    const request = entry.path
      ? invoke<string>('get_file_icon', { path: entry.path })
      : invoke<string | null>('get_application_icon', { exe: entry.exe })
    request
      .then((icon) => {
        if (icon) onEmojiSelect({ shortcodes: icon })
      })
      .catch((e) => error(String(e)))
  }

  const browse = async () => {
    try {
      const picked = await open({
        multiple: false,
        title: 'Choose an icon',
        filters: [{ name: 'Programs and images', extensions: ['exe', 'ico', 'png', 'dll'] }]
      })
      if (typeof picked !== 'string') return
      const icon = await invoke<string>('get_file_icon', { path: picked })
      onEmojiSelect({ shortcodes: icon })
    } catch (e) {
      error(String(e))
    }
  }

  return (
    <Popover
      initialFocusRef={initialFocusRef}
      returnFocusOnClose={true}
      isOpen={isEmojiPopoverOpen}
      onClose={onEmojiPopoverClose}
      closeOnBlur={true}
      isLazy
    >
      <PopoverTrigger>
        <Box
          maxHeight="32px"
          cursor="pointer"
          onClick={onEmojiPopoverOpen}
          _hover={{ transform: 'scale(110%)' }}
          transition="ease-out 150ms"
        >
          <AppIcon icon={shortcodeToShow} />
        </Box>
      </PopoverTrigger>
      <PopoverContent bg="transparent" border="0px" shadow="none" w="fit-content">
        <PopoverBody p={0}>
          <VStack align="stretch" spacing={0} bg={panelBg} rounded="lg" overflow="hidden" shadow="lg">
            <VStack align="stretch" spacing={2} px={3} py={2}>
              <HStack justify="space-between">
                <Text fontSize="xs" fontWeight="semibold" color={muted}>
                  App icon
                </Text>
                <HStack spacing={1}>
                  <Tooltip label="Running programs and installed Steam games" hasArrow variant="brand">
                    <Button size="xs" variant="brand" onClick={() => setPickerOpen(true)}>
                      Applications…
                    </Button>
                  </Tooltip>
                  <Tooltip label="Any .exe, .ico or .png file" hasArrow variant="brand">
                    <Button size="xs" variant="brand" onClick={browse}>
                      Browse…
                    </Button>
                  </Tooltip>
                </HStack>
              </HStack>
              {choices.length > 0 ? (
                <HStack spacing={2} flexWrap="wrap">
                  {choices.map((choice) => (
                    <Tooltip key={choice.exe} label={choice.exe} hasArrow variant="brand">
                      <Box
                        as="button"
                        p={1}
                        rounded="md"
                        _hover={{ bg: hoverBg }}
                        onClick={() => onEmojiSelect({ shortcodes: choice.icon })}
                      >
                        <AppIcon icon={choice.icon} />
                      </Box>
                    </Tooltip>
                  ))}
                </HStack>
              ) : (
                <Text fontSize="xs" color={muted}>
                  {linkedProcesses.length === 0
                    ? 'Linked applications show up here. Applications… lists everything running or installed through Steam.'
                    : 'No icon found for the linked applications yet (they may not be running). Try Applications… or Browse.'}
                </Text>
              )}
            </VStack>
            <Divider />
            <Box id="picker-box" w="full" ref={initialFocusRef}>
              <Picker
                data={data}
                theme={colorMode}
                autoFocus={true}
                onEmojiSelect={onEmojiSelect}
                previewPosition="none"
                dynamicWidth={true}
              />
            </Box>
          </VStack>
        </PopoverBody>
      </PopoverContent>
      <ApplicationPickerModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Choose an application icon"
        description="Running programs and games installed through Steam. Click one to use its icon."
        linked={[]}
        onChange={() => undefined}
        onPick={pickApplication}
      />
    </Popover>
  )
}
