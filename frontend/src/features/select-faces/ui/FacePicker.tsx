import clsx from 'clsx'
import { FaceTile } from '@/entities/face'
import { analyzeFootage, useProjectStore } from '@/entities/project'
import { formatElapsed, pluralize, useElapsedSeconds } from '@/shared/lib'
import { Button } from '@/shared/ui/button'
import { Spinner } from '@/shared/ui/spinner'
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
        SAM 3.1 lists every person it finds once you add footage.
      </p>
    )
  }

  const { mediaId } = video
  const skipButton = (
    <Button size="sm" onClick={skipAnalysis}>
      Let AI choose
    </Button>
  )

  if (analysis.status === 'running') {
    return (
      <div className={styles.row}>
        <FindingPeople />
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
        <p className={styles.hint}>The reel will follow the people who appear most.</p>
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
        Found {pluralize(video.faces.length, 'person', 'people')}. Tap the people the edit should
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

/** Face discovery takes minutes, so show it is alive and how long it has been going. */
function FindingPeople() {
  const elapsed = useElapsedSeconds()

  return (
    <p className={clsx(styles.hint, styles.status)} role="status">
      <Spinner />
      <span>
        SAM 3.1 is finding people scene by scene and Muse Spark is grouping them. This takes a few
        minutes.{' '}
        <span className={styles.elapsed} aria-hidden="true">
          {formatElapsed(elapsed)}
        </span>
      </span>
    </p>
  )
}
