import clsx from 'clsx'
import type { HTMLAttributes } from 'react'
import styles from './Eyebrow.module.css'

type EyebrowProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: 'accent' | 'muted'
  wide?: boolean
}

/** Small uppercase label shown above headings. */
export function Eyebrow({ tone = 'accent', wide = false, className, ...props }: EyebrowProps) {
  return (
    <span
      className={clsx(
        styles.eyebrow,
        tone === 'muted' && styles.muted,
        wide && styles.wide,
        className,
      )}
      {...props}
    />
  )
}
