export type ReelStage = 'idle' | 'generating' | 'done'

/** One stage of the Muse editing pipeline shown while a reel renders. */
export type PipelineStep = {
  agent: string
  text: string
}

export type PipelineStepStatus = 'todo' | 'active' | 'done'
