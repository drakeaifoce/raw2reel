import { pluralize } from '@/shared/lib'
import type { PipelineStep, PipelineStepStatus } from './types'

type PipelineParams = {
  faceCount: number
  /** Whether the edit has a soundtrack to cut to. */
  hasMusic: boolean
  /** Tempo of the soundtrack, when known. */
  bpm?: number
}

/** Length of the cut the AI service plans, in seconds. */
const EDIT_SECONDS = 20

/**
 * Mirrors the stages of the AI service's render job, in order. The job reports no
 * stage, so the progress bar walks through them on an estimate.
 */
export function buildPipelineSteps({ faceCount, hasMusic, bpm }: PipelineParams): PipelineStep[] {
  return [
    {
      agent: 'People tracking',
      text:
        faceCount > 0
          ? `SAM 3.1 locks onto ${pluralize(faceCount, 'selected person', 'selected people')}, scene by scene`
          : 'SAM 3.1 follows everyone it found in your footage, scene by scene',
    },
    ...(hasMusic
      ? [
          {
            agent: 'Beat detection',
            text: bpm
              ? `mapping the downbeats at ${bpm} BPM and finding the drop`
              : 'measuring the tempo and finding the drop in your track',
          },
        ]
      : []),
    {
      agent: 'Moment shortlist',
      text: 'Muse Spark reads the transcript for a dialogue setup and reaction highlights',
    },
    {
      agent: 'Edit plan',
      text: `Muse Spark watches the shortlist and plans a ${EDIT_SECONDS}s cut: story setup, then impact`,
    },
    {
      agent: 'Assembly',
      text: hasMusic
        ? 'landing impact shots on the beats and captioning the dialogue'
        : 'trimming the shots and captioning the dialogue',
    },
    {
      agent: 'Render',
      text: hasMusic
        ? 'reframing to 9:16 around your people and mixing in the music'
        : 'reframing to 9:16 around your people, keeping the dialogue audio',
    },
  ]
}

/** Steps share the progress bar evenly; the one under the cursor is active. */
export function getStepStatus(index: number, total: number, progress: number): PipelineStepStatus {
  const share = 100 / total
  if (progress >= (index + 1) * share) return 'done'
  if (progress >= index * share) return 'active'
  return 'todo'
}
