import { describe, expect, test } from 'bun:test'
import type { AnalysisRecord, AnalysisRepository } from '../src/analyses'
import { handle, type AppDependencies } from '../src/app'
import type { MediaMetadata } from '../src/media'
import type { QueueOutcome, RenderQueue } from '../src/queue'
import type { NewRenderJob, RenderJob, RenderJobRepository } from '../src/render-jobs'

const metadata: MediaMetadata = {
  id: 'media-1',
  ownerId: 'user-1',
  name: 'clip.mp4',
  type: 'video/mp4',
  size: 4,
  blobKey: 'media-1/clip.mp4',
  createdAt: '2026-11-01T00:00:00.000Z',
}

/** Хранилище задач в памяти: повторяет поведение, на которое опираются маршруты. */
class MemoryJobs implements RenderJobRepository {
  readonly records = new Map<string, RenderJob>()

  async create(job: NewRenderJob): Promise<RenderJob> {
    const now = '2026-11-01T00:00:00.000Z'
    const record: RenderJob = {
      ...job,
      status: 'queued',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    }
    this.records.set(record.id, record)
    return record
  }

  async get(id: string, ownerId: string): Promise<RenderJob | null> {
    const record = this.records.get(id)
    return record && record.ownerId === ownerId ? record : null
  }

  async claim(id: string): Promise<RenderJob | null> {
    const record = this.records.get(id)
    if (!record || record.status === 'done' || record.status === 'failed') return null
    record.status = 'rendering'
    record.attempts += 1
    return record
  }

  async finish(id: string, resultMediaId: string): Promise<void> {
    const record = this.records.get(id)
    if (record) Object.assign(record, { status: 'done', resultMediaId })
  }

  async fail(id: string, message: string): Promise<void> {
    const record = this.records.get(id)
    if (record) Object.assign(record, { status: 'failed', error: message })
  }

  async stale(before: string, limit: number): Promise<RenderJob[]> {
    return [...this.records.values()]
      .filter(
        (record) =>
          (record.status === 'queued' || record.status === 'rendering') &&
          record.updatedAt < before,
      )
      .slice(0, limit)
  }

  async requeue(id: string): Promise<void> {
    const record = this.records.get(id)
    if (record) record.status = 'queued'
  }
}

const queueOf = (onPublish?: (id: string) => void): RenderQueue => ({
  publish: async (id) => {
    onPublish?.(id)
  },
  consume: async (_handler: (jobId: string) => Promise<QueueOutcome>) => {},
  ping: async () => {},
  close: async () => {},
})

const doneAnalysis = (overrides: Partial<AnalysisRecord> = {}): AnalysisRecord => ({
  id: 'analysis-1',
  ownerId: 'user-1',
  sourceMediaId: 'media-from-analysis',
  status: 'done',
  people: [
    { id: 'p1', label: 'Person 1', observationCount: 9 },
    { id: 'p2', label: 'Person 2', observationCount: 3 },
  ],
  warnings: [],
  preparedKey: 'analysis-1/analysis.json',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...overrides,
})

/** Из хранилища разборов маршруту рендера нужен только get. */
const analysesWith = (record: AnalysisRecord | null): AnalysisRepository => ({
  create: async () => {
    throw new Error('маршрут рендера разборов не создаёт')
  },
  get: async (id, ownerId) =>
    record && record.id === id && record.ownerId === ownerId ? record : null,
  claim: async () => null,
  latestDone: async () => null,
  latestPending: async () => null,
  finish: async () => {
    throw new Error('маршрут рендера разборов не заполняет')
  },
  fail: async () => {},
  readPrepared: async () => new Uint8Array(),
  readThumbnail: async () => null,
})

