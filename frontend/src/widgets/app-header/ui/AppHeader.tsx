import clsx from 'clsx'
import type { ReactNode } from 'react'
import { Logo } from '@/shared/ui/logo'
import styles from './AppHeader.module.css'

type AppHeaderProps = {
  variant?: 'landing' | 'app'
  /** Current area name shown next to the logo, e.g. "Studio". */
  section?: string
  /** Right-hand content: status text, user badge, actions. */
  aside?: ReactNode
}

export function AppHeader({ variant = 'app', section, aside }: AppHeaderProps) {
  return (
    <header className={clsx(styles.header, styles[variant])}>
      <div className={styles.brand}>
        <Logo size={variant === 'landing' ? 'lg' : 'md'} />
        {section && <span className={styles.section}>{section}</span>}
      </div>
      {aside && <div className={styles.aside}>{aside}</div>}
    </header>
  )
}
