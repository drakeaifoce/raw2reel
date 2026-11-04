import { useProjectStore, useSelectedTrack } from '@/entities/project'
import { PipelineStepItem, buildPipelineSteps, getStepStatus, useReelStore } from '@/entities/reel'
import { formatElapsed, useElapsedSeconds } from '@/shared/lib'
import { Eyebrow } from '@/shared/ui/eyebrow'
import { PhoneFrame } from '@/shared/ui/phone-frame'
import { PulseDot } from '@/shared/ui/pulse-dot'
import styles from './GeneratingState.module.css'
import layout from './StageLayout.module.css'

export function GeneratingState() {
  const video = useProjectStore((state) => state.video)
  const faceCount = useProjectStore((state) => state.faceIds.length)
  const track = useSelectedTrack()
  const progress = useReelStore((state) => state.progress)
  const startedAt = useReelStore((state) => state.startedAt)
  const elapsed = useElapsedSeconds(startedAt)

  const percent = Math.floor(progress)
  const steps = buildPipelineSteps({ faceCount, hasMusic: Boolean(track), bpm: track?.bpm })
  // The bar is estimated and parks near the end until the worker reports done.
  const finalStep = getStepStatus(steps.length - 1, steps.length, progress) === 'active'
  const trackingLabel =
    faceCount === 0 ? 'Everyone' : faceCount === 1 ? 'Person 1' : `${faceCount} faces`

  return (
    <div className={layout.layout}>
      <PhoneFrame tone={video?.tone}>
        <div className={styles.scan} />
        <div className={styles.faceBox}>
          <span className={styles.faceLabel}>{trackingLabel}</span>
        </div>
        {video && <span className={styles.source}>{video.title}</span>}
      </PhoneFrame>

      <div className={layout.details}>
        <div className={layout.heading}>
          <Eyebrow>
            <PulseDot />
            Editing your reel
          </Eyebrow>
          <span className={styles.percent}>{percent}%</span>
        </div>

        <progress
          className={styles.progress}
          aria-label="Generation progress"
          max={100}
          value={percent}
        />
        <p className={styles.wait}>
          <span className={styles.elapsed}>{formatElapsed(elapsed)} elapsed</span>
          {finalStep
            ? ' · Still rendering. Long footage can take several more minutes, keep this tab open.'
            : ' · Usually takes a few minutes.'}
        </p>

        <ol className={styles.steps}>
          {steps.map((step, i) => (
            <PipelineStepItem
              key={`${step.agent}-${i}`}
              step={step}
              status={getStepStatus(i, steps.length, progress)}
            />
          ))}
        </ol>
      </div>
    </div>
  )
}
