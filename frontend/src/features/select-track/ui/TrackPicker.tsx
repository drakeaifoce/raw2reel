import clsx from 'clsx'
import { useId, useState } from 'react'
import { useProjectStore } from '@/entities/project'
import { TRACKS, TrackInfo } from '@/entities/track'
import { Equalizer } from '@/shared/ui/equalizer'
import { PlayIcon } from '@/shared/ui/icon'
import { visuallyHiddenClassName } from '@/shared/ui/visually-hidden'
import styles from './TrackPicker.module.css'

/** Step 3: pick the soundtrack; preview is a visual mock without audio. */
export function TrackPicker() {
  const selectedId = useProjectStore((state) => state.trackId)
  const selectTrack = useProjectStore((state) => state.selectTrack)
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const groupName = useId()

  return (
    <fieldset className={styles.list}>
      <legend className={visuallyHiddenClassName}>Soundtrack</legend>
      {TRACKS.map((track) => {
        const selected = track.id === selectedId
        const previewing = track.id === previewingId

        return (
          <div key={track.id} className={clsx(styles.row, selected && styles.selected)}>
            <label className={styles.pick}>
              <input
                type="radio"
                name={groupName}
                value={track.id}
                checked={selected}
                onChange={() => selectTrack(track.id)}
                className={visuallyHiddenClassName}
              />
              <span className={styles.radio} aria-hidden="true" />
              <TrackInfo track={track} />
            </label>
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
    </fieldset>
  )
}
