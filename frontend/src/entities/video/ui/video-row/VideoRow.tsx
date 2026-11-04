import type { ReactNode } from 'react'
import type { Video } from '../../model/types'
import { VideoThumb } from '../video-thumb/VideoThumb'
import styles from './VideoRow.module.css'

type VideoRowProps = {
  video: Video
  /** Renders the whole row as a button. */
  onSelect?: () => void
  /** Trailing slot, e.g. a "Replace" action. */
  actions?: ReactNode
}

export function VideoRow({ video, onSelect, actions }: VideoRowProps) {
  const content = (
    <>
      <VideoThumb
        tone={video.tone}
        previewUrl={video.previewUrl}
        withPlayIcon={Boolean(onSelect)}
      />
      <span className={styles.info}>
        <span className={styles.title}>{video.title}</span>
        <span className={styles.meta}>{video.meta}</span>
      </span>
      {actions}
    </>
  )

  if (onSelect) {
    return (
      <button type="button" className={styles.row} onClick={onSelect}>
        {content}
      </button>
    )
  }

  return <div className={styles.row}>{content}</div>
}
