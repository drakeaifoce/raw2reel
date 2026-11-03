import { useCallback, useEffect, useRef, useState } from 'react'
import type { Track } from '@/entities/track'

/**
 * Plays one track at a time. Samples play their bundled audio; placeholders without
 * audio only toggle the visual state.
 */
export function useTrackPreview() {
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const stop = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    setPreviewingId(null)
  }, [])

  useEffect(() => () => audioRef.current?.pause(), [])

  const toggle = useCallback(
    (track: Track) => {
      const wasPlaying = previewingId === track.id
      stop()
      if (wasPlaying) return
      setPreviewingId(track.id)
      if (!track.src) return
      const audio = new Audio(track.src)
      audioRef.current = audio
      audio.addEventListener('ended', stop, { once: true })
      audio.play().catch(stop)
    },
    [previewingId, stop],
  )

  return { previewingId, toggle }
}
