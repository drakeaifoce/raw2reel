import clsx from 'clsx'
import { useId, useState, type ChangeEvent } from 'react'
import { useProjectStore } from '@/entities/project'
import { TRACKS, TrackInfo } from '@/entities/track'
import { Equalizer } from '@/shared/ui/equalizer'
import { PlayIcon, UploadIcon } from '@/shared/ui/icon'
import { visuallyHiddenClassName } from '@/shared/ui/visually-hidden'
import { useTrackUpload } from '../model/useTrackUpload'
import styles from './TrackPicker.module.css'

/**
 * Step 3: pick the soundtrack. Presets are not stored media yet, so only an uploaded track
 * reaches the renderer; preset previews are a visual mock without audio.
 */
export function TrackPicker() {
  const selectedId = useProjectStore((state) => state.trackId)
  const selectTrack = useProjectStore((state) => state.selectTrack)
  const customTrack = useProjectStore((state) => state.customTrack)
  const { upload, start } = useTrackUpload()
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const groupName = useId()
  const tracks = customTrack ? [customTrack, ...TRACKS] : TRACKS

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Allow re-picking the same file.
    event.target.value = ''
    if (file) void start(file)
  }

  return (
    <fieldset className={styles.list}>
      <legend className={visuallyHiddenClassName}>Soundtrack</legend>
      {tracks.map((track) => {
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
            {!track.mediaId && (
              <button
                type="button"
                className={styles.preview}
                aria-label={`${previewing ? 'Stop preview of' : 'Preview'} ${track.title}`}
                aria-pressed={previewing}
                onClick={() => setPreviewingId(previewing ? null : track.id)}
              >
                {previewing ? <Equalizer /> : <PlayIcon size={14} />}
              </button>
            )}
          </div>
        )
      })}

      <label className={styles.upload}>
        <UploadIcon size={16} />
        {upload.status === 'uploading'
          ? `Uploading track · ${Math.round(upload.progress * 100)}%`
          : 'Upload your own track'}
        <input
          className={visuallyHiddenClassName}
          type="file"
          accept="audio/*"
          disabled={upload.status === 'uploading'}
          onChange={handleFile}
        />
      </label>
      {upload.status === 'failed' && (
        <p role="alert" className={styles.error}>
          {upload.message}
        </p>
      )}
      {!customTrack && (
        <p className={styles.note}>Presets don’t add music to the render yet. Upload a track.</p>
      )}
    </fieldset>
  )
}
