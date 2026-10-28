import clsx from 'clsx'
import type { CSSProperties, HTMLAttributes } from 'react'
import styles from './PhoneFrame.module.css'

type PhoneFrameProps = HTMLAttributes<HTMLDivElement> & {
  /** Frame width in px; height follows the 9:16 aspect ratio. */
  width?: number
  /** Background fill, e.g. a footage tone. */
  tone?: string
  placeholder?: boolean
}

/** 9:16 vertical frame used for reel previews. */
export function PhoneFrame({
  width = 260,
  tone,
  placeholder = false,
  className,
  style,
  ...props
}: PhoneFrameProps) {
  const frameStyle: CSSProperties = { width, ...(tone && { background: tone }), ...style }

  return (
    <div
      className={clsx(styles.frame, placeholder && styles.placeholder, className)}
      style={frameStyle}
      {...props}
    />
  )
}
