import { create } from 'zustand'
import type { ReelStage } from './types'

type ReelState = {
  stage: ReelStage
  /** Generation progress, 0–100. */
  progress: number
}

type ReelActions = {
  /** Starts a mocked generation that finishes in roughly `durationSec`. */
  start: (durationSec?: number) => void
  reset: () => void
}

const initialState: ReelState = { stage: 'idle', progress: 0 }

const TICK_MS = 100
const COMPLETE_DELAY_MS = 450
const DEFAULT_DURATION_SEC = 7

let tickTimer: ReturnType<typeof setInterval> | undefined
let completeTimer: ReturnType<typeof setTimeout> | undefined

function stopTimers() {
  clearInterval(tickTimer)
  clearTimeout(completeTimer)
  tickTimer = undefined
  completeTimer = undefined
}

/**
 * Reel generation state. Progress is simulated client-side until the Muse
 * pipeline backend is available.
 */
export const useReelStore = create<ReelState & ReelActions>()((set, get) => ({
  ...initialState,

  start: (durationSec = DEFAULT_DURATION_SEC) => {
    stopTimers()
    set({ stage: 'generating', progress: 0 })

    const baseStep = 100 / ((durationSec * 1000) / TICK_MS)
    tickTimer = setInterval(() => {
      // Jitter makes the bar feel like real work instead of a linear fill.
      const jitter = 0.4 + Math.random() * 1.2
      const next = Math.min(100, get().progress + baseStep * jitter)
      set({ progress: next })

      if (next >= 100) {
        clearInterval(tickTimer)
        tickTimer = undefined
        completeTimer = setTimeout(() => set({ stage: 'done' }), COMPLETE_DELAY_MS)
      }
    }, TICK_MS)
  },

  reset: () => {
    stopTimers()
    set(initialState)
  },
}))
