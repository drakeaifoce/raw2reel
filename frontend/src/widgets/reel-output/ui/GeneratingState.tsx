import { useProjectStore } from '@/entities/project'
import { PipelineStepItem, buildPipelineSteps, getStepStatus, useReelStore } from '@/entities/reel'
import { findTrack } from '@/entities/track'
import { Eyebrow } from '@/shared/ui/eyebrow'
import { PhoneFrame } from '@/shared/ui/phone-frame'
import { PulseDot } from '@/shared/ui/pulse-dot'
import styles from './GeneratingState.module.css'
import layout from './StageLayout.module.css'

const FALLBACK_BPM = 120

export function GeneratingState() {
  const video = useProjectStore((state) => state.video)
  const faceCount = useProjectStore((state) => state.faceIds.length)
  const trackId = useProjectStore((state) => state.trackId)
  const progress = useReelStore((state) => state.progress)

  const percent = Math.floor(progress)
  const bpm = findTrack(trackId)?.bpm ?? FALLBACK_BPM
  const steps = buildPipelineSteps({ faceCount, bpm })
  const trackingLabel = faceCount === 1 ? 'Person 1' : `${faceCount} faces`

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
            Muse is editing
          </Eyebrow>
          <span className={styles.percent}>{percent}%</span>
        </div>

        <progress
          className={styles.progress}
          aria-label="Generation progress"
          max={100}
          value={percent}
        />

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
