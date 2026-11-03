import clsx from 'clsx'
import { useId, type ChangeEvent } from 'react'
import { prepareSampleTrack, useProjectStore } from '@/entities/project'
import { TRACKS, TrackInfo, type Track } from '@/entities/track'
import { Equalizer } from '@/shared/ui/equalizer'
import { PlayIcon, UploadIcon } from '@/shared/ui/icon'
import { visuallyHiddenClassName } from '@/shared/ui/visually-hidden'
import { useTrackPreview } from '../model/useTrackPreview'
import { useTrackUpload } from '../model/useTrackUpload'
import styles from './TrackPicker.module.css'

/**
 * Step 3: pick the soundtrack. Picking a sample uploads its bundled audio so the renderer
 * can mix it in; placeholder presets have no audio, so only an upload reaches the render.
 */
export function TrackPicker() {
  const selectedId = useProjectStore((state) => state.trackId)
  const selectTrack = useProjectStore((state) => state.selectTrack)
  const customTrack = useProjectStore((state) => state.customTrack)
  const samples = useProjectStore((state) => state.samples)
  const { upload, start } = useTrackUpload()
  const { previewingId, toggle } = useTrackPreview()
  const groupName = useId()
  const tracks = customTrack ? [customTrack, ...TRACKS] : TRACKS
  const hasSamples = TRACKS.some((track) => track.src)
  const selectedSample = selectedId ? samples[selectedId] : undefined

  const pick = (track: Track) => {
    selectTrack(track.id)
    void prepareSampleTrack(track)
  }

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
                onChange={() => pick(track)}
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
                onClick={() => toggle(track)}
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
      {selectedSample?.status === 'failed' && (
        <p role="alert" className={styles.error}>
          {selectedSample.message}{' '}
          <button
            type="button"
            className={styles.retry}
            onClick={() => {
              const track = TRACKS.find((item) => item.id === selectedId)
              if (track) void prepareSampleTrack(track)
            }}
          >
            Try again
          </button>
        </p>
      )}
      {!customTrack && !hasSamples && (
        <p className={styles.note}>Presets don’t add music to the render yet. Upload a track.</p>
      )}
    </fieldset>
  )
}
