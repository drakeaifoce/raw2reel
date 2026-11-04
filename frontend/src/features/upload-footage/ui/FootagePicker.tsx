import clsx from 'clsx'
import { useId, useState, type ChangeEvent, type DragEvent } from 'react'
import { useProjectStore } from '@/entities/project'
import { VideoRow } from '@/entities/video'
import { Button } from '@/shared/ui/button'
import { UploadIcon, VideoIcon } from '@/shared/ui/icon'
import { Spinner } from '@/shared/ui/spinner'
import { visuallyHiddenClassName } from '@/shared/ui/visually-hidden'
import { useFootageUpload } from '../model/useFootageUpload'
import { useSampleVideos } from '../model/useSampleVideos'
import { useSelectFootage } from '../model/useSelectFootage'
import styles from './FootagePicker.module.css'
import { UploadProgress } from './UploadProgress'

/** Step 1: upload a raw clip to media storage or take one of the sample videos. */
export function FootagePicker() {
  const video = useProjectStore((state) => state.video)
  const { clearFootage } = useSelectFootage()
  const { upload, start, cancel } = useFootageUpload()
  const [samplesOpen, setSamplesOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const samplesId = useId()
  const samples = useSampleVideos(samplesOpen)

  const handleFile = (file: File | undefined) => {
    if (!file) return
    setSamplesOpen(false)
    void start(file)
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

  if (upload.status === 'uploading') {
    return (
      <UploadProgress fileName={upload.fileName} progress={upload.progress} onCancel={cancel} />
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
        <span className={styles.dropHint}>MP4 or MOV, one raw clip up to 100 MB</span>
        <input
          className={visuallyHiddenClassName}
          type="file"
          accept="video/*"
          onChange={handleInputChange}
        />
      </label>

      {upload.status === 'failed' && (
        <p role="alert" className={styles.error}>
          {upload.message}
        </p>
      )}

      <Button
        fullWidth
        aria-expanded={samplesOpen}
        aria-controls={samplesId}
        onClick={() => setSamplesOpen((open) => !open)}
      >
        <VideoIcon />
        Use a sample video
      </Button>

      {samplesOpen &&
        (samples.options ? (
          <ul id={samplesId} className={styles.samples} aria-label="Sample videos">
            {samples.options.map((option) => (
              <li key={option.video.id}>
                <VideoRow
                  video={option.video}
                  onSelect={samples.taking ? undefined : () => void samples.pick(option)}
                  actions={
                    option.sampleId !== undefined &&
                    option.sampleId === samples.taking && (
                      <span className={styles.taking} role="status">
                        <Spinner size={14} />
                        Opening
                      </span>
                    )
                  }
                />
              </li>
            ))}
          </ul>
        ) : (
          <p id={samplesId} className={styles.loadingSamples} role="status">
            <Spinner size={14} />
            Loading samples…
          </p>
        ))}

      {samples.error && (
        <p role="alert" className={styles.error}>
          {samples.error}
        </p>
      )}
    </>
  )
}
