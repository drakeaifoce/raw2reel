import { describe, expect, test } from 'bun:test'
import type { AnalysisRecord, AnalysisRepository, NewAnalysis } from '../src/analyses'
import { resolveAnalysis } from '../src/render-analysis'

const now = '2026-11-01T00:00:00.000Z'

const record = (overrides: Partial<AnalysisRecord> = {}): AnalysisRecord => ({
  id: 'analysis-1',
  ownerId: 'user-1',
  sourceMediaId: 'media-1',
  status: 'done',
  people: [{ id: 'p1', label: 'Person 1', observationCount: 2 }],
  warnings: [],
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

/** Хранилище ровно с тем, что трогает выбор разбора. Остальное звать нельзя. */
function store(seed: AnalysisRecord[] = []) {
  const records = new Map(seed.map((entry) => [entry.id, entry]))
  const created: string[] = []
  const unused = () => {
    throw new Error('выбор разбора этого не делает')
  }
  const repository: AnalysisRepository = {
    create: async (input: NewAnalysis) => {
      created.push(input.id)
      const fresh = record({ ...input, status: 'queued', people: [] })
      records.set(fresh.id, fresh)
      return fresh
    },
    get: async (id, ownerId) => {
      const found = records.get(id)
      return found && found.ownerId === ownerId ? found : null
    },
    claim: async (id) => {
      const found = records.get(id)
      if (!found || found.status === 'done' || found.status === 'failed') return null
      found.status = 'preparing'
      return found
    },
    latestDone: async (ownerId, sourceMediaId) =>
      [...records.values()].find(
        (entry) =>
          entry.ownerId === ownerId &&
          entry.sourceMediaId === sourceMediaId &&
          entry.status === 'done',
      ) ?? null,
    latestPending: async (ownerId, sourceMediaId) =>
      [...records.values()].find(
        (entry) =>
          entry.ownerId === ownerId &&
          entry.sourceMediaId === sourceMediaId &&
          (entry.status === 'queued' || entry.status === 'preparing'),
      ) ?? null,
    finish: unused,
    fail: unused,
    readPrepared: unused,
    readThumbnail: unused,
  }
  return { repository, records, created }
}

const demand = { ownerId: 'user-1', sourceMediaId: 'media-1' }

describe('выбор разбора клиентом', () => {
  test('готовый разбор отдаётся как есть', async () => {
    const { repository } = store([record()])
    const choice = await resolveAnalysis(repository, { ...demand, analysisId: 'analysis-1' })
    expect(choice).toMatchObject({ kind: 'ready', record: { id: 'analysis-1' } })
  })

  test('неготовый разбор клиента не доделываем за него', async () => {
    const { repository, created } = store([record({ status: 'preparing' })])
    const choice = await resolveAnalysis(repository, { ...demand, analysisId: 'analysis-1' })
    expect(choice).toMatchObject({ kind: 'failed' })
    expect(created).toEqual([])
  })

  test('чужой разбор неотличим от отсутствующего', async () => {
    const { repository } = store([record({ ownerId: 'user-2' })])
    const choice = await resolveAnalysis(repository, { ...demand, analysisId: 'analysis-1' })
    expect(choice).toMatchObject({ kind: 'failed' })
  })
})

describe('разбор по ходу рендера', () => {
  test('без разбора создаёт один и берёт его в работу', async () => {
    const { repository, created } = store()
    const choice = await resolveAnalysis(repository, demand, () => 'новый-1')
    expect(choice).toMatchObject({
      kind: 'prepare',
      record: { id: 'новый-1', status: 'preparing' },
    })
    expect(created).toEqual(['новый-1'])
  })

  test('повторная доставка берёт тот же разбор, а не создаёт новый', async () => {
    // Ровно тот дефект, что нашёлся на стенде: десять попыток оставляли десять
    // брошенных записей.
    const { repository, created, records } = store()
    const ids: string[] = []
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const choice = await resolveAnalysis(repository, demand, () => `новый-${attempt}`)
      expect(choice.kind).toBe('prepare')
      if (choice.kind === 'prepare') ids.push(choice.record.id)
    }
    expect(new Set(ids).size).toBe(1)
    expect(created).toEqual(['новый-0'])
    expect(records.size).toBe(1)
  })

  test('готовый разбор того же исходника переиспользуется без новых вызовов моделей', async () => {
    const { repository, created } = store([record({ id: 'готовый' })])
    const choice = await resolveAnalysis(repository, demand)
    expect(choice).toMatchObject({ kind: 'ready', record: { id: 'готовый' } })
    expect(created).toEqual([])
  })

  test('разбор чужого исходника не берётся', async () => {
    const { repository, created } = store([record({ sourceMediaId: 'другое-видео' })])
    const choice = await resolveAnalysis(repository, demand, () => 'новый-1')
    expect(choice).toMatchObject({ kind: 'prepare', record: { id: 'новый-1' } })
    expect(created).toEqual(['новый-1'])
  })

  test('если разбор завершился помимо нас, он перечитывается', async () => {
    const { repository, records } = store([record({ status: 'queued' })])
    // claim вернёт null, потому что к этому моменту запись уже готова.
    records.get('analysis-1')!.status = 'done'
    const choice = await resolveAnalysis(repository, demand)
    expect(choice).toMatchObject({ kind: 'ready', record: { id: 'analysis-1' } })
  })

  test('провалившийся разбор не переиспользуется: новая заявка начинает заново', async () => {
    // Отказ мог быть и разовым, а заявка пришла новая — повторить честнее,
    // чем отказать ссылкой на прошлую неудачу.
    const { repository, created } = store([record({ status: 'failed', error: 'моделей нет' })])
    const choice = await resolveAnalysis(repository, demand, () => 'новый-1')
    expect(choice).toMatchObject({ kind: 'prepare', record: { id: 'новый-1' } })
    expect(created).toEqual(['новый-1'])
  })

  test('если разбор провалился между выбором и захватом, рендер не начинается', async () => {
    const { repository, records } = store([record({ status: 'queued' })])
    const sabotaged: AnalysisRepository = {
      ...repository,
      latestPending: async (ownerId, sourceMediaId) => {
        const found = await repository.latestPending(ownerId, sourceMediaId)
        // Ровно в этот зазор разбор успевает провалиться в чужих руках.
        Object.assign(records.get('analysis-1')!, { status: 'failed', error: 'моделей нет' })
        return found
      },
    }
    const choice = await resolveAnalysis(sabotaged, demand)
    expect(choice).toMatchObject({ kind: 'failed' })
    if (choice.kind === 'failed') expect(choice.reason).toContain('моделей нет')
  })
})
