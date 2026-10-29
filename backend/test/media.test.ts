import { describe, expect, test } from 'bun:test'
import { handle, type AppDependencies } from '../src/app'
import type { MediaMetadata, StoredMedia } from '../src/media'

const metadata: MediaMetadata = {
  id: 'media-1',
  name: 'clip.mp4',
  type: 'video/mp4',
  size: 4,
  blobKey: 'media-1/clip.mp4',
  createdAt: '2026-10-29T00:00:00.000Z',
}

function dependencies(overrides: Partial<AppDependencies> = {}): AppDependencies {
  return {
    media: {
      create: async () => metadata,
      get: async () => ({ metadata, body: new Blob(['test']).stream() }),
      list: async () => [metadata],
    },
    database: { hello: async () => ({ message: 'hello from MongoDB' }) },
    ...overrides,
  }
}

describe('media API', () => {
  test('POST /api/media uploads an allowed file', async () => {
    const form = new FormData()
    form.set('file', new File(['test'], 'clip.mp4', { type: 'video/mp4' }))

    const response = await handle(
      new Request('http://localhost/api/media', { method: 'POST', body: form }),
      dependencies(),
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(metadata)
  })

  test('POST /api/media requires a file', async () => {
    const response = await handle(
      new Request('http://localhost/api/media', { method: 'POST', body: new FormData() }),
      dependencies(),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'FILE_REQUIRED' })
  })

  test('POST /api/media rejects disallowed content types', async () => {
    const form = new FormData()
    form.set('file', new File(['text'], 'notes.txt', { type: 'text/plain' }))
    const response = await handle(
      new Request('http://localhost/api/media', { method: 'POST', body: form }),
      dependencies(),
    )
    expect(response.status).toBe(415)
    expect(await response.json()).toMatchObject({ code: 'MEDIA_TYPE_NOT_ALLOWED' })
  })

  test('POST /api/media rejects files over the configured limit', async () => {
    const form = new FormData()
    form.set('file', new File(['12345'], 'large.png', { type: 'image/png' }))
    const response = await handle(
      new Request('http://localhost/api/media', { method: 'POST', body: form }),
      dependencies({ maxMediaSizeBytes: 4 }),
    )
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ code: 'FILE_TOO_LARGE' })
  })

  test('GET /api/media validates and forwards the list limit', async () => {
    let receivedLimit = 0
    const deps = dependencies({
      media: {
        create: async () => metadata,
        get: async (): Promise<StoredMedia | null> => null,
        list: async (limit) => {
          receivedLimit = limit
          return [metadata]
        },
      },
    })
    const response = await handle(new Request('http://localhost/api/media?limit=7'), deps)
    expect(response.status).toBe(200)
    expect(receivedLimit).toBe(7)
    expect(await response.json()).toEqual({ items: [metadata] })

    const invalid = await handle(new Request('http://localhost/api/media?limit=101'), deps)
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ code: 'INVALID_LIMIT' })
  })

  test('GET /api/media/:id streams content with its media type', async () => {
    const response = await handle(new Request('http://localhost/api/media/media-1'), dependencies())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('content-length')).toBe('4')
    expect(await response.text()).toBe('test')
  })

  test('GET /api/media/:id returns 404 for missing media', async () => {
    const deps = dependencies({
      media: { create: async () => metadata, get: async () => null, list: async () => [] },
    })
    const response = await handle(new Request('http://localhost/api/media/missing'), deps)
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'MEDIA_NOT_FOUND' })
  })

  test('GET /api/media/:id rejects malformed URL encoding', async () => {
    const response = await handle(
      new Request('http://localhost/api/media/%E0%A4%A'),
      dependencies(),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_MEDIA_ID' })
  })
})

test('GET /api/db/hello writes and reads a MongoDB document', async () => {
  const response = await handle(new Request('http://localhost/api/db/hello'), dependencies())
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ message: 'hello from MongoDB' })
})
