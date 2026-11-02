import { requestJson } from './request'

export type AnalysisStatus = 'queued' | 'preparing' | 'done' | 'failed'

/** A person Muse Vision found in the footage. */
export type AnalysisPerson = {
  id: string
  /** Anonymous label, never a real name. */
  label: string
  /** How often the person was seen. */
  observationCount: number
  /** Preview path relative to the API root; absent when there is no usable preview. */
  thumbnailUrl?: string
}

export type Analysis = {
  id: string
  sourceMediaId: string
  status: AnalysisStatus
  people: AnalysisPerson[]
  sourceDuration?: number
  warnings?: string[]
  error?: string
  createdAt: string
  updatedAt: string
}

/** Queues character discovery; it runs in the cloud and takes minutes. */
export const createAnalysis = (sourceMediaId: string) =>
  requestJson<Analysis>('/analyses', {
    method: 'POST',
    body: JSON.stringify({ sourceMediaId }),
  })

export const getAnalysis = (id: string, signal?: AbortSignal) =>
  requestJson<Analysis>(`/analyses/${encodeURIComponent(id)}`, { signal })

/** Public URL for a person preview; the API returns it without the `/api` prefix. */
export const analysisThumbnailUrl = (path: string) =>
  `/api${path.startsWith('/') ? '' : '/'}${path}`
