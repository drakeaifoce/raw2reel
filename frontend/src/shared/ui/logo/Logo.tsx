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
      <svg width={markSize[size]} height={markSize[size]} viewBox="0 0 512 512" aria-hidden="true">
        <path
          d="M362 459H276.8V221.769L362 153.837V459ZM362 132.608L276.8 200.54V106.072H362V132.608ZM234.2 405.928H149V323.667L234.2 255.735V405.928ZM234.2 234.506L149 302.438V53H234.2V234.506Z"
          fill="var(--color-accent)"
        />
      </svg>
      <span className={styles.wordmark}>Raw2Reel</span>
    </span>
  )
}
