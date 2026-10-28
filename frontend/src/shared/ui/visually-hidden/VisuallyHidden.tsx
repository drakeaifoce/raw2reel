import type { ReactNode } from 'react'
import styles from './VisuallyHidden.module.css'

/** Hides content visually while keeping it available to screen readers. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className={styles.hidden}>{children}</span>
}
