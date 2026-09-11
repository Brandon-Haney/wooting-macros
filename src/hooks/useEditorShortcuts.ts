import { useEffect } from 'react'
import { useMacroContext } from '../contexts/macroContext'

/** True when the key event comes from a text field, where editing keys must keep their meaning. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

/**
 * Keyboard shortcuts for the macro editor:
 * Ctrl+S saves the macro, Delete/Backspace removes the selected element, Ctrl+D duplicates it,
 * Escape deselects it. Recording hooks swallow key events before they reach here, so shortcuts
 * are inactive while recording.
 */
export default function useEditorShortcuts() {
  const {
    sequence,
    selectedElementId,
    canSaveMacro,
    updateMacro,
    onElementDelete,
    onElementAdd,
    updateSelectedElementId
  } = useMacroContext()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ctrl = event.ctrlKey || event.metaKey

      if (ctrl && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (canSaveMacro) updateMacro()
        return
      }

      if (isTypingTarget(event.target)) return

      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        selectedElementId !== undefined
      ) {
        event.preventDefault()
        onElementDelete(selectedElementId)
        updateSelectedElementId(undefined)
        return
      }

      if (ctrl && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        if (selectedElementId !== undefined && sequence[selectedElementId]) {
          onElementAdd({ ...sequence[selectedElementId] })
        }
        return
      }

      if (event.key === 'Escape' && selectedElementId !== undefined) {
        updateSelectedElementId(undefined)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    canSaveMacro,
    onElementAdd,
    onElementDelete,
    selectedElementId,
    sequence,
    updateMacro,
    updateSelectedElementId
  ])
}
