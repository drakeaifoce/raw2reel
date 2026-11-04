import { PlayIcon } from '@/shared/ui/icon'
import styles from './VideoThumb.module.css'

type VideoThumbProps = {
  tone: string
  /** Stored footage to take a poster frame from. */
  previewUrl?: string
  withPlayIcon?: boolean
}

export function VideoThumb({ tone, previewUrl, withPlayIcon = false }: VideoThumbProps) {
  return (
    <span className={styles.thumb} style={{ background: tone }} aria-hidden="true">
      {previewUrl && (
        // The media routes answer Range requests, so this fetches only enough for one frame.
        <video
          className={styles.frame}
          src={`${previewUrl}#t=1`}
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
        />
      )}
      {withPlayIcon && <PlayIcon size={16} className={styles.icon} />}
    </span>
  )
}
