import clsx from 'clsx'
import type { HTMLAttributes } from 'react'
import styles from './Chip.module.css'

export function Chip({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={clsx(styles.chip, className)} {...props} />
}
