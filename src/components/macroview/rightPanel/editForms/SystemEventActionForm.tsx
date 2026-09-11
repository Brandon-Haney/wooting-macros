import { SystemEventAction } from '../../../../types'
import ClipboardForm from './ClipboardForm'
import EmptyForm from './EmptyForm'
import OpenEventForm from './OpenEventForm'
import MacroCallForm from './MacroCallForm'
import CollectionActionForm from './CollectionActionForm'
import TypeTextForm from './TypeTextForm'

interface Props {
  selectedElement: SystemEventAction
  selectedElementId: number
}

export default function SystemEventActionForm({
  selectedElement,
  selectedElementId
}: Props) {
  switch (selectedElement.data.type) {
    case 'Open':
      return (
        <OpenEventForm
          selectedElementId={selectedElementId}
          selectedElement={selectedElement}
        />
      )
    case 'Volume':
    case 'Media':
      return <EmptyForm />
    case 'Macro':
      return (
        <MacroCallForm
          selectedElementId={selectedElementId}
          selectedElement={selectedElement}
        />
      )
    case 'Text':
      return (
        <TypeTextForm
          selectedElementId={selectedElementId}
          selectedElement={selectedElement}
        />
      )
    case 'Collection':
      return (
        <CollectionActionForm
          selectedElementId={selectedElementId}
          selectedElement={selectedElement}
        />
      )
    case 'Clipboard':
      if (selectedElement.data.action.type === 'PasteUserDefinedString') {
        return (
          <ClipboardForm
            selectedElementId={selectedElementId}
            selectedElement={selectedElement}
          />
        )
      } else {
        return <EmptyForm />
      }
    default:
      return <EmptyForm />
  }
}
