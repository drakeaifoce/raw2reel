import { useCallback, useEffect, useState } from 'react'
import { analyzeFootage } from '@/entities/project'
import { createSampleVideo, createUploadedVideo, type Video } from '@/entities/video'
import { ApiError, listSamples, takeSample, type MediaItem } from '@/shared/api'
import { useSelectFootage } from './useSelectFootage'

type Catalog =
  { status: 'loading' } | { status: 'ready'; samples: MediaItem[] } | { status: 'failed' }

export type SampleVideoOption = {
  video: Video
  /** Server sample the user's copy is taken from. */
  sampleId: string
}

/**
 * Sample footage from the backend catalog, loaded once the list is opened. The server
 * copies a taken sample into the user's media, so a large video never passes through
 * the browser.
 */
export function useSampleVideos(open: boolean) {
  const { selectFootage } = useSelectFootage()
  const [catalog, setCatalog] = useState<Catalog>({ status: 'loading' })
  const [taking, setTaking] = useState<string>()
  const [error, setError] = useState<string>()
  const loading = catalog.status === 'loading'

  useEffect(() => {
    if (!open || !loading) return
    const controller = new AbortController()
    listSamples(controller.signal)
      .then((samples) => setCatalog({ status: 'ready', samples }))
      .catch(() => {
        if (!controller.signal.aborted) setCatalog({ status: 'failed' })
      })
    return () => controller.abort()
  }, [open, loading])

  const options: SampleVideoOption[] | undefined =
    catalog.status === 'ready'
      ? catalog.samples
          .filter((sample) => sample.type.startsWith('video/'))
          .map((sample) => ({ video: createSampleVideo(sample), sampleId: sample.id }))
      : undefined

  const retry = useCallback(() => setCatalog({ status: 'loading' }), [])

  const pick = useCallback(
    async ({ sampleId }: SampleVideoOption) => {
      setError(undefined)
      setTaking(sampleId)
      try {
        const media = await takeSample(sampleId)
        selectFootage(createUploadedVideo(media, 'sample'))
        void analyzeFootage(media.id)
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'Could not open this sample.')
      } finally {
        setTaking(undefined)
      }
    },
    [selectFootage],
  )

  return { options, failed: catalog.status === 'failed', taking, error, pick, retry }
}
