import { findTrack, type Track } from '@/entities/track/@x/project'
import { useProjectStore } from './store'

type TrackState = Pick<ReturnType<typeof useProjectStore.getState>, 'trackId' | 'customTrack'>

/** Resolves the chosen soundtrack among the presets and the user's upload. */
export const selectTrack = ({ trackId, customTrack }: TrackState): Track | undefined =>
  customTrack && customTrack.id === trackId ? customTrack : findTrack(trackId)

/** First thing the user still has to do before generating, or `null` when ready. */
export function useMissingRequirement(): string | null {
  return useProjectStore((state) => {
    if (!state.video) return 'Add a video or pick a sample to start.'
    if (state.analysis.status === 'running') return 'Muse Vision is still finding people.'
    if (state.analysis.status === 'failed') return 'Face detection failed. Retry or replace it.'
    if (state.faceIds.length === 0) return 'Pick at least one face to keep in frame.'
    if (!state.trackId) return 'Pick a soundtrack.'
    return null
  })
}

/** The chosen preset or uploaded soundtrack. */
export function useSelectedTrack(): Track | undefined {
  return useProjectStore(selectTrack)
}
