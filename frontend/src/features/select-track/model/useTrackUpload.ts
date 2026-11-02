import { useCallback, useEffect, useRef, useState } from 'react'
import { useProjectStore } from '@/entities/project'
import { MAX_MEDIA_BYTES, MediaUploadError, uploadMedia } from '@/shared/api'

export type TrackUpload =
  | { status: 'idle' }
  | { status: 'uploading'; progress: number }
  | { status: 'failed'; message: string }

/** Uploads the user's own audio and selects it as the soundtrack. */
export function useTrackUpload() {
  const setCustomTrack = useProjectStore((state) => state.setCustomTrack)
  const [upload, setUpload] = useState<TrackUpload>({ status: 'idle' })
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => controllerRef.current?.abort(), [])

  const start = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('audio/')) {
        setUpload({ status: 'failed', message: 'Pick an audio file, e.g. MP3 or WAV.' })
        return
      }
      if (file.size > MAX_MEDIA_BYTES) {
        setUpload({ status: 'failed', message: 'This file is larger than 100 MB.' })
        return
      }

      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      setUpload({ status: 'uploading', progress: 0 })

      try {
        const media = await uploadMedia(file, {
          signal: controller.signal,
          onProgress: (progress) => setUpload({ status: 'uploading', progress }),
        })
        setUpload({ status: 'idle' })
        setCustomTrack({
          id: `upload-${media.id}`,
          title: media.name,
          mood: 'Your track',
          mediaId: media.id,
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        const message =
          error instanceof MediaUploadError ? error.message : 'Upload failed. Try again.'
        setUpload({ status: 'failed', message })
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null
      }
    },
    [setCustomTrack],
  )

  return { upload, start }
}
