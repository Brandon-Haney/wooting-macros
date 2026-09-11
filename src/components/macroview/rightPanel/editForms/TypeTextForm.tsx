import { Divider, HStack, Text, Textarea } from '@chakra-ui/react'
import React, { useCallback, useEffect, useState } from 'react'
import { useMacroContext } from '../../../../contexts/macroContext'
import { SystemEventAction } from '../../../../types'
import { BoxText } from '../EditArea'

interface Props {
  selectedElementId: number
  selectedElement: SystemEventAction
}

/** Edits the text of a Type Text element. */
export default function TypeTextForm({
  selectedElementId,
  selectedElement
}: Props) {
  const [text, setText] = useState('')
  const { updateElement } = useMacroContext()

  useEffect(() => {
    if (
      selectedElement.data.type !== 'Text' ||
      selectedElement.data.action.type !== 'Type'
    )
      return
    setText(selectedElement.data.action.data)
  }, [selectedElement])

  const onTextChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(event.target.value)
    },
    [setText]
  )

  const onInputBlur = useCallback(() => {
    const temp: SystemEventAction = {
      ...selectedElement,
      data: { type: 'Text', action: { type: 'Type', data: text } }
    }
    updateElement(temp, selectedElementId)
  }, [selectedElement, selectedElementId, text, updateElement])

  return (
    <>
      <HStack justifyContent="center" p={1}>
        <BoxText>Type Text</BoxText>
      </HStack>
      <Divider />
      <Text fontSize={['xs', 'sm', 'md']} fontWeight="semibold">
        Text to type
      </Text>
      <Textarea
        variant="brandAccent"
        value={text}
        onChange={onTextChange}
        onBlur={onInputBlur}
        placeholder="Typed one character at a time; a new line presses Enter."
      />
      <Text fontSize="xs" opacity={0.7}>
        Typed as keystrokes, so it works where Paste Text does not (chat
        boxes in games, launchers). Slower than pasting for long text.
      </Text>
    </>
  )
}
