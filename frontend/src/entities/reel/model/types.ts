export type ReelStage = 'idle' | 'generating' | 'done' | 'failed'

/** One stage of the AI editing pipeline shown while a reel renders. */
export type PipelineStep = {
  agent: string
  text: string
}

export type PipelineStepStatus = 'todo' | 'active' | 'done'
