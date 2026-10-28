import type { Track } from '../../model/types'
import styles from './TrackInfo.module.css'

export function TrackInfo({ track }: { track: Track }) {
  return (
    <span className={styles.info}>
      <span className={styles.title}>{track.title}</span>
      <span className={styles.meta}>
        {track.mood} · {track.bpm} BPM
      </span>
    </span>
  )
}
