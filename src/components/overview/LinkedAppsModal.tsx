import { useCallback, useMemo } from 'react'
import { invoke } from '@tauri-apps/api'
import { isImageIcon } from '../AppIcon'
import { useApplicationContext } from '../../contexts/applicationContext'
import { useSelectedCollection } from '../../contexts/selectors'
import ApplicationPickerModal from '../ApplicationPickerModal'

interface Props {
  isOpen: boolean
  onClose: () => void
}

/** Links the selected collection to application executables. */
export default function LinkedAppsModal({ isOpen, onClose }: Props) {
  const { selection, onCollectionUpdate } = useApplicationContext()
  const currentCollection = useSelectedCollection()
  const linked = useMemo(
    () => currentCollection.linked_processes ?? [],
    [currentCollection.linked_processes]
  )

  const onChange = useCallback(
    (linked_processes: string[]) => {
      onCollectionUpdate(
        { ...currentCollection, linked_processes },
        selection.collectionIndex
      )
      // The first linked application gives a collection that still has the default emoji its icon.
      const firstLink = linked.length === 0 && linked_processes.length > 0
      if (firstLink && !isImageIcon(currentCollection.icon) && currentCollection.icon === ':package:') {
        const index = selection.collectionIndex
        invoke<string | null>('get_application_icon', { exe: linked_processes[0] })
          .then((icon) => {
            if (icon) onCollectionUpdate({ ...currentCollection, linked_processes, icon }, index)
          })
          .catch(() => undefined)
      }
    },
    [currentCollection, linked, onCollectionUpdate, selection.collectionIndex]
  )

  return (
    <ApplicationPickerModal
      isOpen={isOpen}
      onClose={onClose}
      title="Linked applications"
      description="The collection is armed only while one of these applications is the focused window, and disarmed otherwise. Leave the list empty to control the collection manually."
      linked={linked}
      onChange={onChange}
    />
  )
}