function dependencies(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return {
    auth: {
      handler: async () => new Response('unused'),
      getSession: async () => ({ user: { id: 'user-1', email: 'editor@example.com' } }),
    },
    media: {
      create: async () => metadata,
      get: async () => ({ metadata, body: new Blob(['test']).stream() }),
      list: async () => [metadata],
    },
    renderJobs: new MemoryJobs(),
    renderQueue: queueOf(),
    analyses: analysesWith(doneAnalysis()),
    ...overrides,
  }
}

const post = (body: unknown, deps: AppDependencies) =>
  handle(
    new Request('http://localhost/renders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    deps,
  )

describe('POST /renders', () => {
  test('ставит задачу в очередь и отвечает 202, не дожидаясь рендера', async () => {
    const published: string[] = []
    const jobs = new MemoryJobs()
    const response = await post(
      { sourceMediaId: 'media-1', duration: 20, captions: false },
      dependencies({ renderJobs: jobs, renderQueue: queueOf((id) => published.push(id)) }),
    )

    expect(response.status).toBe(202)
    const body = (await response.json()) as { id: string; status: string; duration: number }
    expect(body).toMatchObject({ status: 'queued', duration: 20, captions: false })
    expect(response.headers.get('location')).toBe(`/renders/${body.id}`)
    // Задача ушла в очередь ровно одна и ровно та, что создана.
    expect(published).toEqual([body.id])
    expect(jobs.records.get(body.id)?.ownerId).toBe('user-1')
  })

  test('подставляет значения по умолчанию: 27 секунд и подписи включены', async () => {
    const response = await post({ sourceMediaId: 'media-1' }, dependencies())
    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ duration: 27, captions: true })
  })

  test('владельца берёт из сессии, а не из тела запроса', async () => {
    const jobs = new MemoryJobs()
    const response = await post(
      { sourceMediaId: 'media-1', ownerId: 'attacker-selected' },
      dependencies({ renderJobs: jobs }),
    )
    const body = (await response.json()) as { id: string }
    expect(jobs.records.get(body.id)?.ownerId).toBe('user-1')
  })

  test('без sourceMediaId отвечает 400', async () => {
    const response = await post({ duration: 10 }, dependencies())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_REQUEST' })
  })

  test('отвергает длительность вне предела AI-сервиса', async () => {
    for (const duration of [0, -5, 31, 600]) {
      const response = await post({ sourceMediaId: 'media-1', duration }, dependencies())
      expect(response.status).toBe(400)
    }
  })

  test('на чужое или несуществующее медиа отвечает 404 сразу, а не через минуту', async () => {
    const response = await post(
      { sourceMediaId: 'media-404' },
      dependencies({
        media: { create: async () => metadata, get: async () => null, list: async () => [] },
      }),
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'MEDIA_NOT_FOUND' })
  })

  test('если очередь недоступна, задача помечается провалившейся, а не остаётся queued', async () => {
    const jobs = new MemoryJobs()
    const response = await post(
      { sourceMediaId: 'media-1' },
      dependencies({
        renderJobs: jobs,
        renderQueue: {
          ...queueOf(),
          publish: async () => {
            throw new Error('очередь недоступна')
          },
        },
      }),
    )

    expect(response.status).toBe(503)
    const [record] = [...jobs.records.values()]
    expect(record?.status).toBe('failed')
    expect(record?.error).toContain('очередь недоступна')
  })

  test('без настроенной очереди отвечает 503, а не падает', async () => {
    const response = await post(
      { sourceMediaId: 'media-1' },
      dependencies({ renderJobs: new MemoryJobs(), renderQueue: undefined }),
    )
    expect(response.status).toBe(503)
  })
})

