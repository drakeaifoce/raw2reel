import { Button } from '@/shared/ui/button'
import { UploadIcon } from '@/shared/ui/icon'
import styles from './FootagePicker.module.css'

type UploadProgressProps = {
  fileName: string
  /** From 0 to 1. */
  progress: number
  onCancel: () => void
}

export function UploadProgress({ fileName, progress, onCancel }: UploadProgressProps) {
  const percent = Math.round(progress * 100)
  const finishing = percent >= 100

  return (
    <div className={styles.uploading}>
      <UploadIcon size={20} className={styles.uploadIcon} />
      <div className={styles.uploadInfo}>
        <span className={styles.uploadName}>{fileName}</span>
        <progress
          className={styles.uploadBar}
          max={100}
          value={percent}
          aria-label={`Uploading ${fileName}`}
        />
        <output className={styles.dropHint}>
          {finishing ? 'Saving to your media…' : `Uploading · ${percent}%`}
        </output>
      </div>
      <Button size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}
