import { create } from 'zustand'
import type { ReelStage } from './types'

type ReelState = {
  stage: ReelStage
  /** Generation progress, 0–100. */
  progress: number
}

type ReelActions = {
  start: () => void
  setProgress: (progress: number) => void
  complete: () => void
  reset: () => void
}

const initialState: ReelState = { stage: 'idle', progress: 0 }

export const useReelStore = create<ReelState & ReelActions>()((set) => ({
  ...initialState,
  start: () => set({ stage: 'generating', progress: 0 }),
  setProgress: (progress) => set({ progress: Math.min(100, Math.max(0, progress)) }),
  complete: () => set({ stage: 'done', progress: 100 }),
  reset: () => set(initialState),
}))
