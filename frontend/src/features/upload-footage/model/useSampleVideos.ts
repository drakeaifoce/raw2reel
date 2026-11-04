import { useCallback, useEffect, useState } from 'react'
import { analyzeFootage } from '@/entities/project'
import { SAMPLE_VIDEOS, createSampleVideo, createUploadedVideo, type Video } from '@/entities/video'
import { ApiError, listSamples, takeSample, type MediaItem } from '@/shared/api'
import { useSelectFootage } from './useSelectFootage'

type Catalog =
  | { status: 'loading' }
  | { status: 'ready'; samples: MediaItem[] }
  /** Unreachable catalog: fall back to the demo samples. */
  | { status: 'failed' }

export type SampleVideoOption = {
  video: Video
  /** Server sample to take; demo samples have none and run on mocks. */
  sampleId?: string
}

/**
 * Sample footage from the backend catalog, loaded once the list is opened. The server
 * copies a taken sample into the user's media, so a large video never passes through
 * the browser. While the catalog has no videos, the demo samples stand in.
 */
export function useSampleVideos(open: boolean) {
  const { selectFootage } = useSelectFootage()
  const [catalog, setCatalog] = useState<Catalog>({ status: 'loading' })
  const [taking, setTaking] = useState<string>()
  const [error, setError] = useState<string>()
  const loaded = catalog.status !== 'loading'

  useEffect(() => {
    if (!open || loaded) return
    const controller = new AbortController()
    listSamples(controller.signal)
      .then((samples) => setCatalog({ status: 'ready', samples }))
      .catch(() => {
        if (!controller.signal.aborted) setCatalog({ status: 'failed' })
      })
    return () => controller.abort()
  }, [open, loaded])

  const videos =
    catalog.status === 'ready'
      ? catalog.samples.filter((sample) => sample.type.startsWith('video/'))
      : []
  const options: SampleVideoOption[] | undefined = !loaded
    ? undefined
    : videos.length > 0
      ? videos.map((sample) => ({ video: createSampleVideo(sample), sampleId: sample.id }))
      : SAMPLE_VIDEOS.map((video) => ({ video }))

  const pick = useCallback(
    async ({ video, sampleId }: SampleVideoOption) => {
      setError(undefined)
      if (!sampleId) {
        selectFootage(video)
        return
      }
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

  return { options, taking, error, pick }
}
