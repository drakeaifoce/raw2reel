import { useProjectStore } from '@/entities/project'
import { BeatGrid, MOCK_BEAT_SEGMENTS } from '@/entities/reel'
import { findTrack } from '@/entities/track'
import { DownloadReelButton } from '@/features/download-reel'
import { RestartReelButton } from '@/features/generate-reel'
import { pluralize } from '@/shared/lib'
import { Chip } from '@/shared/ui/chip'
import { Eyebrow } from '@/shared/ui/eyebrow'
import { CheckIcon, PauseIcon, PlayIcon } from '@/shared/ui/icon'
import { PhoneFrame } from '@/shared/ui/phone-frame'
import { usePlaybackMock } from '../model/usePlaybackMock'
import styles from './ResultState.module.css'
import layout from './StageLayout.module.css'

const MOCK_DURATION = '0:27'
const FALLBACK_BPM = 120

export function ResultState() {
  const video = useProjectStore((state) => state.video)
  const faceCount = useProjectStore((state) => state.faceIds.length)
  const track = useProjectStore((state) => findTrack(state.trackId))
  const playback = usePlaybackMock()

  const bpm = track?.bpm ?? FALLBACK_BPM
  const summary = [
    `${MOCK_DURATION} · 9:16`,
    pluralize(Math.round(bpm / 10), 'cut'),
    `${track?.title ?? 'Track'} · ${bpm} BPM`,
    pluralize(faceCount, 'face tracked', 'faces tracked'),
    'Captions on',
  ]

  return (
    <div className={layout.layout}>
      <PhoneFrame width={280} tone={video?.tone}>
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

        <div className={styles.timeline}>
          <Eyebrow tone="muted">Cuts on the beat grid</Eyebrow>
          <BeatGrid segments={MOCK_BEAT_SEGMENTS} />
        </div>

        <div className={styles.actions}>
          <DownloadReelButton className={styles.primaryAction} />
          <RestartReelButton className={styles.secondaryAction} />
        </div>
        <p className={styles.note}>
          Restart keeps your footage, faces and track so you can try another cut.
        </p>
      </div>
    </div>
  )
}
