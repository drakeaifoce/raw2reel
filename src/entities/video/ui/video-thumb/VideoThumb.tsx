import { PlayIcon } from '@/shared/ui/icon'
import styles from './VideoThumb.module.css'

type VideoThumbProps = {
  tone: string
  withPlayIcon?: boolean
}

export function VideoThumb({ tone, withPlayIcon = false }: VideoThumbProps) {
  return (
    <span className={styles.thumb} style={{ background: tone }} aria-hidden="true">
      {withPlayIcon && <PlayIcon size={16} />}
    </span>
  )
}
