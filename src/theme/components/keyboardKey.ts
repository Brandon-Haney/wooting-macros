import type { StyleFunctionProps } from '@chakra-ui/styled-system'
import { defineStyleConfig } from '@chakra-ui/react'
import { mode } from '@chakra-ui/theme-tools'

/**
 * Keycap look for every key shown in the UI (renders the HTML <kbd> element): a light face, a
 * thicker bottom edge and a soft shadow, like a physical key.
 */
export const Kbd = defineStyleConfig({
  baseStyle: (props: StyleFunctionProps) => ({
    bg: mode('bg-light', 'primary-dark.800')(props),
    color: mode('bg-dark', 'bg-light')(props),
    borderWidth: '1px',
    borderBottomWidth: '3px',
    borderColor: mode('primary-light.300', 'primary-dark.600')(props),
    rounded: 'md',
    px: 2,
    py: 0.5,
    fontFamily: 'inherit',
    fontWeight: 'semibold',
    fontSize: 'sm',
    lineHeight: 'shorter',
    whiteSpace: 'nowrap',
    boxShadow: mode(
      '0 1px 1px rgba(0, 0, 0, 0.12)',
      '0 1px 1px rgba(0, 0, 0, 0.5)'
    )(props)
  }),
  variants: {
    brand: {}
  }
})
