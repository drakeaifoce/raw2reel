import { useEffect, useState } from 'react'
import { mediaUrl } from '@/shared/api'

type MediaSource = { src: string; loading: boolean }

/**
 * Loads a stored reel into memory and serves it from an object URL. The media
 * endpoint has no Range support, so streaming it directly breaks seeking and
 * Safari playback; reels are capped at 30 seconds, small enough to buffer whole.
 * Falls back to the streaming URL if the download fails.
 */
export function useMediaSource(mediaId: string | undefined): MediaSource | undefined {
  const [loaded, setLoaded] = useState<{ mediaId: string; src: string }>()

  useEffect(() => {
    if (!mediaId) return
    const controller = new AbortController()
    let objectUrl: string | undefined

    fetch(mediaUrl(mediaId), { credentials: 'include', signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('media request failed')
        return response.blob()
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setLoaded({ mediaId, src: objectUrl })
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ mediaId, src: mediaUrl(mediaId) })
      })

    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [mediaId])

  if (!mediaId) return undefined
  if (loaded?.mediaId !== mediaId) return { src: '', loading: true }
  return { src: loaded.src, loading: false }
}
