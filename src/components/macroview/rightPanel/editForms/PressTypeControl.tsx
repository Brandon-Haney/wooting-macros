import { Box, Button, ButtonGroup, Tooltip } from '@chakra-ui/react'
import { KeyType } from '../../../../constants/enums'
import { DownArrowIcon, DownUpArrowsIcon, UpArrowIcon } from '../../../icons'

interface Props {
  value: KeyType | undefined
  onChange: (type: KeyType) => void
  /** "Key" or "Mouse", used in the tooltips. */
  noun: string
}

/**
 * Full press / down / up as one attached segmented control on a single row.
 * Labels hide below the md breakpoint, where the icon and tooltip carry the meaning.
 */
export default function PressTypeControl({ value, onChange, noun }: Props) {
  const options: { type: KeyType; label: string; long: string; icon: JSX.Element }[] = [
    {
      type: KeyType.DownUp,
      label: 'Full',
      long: `Full press: ${noun.toLowerCase()} down, wait the duration, ${noun.toLowerCase()} up`,
      icon: <DownUpArrowsIcon />
    },
    {
      type: KeyType.Down,
      label: 'Down',
      long: `${noun} down only; it stays held until a matching up`,
      icon: <DownArrowIcon />
    },
    {
      type: KeyType.Up,
      label: 'Up',
      long: `${noun} up only`,
      icon: <UpArrowIcon />
    }
  ]
  return (
    <ButtonGroup isAttached size={{ base: 'sm', md: 'md' }} variant="brandTertiary" w="full">
      {options.map((option) => (
        <Tooltip key={option.type} label={option.long} hasArrow variant="brand" openDelay={300}>
          <Button
            flex="1"
            leftIcon={option.icon}
            iconSpacing={{ base: 0, md: 2 }}
            isActive={value === option.type}
            onClick={() => onChange(option.type)}
            aria-label={option.long}
          >
            <Box as="span" display={{ base: 'none', md: 'inline' }}>
              {option.label}
            </Box>
          </Button>
        </Tooltip>
      ))}
    </ButtonGroup>
  )
}
