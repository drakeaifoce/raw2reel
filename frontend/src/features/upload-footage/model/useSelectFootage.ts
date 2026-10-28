import { useCallback } from 'react'
import { useProjectStore } from '@/entities/project'
import { useReelStore } from '@/entities/reel'
import type { Video } from '@/entities/video'

/** Swapping footage invalidates any generated or in-progress reel. */
export function useSelectFootage() {
  const setVideo = useProjectStore((state) => state.setVideo)
  const clearVideo = useProjectStore((state) => state.clearVideo)
  const resetReel = useReelStore((state) => state.reset)

  const selectFootage = useCallback(
    (video: Video) => {
      resetReel()
      setVideo(video)
    },
    [resetReel, setVideo],
  )

  const clearFootage = useCallback(() => {
    resetReel()
    clearVideo()
  }, [resetReel, clearVideo])

  return { selectFootage, clearFootage }
}
