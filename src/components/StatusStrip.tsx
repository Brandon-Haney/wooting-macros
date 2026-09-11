import {
  Box,
  Divider,
  HStack,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Text,
  useColorModeValue,
  VStack
} from '@chakra-ui/react'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useMemo, useState } from 'react'
import { useApplicationContext } from '../contexts/applicationContext'
import { getStatus } from '../constants/utils'
import { BackendStatus } from '../types'
import { error } from 'tauri-plugin-log'

const POLL_INTERVAL_MS = 1000
const BURST_WINDOW_MS = 10_000
const RECENT_KEPT = 3
/** Armed collection names shown inline before the +N chip. */
const INLINE_ARMED = 2

interface Fired {
  name: string
  at: number
}

function Dot({ color }: { color: string }) {
  return (
    <Box
      as="span"
      display="inline-block"
      w="8px"
      h="8px"
      rounded="full"
      bg={color}
      flexShrink={0}
    />
  )
}

function Chip({ children }: { children: string }) {
  return (
    <Box
      as="span"
      bg="primary-light.700"
      color="primary-light.100"
      rounded="full"
      px={1.5}
      fontSize="11px"
      lineHeight="16px"
      flexShrink={0}
    >
      {children}
    </Box>
  )
}

function Separator() {
  return <Box w="1px" h="14px" bg="primary-light.600" flexShrink={0} />
}

