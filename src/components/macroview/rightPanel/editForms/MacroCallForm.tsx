import { Divider, HStack, Select, Text } from '@chakra-ui/react'
import { useCallback, useMemo } from 'react'
import { useApplicationContext } from '../../../../contexts/applicationContext'
import { useMacroContext } from '../../../../contexts/macroContext'
import { SystemEventAction } from '../../../../types'
import { BoxText } from '../EditArea'

interface Props {
  selectedElementId: number
  selectedElement: SystemEventAction
}

/** Picks the macro that a "Run Macro" element plays. */
export default function MacroCallForm({
  selectedElementId,
  selectedElement
}: Props) {
  const { collections } = useApplicationContext()
  const { macro, updateElement } = useMacroContext()

  const current =
    selectedElement.data.type === 'Macro' ? selectedElement.data.action.data : ''

  const options = useMemo(
    () =>
      collections.flatMap((collection) =>
        collection.macros
          .filter((m) => m.name !== macro.name)
          .map((m) => ({
            name: m.name,
            label: `${collection.name} / ${m.name}`
          }))
      ),
    [collections, macro.name]
  )

  const onChange = useCallback(
    (name: string) => {
      const temp: SystemEventAction = {
        ...selectedElement,
        data: { type: 'Macro', action: { type: 'Run', data: name } }
      }
      updateElement(temp, selectedElementId)
    },
    [selectedElement, selectedElementId, updateElement]
  )

  return (
    <>
      <HStack justifyContent="center" p={1}>
        <BoxText>Run Macro</BoxText>
      </HStack>
      <Divider />
      <Text fontSize={['xs', 'sm', 'md']} fontWeight="semibold">
        Macro to play
      </Text>
      <Select
        size="sm"
        placeholder="Choose a macro…"
        value={current}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.label} value={option.name}>
            {option.label}
          </option>
        ))}
      </Select>
      <Text fontSize="xs" opacity={0.7}>
        Macros are looked up by name when this element runs. Chains deeper
        than 8 macros are stopped.
      </Text>
    </>
  )
}
