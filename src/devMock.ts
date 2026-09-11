/**
 * Browser preview of the frontend without Tauri. Loaded by main.tsx in dev
 * builds when the page URL carries `?mock`, e.g. `http://localhost:1420/?mock`.
 * Answers the Tauri commands the UI issues with canned data so screens can be
 * exercised and screenshotted in a normal browser.
 */
import { ApplicationConfig, MacroData } from './types'

type Message = { cmd: string; callback: number; error: number } & Record<string, unknown>

const config: ApplicationConfig = {
  AutoStart: false,
  DefaultDelayValue: 20,
  AutoAddDelay: false,
  AutoSelectElement: true,
  MinimizeAtLaunch: false,
  Theme: 'dark',
  MinimizeToTray: true,
  PauseHotkey: [],
  RecordFixedTimings: false,
  SequenceView: 'List'
}

const key = (keypress: number, press_duration: number, keytype = 'DownUp') => ({
  type: 'KeyPressEventAction' as const,
  data: { keypress, press_duration, keytype }
})
const delay = (data: number) => ({ type: 'DelayEventAction' as const, data })

let macros: MacroData = {
  data: [
    {
      name: 'Preview',
      active: true,
      icon: ':video_game:',
      macros: [
        {
          name: 'hello',
          icon: ':wave:',
          active: true,
          macro_type: 'OnHold',
          trigger: { type: 'KeyPressEvent', data: [27], allow_while_other_keys: true },
          sequence: [
            key(11, 25), // H
            delay(15),
            key(8, 0, 'Down'), // E held while L is typed
            delay(10),
            key(15, 20), // L
            delay(10),
            key(15, 20),
            key(8, 0, 'Up'),
            delay(10),
            key(18, 20), // O
            delay(15),
            key(44, 30), // Space
            {
              type: 'SystemEventAction',
              data: { type: 'Open', action: { type: 'Website', data: 'https://wooting.io' } }
            },
            delay(20),
            key(40, 20), // Enter
            delay(40)
          ],
          hold_threshold_ms: 250,
          tap_mode: 'PassThrough',
          repeat_count: null,
          linked_processes: []
        },
        {
          name: 'empty',
          icon: ':new:',
          active: true,
          macro_type: 'Single',
          trigger: { type: 'KeyPressEvent', data: [4], allow_while_other_keys: true },
          sequence: [],
          repeat_count: null,
          linked_processes: []
        }
      ],
      linked_processes: []
    }
  ]
}

function answer(message: Message): unknown {
  switch (message.cmd) {
    case 'get_config':
      return config
    case 'set_config':
      return undefined
    case 'get_macros':
      return macros
    case 'set_macros':
      macros = (message.frontendData as MacroData) ?? macros
      return macros
    case 'get_status':
      return { hook_healthy: true, is_listening: true, foreground_process: 'preview.exe' }
    case 'run_macro':
      return undefined
    case 'get_file_icon':
    case 'get_application_icon':
      return null
    case 'is_debug':
      return true
    case 'list_processes':
      return ['preview.exe']
    case 'list_applications':
      return []
    case 'plugin:event|listen':
      return 1
    default:
      return undefined
  }
}

export function installTauriMock() {
  const w = window as unknown as Record<string, unknown>
  const counts = new Map<string, number>()
  w.__TAURI_IPC__ = (message: Message) => {
    // Guard against a component re-invoking on every response.
    const count = (counts.get(message.cmd) ?? 0) + 1
    counts.set(message.cmd, count)
    if (count === 200) console.error(`mock: ${message.cmd} invoked 200 times, refusing further calls`)
    if (count >= 200) return
    const result = answer(message)
    const callback = w[`_${message.callback}`]
    if (typeof callback === 'function') {
      setTimeout(() => (callback as (value: unknown) => void)(result), 0)
    }
  }
  w.__TAURI_METADATA__ = { __windows: [{ label: 'main' }], __currentWindow: { label: 'main' } }
}
