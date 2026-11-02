import { pluralize } from '@/shared/lib'
import type { PipelineStep, PipelineStepStatus } from './types'

type PipelineParams = {
  faceCount: number
  /** Tempo of the soundtrack, when known. */
  bpm?: number
}

export function buildPipelineSteps({ faceCount, bpm }: PipelineParams): PipelineStep[] {
  return [
    { agent: 'Muse Vision', text: 'scanning every frame for motion peaks and highlights' },
    {
      agent: 'Muse Vision',
      text: `locking on ${pluralize(faceCount, 'selected face')}, dropping shots without them`,
    },
    { agent: 'Muse Voice', text: 'transcribing speech into word-timed captions' },
    { agent: 'Muse Spark', text: 'reading the story and choosing a hook for the first 2 seconds' },
    {
      agent: 'Muse Spark',
      text: bpm
        ? `mapping the beat grid at ${bpm} BPM and cutting on downbeats`
        : 'mapping the beat grid and cutting on downbeats',
    },
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
