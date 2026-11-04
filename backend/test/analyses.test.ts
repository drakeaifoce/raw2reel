import { describe, expect, test } from 'bun:test'
import {
  readPeople,
  type AnalysisRecord,
  type AnalysisRepository,
  type NewAnalysis,
  type StoredThumbnail,
} from '../src/analyses'
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

const now = '2026-11-01T00:00:00.000Z'

/** Хранилище разборов в памяти: повторяет поведение, на которое смотрят маршруты. */
class MemoryAnalyses implements AnalysisRepository {
  readonly records = new Map<string, AnalysisRecord>()
  readonly thumbnails = new Map<string, string>()

  constructor(seed: AnalysisRecord[] = []) {
    for (const record of seed) this.records.set(record.id, record)
  }

  async create(input: NewAnalysis): Promise<AnalysisRecord> {
    const record: AnalysisRecord = {
      ...input,
      status: 'queued',
      people: [],
      warnings: [],
      createdAt: now,
      updatedAt: now,
    }
    this.records.set(record.id, record)
    return record
  }

  async get(id: string, ownerId: string): Promise<AnalysisRecord | null> {
    const record = this.records.get(id)
    return record && record.ownerId === ownerId ? record : null
  }

  async claim(id: string): Promise<AnalysisRecord | null> {
    const record = this.records.get(id)
    if (!record || record.status === 'done' || record.status === 'failed') return null
    record.status = 'preparing'
    return record
  }

  async latestDone(ownerId: string, sourceMediaId: string): Promise<AnalysisRecord | null> {
    return (
      [...this.records.values()].find(
        (record) =>
          record.ownerId === ownerId &&
          record.sourceMediaId === sourceMediaId &&
          record.status === 'done',
      ) ?? null
    )
  }

  async latestPending(ownerId: string, sourceMediaId: string): Promise<AnalysisRecord | null> {
    return (
      [...this.records.values()].find(
        (record) =>
          record.ownerId === ownerId &&
          record.sourceMediaId === sourceMediaId &&
          (record.status === 'queued' || record.status === 'preparing'),
      ) ?? null
    )
  }

  async finish(id: string, prepared: Uint8Array): Promise<AnalysisRecord> {
    const record = this.records.get(id)!
    const { people, warnings, sourceDuration } = readPeople(prepared)
    Object.assign(record, {
      status: 'done',
      people,
      warnings,
      preparedKey: `${id}/analysis.json`,
      ...(sourceDuration !== undefined ? { sourceDuration } : {}),
    })
    return record
  }

  async fail(id: string, message: string): Promise<void> {
    const record = this.records.get(id)
    if (record) Object.assign(record, { status: 'failed', error: message })
  }

  async readPrepared(): Promise<Uint8Array> {
    return new TextEncoder().encode('{}')
  }

  async readThumbnail(record: AnalysisRecord, personId: string): Promise<StoredThumbnail | null> {
    const key = record.people.find((person) => person.id === personId)?.thumbnailKey
    const bytes = key ? this.thumbnails.get(key) : undefined
    if (!bytes) return null
    const body = new Blob([bytes]).stream() as ReadableStream<Uint8Array>
    return { body, size: bytes.length }
  }
}

class MemoryJobs implements RenderJobRepository {
  readonly records = new Map<string, RenderJob>()

