import { useState } from 'react'
import { useProjectStore, useSelectedTrack } from '@/entities/project'
import { useReelStore } from '@/entities/reel'
import { DownloadReelButton } from '@/features/download-reel'
import { RestartReelButton } from '@/features/generate-reel'
import { mediaUrl } from '@/shared/api'
import { pluralize } from '@/shared/lib'
import { Chip } from '@/shared/ui/chip'
import { Eyebrow } from '@/shared/ui/eyebrow'
import { CheckIcon } from '@/shared/ui/icon'
import { PhoneFrame } from '@/shared/ui/phone-frame'
import styles from './ResultState.module.css'
import layout from './StageLayout.module.css'

const formatDuration = (seconds: number) => {
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export function ResultState() {
  const video = useProjectStore((state) => state.video)
  const faceCount = useProjectStore((state) => state.faceIds.length)
  const track = useSelectedTrack()
  const resultMediaId = useReelStore((state) => state.resultMediaId)
  // The render job only knows the requested length; the reel itself can be shorter.
  const [duration, setDuration] = useState<number>()
  // The media route answers Range requests, so the reel streams and seeks directly.
  const src = resultMediaId ? mediaUrl(resultMediaId) : undefined

  const summary = [
    duration === undefined ? '9:16' : `${formatDuration(duration)} · 9:16`,
    !track?.mediaId
      ? 'No music'
      : [track.title, track.bpm && `${track.bpm} BPM`].filter(Boolean).join(' · '),
    faceCount > 0 ? pluralize(faceCount, 'face tracked', 'faces tracked') : 'Whole frame',
    'Captions on',
  ]

  return (
    <div className={layout.layout}>
      <PhoneFrame width={280} tone={video?.tone}>
        <video
          className={styles.video}
          src={src}
          controls
          playsInline
          preload="metadata"
          aria-label="Generated reel"
          onLoadedMetadata={({ currentTarget }) => {
            if (Number.isFinite(currentTarget.duration)) setDuration(currentTarget.duration)
          }}
        />
      </PhoneFrame>

      <div className={layout.details}>
        <div className={layout.heading}>
          <Eyebrow>
            <CheckIcon />
            Edit ready
          </Eyebrow>
          <h2 className={styles.title}>Your reel is cut to the beat.</h2>
        </div>

        <ul className={styles.chips} aria-label="Edit summary">
          {summary.map((item) => (
            <li key={item}>
              <Chip>{item}</Chip>
            </li>
          ))}
        </ul>

        <div className={styles.actions}>
          <DownloadReelButton href={src} className={styles.primaryAction} />
          <RestartReelButton className={styles.secondaryAction} />
        </div>
        <p className={styles.note}>
          Restart keeps your footage, faces and track so you can try another cut.
        </p>
      </div>
    </div>
  )
}
