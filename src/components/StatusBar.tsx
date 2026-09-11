import { Badge, HStack, Text, Tooltip, VStack } from '@chakra-ui/react'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useState } from 'react'
import { useApplicationContext } from '../contexts/applicationContext'
import { getStatus } from '../constants/utils'
import { BackendStatus } from '../types'
import { error } from 'tauri-plugin-log'

const POLL_INTERVAL_MS = 1000

/** Live backend health: hook, focused application, armed collections, last macro fired. */
export default function StatusBar() {
  const { collections } = useApplicationContext()
  const [status, setStatus] = useState<BackendStatus | null>(null)
  const [lastFired, setLastFired] = useState<{ name: string; at: number } | null>(
    null
  )
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let cancelled = false
    const poll = () => {
      if (document.hidden) return
      getStatus()
        .then((s) => {
          if (!cancelled) setStatus(s)
        })
        .catch((e) => error(String(e)))
      setNow(Date.now())
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
      setLastFired({ name: event.payload, at: Date.now() })
    })
    return () => {
      unlisten.then((stop) => stop()).catch((e) => error(String(e)))
    }
  }, [])

  const armed = collections.filter((c) => c.active).map((c) => c.name)
  const hookOk = status?.hook_healthy ?? true
  const listening = status?.listening ?? true
  const agoSeconds = lastFired ? Math.max(0, Math.round((now - lastFired.at) / 1000)) : null

  return (
    <VStack w="full" align="stretch" spacing={0.5} px={1} pb={1}>
      <HStack spacing={2}>
        <Tooltip
          variant="brand"
          hasArrow
          label={
            status
              ? `Input hook ${hookOk ? 'responding' : 'not responding, restarting'}; ${status.hook_events} events seen, re-installed ${status.rehooks} times`
              : 'Waiting for the backend'
          }
        >
          <Badge
            fontSize="2xs"
            colorScheme={!listening ? 'orange' : hookOk ? 'green' : 'red'}
          >
            {!listening ? 'Paused' : hookOk ? 'Hook OK' : 'Hook down'}
          </Badge>
        </Tooltip>
      </HStack>
      <Text fontSize="xs" opacity={0.8} noOfLines={1}>
        Focus: {status?.foreground ?? 'unknown'}
      </Text>
      <Text fontSize="xs" opacity={0.8} noOfLines={1}>
        Armed: {armed.length > 0 ? armed.join(', ') : 'none'}
      </Text>
      <Text fontSize="xs" opacity={0.8} noOfLines={1}>
        Last fired:{' '}
        {lastFired ? `${lastFired.name} (${agoSeconds}s ago)` : 'nothing yet'}
      </Text>
    </VStack>
  )
}
