import clsx from 'clsx'
import type { HTMLAttributes } from 'react'
import styles from './Card.module.css'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx(styles.card, className)} {...props} />
}
