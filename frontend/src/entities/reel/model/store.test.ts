import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useReelStore } from './store'

const api = vi.hoisted(() => ({ createRender: vi.fn(), getRender: vi.fn() }))

vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api')>()),
  ...api,
}))

const job = (status: string, extra = {}) => ({
  id: 'job-1',
  status,
  createdAt: '',
  updatedAt: '',
  ...extra,
})

beforeEach(() => vi.useFakeTimers())

afterEach(() => {
  useReelStore.getState().reset()
  vi.useRealTimers()
  vi.clearAllMocks()
})

test('follows a render to the finished reel', async () => {
  api.createRender.mockResolvedValue(job('queued'))
  api.getRender
    .mockResolvedValueOnce(job('rendering'))
    .mockResolvedValueOnce(job('done', { resultMediaId: 'reel-1', duration: 15 }))

  const run = useReelStore.getState().render({ analysisId: 'an-1', personIds: ['p'] })
  expect(useReelStore.getState().stage).toBe('generating')
  await vi.advanceTimersByTimeAsync(10_000)
  await run
  await vi.advanceTimersByTimeAsync(1000)

  expect(useReelStore.getState()).toMatchObject({
    stage: 'done',
    progress: 100,
    resultMediaId: 'reel-1',
  })
})

test('surfaces a failed render', async () => {
  api.createRender.mockResolvedValue(job('failed', { error: 'Worker crashed' }))
  await useReelStore.getState().render({ sourceMediaId: 'media-1' })
  expect(useReelStore.getState()).toMatchObject({ stage: 'failed', error: 'Worker crashed' })
})

test('stops following a render after reset', async () => {
  api.createRender.mockResolvedValue(job('queued'))
  const run = useReelStore.getState().render({ sourceMediaId: 'media-1' })
  await vi.advanceTimersByTimeAsync(0)
  useReelStore.getState().reset()
  await vi.advanceTimersByTimeAsync(10_000)
  await run

  expect(api.getRender).not.toHaveBeenCalled()
  expect(useReelStore.getState().stage).toBe('idle')
})

test('resumes polling a render that was in flight before a reload', async () => {
  useReelStore.setState({ stage: 'generating', progress: 40, renderId: 'job-1' })
  api.getRender
    .mockResolvedValueOnce(job('rendering'))
    .mockResolvedValueOnce(job('done', { resultMediaId: 'reel-1', duration: 15 }))

  const run = useReelStore.getState().resume()
  await vi.advanceTimersByTimeAsync(5000)
  await run
  await vi.advanceTimersByTimeAsync(1000)

  expect(api.createRender).not.toHaveBeenCalled()
  expect(useReelStore.getState()).toMatchObject({ stage: 'done', resultMediaId: 'reel-1' })
})

test('drops a sample mock that cannot be resumed', async () => {
  useReelStore.setState({ stage: 'generating', progress: 40 })
  await useReelStore.getState().resume()
  expect(useReelStore.getState().stage).toBe('idle')
})
