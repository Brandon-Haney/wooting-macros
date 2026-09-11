import {
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Flex,
  SimpleGrid
} from '@chakra-ui/react'
import { SystemEventInfo } from '../../../../constants/SystemEventMap'
import { SystemIcon } from '../../../icons'
import { Tooltip } from '@chakra-ui/react'
import SelectElementButton from '../SelectElementButton'

interface Props {
  elementsToRender: SystemEventInfo[]
  title?: string
  /** Shown on the group header. */
  hint?: string
}

export default function SystemEventsSection({
  elementsToRender,
  title = 'System Events',
  hint
}: Props) {
  return (
    <AccordionItem>
      <h2>
        <AccordionButton>
          <Flex
            flex="1"
            textAlign="left"
            fontWeight="semibold"
            alignItems="center"
            gap={2}
          >
            <SystemIcon />
            <Tooltip label={hint} hasArrow variant="brand" isDisabled={!hint} openDelay={400}>
              <span>{title}</span>
            </Tooltip>
          </Flex>
          <AccordionIcon boxSize={6} />
        </AccordionButton>
      </h2>
      <AccordionPanel>
        <SimpleGrid h="fit" minChildWidth="118px" px={4} spacing={2}>
          {elementsToRender.map((info: SystemEventInfo) => (
            <SelectElementButton
              key={info.displayString}
              nameText={info.displayString}
              descText={info.description}
              properties={{
                type: 'SystemEventAction',
                data: info.defaultData
              }}
            />
          ))}
        </SimpleGrid>
      </AccordionPanel>
    </AccordionItem>
  )
}
