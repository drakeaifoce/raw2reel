import { describe, expect, test } from 'bun:test'
import type { QueueOutcome, RenderQueue } from '../src/queue'
import { GIVE_UP_AFTER_MS, STALE_AFTER_MS, sweepStuckJobs } from '../src/reaper'
import type { NewRenderJob, RenderJob, RenderJobRepository } from '../src/render-jobs'

const NOW = Date.parse('2026-11-04T18:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

const job = (overrides: Partial<RenderJob> = {}): RenderJob => ({
  id: 'job-1',
  ownerId: 'user-1',
  sourceMediaId: 'media-1',
  status: 'rendering',
  attempts: 1,
  createdAt: ago(STALE_AFTER_MS * 2),
  updatedAt: ago(STALE_AFTER_MS * 2),
  ...overrides,
})

function store(records: RenderJob[]) {
  const all = [...records]
  const unused = () => {
    throw new Error('подбор застрявших этого не делает')
  }
  const jobs: RenderJobRepository = {
    create: unused as unknown as (input: NewRenderJob) => Promise<RenderJob>,
    get: unused as unknown as (id: string, ownerId: string) => Promise<RenderJob | null>,
    claim: unused as unknown as (id: string) => Promise<RenderJob | null>,
    finish: unused as unknown as (id: string, resultMediaId?: string) => Promise<void>,
    requeue: unused as unknown as (id: string) => Promise<void>,
    fail: async (id, message) => {
      const found = all.find((item) => item.id === id)
      if (found) Object.assign(found, { status: 'failed', error: message })
    },
    // Повторяет условие запроса: только незавершённые и давно не менявшиеся.
    stale: async (before, limit) =>
      all
        .filter(
          (item) =>
            (item.status === 'queued' || item.status === 'rendering') && item.updatedAt < before,
        )
        .slice(0, limit),
  }
  return { jobs, all }
}

const queueOf = (published: string[], failing = false): RenderQueue => ({
  publish: async (id) => {
    if (failing) throw new Error('очередь недоступна')
    published.push(id)
  },
  consume: async (_handler: (jobId: string) => Promise<QueueOutcome>) => {},
  ping: async () => {},
  close: async () => {},
})

describe('подбор застрявших задач', () => {
  test('возвращает в очередь задачу, которая давно не двигалась', async () => {
    const { jobs } = store([job()])
    const published: string[] = []

    const result = await sweepStuckJobs(jobs, queueOf(published), () => NOW)

    expect(result).toEqual({ requeued: 1, failed: 0 })
    expect(published).toEqual(['job-1'])
  })

  test('не трогает ту, что просто долго считается', async () => {
    // Рендер идёт минутами, и подбор не должен мешать живой работе.
    const { jobs } = store([job({ updatedAt: ago(STALE_AFTER_MS - 60_000) })])
    const published: string[] = []

    const result = await sweepStuckJobs(jobs, queueOf(published), () => NOW)

    expect(result).toEqual({ requeued: 0, failed: 0 })
    expect(published).toEqual([])
  })

  test('завершённые задачи не трогает никогда', async () => {
    const { jobs, all } = store([
      job({ id: 'готовая', status: 'done' }),
      job({ id: 'провал', status: 'failed' }),
    ])
    const published: string[] = []

    const result = await sweepStuckJobs(jobs, queueOf(published), () => NOW)

    expect(result).toEqual({ requeued: 0, failed: 0 })
    expect(published).toEqual([])
    expect(all.map((item) => item.status)).toEqual(['done', 'failed'])
  })

  test('после суток признаёт задачу провалившейся, а не крутит по кругу', async () => {
    const { jobs, all } = store([job({ updatedAt: ago(GIVE_UP_AFTER_MS + 60_000) })])
    const published: string[] = []

    const result = await sweepStuckJobs(jobs, queueOf(published), () => NOW)

    expect(result).toEqual({ requeued: 0, failed: 1 })
    expect(published).toEqual([])
    expect(all[0]!.status).toBe('failed')
    expect(all[0]!.error).toContain('больше суток')
  })

  test('недоступная очередь не портит задачу: следующий проход попробует снова', async () => {
    const { jobs, all } = store([job()])

    const result = await sweepStuckJobs(jobs, queueOf([], true), () => NOW)

    expect(result).toEqual({ requeued: 0, failed: 0 })
    expect(all[0]!.status).toBe('rendering')
  })

  test('берёт и те, что застряли в очереди, а не только в работе', async () => {
    const { jobs } = store([job({ id: 'в-очереди', status: 'queued' })])
    const published: string[] = []

    await sweepStuckJobs(jobs, queueOf(published), () => NOW)

    expect(published).toEqual(['в-очереди'])
  })
})
