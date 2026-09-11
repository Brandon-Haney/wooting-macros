import { useMemo } from 'react'
import { useMacroContext } from '../contexts/macroContext'
import { compile, Schedule } from '../utils/schedule'
import { ActionEventType } from '../types'

/** The sequence in display order and its compiled schedule. */
export default function useSchedule(): {
  ordered: ActionEventType[]
  schedule: Schedule
} {
  const { sequence, ids } = useMacroContext()
  const ordered = useMemo(
    () => ids.map((id) => sequence[id - 1]).filter(Boolean),
    [ids, sequence]
  )
  const schedule = useMemo(() => compile(ordered), [ordered])
  return { ordered, schedule }
}
