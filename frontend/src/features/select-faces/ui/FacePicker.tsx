import clsx from 'clsx'
import { FaceTile } from '@/entities/face'
import { analyzeFootage, useProjectStore } from '@/entities/project'
import { pluralize } from '@/shared/lib'
import { Button } from '@/shared/ui/button'
import { PulseDot } from '@/shared/ui/pulse-dot'
import styles from './FacePicker.module.css'

/** Step 2: choose which detected people the edit should follow. */
export function FacePicker() {
  const video = useProjectStore((state) => state.video)
  const analysis = useProjectStore((state) => state.analysis)
  const selectedIds = useProjectStore((state) => state.faceIds)
  const toggleFace = useProjectStore((state) => state.toggleFace)

  if (!video) {
    return (
      <p className={clsx(styles.hint, styles.empty)}>
        Muse Vision lists every face it finds once you add footage.
      </p>
    )
  }

  if (analysis.status === 'running') {
    return (
      <p className={clsx(styles.hint, styles.status)} role="status">
        <PulseDot />
        Muse Vision is finding people in your footage. This takes a few minutes.
      </p>
    )
  }

  if (analysis.status === 'failed') {
    const { mediaId } = video
    return (
      <div className={styles.failed}>
        <p className={styles.hint} role="alert">
          {analysis.message}
        </p>
        {mediaId && (
          <Button size="sm" onClick={() => void analyzeFootage(mediaId)}>
            Try again
          </Button>
        )}
      </div>
    )
  }

  return (
    <>
      <p className={styles.hint}>
        Muse Vision found {pluralize(video.faces.length, 'face')}. Tap the people the edit should
        follow.
      </p>
      <ul className={styles.faces} aria-label="Detected faces">
        {video.faces.map((face) => (
          <li key={face.id}>
            <FaceTile
              face={face}
              selected={selectedIds.includes(face.id)}
              onClick={() => toggleFace(face.id)}
            />
          </li>
        ))}
      </ul>
    </>
  )
}
