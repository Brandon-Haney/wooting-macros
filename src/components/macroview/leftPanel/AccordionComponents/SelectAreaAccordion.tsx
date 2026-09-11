import { Accordion, Divider, Flex, Text } from '@chakra-ui/react'
import { useMemo } from 'react'
import { HIDCategory } from '../../../../constants/enums'
import { Hid } from '../../../../constants/HIDmap'
import { SystemEvent } from '../../../../constants/SystemEventMap'
import MouseButtonsSection from './MouseButtonsSection'
import SystemEventsSection from './SystemEventsSection'
import { MouseInput } from '../../../../constants/MouseMap'
import KeyboardKeysSection from './KeyboardKeysSection'
import { KeyboardKeyCategory } from '../../../../types'
import useScrollbarStyles from '../../../../hooks/useScrollbarStyles'

interface Props {
  searchValue: string
}

export default function SelectAreaAccordion({ searchValue }: Props) {
  const systemEventElements = useMemo(() => {
    if (searchValue.trim() === '') {
      return SystemEvent.all
    }
    return SystemEvent.all.filter((element) =>
      element.displayString.toLowerCase().includes(searchValue)
    )
  }, [searchValue])

  const keyboardKeyElements = useMemo(() => {
    if (searchValue.trim() === '') {
      return Hid.all
    }
    return Hid.all.filter((element) =>
      element.displayString.toLowerCase().includes(searchValue)
    )
  }, [searchValue])

  const keyboardKeyCategories = useMemo<KeyboardKeyCategory[]>(() => {
    const temp: KeyboardKeyCategory[] = []
    const categories = Object.keys(HIDCategory).filter((key) =>
      isNaN(Number(key))
    )

    for (let i = 0; i < categories.length; i++) {
      const categoryName = categories[i]
      const elements = keyboardKeyElements.filter((element) => {
        return HIDCategory[element.category] === categoryName
      })
      if (elements.length > 0)
        temp.push({ name: categoryName, elements: elements })
    }
    return temp
  }, [keyboardKeyElements])

  // const pluginElements = useMemo(() => {
  //     if (searchValue.trim() === '') {
  //       return Plugin.all
  //     }
  //     return Plugin.all.filter(
  //       (element) =>
  //         element.displayString.toLowerCase().includes(searchValue)
  //     )
  //   },
  //   [searchValue]
  // )

  // const pluginCategories = useMemo<PluginCategory[]>(() => {
  //   const temp: PluginCategory[] = []
  //   const pluginGroups = Object.keys(PluginGroup).filter((key) =>
  //     isNaN(Number(key))
  //   )

  //   for (let i = 0; i < pluginGroups.length; i++) {
  //     const groupName = pluginGroups[i]
  //     const elements = pluginElements.filter((element) => {
  //       return PluginGroup[element.pluginGroup] === groupName
  //     })
  //     if (elements.length > 0) temp.push({ name: groupName, elements: elements })
  //   }
  //   return temp
  // }, [pluginElements])

  const mouseElements = useMemo(() => {
    if (searchValue.trim() === '') {
      return MouseInput.all
    }
    return MouseInput.all.filter((element) =>
      element.displayString.toLowerCase().includes(searchValue)
    )
  }, [searchValue])

  // The reference groups: macro and collection controls, media, then the rest.
  const systemGroups = useMemo(() => {
    const functions = ['Run Macro', 'Enable Collection', 'Disable Collection', 'Toggle Collection']
    const media = [
      'Increase Volume',
      'Decrease Volume',
      'Toggle Mute Volume',
      'Toggle Mute Microphone',
      'Next Track',
      'Previous Track',
      'Stop Media',
      'Play/Pause Media'
    ]
    return [
      {
        title: 'Functions',
        hint: 'Run another macro, enable or disable a collection',
        elements: systemEventElements.filter((e) => functions.includes(e.displayString))
      },
      {
        title: 'Media and Volume',
        hint: 'Volume, microphone and media keys',
        elements: systemEventElements.filter((e) => media.includes(e.displayString))
      },
      {
        title: 'System',
        hint: 'Open files, folders and websites; paste or type text',
        elements: systemEventElements.filter(
          (e) => !functions.includes(e.displayString) && !media.includes(e.displayString)
        )
      }
    ]
  }, [systemEventElements])

  const indices = useMemo(() => {
    if (searchValue.trim() === '') {
      return undefined
    }

    let count = 0

    systemGroups.forEach((group) => {
      if (group.elements.length > 0) {
        count++
      }
    })

    keyboardKeyCategories.forEach((category) => {
      if (category.elements.length > 0) {
        count++
      }
    })

    // pluginCategories.forEach((category) => {
    //   if (category.elements.length > 0) {
    //     count++
    //   }
    // })

    if (mouseElements.length > 0) {
      count++
    }
    return [...Array(count).keys()]
  }, [searchValue, systemGroups, keyboardKeyCategories, mouseElements.length])

  const isValidSearch = useMemo(() => {
    return indices !== undefined && indices.length === 0
  }, [indices])

  return (
    <Flex
      direction="column"
      w="full"
      h="fit"
      overflowY="auto"
      alignItems={isValidSearch ? 'center' : 'flex-start'}
      sx={useScrollbarStyles()}
    >
      {isValidSearch && searchValue !== '' && (
        <>
          <Divider />
          <Text mt={4} fontWeight="semibold">
            Nothing found, try another query.
          </Text>
        </>
      )}
      <Accordion w="full" variant="brand" allowMultiple p={0} index={indices}>
        <KeyboardKeysSection keyboardKeyCategories={keyboardKeyCategories} />
        {mouseElements.length > 0 && (
          <MouseButtonsSection elementsToRender={mouseElements} />
        )}
        {systemGroups.map(
          (group) =>
            group.elements.length > 0 && (
              <SystemEventsSection
                key={group.title}
                title={group.title}
                hint={group.hint}
                elementsToRender={group.elements}
              />
            )
        )}
        {/* <PluginsSection pluginCategories={pluginCategories} /> */}
      </Accordion>
    </Flex>
  )
}
