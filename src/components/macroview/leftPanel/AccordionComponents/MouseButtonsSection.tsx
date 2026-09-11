import {
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Flex,
  SimpleGrid
} from '@chakra-ui/react'
import { MouseInputInfo } from '../../../../constants/MouseMap'
import { MouseIcon } from '../../../icons'
import SelectElementButton from '../SelectElementButton'
import { DefaultMouseDelay } from '../../../../constants'

interface Props {
  elementsToRender: MouseInputInfo[]
}

export default function MouseButtonsSection({ elementsToRender }: Props) {
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
            <MouseIcon />
            Mouse Buttons
          </Flex>
          <AccordionIcon boxSize={6} />
        </AccordionButton>
      </h2>
      <AccordionPanel>
        <SimpleGrid h="fit" minChildWidth="96px" px={4} spacing={2}>
          {elementsToRender.map((info: MouseInputInfo) => (
            <SelectElementButton
              key={info.webButtonVal}
              nameText={info.displayString}
              properties={{
                type: 'MouseEventAction',
                data: {
                  type: 'Press',
                  data: {
                    type: 'DownUp',
                    button: info.enumVal,
                    duration: DefaultMouseDelay
                  }
                }
              }}
            />
          ))}
        </SimpleGrid>
      </AccordionPanel>
    </AccordionItem>
  )
}
