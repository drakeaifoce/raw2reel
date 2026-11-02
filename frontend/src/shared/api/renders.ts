import { requestJson } from './request'

export type RenderStatus = 'queued' | 'rendering' | 'done' | 'failed'

export type RenderJob = {
  id: string
  status: RenderStatus
  duration?: number
  captions?: boolean
  musicMediaId?: string
  analysisId?: string
  personIds?: string[]
  /** Media id of the finished reel, present once status is done. */
  resultMediaId?: string
  error?: string
  createdAt: string
  updatedAt: string
}

export type CreateRenderInput = (
  { analysisId: string; personIds?: string[] } | { sourceMediaId: string }
) & {
  musicMediaId?: string
  /** Result length in seconds, at most 30. */
  duration?: number
  captions?: boolean
}

/** Queues a reel render; it runs in a worker and takes minutes. */
export const createRender = (input: CreateRenderInput) =>
  requestJson<RenderJob>('/renders', { method: 'POST', body: JSON.stringify(input) })

export const getRender = (id: string, signal?: AbortSignal) =>
  requestJson<RenderJob>(`/renders/${encodeURIComponent(id)}`, { signal })
