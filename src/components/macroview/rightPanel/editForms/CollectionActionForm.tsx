import { Divider, HStack, Select, Text } from '@chakra-ui/react'
import { useCallback } from 'react'
import { useApplicationContext } from '../../../../contexts/applicationContext'
import { useMacroContext } from '../../../../contexts/macroContext'
import { CollectionAction, SystemEventAction } from '../../../../types'
import { BoxText } from '../EditArea'

interface Props {
  selectedElementId: number
  selectedElement: SystemEventAction
}

/** Picks the collection (and mode) of an Enable/Disable/Toggle Collection element. */
export default function CollectionActionForm({
  selectedElementId,
  selectedElement
}: Props) {
  const { collections } = useApplicationContext()
  const { updateElement } = useMacroContext()

  const action: CollectionAction =
    selectedElement.data.type === 'Collection'
      ? selectedElement.data.action
      : { type: 'Toggle', data: '' }

  const update = useCallback(
    (next: CollectionAction) => {
      const temp: SystemEventAction = {
        ...selectedElement,
        data: { type: 'Collection', action: next }
      }
      updateElement(temp, selectedElementId)
    },
    [selectedElement, selectedElementId, updateElement]
  )

  return (
    <>
      <HStack justifyContent="center" p={1}>
        <BoxText>{`${action.type} Collection`}</BoxText>
      </HStack>
      <Divider />
      <Text fontSize={['xs', 'sm', 'md']} fontWeight="semibold">
        Collection
      </Text>
      <Select
        size="sm"
        placeholder="Choose a collection…"
        value={action.data}
        onChange={(event) => update({ ...action, data: event.target.value })}
      >
        {collections.map((collection) => (
          <option key={collection.name} value={collection.name}>
            {collection.name}
            {(collection.linked_processes ?? []).length > 0
              ? ' (linked to applications, cannot be changed by a macro)'
              : ''}
          </option>
        ))}
      </Select>
      <Text fontSize={['xs', 'sm', 'md']} fontWeight="semibold">
        Action
      </Text>
      <Select
        size="sm"
        value={action.type}
        onChange={(event) =>
          update({
            type: event.target.value as CollectionAction['type'],
            data: action.data
          })
        }
      >
        <option value="Enable">Enable</option>
        <option value="Disable">Disable</option>
        <option value="Toggle">Toggle</option>
      </Select>
    </>
  )
}
