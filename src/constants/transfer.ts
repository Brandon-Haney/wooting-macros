import { open, save } from '@tauri-apps/api/dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/api/fs'
import { Collection, Macro, MacroData } from '../types'

/** File formats written by Export. Import also accepts bare Macro/Collection/MacroData JSON. */
export type MacroFile = { kind: 'wootomation-macro'; version: 1; macro: Macro }
export type CollectionFile = {
  kind: 'wootomation-collection'
  version: 1
  collection: Collection
}

const JSON_FILTER = [{ name: 'Wootomation JSON', extensions: ['json'] }]
const FORBIDDEN_FILE_NAME_CHARS = '<>:"/\\|?*'

function safeFileName(name: string): string {
  const cleaned = Array.from(name)
    .filter(
      (ch) => ch.charCodeAt(0) >= 32 && !FORBIDDEN_FILE_NAME_CHARS.includes(ch)
    )
    .join('')
    .trim()
  return cleaned === '' ? 'untitled' : cleaned
}

/** Asks where to save and writes the JSON. Returns false if the user cancelled. */
async function exportJson(defaultName: string, payload: unknown): Promise<boolean> {
  const path = await save({ defaultPath: defaultName, filters: JSON_FILTER })
  if (typeof path !== 'string') return false
  await writeTextFile(path, JSON.stringify(payload, null, 2))
  return true
}

export function exportMacro(macro: Macro): Promise<boolean> {
  const file: MacroFile = { kind: 'wootomation-macro', version: 1, macro }
  return exportJson(`${safeFileName(macro.name)}.macro.json`, file)
}

export function exportCollection(collection: Collection): Promise<boolean> {
  const file: CollectionFile = {
    kind: 'wootomation-collection',
    version: 1,
    collection
  }
  return exportJson(`${safeFileName(collection.name)}.collection.json`, file)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isMacro = (value: unknown): value is Macro =>
  isRecord(value) && 'trigger' in value && Array.isArray(value.sequence)

const isCollection = (value: unknown): value is Collection =>
  isRecord(value) && Array.isArray(value.macros)

const isMacroData = (value: unknown): value is MacroData =>
  isRecord(value) && Array.isArray(value.data)

/** What an imported file contained: any number of macros and/or whole collections. */
export interface ImportedContent {
  macros: Macro[]
  collections: Collection[]
}

/** Opens a file picker and parses the chosen file. Returns null if cancelled. */
export async function importFile(): Promise<ImportedContent | null> {
  const path = await open({ multiple: false, filters: JSON_FILTER })
  if (typeof path !== 'string') return null
  const parsed: unknown = JSON.parse(await readTextFile(path))

  const content: ImportedContent = { macros: [], collections: [] }

  if (isRecord(parsed) && parsed.kind === 'wootomation-macro' && isMacro(parsed.macro)) {
    content.macros.push(parsed.macro)
  } else if (
    isRecord(parsed) &&
    parsed.kind === 'wootomation-collection' &&
    isCollection(parsed.collection)
  ) {
    content.collections.push(parsed.collection)
  } else if (isMacroData(parsed)) {
    content.collections.push(...parsed.data.filter(isCollection))
  } else if (isCollection(parsed)) {
    content.collections.push(parsed)
  } else if (isMacro(parsed)) {
    content.macros.push(parsed)
  } else {
    throw new Error('This file does not contain a Wootomation macro or collection.')
  }
  return content
}
