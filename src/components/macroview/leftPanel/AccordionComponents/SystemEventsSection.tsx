import {
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  AspectRatio,
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
        <SimpleGrid
          h="fit"
          columns={{
            base: 2,
            md: 3,
            xl: 4
          }}
          px={4}
          spacing={2}
        >
          {elementsToRender.map((info: SystemEventInfo) => (
            <AspectRatio ratio={2 / 0.75} key={info.displayString}>
              <SelectElementButton
                key={info.displayString}
                nameText={info.displayString}
                descText={info.description}
                properties={{
                  type: 'SystemEventAction',
                  data: info.defaultData
                }}
              />
            </AspectRatio>
          ))}
        </SimpleGrid>
      </AccordionPanel>
    </AccordionItem>
  )
}
