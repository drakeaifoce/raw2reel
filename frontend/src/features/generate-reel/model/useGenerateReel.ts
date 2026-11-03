import { useCallback } from 'react'
import { selectTrack, useProjectStore } from '@/entities/project'
import { useReelStore } from '@/entities/reel'

/** Length of the cut sent to the renderer, in seconds (the API caps it at 30). */
const REEL_DURATION_SEC = 15

/**
 * Renders uploaded footage for real; bundled samples keep the simulated pipeline.
 * Without a finished analysis the renderer cuts the whole frame.
 */
export function useGenerateReel() {
  const start = useReelStore((state) => state.start)
  const render = useReelStore((state) => state.render)

  return useCallback(() => {
    const state = useProjectStore.getState()
    const { video, analysis, faceIds } = state
    if (!video?.mediaId) {
      start()
      return
    }
    const source =
      analysis.status === 'done'
        ? { analysisId: analysis.id, personIds: faceIds }
        : { sourceMediaId: video.mediaId }
    void render({
      ...source,
      musicMediaId: selectTrack(state)?.mediaId,
      duration: REEL_DURATION_SEC,
      captions: true,
    })
  }, [render, start])
}
