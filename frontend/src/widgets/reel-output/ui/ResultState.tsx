import { useProjectStore, useSelectedTrack } from '@/entities/project'
import { BeatGrid, MOCK_BEAT_SEGMENTS, useReelStore } from '@/entities/reel'
import { DownloadReelButton } from '@/features/download-reel'
import { RestartReelButton } from '@/features/generate-reel'
import { mediaUrl } from '@/shared/api'
import { pluralize } from '@/shared/lib'
import { Chip } from '@/shared/ui/chip'
import { Eyebrow } from '@/shared/ui/eyebrow'
import { CheckIcon, PauseIcon, PlayIcon } from '@/shared/ui/icon'
import { PhoneFrame } from '@/shared/ui/phone-frame'
import { usePlaybackMock } from '../model/usePlaybackMock'
import styles from './ResultState.module.css'
import layout from './StageLayout.module.css'

const MOCK_DURATION_SEC = 27

const formatDuration = (seconds: number) => {
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export function ResultState() {
  const video = useProjectStore((state) => state.video)
  const faceCount = useProjectStore((state) => state.faceIds.length)
  const track = useSelectedTrack()
  const resultMediaId = useReelStore((state) => state.resultMediaId)
  const duration = useReelStore((state) => state.duration)

  const summary = [
    `${formatDuration(duration ?? MOCK_DURATION_SEC)} · 9:16`,
    resultMediaId && !track?.mediaId
      ? 'No music'
      : [track?.title ?? 'Track', track?.bpm && `${track.bpm} BPM`].filter(Boolean).join(' · '),
    pluralize(faceCount, 'face tracked', 'faces tracked'),
    'Captions on',
  ]

  return (
    <div className={layout.layout}>
      {resultMediaId ? (
        <PhoneFrame width={280} tone={video?.tone}>
          <video
            className={styles.video}
            src={mediaUrl(resultMediaId)}
            controls
            playsInline
            preload="metadata"
            aria-label="Generated reel"
          />
        </PhoneFrame>
      ) : (
        <MockPreview tone={video?.tone} />
      )}

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

        {!resultMediaId && (
          <div className={styles.timeline}>
            <Eyebrow tone="muted">Cuts on the beat grid</Eyebrow>
            <BeatGrid segments={MOCK_BEAT_SEGMENTS} />
          </div>
        )}

        <div className={styles.actions}>
          <DownloadReelButton mediaId={resultMediaId} className={styles.primaryAction} />
          <RestartReelButton className={styles.secondaryAction} />
        </div>
        <p className={styles.note}>
          Restart keeps your footage, faces and track so you can try another cut.
        </p>
      </div>
    </div>
  )
}

/** Simulated player for sample footage, which never reaches the renderer. */
function MockPreview({ tone }: { tone?: string }) {
  const playback = usePlaybackMock()

  return (
    <PhoneFrame width={280} tone={tone}>
      <span className={styles.badge}>RAW2REEL EDIT</span>
      <button
        type="button"
        className={styles.play}
        aria-label={playback.playing ? 'Pause preview' : 'Play preview'}
        onClick={playback.toggle}
      >
        {playback.playing ? <PauseIcon size={24} /> : <PlayIcon size={26} />}
      </button>
      <div className={styles.caption}>
        <span className={styles.captionText}>[auto caption from your audio]</span>
      </div>
      <div className={styles.scrubber}>
        <div className={styles.scrubberFill} style={{ width: `${playback.position}%` }} />
      </div>
    </PhoneFrame>
  )
}
