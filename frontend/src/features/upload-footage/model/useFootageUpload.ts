import { useCallback, useEffect, useRef, useState } from 'react'
import { createUploadedVideo } from '@/entities/video'
import { MAX_MEDIA_BYTES, MediaUploadError, uploadMedia } from '@/shared/api'
import { useSelectFootage } from './useSelectFootage'

export type FootageUpload =
  | { status: 'idle' }
  | { status: 'uploading'; fileName: string; progress: number }
  | { status: 'failed'; message: string }

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

/** Uploads the picked file to media storage and selects it as footage once stored. */
export function useFootageUpload() {
  const { selectFootage } = useSelectFootage()
  const [upload, setUpload] = useState<FootageUpload>({ status: 'idle' })
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => controllerRef.current?.abort(), [])

  const start = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('video/')) {
        setUpload({ status: 'failed', message: 'This file type is not supported. Upload a video.' })
        return
      }
      if (file.size > MAX_MEDIA_BYTES) {
        setUpload({ status: 'failed', message: 'This file is larger than 100 MB.' })
        return
      }

      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      setUpload({ status: 'uploading', fileName: file.name, progress: 0 })

      try {
        const media = await uploadMedia(file, {
          signal: controller.signal,
          onProgress: (progress) =>
            setUpload({ status: 'uploading', fileName: file.name, progress }),
        })
        setUpload({ status: 'idle' })
        selectFootage(createUploadedVideo(media))
      } catch (error) {
        if (isAbort(error)) return
        const message =
          error instanceof MediaUploadError ? error.message : 'Upload failed. Try again.'
        setUpload({ status: 'failed', message })
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null
      }
    },
    [selectFootage],
  )

  const cancel = useCallback(() => {
    controllerRef.current?.abort()
    setUpload({ status: 'idle' })
  }, [])

  return { upload, start, cancel }
}
