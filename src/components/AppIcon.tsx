import { Image } from '@chakra-ui/react'

interface Props {
  /** An emoji shortcode (`:smile:`) or a PNG data URL from an application's icon. */
  icon: string
  size?: number
}

export function isImageIcon(icon: string): boolean {
  return icon.startsWith('data:image/')
}

/** Collection and macro icons: an emoji, or the image of the linked application. */
export default function AppIcon({ icon, size = 32 }: Props) {
  if (isImageIcon(icon)) {
    return (
      <Image
        src={icon}
        alt=""
        boxSize={`${size}px`}
        objectFit="contain"
        draggable={false}
        rounded="sm"
        sx={{ imageRendering: 'auto' }}
      />
    )
  }
  return <em-emoji shortcodes={icon} size={`${size}px`} />
}
