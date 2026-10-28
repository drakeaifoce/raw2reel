import type { ReactNode } from 'react'
import styles from './Divider.module.css'

export function Divider({ children }: { children?: ReactNode }) {
  return <div className={styles.divider}>{children}</div>
}
