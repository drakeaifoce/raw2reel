import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  ApiError,
  createRender,
  getRender,
  jobErrorMessage,
  type CreateRenderInput,
  type RenderJob,
} from '@/shared/api'
import type { ReelStage } from './types'

type ReelState = {
  stage: ReelStage
  /** Generation progress, 0–100. */
  progress: number
  /** Stored media of the finished reel; absent for the sample mock. */
  resultMediaId?: string
  /** Reel length in seconds, when the renderer reported it. */
  duration?: number
  error?: string
  /** Backend job of a real render, kept so a reload can resume polling. */
  renderId?: string
  /** When the current render started, in epoch ms; drives the estimated progress. */
  startedAt?: number
}

type ReelActions = {
  /** Starts a mocked generation for sample footage that finishes in roughly `durationSec`. */
  start: (durationSec?: number) => void
  /** Queues a real render and follows it until the worker settles. */
  render: (input: CreateRenderInput) => Promise<void>
  /** Picks up a render that was in flight when the page was reloaded. */
  resume: () => Promise<void>
  reset: () => void
}

// Optional fields are listed so `set` clears them; zustand merges partial state.
const initialState: ReelState = {
  stage: 'idle',
  progress: 0,
  resultMediaId: undefined,
  duration: undefined,
  error: undefined,
  renderId: undefined,
  startedAt: undefined,
}

const TICK_MS = 100
const COMPLETE_DELAY_MS = 450
const DEFAULT_DURATION_SEC = 7

const POLL_MS = 4000
/** Consecutive failed polls tolerated before giving up, e.g. during a deploy. */
const MAX_POLL_ERRORS = 3
/** Renders take minutes; progress eases toward the cap with this time constant. */
const RENDER_EASE_MS = 90_000
const QUEUED_CAP = 10
const RENDERING_CAP = 95

let tickTimer: ReturnType<typeof setInterval> | undefined
let completeTimer: ReturnType<typeof setTimeout> | undefined
/** Bumped on every start or reset so stale polling loops stop writing. */
let currentRun = 0

function stopTimers() {
  clearInterval(tickTimer)
  clearTimeout(completeTimer)
  tickTimer = undefined
  completeTimer = undefined
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Reel generation state. Real renders only report a status, so the progress bar
 * is estimated from elapsed time and snaps to 100 when the worker finishes.
 * Kept in session storage so a reload mid-render keeps following the job.
 */
export const useReelStore = create<ReelState & ReelActions>()(
  persist(
    (set, get) => {
      const finish = (result: Partial<ReelState>) => {
        clearInterval(tickTimer)
        tickTimer = undefined
        set({ progress: 100, ...result })
        completeTimer = setTimeout(() => set({ stage: 'done' }), COMPLETE_DELAY_MS)
      }

      const fail = (error: string) => {
        stopTimers()
        set({ stage: 'failed', error })
      }

      /** Eases progress and polls the job returned by `first` until it settles. */
      const follow = async (first: () => Promise<RenderJob>) => {
        stopTimers()
        const run = ++currentRun
        const isCurrent = () => run === currentRun
        const startedAt = get().startedAt ?? Date.now()

        let cap = QUEUED_CAP
        const tick = () => {
          const eased = RENDERING_CAP * (1 - Math.exp(-(Date.now() - startedAt) / RENDER_EASE_MS))
          set({ progress: Math.max(get().progress, Math.min(cap, eased)) })
        }
        tickTimer = setInterval(tick, TICK_MS * 5)

        try {
          let job = await first()
          if (!isCurrent()) return
          set({ renderId: job.id })
          let pollErrors = 0
          while (job.status === 'queued' || job.status === 'rendering') {
            if (job.status === 'rendering') cap = RENDERING_CAP
            tick()
            await wait(POLL_MS)
            if (!isCurrent()) return
            try {
              job = await getRender(job.id)
              pollErrors = 0
            } catch (error) {
              if (error instanceof ApiError && error.status !== 0 && error.status < 500) throw error
              if (++pollErrors >= MAX_POLL_ERRORS) throw error
            }
          }
          if (!isCurrent()) return

          if (job.status === 'done' && job.resultMediaId) {
            finish({ resultMediaId: job.resultMediaId, duration: job.duration })
          } else {
            fail(jobErrorMessage(job.error) ?? 'The render failed. Try again.')
          }
        } catch (error) {
          if (!isCurrent()) return
          fail(error instanceof ApiError ? error.message : 'The render failed. Try again.')
        }
      }

      return {
        ...initialState,

        start: (durationSec = DEFAULT_DURATION_SEC) => {
          stopTimers()
          currentRun += 1
          set({ ...initialState, stage: 'generating' })

          const baseStep = 100 / ((durationSec * 1000) / TICK_MS)
          tickTimer = setInterval(() => {
            // Jitter makes the bar feel like real work instead of a linear fill.
            const jitter = 0.4 + Math.random() * 1.2
            const next = Math.min(100, get().progress + baseStep * jitter)
            set({ progress: next })
            if (next >= 100) finish({})
          }, TICK_MS)
        },

        render: (input) => {
          set({ ...initialState, stage: 'generating', startedAt: Date.now() })
          return follow(() => createRender(input))
        },

        resume: async () => {
          const { stage, renderId } = get()
          if (stage !== 'generating' || tickTimer) return
          // The sample mock and a render the backend never acknowledged cannot be resumed.
          if (!renderId) {
            set(initialState)
            return
          }
          await follow(() => getRender(renderId))
        },

        reset: () => {
          stopTimers()
          currentRun += 1
          set(initialState)
        },
      }
    },
    {
      name: 'raw2reel:reel',
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ stage, progress, resultMediaId, duration, error, renderId, startedAt }) => ({
        stage,
        progress,
        resultMediaId,
        duration,
        error,
        renderId,
        startedAt,
      }),
    },
  ),
)
