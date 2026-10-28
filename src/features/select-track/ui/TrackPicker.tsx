import clsx from 'clsx'
import { useState } from 'react'
import { useProjectStore } from '@/entities/project'
import { TRACKS, TrackInfo } from '@/entities/track'
import { Equalizer } from '@/shared/ui/equalizer'
import { PlayIcon } from '@/shared/ui/icon'
import styles from './TrackPicker.module.css'

/** Step 3: pick the soundtrack; preview is a visual mock without audio. */
export function TrackPicker() {
  const selectedId = useProjectStore((state) => state.trackId)
  const selectTrack = useProjectStore((state) => state.selectTrack)
  const [previewingId, setPreviewingId] = useState<string | null>(null)

  return (
    <div role="radiogroup" aria-label="Soundtrack" className={styles.list}>
      {TRACKS.map((track) => {
        const selected = track.id === selectedId
        const previewing = track.id === previewingId

        return (
          <div key={track.id} className={clsx(styles.row, selected && styles.selected)}>
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              className={styles.pick}
              onClick={() => selectTrack(track.id)}
            >
              <span className={styles.radio} aria-hidden="true" />
              <TrackInfo track={track} />
            </button>
            <button
              type="button"
              className={styles.preview}
              aria-label={`${previewing ? 'Stop preview of' : 'Preview'} ${track.title}`}
              aria-pressed={previewing}
              onClick={() => setPreviewingId(previewing ? null : track.id)}
            >
              {previewing ? <Equalizer /> : <PlayIcon size={14} />}
            </button>
          </div>
        )
      })}
    </div>
  )
}
