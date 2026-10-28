import clsx from 'clsx'
import type { ReactNode } from 'react'
import { VisuallyHidden } from '../visually-hidden'
import styles from './StepTitle.module.css'

type StepTitleProps = {
  step: number
  complete?: boolean
  children: ReactNode
}

export function StepTitle({ step, complete = false, children }: StepTitleProps) {
  return (
    <h2 className={styles.title}>
      <span className={clsx(styles.badge, complete && styles.complete)} aria-hidden="true">
        {step}
      </span>
      {children}
      {complete && <VisuallyHidden> (done)</VisuallyHidden>}
    </h2>
  )
}
