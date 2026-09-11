import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api'
import { ApplicationEntry } from '../types'

/** Icons already fetched this session, by executable path (null = none available). */
const cache = new Map<string, string | null>()
const CONCURRENCY = 4

/**
 * Icons (PNG data URLs) for application entries that carry a path, fetched a
 * few at a time and cached for the session. Entries without a path get none.
 */
export default function useApplicationIcons(entries: ApplicationEntry[]): Map<string, string> {
  const [icons, setIcons] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    let cancelled = false
    const paths = [...new Set(entries.map((e) => e.path).filter((p): p is string => !!p))]
    const known = new Map<string, string>()
    const pending: string[] = []
    for (const path of paths) {
      const hit = cache.get(path)
      if (hit) known.set(path, hit)
      else if (hit === undefined) pending.push(path)
    }
    setIcons(known)
    if (pending.length === 0) return

    let next = 0
    const worker = async () => {
      while (!cancelled && next < pending.length) {
        const path = pending[next++]
        let icon: string | null = null
        try {
          icon = await invoke<string>('get_file_icon', { path })
        } catch {
          icon = null
        }
        cache.set(path, icon)
        if (icon && !cancelled) {
          setIcons((current) => {
            const copy = new Map(current)
            copy.set(path, icon as string)
            return copy
          })
        }
      }
    }
    for (let i = 0; i < CONCURRENCY; i++) worker()
    return () => {
      cancelled = true
    }
  }, [entries])

  return icons
}
