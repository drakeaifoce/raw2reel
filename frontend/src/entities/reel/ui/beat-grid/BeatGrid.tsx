import clsx from 'clsx'
import type { BeatSegment } from '../../model/beatGrid'
import styles from './BeatGrid.module.css'

/** Visualises edit cuts aligned to the soundtrack's beat grid. */
export function BeatGrid({ segments }: { segments: BeatSegment[] }) {
  return (
    <div className={styles.grid} aria-hidden="true">
      {segments.map((segment, i) => (
        <span
          key={i}
          className={clsx(styles.segment, styles[segment.emphasis])}
          style={{ flexGrow: segment.grow }}
        />
      ))}
    </div>
  )
}
