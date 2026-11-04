import { useEffect, useRef, useState, type RefObject } from 'react'
import { useProjectStore, useSelectedTrack } from '@/entities/project'
import { BeatGrid, MOCK_BEAT_SEGMENTS, useReelStore } from '@/entities/reel'
import { DownloadReelButton } from '@/features/download-reel'
import { RestartReelButton } from '@/features/generate-reel'
import { mediaUrl } from '@/shared/api'
import { pluralize } from '@/shared/lib'
import { Chip } from '@/shared/ui/chip'
import { Eyebrow } from '@/shared/ui/eyebrow'
import { CheckIcon, ExpandIcon, PauseIcon, PlayIcon } from '@/shared/ui/icon'
import { PhoneFrame } from '@/shared/ui/phone-frame'
import { Spinner } from '@/shared/ui/spinner'
import { useMediaSource } from '../model/useMediaSource'
import { usePlaybackMock } from '../model/usePlaybackMock'
import styles from './ResultState.module.css'
import layout from './StageLayout.module.css'

const MOCK_DURATION_SEC = 27

type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void }

/**
 * Takes the player wrapper full screen, not the video: browsers stretch a full-screen
 * `<video>` to the whole display, while the wrapper keeps it at 9:16. iOS Safari only
 * lets the video itself go full screen, through a prefixed API.
 */
function toggleFullscreen(player: HTMLElement, video: FullscreenVideo) {
  if (document.fullscreenElement) {
    void document.exitFullscreen()
  } else if (typeof player.requestFullscreen === 'function') {
    player.requestFullscreen().catch(() => video.webkitEnterFullscreen?.())
  } else {
    video.webkitEnterFullscreen?.()
  }
}

/** Whether `element` is the one shown full screen. */
function useIsFullscreen(element: RefObject<HTMLElement | null>) {
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === element.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [element])

  return fullscreen
}

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
  const videoRef = useRef<FullscreenVideo>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const fullscreen = useIsFullscreen(playerRef)
  const media = useMediaSource(resultMediaId)
  // Until the reel is buffered, download straight from the stream.
  const downloadHref = media?.loading && resultMediaId ? mediaUrl(resultMediaId) : media?.src

  const length = resultMediaId ? duration : MOCK_DURATION_SEC
  const summary = [
    length === undefined ? '9:16' : `${formatDuration(length)} · 9:16`,
    resultMediaId && !track?.mediaId
      ? 'No music'
      : [track?.title ?? 'Track', track?.bpm && `${track.bpm} BPM`].filter(Boolean).join(' · '),
    faceCount > 0 ? pluralize(faceCount, 'face tracked', 'faces tracked') : 'Whole frame',
    'Captions on',
  ]

  return (
    <div className={layout.layout}>
      {media ? (
        <PhoneFrame width={280} tone={video?.tone}>
          {media.loading ? (
            <p className={styles.loading} role="status">
              <Spinner size={24} />
              Loading your reel…
            </p>
          ) : (
            <div ref={playerRef} className={styles.player}>
              <video
                ref={videoRef}
                className={styles.video}
                src={media.src}
                controls
                // Our button takes the 9:16 wrapper full screen instead.
                controlsList="nofullscreen"
                playsInline
                preload="metadata"
                aria-label="Generated reel"
                onLoadedMetadata={({ currentTarget }) => {
                  if (Number.isFinite(currentTarget.duration)) setDuration(currentTarget.duration)
                }}
              />
              <button
                type="button"
                className={styles.fullscreen}
                onClick={() => {
                  if (playerRef.current && videoRef.current)
                    toggleFullscreen(playerRef.current, videoRef.current)
                }}
              >
                <ExpandIcon size={14} />
                {fullscreen ? 'Exit full screen' : 'Full screen'}
              </button>
            </div>
          )}
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
          <DownloadReelButton href={downloadHref} className={styles.primaryAction} />
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