  async create(job: NewRenderJob): Promise<RenderJob> {
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
  async get(id: string, ownerId: string) {
    const record = this.records.get(id)
    return record && record.ownerId === ownerId ? record : null
  }
  async claim(id: string) {
    return this.records.get(id) ?? null
  }
  async finish(id: string, resultMediaId?: string) {
    const record = this.records.get(id)
    if (record) Object.assign(record, { status: 'done', resultMediaId })
  }
  async fail(id: string, message: string) {
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

  async requeue(id: string) {
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

const done = (overrides: Partial<AnalysisRecord> = {}): AnalysisRecord => ({
  id: 'analysis-1',
  ownerId: 'user-1',
  sourceMediaId: 'media-1',
  status: 'done',
  people: [
    { id: 'p1', label: 'Person 1', observationCount: 9, thumbnailKey: 'analysis-1/people/p1.jpg' },
    { id: 'p2', label: 'Person 2', observationCount: 3 },
  ],
  warnings: [],
  preparedKey: 'analysis-1/analysis.json',
  createdAt: now,
  updatedAt: now,
  ...overrides,
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
    analyses: new MemoryAnalyses(),
    ...overrides,
  }
}

const post = (body: unknown, deps: AppDependencies) =>
  handle(
    new Request('http://localhost/analyses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    deps,
  )

describe('POST /analyses', () => {
  test('ставит разбор в очередь и отвечает 202, не дожидаясь моделей', async () => {
    const published: string[] = []
    const analyses = new MemoryAnalyses()
    const jobs = new MemoryJobs()
    const response = await post(
      { sourceMediaId: 'media-1' },
      dependencies({
        analyses,
        renderJobs: jobs,
        renderQueue: queueOf((id) => published.push(id)),
      }),
    )

    expect(response.status).toBe(202)
    const body = (await response.json()) as { id: string; status: string; people: unknown[] }
    expect(body).toMatchObject({ status: 'queued', sourceMediaId: 'media-1', people: [] })
    expect(response.headers.get('location')).toBe(`/analyses/${body.id}`)
    // Задача ушла в очередь, и это задача разбора, а не рендера.
    expect(published).toHaveLength(1)
    const job = jobs.records.get(published[0]!)
    expect(job).toMatchObject({ kind: 'prepare', analysisId: body.id, sourceMediaId: 'media-1' })
  })

  test('на чужое или несуществующее медиа отвечает 404 сразу', async () => {
    const response = await post(
      { sourceMediaId: 'media-404' },
      dependencies({
        media: { create: async () => metadata, get: async () => null, list: async () => [] },
      }),
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'MEDIA_NOT_FOUND' })
  })

  test('без sourceMediaId отвечает 400', async () => {
    const response = await post({}, dependencies())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_REQUEST' })
  })

  test('если очередь недоступна, помечает провалившимися и разбор, и задачу', async () => {
    const analyses = new MemoryAnalyses()
    const jobs = new MemoryJobs()
    const response = await post(
      { sourceMediaId: 'media-1' },
      dependencies({
        analyses,
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
    const [record] = [...analyses.records.values()]
    expect(record).toMatchObject({ status: 'failed', error: 'очередь недоступна' })
    expect([...jobs.records.values()][0]?.status).toBe('failed')
  })

  test('без настроенного хранилища разборов отвечает 503, а не падает', async () => {
    const response = await post({ sourceMediaId: 'media-1' }, dependencies({ analyses: undefined }))
    expect(response.status).toBe(503)
  })
})

describe('GET /analyses/{id}', () => {
  const read = (id: string, deps: AppDependencies) =>
    handle(new Request(`http://localhost/analyses/${id}`), deps)

  test('отдаёт карточки персонажей со ссылкой на превью, а не base64', async () => {
    const analyses = new MemoryAnalyses([done({ sourceDuration: 61.5 })])
    const response = await read('analysis-1', dependencies({ analyses }))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id: 'analysis-1',
      status: 'done',
      sourceDuration: 61.5,
      people: [
        {
          id: 'p1',
          label: 'Person 1',
          observationCount: 9,
          thumbnailUrl: '/analyses/analysis-1/people/p1/thumbnail',
        },
        // У второго персонажа превью нет — ссылки тоже быть не должно.
        { id: 'p2', label: 'Person 2', observationCount: 3 },
      ],
    })
  })

  test('разбор другого владельца не показывает', async () => {
    const analyses = new MemoryAnalyses([done({ ownerId: 'user-2' })])
    const response = await read('analysis-1', dependencies({ analyses }))
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'ANALYSIS_NOT_FOUND' })
  })

  test('маршруты разбора требуют проверенной сессии', async () => {
    const response = await read(
      'analysis-1',
      dependencies({
        auth: { handler: async () => new Response('unused'), getSession: async () => null },
      }),
    )
    expect(response.status).toBe(401)
  })
})

describe('GET /analyses/{id}/people/{personId}/thumbnail', () => {
  const read = (personId: string, deps: AppDependencies) =>
    handle(new Request(`http://localhost/analyses/analysis-1/people/${personId}/thumbnail`), deps)

  test('отдаёт JPEG с запретом на угадывание типа', async () => {
    const analyses = new MemoryAnalyses([done()])
    analyses.thumbnails.set('analysis-1/people/p1.jpg', 'jpeg-bytes')
    const response = await read('p1', dependencies({ analyses }))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.text()).toBe('jpeg-bytes')
  })

  test('персонажа без превью отличает от чужого разбора только кодом', async () => {
    const analyses = new MemoryAnalyses([done()])
    expect((await read('p2', dependencies({ analyses }))).status).toBe(404)
    const response = await read('p2', dependencies({ analyses }))
    expect(await response.json()).toMatchObject({ code: 'THUMBNAIL_NOT_FOUND' })
  })
})

describe('разбор ответа prepare', () => {
  const payload = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

  test('собирает карточки и берёт превью первого наблюдения', () => {
    const result = readPeople(
      payload({
        catalog: {
          source_duration: 42,
          warnings: ['часть сцен не просмотрена'],
          people: [
            { id: 'p1', label: 'Woman in red', observation_ids: ['o1', 'o2'] },
            { id: 'p2', label: 'Man', observation_ids: ['o3'] },
          ],
        },
        thumbnails: {
          o1: `data:image/jpeg;base64,${Buffer.from('первый').toString('base64')}`,
          o2: `data:image/jpeg;base64,${Buffer.from('второй').toString('base64')}`,
          o3: 'не картинка',
        },
      }),
    )

    expect(result.people).toEqual([
      { id: 'p1', label: 'Woman in red', observationCount: 2 },
      { id: 'p2', label: 'Man', observationCount: 1 },
    ])
    expect(result.sourceDuration).toBe(42)
    expect(result.warnings).toEqual(['часть сцен не просмотрена'])
    // Превью берём первого наблюдения, а негодную строку просто не берём.
    expect(new TextDecoder().decode(result.thumbnails.get('p1')!)).toBe('первый')
    expect(result.thumbnails.has('p2')).toBe(false)
  })

  test('пустой каталог — это ноль персонажей, а не ошибка', () => {
    const result = readPeople(payload({ catalog: { people: [] }, thumbnails: {} }))
    expect(result.people).toEqual([])
  })

  test('без каталога или не-JSON отвечает понятной ошибкой', () => {
    expect(() => readPeople(new TextEncoder().encode('не json'))).toThrow('не JSON')
    expect(() => readPeople(payload({ thumbnails: {} }))).toThrow('нет каталога')
    expect(() => readPeople(payload({ catalog: {} }))).toThrow('нет списка персонажей')
  })

  test('подпись подставляется из идентификатора, если её не прислали', () => {
    const result = readPeople(payload({ catalog: { people: [{ id: 'p7' }] } }))
    expect(result.people).toEqual([{ id: 'p7', label: 'p7', observationCount: 0 }])
  })
})