/** IDE-style status strip: hook state, focused application, armed collections, last macro fired. */
export default function StatusStrip() {
  const { collections } = useApplicationContext()
  const [status, setStatus] = useState<BackendStatus | null>(null)
  const [recent, setRecent] = useState<Fired[]>([])
  const [now, setNow] = useState(Date.now())
  const stripBg = useColorModeValue('primary-light.800', 'primary-dark.900')
  const cardBg = useColorModeValue('bg-light', 'primary-dark.800')
  const cardText = useColorModeValue('primary-light.900', 'primary-dark.100')
  const cardMuted = useColorModeValue('primary-light.600', 'primary-dark.400')

  useEffect(() => {
    let cancelled = false
    const poll = () => {
      setNow(Date.now())
      if (document.hidden) return
      getStatus()
        .then((s) => {
          if (!cancelled) setStatus(s)
        })
        .catch((e) => error(String(e)))
    }
    poll()
    const timer = window.setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const unlisten = listen<string>('macro-fired', (event) => {
      setRecent((list) =>
        [{ name: event.payload, at: Date.now() }, ...list].slice(0, RECENT_KEPT * 4)
      )
    })
    return () => {
      unlisten.then((stop) => stop()).catch((e) => error(String(e)))
    }
  }, [])

  const foreground = status?.foreground ?? null
  const listening = status?.listening ?? true
  const hookOk = status?.hook_healthy ?? true

  const armed = useMemo(
    () =>
      collections
        .filter((c) => c.active)
        .map((c) => {
          const linked = c.linked_processes ?? []
          const focused =
            foreground !== null &&
            linked.some((l) => l.toLowerCase() === foreground.toLowerCase())
          return {
            name: c.name,
            detail:
              linked.length === 0
                ? 'manual'
                : focused
                  ? `${foreground} · focused`
                  : `${linked.join(', ')}`,
            focused: linked.length === 0 || focused
          }
        }),
    [collections, foreground]
  )

  const burst = recent.filter((f) => now - f.at <= BURST_WINDOW_MS).length
  const last = recent[0]
  const ago = (at: number) => `${Math.max(0, Math.round((now - at) / 1000))} s ago`

  const state = !listening
    ? { label: 'Paused', color: 'orange.400' }
    : hookOk
      ? { label: 'Ready', color: 'green.400' }
      : { label: 'Hook down', color: 'red.400' }

  return (
    <Popover trigger="hover" placement="top" openDelay={250} gutter={6}>
      <PopoverTrigger>
        <HStack
          as="footer"
          w="full"
          h="26px"
          flexShrink={0}
          bg={stripBg}
          color="primary-light.100"
          px={3}
          spacing={4}
          fontSize="12px"
          cursor="default"
          userSelect="none"
          overflow="hidden"
        >
          <HStack spacing={1.5}>
            <Dot color={state.color} />
            <Text color="bg-light" fontWeight="semibold">
              {state.label}
            </Text>
          </HStack>
          <Separator />
          <HStack spacing={1} minW={0}>
            <Text opacity={0.8}>Focus</Text>
            <Text color="bg-light" noOfLines={1}>
              {foreground ?? 'unknown'}
            </Text>
          </HStack>
          <Separator />
          <HStack spacing={1.5} minW={0}>
            <Text opacity={0.8}>Armed</Text>
            {armed.length === 0 ? (
              <Text color="bg-light">none</Text>
            ) : (
              <>
                {armed.slice(0, INLINE_ARMED).map((a) => (
                  <Text key={a.name} color="bg-light" noOfLines={1}>
                    {a.name}
                  </Text>
                ))}
                {armed.length > INLINE_ARMED && (
                  <Chip>{`+${armed.length - INLINE_ARMED}`}</Chip>
                )}
              </>
            )}
          </HStack>
          <Separator />
          <HStack spacing={1.5} minW={0}>
            {burst > 0 && <Dot color="primary-accent.500" />}
            <Text opacity={0.8}>Last fired</Text>
            {last ? (
              <>
                <Text color="bg-light" noOfLines={1}>
                  {last.name}
                </Text>
                <Text opacity={0.8} whiteSpace="nowrap">
                  · {ago(last.at)}
                </Text>
                {burst > 1 && <Chip>{`${burst} in 10 s`}</Chip>}
              </>
            ) : (
              <Text color="bg-light">nothing yet</Text>
            )}
          </HStack>
          <Box flexGrow={1} />
          <Text opacity={0.6} whiteSpace="nowrap">
            v{__APP_VERSION__}
          </Text>
        </HStack>
      </PopoverTrigger>
      <PopoverContent
        w="340px"
        bg={cardBg}
        color={cardText}
        borderColor="primary-light.200"
        shadow="lg"
        fontSize="13px"
      >
        <PopoverArrow bg={cardBg} />
        <PopoverBody>
          <VStack align="stretch" spacing={2}>
            <HStack justifyContent="space-between">
              <Text color={cardMuted}>Input hook</Text>
              <HStack spacing={1.5}>
                <Dot color={hookOk ? 'green.400' : 'red.400'} />
                <Text fontWeight="semibold">
                  {hookOk ? 'Responding' : 'Not responding, restarting'}
                </Text>
              </HStack>
            </HStack>
            <HStack justifyContent="space-between">
              <Text color={cardMuted}>Macro output</Text>
              <Text fontWeight="semibold">{listening ? 'Enabled' : 'Paused'}</Text>
            </HStack>
            <HStack justifyContent="space-between">
              <Text color={cardMuted}>Focused app</Text>
              <Text fontWeight="semibold" noOfLines={1}>
                {foreground ?? 'unknown'}
              </Text>
            </HStack>
            <Divider />
            <Text color={cardMuted} fontSize="11px" fontWeight="bold">
              ARMED COLLECTIONS
            </Text>
            {armed.length === 0 && (
              <Text color={cardMuted}>None. Enable a collection or focus a linked application.</Text>
            )}
            {armed.map((a) => (
              <HStack key={a.name} justifyContent="space-between" spacing={3}>
                <Text fontWeight="semibold" noOfLines={1}>
                  {a.name}
                </Text>
                <Text color={a.focused ? 'green.500' : cardMuted} noOfLines={1}>
                  {a.detail}
                </Text>
              </HStack>
            ))}
            <Divider />
            <Text color={cardMuted} fontSize="11px" fontWeight="bold">
              RECENT ACTIVITY
            </Text>
            {recent.length === 0 && (
              <Text color={cardMuted}>No macro has fired yet.</Text>
            )}
            {recent.slice(0, RECENT_KEPT).map((f) => (
              <HStack key={`${f.at}-${f.name}`} justifyContent="space-between" spacing={3}>
                <Text fontWeight="semibold" noOfLines={1}>
                  {f.name}
                </Text>
                <Text color={cardMuted} whiteSpace="nowrap">
                  {ago(f.at)}
                </Text>
              </HStack>
            ))}
            {status && (
              <Text color={cardMuted} fontSize="11px">
                {status.hook_events} input events seen, hook re-installed{' '}
                {status.rehooks} times
              </Text>
            )}
          </VStack>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  )
}
