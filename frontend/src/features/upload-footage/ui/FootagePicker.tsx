import clsx from 'clsx'
import { useId, useState, type ChangeEvent, type DragEvent } from 'react'
import { useProjectStore } from '@/entities/project'
import { SAMPLE_VIDEOS, VideoRow, createUploadedVideo } from '@/entities/video'
import { Button } from '@/shared/ui/button'
import { UploadIcon, VideoIcon } from '@/shared/ui/icon'
import { visuallyHiddenClassName } from '@/shared/ui/visually-hidden'
import { useSelectFootage } from '../model/useSelectFootage'
import styles from './FootagePicker.module.css'

/** Step 1: upload a raw clip or pick one of the bundled samples. */
export function FootagePicker() {
  const video = useProjectStore((state) => state.video)
  const { selectFootage, clearFootage } = useSelectFootage()
  const [samplesOpen, setSamplesOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const samplesId = useId()

  const handleFile = (file: File | undefined) => {
    if (!file) return
    setSamplesOpen(false)
    selectFootage(createUploadedVideo(file.name))
  }

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleFile(event.target.files?.[0])
    // Allow re-selecting the same file after "Replace".
    event.target.value = ''
  }

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDragging(false)
    handleFile(event.dataTransfer.files[0])
  }

  if (video) {
    return (
      <VideoRow
        video={video}
        actions={
          <Button
            onClick={() => {
              clearFootage()
              setSamplesOpen(true)
            }}
          >
            Replace
          </Button>
        }
      />
    )
  }

  return (
    <>
      {/* Drag handlers only enhance the native file input wrapped by this label. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <label
        className={clsx(styles.dropzone, dragging && styles.dragging)}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <UploadIcon size={28} className={styles.uploadIcon} />
        <span className={styles.dropTitle}>Drop one video or browse</span>
        <span className={styles.dropHint}>MP4 or MOV, one raw clip</span>
        <input
          className={visuallyHiddenClassName}
          type="file"
          accept="video/*"
          onChange={handleInputChange}
        />
      </label>

      <Button
        fullWidth
        aria-expanded={samplesOpen}
        aria-controls={samplesId}
        onClick={() => setSamplesOpen((open) => !open)}
      >
        <VideoIcon />
        Use a sample video
      </Button>

      {samplesOpen && (
        <ul id={samplesId} className={styles.samples} aria-label="Sample videos">
          {SAMPLE_VIDEOS.map((sample) => (
            <li key={sample.id}>
              <VideoRow video={sample} onSelect={() => selectFootage(sample)} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