describe('GET /renders/{id}', () => {
  test('отдаёт состояние задачи владельцу', async () => {
    const jobs = new MemoryJobs()
    const created = await post({ sourceMediaId: 'media-1' }, dependencies({ renderJobs: jobs }))
    const { id } = (await created.json()) as { id: string }
    await jobs.finish(id, 'media-result')

    const response = await handle(
      new Request(`http://localhost/renders/${id}`),
      dependencies({ renderJobs: jobs }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id,
      status: 'done',
      resultMediaId: 'media-result',
    })
  })

  test('задачу другого владельца не показывает', async () => {
    const jobs = new MemoryJobs()
    await jobs.create({
      id: 'job-other',
      ownerId: 'user-2',
      sourceMediaId: 'media-1',
      duration: 27,
      captions: true,
    })

    const response = await handle(
      new Request('http://localhost/renders/job-other'),
      dependencies({ renderJobs: jobs }),
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'RENDER_NOT_FOUND' })
  })

  test('маршруты рендера требуют проверенной сессии', async () => {
    const response = await handle(
      new Request('http://localhost/renders/job-1', { headers: { 'x-user-id': 'forged-user' } }),
      dependencies({
        auth: { handler: async () => new Response('unused'), getSession: async () => null },
      }),
    )
    expect(response.status).toBe(401)
  })
})

describe('POST /renders по готовому разбору', () => {
  test('берёт исходник из разбора, а не из тела запроса: сервис сверяет отпечаток', async () => {
    const jobs = new MemoryJobs()
    const response = await post(
      { analysisId: 'analysis-1', personIds: ['p2'] },
      dependencies({ renderJobs: jobs }),
    )

    expect(response.status).toBe(202)
    const body = (await response.json()) as { id: string }
    expect(jobs.records.get(body.id)).toMatchObject({
      kind: 'render',
      analysisId: 'analysis-1',
      personIds: ['p2'],
      sourceMediaId: 'media-from-analysis',
    })
  })

  test('без personIds задача уходит в очередь: персонажей выберет воркер', async () => {
    const jobs = new MemoryJobs()
    const response = await post({ analysisId: 'analysis-1' }, dependencies({ renderJobs: jobs }))
    expect(response.status).toBe(202)
    const body = (await response.json()) as { id: string }
    expect(jobs.records.get(body.id)?.personIds).toBeUndefined()
  })

  test('analysisId и sourceMediaId вместе — 400: неясно, какой исходник брать', async () => {
    const response = await post(
      { analysisId: 'analysis-1', sourceMediaId: 'media-1' },
      dependencies(),
    )
    expect(response.status).toBe(400)
  })

  test('personIds без analysisId — 400: проверить их пока не по чему', async () => {
    const response = await post({ sourceMediaId: 'media-1', personIds: ['p1'] }, dependencies())
    expect(response.status).toBe(400)
  })

  test('неготовый разбор — 409, а не задача, которая провалится через минуту', async () => {
    const response = await post(
      { analysisId: 'analysis-1' },
      dependencies({ analyses: analysesWith(doneAnalysis({ status: 'preparing' })) }),
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'ANALYSIS_NOT_READY' })
  })

  test('пустой каталог — 409: пустой person_ids AI-сервис не примет', async () => {
    const response = await post(
      { analysisId: 'analysis-1' },
      dependencies({ analyses: analysesWith(doneAnalysis({ people: [] })) }),
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'ANALYSIS_HAS_NO_PEOPLE' })
  })

  test('чужой разбор — 404, как и отсутствующий', async () => {
    const response = await post(
      { analysisId: 'analysis-1' },
      dependencies({ analyses: analysesWith(doneAnalysis({ ownerId: 'user-2' })) }),
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'ANALYSIS_NOT_FOUND' })
  })

  test('негодный выбор персонажей отвергается до очереди', async () => {
    const cases = [
      [],
      ['p1', 'p1'],
      ['нет-такого'],
      Array.from({ length: 17 }, (_, index) => `p${index}`),
    ]
    for (const personIds of cases) {
      const response = await post({ analysisId: 'analysis-1', personIds }, dependencies())
      expect(response.status).toBe(400)
    }
  })

  test('без настроенного хранилища разборов отвечает 503', async () => {
    const response = await post({ analysisId: 'analysis-1' }, dependencies({ analyses: undefined }))
    expect(response.status).toBe(503)
  })
})
