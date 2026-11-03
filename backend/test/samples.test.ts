import { describe, expect, test } from 'bun:test'
import { handle, type AppDependencies } from '../src/app'
import type { MediaMetadata, MediaRepository } from '../src/media'

const SAMPLES_OWNER = 'samples'

const sample: MediaMetadata = {
  id: 'sample-track',
  ownerId: SAMPLES_OWNER,
  name: 'Neon Drive.mp3',
  type: 'audio/mpeg',
  size: 4_200_000,
  blobKey: 'samples/sample-track/Neon_Drive.mp3',
  createdAt: '2026-11-03T00:00:00.000Z',
}

/** Хранилище в памяти: копия заводит новую запись, оригинал не трогает. */
function store(records: MediaMetadata[] = [sample]) {
  const all = [...records]
  const media: MediaRepository = {
    create: async () => {
      throw new Error('маршруты сэмплов ничего не загружают')
    },
    get: async (id, ownerId) => {
      const found = all.find((item) => item.id === id && item.ownerId === ownerId)
      return found ? { metadata: found, body: new Blob(['audio']).stream() } : null
    },
    list: async (limit, ownerId) => all.filter((item) => item.ownerId === ownerId).slice(0, limit),
    copy: async (id, fromOwnerId, toOwnerId) => {
      const source = all.find((item) => item.id === id && item.ownerId === fromOwnerId)
      if (!source) return null
      const copied: MediaMetadata = {
        ...source,
        id: `copy-of-${source.id}`,
        ownerId: toOwnerId,
        blobKey: `${toOwnerId}/copy`,
      }
      all.push(copied)
      return copied
    },
  }
  return { media, all }
}

function dependencies(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return {
    auth: {
      handler: async () => new Response('unused'),
      getSession: async () => ({ user: { id: 'user-1', email: 'editor@example.com' } }),
    },
    media: store().media,
    ...overrides,
  }
}

describe('GET /samples', () => {
  test('отдаёт только сэмплы, а не чужие загрузки', async () => {
    const { media } = store([sample, { ...sample, id: 'private', ownerId: 'user-1' }])
    const response = await handle(new Request('http://localhost/samples'), dependencies({ media }))

    expect(response.status).toBe(200)
    const body = (await response.json()) as { items: { id: string }[] }
    expect(body.items.map((item) => item.id)).toEqual(['sample-track'])
  })

  test('не раскрывает служебные поля хранилища', async () => {
    const response = await handle(new Request('http://localhost/samples'), dependencies())
    const body = (await response.json()) as { items: Record<string, unknown>[] }
    expect(Object.keys(body.items[0]!).sort()).toEqual(['createdAt', 'id', 'name', 'size', 'type'])
  })

  test('требует проверенной сессии', async () => {
    const response = await handle(
      new Request('http://localhost/samples'),
      dependencies({
        auth: { handler: async () => new Response('unused'), getSession: async () => null },
      }),
    )
    expect(response.status).toBe(401)
  })
})

describe('POST /samples/{id}', () => {
  test('кладёт копию текущему пользователю, оригинал оставляя на месте', async () => {
    const { media, all } = store()
    const response = await handle(
      new Request('http://localhost/samples/sample-track', { method: 'POST' }),
      dependencies({ media }),
    )

    expect(response.status).toBe(201)
    // Ответ неотличим от обычной загрузки: дальше клиент идёт прежним путём.
    expect(await response.json()).toMatchObject({
      id: 'copy-of-sample-track',
      name: 'Neon Drive.mp3',
      type: 'audio/mpeg',
    })
    expect(all.find((item) => item.id === 'sample-track')?.ownerId).toBe(SAMPLES_OWNER)
    expect(all.find((item) => item.id === 'copy-of-sample-track')?.ownerId).toBe('user-1')
  })

  test('чужую запись сэмплом не считает', async () => {
    // Запись принадлежит пользователю, а не служебному владельцу: взять её
    // через сэмплы нельзя, иначе это обход проверки владельца.
    const { media } = store([{ ...sample, id: 'private', ownerId: 'user-2' }])
    const response = await handle(
      new Request('http://localhost/samples/private', { method: 'POST' }),
      dependencies({ media }),
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'SAMPLE_NOT_FOUND' })
  })

  test('несуществующий сэмпл — 404', async () => {
    const response = await handle(
      new Request('http://localhost/samples/нет-такого', { method: 'POST' }),
      dependencies(),
    )
    expect(response.status).toBe(404)
  })

  test('без поддержки копирования отвечает 503, а не падает', async () => {
    const { media } = store()
    const response = await handle(
      new Request('http://localhost/samples/sample-track', { method: 'POST' }),
      dependencies({ media: { ...media, copy: undefined } }),
    )
    expect(response.status).toBe(503)
  })
})
