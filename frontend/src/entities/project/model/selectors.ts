import { useMemo } from 'react'
import { findTrack, type Track } from '@/entities/track/@x/project'
import { useProjectStore } from './store'

type TrackState = Pick<
  ReturnType<typeof useProjectStore.getState>,
  'trackId' | 'customTrack' | 'samples'
>

/** Resolves the chosen soundtrack among the presets and the user's upload. */
export const selectTrack = ({ trackId, customTrack, samples }: TrackState): Track | undefined => {
  if (customTrack && customTrack.id === trackId) return customTrack
  const preset = findTrack(trackId)
  if (!preset) return undefined
  const upload = samples[preset.id]
  return upload?.status === 'ready' ? { ...preset, mediaId: upload.mediaId } : preset
}

/** First thing the user still has to do before generating, or `null` when ready. */
export function useMissingRequirement(): string | null {
  return useProjectStore((state) => {
    if (!state.video) return 'Add a video or pick a sample to start.'
    if (state.analysis.status === 'running') return 'Still finding people in your footage.'
    if (state.analysis.status === 'failed') return 'Face detection failed. Retry or replace it.'
    if (state.analysis.status !== 'skipped' && state.faceIds.length === 0)
      return 'Pick at least one face to keep in frame.'
    if (!state.trackId) return 'Pick a soundtrack.'
    const sample = state.samples[state.trackId]
    if (sample?.status === 'uploading') return 'Preparing the soundtrack…'
    if (sample?.status === 'failed') return 'The soundtrack did not load. Try again.'
    return null
  })
}

/** The chosen preset or uploaded soundtrack. */
export function useSelectedTrack(): Track | undefined {
  const trackId = useProjectStore((state) => state.trackId)
  const customTrack = useProjectStore((state) => state.customTrack)
  const samples = useProjectStore((state) => state.samples)
  // selectTrack builds a new object for uploaded samples, so it cannot be a store selector.
  return useMemo(
    () => selectTrack({ trackId, customTrack, samples }),
    [trackId, customTrack, samples],
  )
}
