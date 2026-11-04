import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Face } from '@/entities/face/@x/project'
import type { Track } from '@/entities/track/@x/project'
import type { Video } from '@/entities/video/@x/project'

/** Face discovery for uploaded footage; samples skip it. */
export type FootageAnalysis =
  | { status: 'idle' }
  /** `id` is known once the backend accepted the job. */
  | { status: 'running'; id?: string }
  | { status: 'done'; id: string }
  | { status: 'failed'; message: string }
  /** The user chose to let the worker pick people instead of waiting for faces. */
  | { status: 'skipped' }

/** Upload of a bundled sample to the user's media, so the renderer can mix it in. */
export type SampleUpload =
  | { status: 'uploading' }
  | { status: 'ready'; mediaId: string }
  | { status: 'failed'; message: string }

type ProjectState = {
  video: Video | null
  faceIds: string[]
  trackId: string | null
  analysis: FootageAnalysis
  /** Soundtrack the user uploaded, listed next to the presets. */
  customTrack: Track | null
  /** Sample uploads by track id. */
  samples: Record<string, SampleUpload>
}

type ProjectActions = {
  /** Sets the footage and pre-selects the most prominent face. */
  setVideo: (video: Video) => void
  clearVideo: () => void
  setAnalysis: (analysis: FootageAnalysis) => void
  /** Stores faces found by a finished analysis and pre-selects the most visible one. */
  setDetectedFaces: (analysisId: string, faces: Face[]) => void
  /** Drops face discovery; the worker then follows the people seen most. */
  skipAnalysis: () => void
  toggleFace: (faceId: string) => void
  selectTrack: (trackId: string) => void
  setCustomTrack: (track: Track) => void
  setSampleUpload: (trackId: string, upload: SampleUpload) => void
  reset: () => void
}

const initialState: ProjectState = {
  video: null,
  faceIds: [],
  trackId: null,
  analysis: { status: 'idle' },
  customTrack: null,
  samples: {},
}

const firstFaceIds = (faces: Face[]) => (faces[0] ? [faces[0].id] : [])

/**
 * Client-side edit setup: footage, faces to keep in frame and soundtrack.
 * Kept in session storage so a reload mid-analysis can pick the job back up.
 */
export const useProjectStore = create<ProjectState & ProjectActions>()(
  persist(
    (set) => ({
      ...initialState,

      setVideo: (video) =>
        set({ video, faceIds: firstFaceIds(video.faces), analysis: { status: 'idle' } }),

      clearVideo: () => set({ video: null, faceIds: [], analysis: { status: 'idle' } }),

      setAnalysis: (analysis) => set({ analysis }),

      setDetectedFaces: (analysisId, faces) =>
        set((state) => ({
          video: state.video && { ...state.video, faces },
          faceIds: firstFaceIds(faces),
          analysis: { status: 'done', id: analysisId },
        })),

      skipAnalysis: () => set({ faceIds: [], analysis: { status: 'skipped' } }),

      toggleFace: (faceId) =>
        set((state) => ({
          faceIds: state.faceIds.includes(faceId)
            ? state.faceIds.filter((id) => id !== faceId)
            : [...state.faceIds, faceId],
        })),

      selectTrack: (trackId) => set({ trackId }),

      setCustomTrack: (track) => set({ customTrack: track, trackId: track.id }),

      setSampleUpload: (trackId, upload) =>
        set((state) => ({ samples: { ...state.samples, [trackId]: upload } })),

      reset: () => set(initialState),
    }),
    {
      name: 'raw2reel:project',
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ video, faceIds, trackId, analysis, customTrack, samples }) => ({
        video,
        faceIds,
        trackId,
        analysis,
        customTrack,
        // An upload cut short by a reload is restarted on the next pick.
        samples: Object.fromEntries(
          Object.entries(samples).filter(([, upload]) => upload.status === 'ready'),
        ),
      }),
    },
  ),
)
