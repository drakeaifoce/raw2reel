import clsx from 'clsx'
import styles from './Logo.module.css'

type LogoProps = {
  size?: 'md' | 'lg'
  className?: string
}

const markSize = { md: 28, lg: 32 } as const

export function Logo({ size = 'md', className }: LogoProps) {
  return (
    <span className={clsx(styles.logo, styles[size], className)}>
      <svg width={markSize[size]} height={markSize[size]} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="var(--color-accent)" />
        <path d="M12 9.5v13l10.5-6.5z" fill="var(--color-text-on-accent)" />
      </svg>
      <span className={styles.wordmark}>Raw2Reel</span>
    </span>
  )
}
