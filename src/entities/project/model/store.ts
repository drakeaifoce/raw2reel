import { create } from 'zustand'
import type { Video } from '@/entities/video/@x/project'

type ProjectState = {
  video: Video | null
  faceIds: string[]
  trackId: string | null
}

type ProjectActions = {
  /** Sets the footage and pre-selects the most prominent face. */
  setVideo: (video: Video) => void
  clearVideo: () => void
  toggleFace: (faceId: string) => void
  selectTrack: (trackId: string) => void
  reset: () => void
}

const initialState: ProjectState = {
  video: null,
  faceIds: [],
  trackId: null,
}

/** Client-side edit setup: footage, faces to keep in frame and soundtrack. */
export const useProjectStore = create<ProjectState & ProjectActions>()((set) => ({
  ...initialState,

  setVideo: (video) => {
    const firstFace = video.faces[0]
    set({ video, faceIds: firstFace ? [firstFace.id] : [] })
  },

  clearVideo: () => set({ video: null, faceIds: [] }),

  toggleFace: (faceId) =>
    set((state) => ({
      faceIds: state.faceIds.includes(faceId)
        ? state.faceIds.filter((id) => id !== faceId)
        : [...state.faceIds, faceId],
    })),

  selectTrack: (trackId) => set({ trackId }),

  reset: () => set(initialState),
}))
