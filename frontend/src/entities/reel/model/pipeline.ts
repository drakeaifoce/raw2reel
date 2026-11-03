import { pluralize } from '@/shared/lib'
import type { PipelineStep, PipelineStepStatus } from './types'

type PipelineParams = {
  faceCount: number
  /** Whether the edit has a soundtrack to cut to. */
  hasMusic: boolean
  /** Tempo of the soundtrack, when known. */
  bpm?: number
}

/** Mirrors the stages of the AI service's render job, in order. */
export function buildPipelineSteps({ faceCount, hasMusic, bpm }: PipelineParams): PipelineStep[] {
  return [
    {
      agent: 'SAM 3.1',
      text:
        faceCount > 0
          ? `tracking ${pluralize(faceCount, 'selected person', 'selected people')} through every scene`
          : 'keeping the whole frame, no one to follow',
    },
    ...(hasMusic
      ? [
          {
            agent: 'Beat sync',
            text: bpm
              ? `finding the downbeats at ${bpm} BPM`
              : 'finding the downbeats in your track',
          },
        ]
      : []),
    { agent: 'Muse Spark', text: 'shortlisting the strongest moments from speech and action' },
    { agent: 'Muse Spark', text: 'watching the shortlist and planning the cut' },
    { agent: 'Render', text: 'reframing to 9:16, burning in captions, mixing audio' },
  ]
}

/** Steps share the progress bar evenly; the one under the cursor is active. */
export function getStepStatus(index: number, total: number, progress: number): PipelineStepStatus {
  const share = 100 / total
  if (progress >= (index + 1) * share) return 'done'
  if (progress >= index * share) return 'active'
  return 'todo'
}
