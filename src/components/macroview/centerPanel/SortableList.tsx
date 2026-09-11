import { Box, Text, useColorModeValue, VStack } from '@chakra-ui/react'
import useMainBgColour from '../../../hooks/useMainBgColour'
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { DragEvent, useCallback, useRef, useState } from 'react'
import { useMacroContext } from '../../../contexts/macroContext'
import useScrollbarStyles from '../../../hooks/useScrollbarStyles'
import DragWrapper from './sortableElement/DragWrapper'
import SortableItem from './sortableElement/SortableItem'
import SortableWrapper from './sortableElement/SortableWrapper'
import { ELEMENT_DRAG_TYPE } from './timeline/Timeline'
import { useSettingsContext } from '../../../contexts/settingsContext'
import { ActionEventType } from '../../../types'

interface Props {
  recording: boolean
  stopRecording: () => void
}

export default function SortableList({ recording, stopRecording }: Props) {
  const [activeId, setActiveId] = useState<number | undefined>(undefined)
  const { sequence, ids, overwriteIds, overwriteSequence, updateSelectedElementId } =
    useMacroContext()
  const { config } = useSettingsContext()
  const listRef = useRef<HTMLDivElement>(null)
  // Insertion point (display index) and its pixel position while a palette element is dragged over.
  const [drop, setDrop] = useState<{ index: number; y: number } | null>(null)
  const dropColour = useColorModeValue('primary-accent.500', 'primary-accent.300')

  /** Display index the pointer is closest to, and the y (within the list) to draw the marker. */
  const dropTarget = useCallback((clientY: number): { index: number; y: number } => {
    const list = listRef.current
    if (!list) return { index: ids.length, y: 0 }
    const items = Array.from(list.querySelectorAll<HTMLElement>('[data-sortable-item]'))
    const top = list.getBoundingClientRect().top - list.scrollTop
    let index = items.length
    let y = 0
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect()
      if (clientY < rect.top + rect.height / 2) {
        index = i
        y = rect.top - top - 4
        break
      }
      y = rect.bottom - top + 4
    }
    return { index, y }
  }, [ids.length])

  const onDragOver = useCallback(
    (event: DragEvent) => {
      if (recording || !event.dataTransfer.types.includes(ELEMENT_DRAG_TYPE)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setDrop(dropTarget(event.clientY))
    },
    [dropTarget, recording]
  )

  const onDrop = useCallback(
    (event: DragEvent) => {
      setDrop(null)
      const raw = event.dataTransfer.getData(ELEMENT_DRAG_TYPE)
      if (!raw || recording) return
      event.preventDefault()
      let element: ActionEventType
      try {
        element = JSON.parse(raw) as ActionEventType
      } catch {
        return
      }
      const { index } = dropTarget(event.clientY)
      const ordered = ids.map((id) => sequence[id - 1]).filter(Boolean)
      const previous = ordered[index - 1]
      const insert: ActionEventType[] =
        config.AutoAddDelay &&
        previous !== undefined &&
        previous.type !== 'DelayEventAction' &&
        element.type !== 'DelayEventAction'
          ? [{ type: 'DelayEventAction', data: config.DefaultDelayValue }, element]
          : [element]
      const next = [...ordered.slice(0, index), ...insert, ...ordered.slice(index)]
      overwriteSequence(next)
      updateSelectedElementId(index + insert.length - 1)
    },
    [config.AutoAddDelay, config.DefaultDelayValue, dropTarget, ids, overwriteSequence, recording, sequence, updateSelectedElementId]
  )
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )
  // Same background as the rest of the panel; the timeline matches it.
  const backgroundColor = useMainBgColour()
  const mutedText = useColorModeValue('gray.600', 'gray.400')

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event

      if (over === null) {
        return
      }

      if (active.id !== over.id) {
        const oldIndex = ids.indexOf(Number(active.id))
        const newIndex = ids.indexOf(Number(over.id))
        overwriteIds(arrayMove(ids, oldIndex, newIndex))
      }
      setActiveId(undefined)
    },
    [ids, overwriteIds, setActiveId]
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      stopRecording()
      const { active } = event
      setActiveId(Number(active.id))
    },
    [stopRecording, setActiveId]
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToVerticalAxis]}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <VStack
          ref={listRef}
          bg={backgroundColor}
          w="full"
          h="full"
          px={4}
          p={2}
          pb={4}
          overflowY="auto"
          overflowX="hidden"
          position="relative"
          sx={useScrollbarStyles()}
          justifyContent={ids.length === 0 ? 'center' : undefined}
          onDragOver={onDragOver}
          onDragLeave={(event) => {
            if (!listRef.current?.contains(event.relatedTarget as Node)) setDrop(null)
          }}
          onDrop={onDrop}
        >
          {drop && ids.length > 0 && (
            <Box
              position="absolute"
              left={4}
              right={4}
              top={`${drop.y}px`}
              h="3px"
              rounded="full"
              bg={dropColour}
              pointerEvents="none"
              zIndex={2}
            />
          )}
          {ids.length === 0 && (
            <Text fontSize="sm" color={mutedText} textAlign="center" px={4}>
              No elements yet. Record a sequence, click a key in the palette or drag one here.
            </Text>
          )}
          {ids.map((id) => (
            <SortableWrapper
              id={id}
              key={id}
              isSmall={sequence[id - 1].type === 'DelayEventAction'}
            >
              <SortableItem
                id={id}
                element={sequence[id - 1]}
                recording={recording}
                stopRecording={stopRecording}
              />
            </SortableWrapper>
          ))}
        </VStack>
      </SortableContext>
      <DragOverlay>
        {activeId ? (
          <DragWrapper id={activeId} element={sequence[activeId - 1]}>
            <SortableItem
              id={activeId}
              element={sequence[activeId - 1]}
              recording={recording}
              stopRecording={stopRecording}
            />
          </DragWrapper>
        ) : undefined}
      </DragOverlay>
    </DndContext>
  )
}
