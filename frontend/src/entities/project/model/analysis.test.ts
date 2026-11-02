import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { analyzeFootage } from './analysis'
import { useProjectStore } from './store'

const api = vi.hoisted(() => ({ createAnalysis: vi.fn(), getAnalysis: vi.fn() }))

vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api')>()),
  ...api,
}))

const analysis = (status: string, people: unknown[] = []) => ({
  id: 'an-1',
  sourceMediaId: 'media-1',
  status,
  people,
  createdAt: '',
  updatedAt: '',
})

beforeEach(() => {
  vi.useFakeTimers()
  useProjectStore.getState().setVideo({
    id: 'upload-media-1',
    mediaId: 'media-1',
    title: 'clip.mp4',
    meta: '',
    tone: '#000',
    faces: [],
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  useProjectStore.getState().reset()
})

test('polls until done and pre-selects the most visible person', async () => {
  api.createAnalysis.mockResolvedValue(analysis('queued'))
  api.getAnalysis.mockResolvedValueOnce(analysis('preparing')).mockResolvedValueOnce(
    analysis('done', [
      { id: 'p-rare', label: 'Person 2', observationCount: 3 },
      { id: 'p-main', label: 'Person 1', observationCount: 40, thumbnailUrl: '/analyses/an-1/x' },
    ]),
  )

  const run = analyzeFootage('media-1')
  expect(useProjectStore.getState().analysis.status).toBe('running')
  await vi.runAllTimersAsync()
  await run

  const state = useProjectStore.getState()
  expect(state.analysis).toEqual({ status: 'done', id: 'an-1' })
  expect(state.faceIds).toEqual(['p-main'])
  expect(state.video?.faces.map((face) => face.thumbnailUrl)).toEqual([
    '/api/analyses/an-1/x',
    undefined,
  ])
})

test('drops the result when the footage was replaced meanwhile', async () => {
  api.createAnalysis.mockResolvedValue(analysis('queued'))
  api.getAnalysis.mockResolvedValue(
    analysis('done', [{ id: 'p', label: 'P', observationCount: 1 }]),
  )

  const run = analyzeFootage('media-1')
  useProjectStore.getState().clearVideo()
  await vi.runAllTimersAsync()
  await run

  expect(useProjectStore.getState().analysis).toEqual({ status: 'idle' })
  expect(api.getAnalysis).not.toHaveBeenCalled()
})

test('reports an analysis without people as a failure', async () => {
  api.createAnalysis.mockResolvedValue(analysis('done'))
  await analyzeFootage('media-1')
  expect(useProjectStore.getState().analysis).toEqual({
    status: 'failed',
    message: 'Muse Vision found no people in this video.',
  })
})
