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
  const skipAnalysis = useProjectStore((state) => state.skipAnalysis)

  if (!video) {
    return (
      <p className={clsx(styles.hint, styles.empty)}>
        Muse Vision lists every face it finds once you add footage.
      </p>
    )
  }

  const { mediaId } = video
  const skipButton = (
    <Button size="sm" onClick={skipAnalysis}>
      Use the whole frame
    </Button>
  )

  if (analysis.status === 'running') {
    return (
      <div className={styles.row}>
        <p className={clsx(styles.hint, styles.status)} role="status">
          <PulseDot />
          Muse Vision is finding people in your footage. This takes a few minutes.
        </p>
        {skipButton}
      </div>
    )
  }

  if (analysis.status === 'failed') {
    return (
      <div className={clsx(styles.row, styles.failed)}>
        <p className={styles.hint} role="alert">
          {analysis.message}
        </p>
        <div className={styles.actions}>
          {mediaId && (
            <Button size="sm" onClick={() => void analyzeFootage(mediaId)}>
              Try again
            </Button>
          )}
          {skipButton}
        </div>
      </div>
    )
  }

  if (analysis.status === 'skipped') {
    return (
      <div className={styles.row}>
        <p className={styles.hint}>The reel will use the whole frame, without following anyone.</p>
        {mediaId && (
          <Button size="sm" onClick={() => void analyzeFootage(mediaId)}>
            Find faces
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
