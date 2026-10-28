import { useProjectStore } from './store'

/** First thing the user still has to do before generating, or `null` when ready. */
export function useMissingRequirement(): string | null {
  return useProjectStore((state) => {
    if (!state.video) return 'Add a video or pick a sample to start.'
    if (state.faceIds.length === 0) return 'Pick at least one face to keep in frame.'
    if (!state.trackId) return 'Pick a soundtrack.'
    return null
  })
}
