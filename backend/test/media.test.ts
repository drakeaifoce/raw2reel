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
    auth: {
      handler: async () => new Response('unused'),
      getSession: async () => ({ user: { id: 'user-1', email: 'editor@example.com' } }),
    },
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
  test('media routes require a server-validated session', async () => {
    const response = await handle(
      new Request('http://localhost/media', { headers: { 'x-user-id': 'forged-user' } }),
      dependencies({
        auth: {
          handler: async () => new Response('unused'),
          getSession: async () => null,
        },
      }),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'UNAUTHORIZED' })
  })

  test('POST /media uploads an allowed file', async () => {
    const form = new FormData()
    form.set('file', new File(['test'], 'clip.mp4', { type: 'video/mp4' }))

    const response = await handle(
      new Request('http://localhost/media', { method: 'POST', body: form }),
      dependencies(),
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(metadata)
  })

  test('POST /media requires a file', async () => {
    const response = await handle(
      new Request('http://localhost/media', { method: 'POST', body: new FormData() }),
      dependencies(),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'FILE_REQUIRED' })
  })

  test('POST /media rejects disallowed content types', async () => {
    const form = new FormData()
    form.set('file', new File(['text'], 'notes.txt', { type: 'text/plain' }))
    const response = await handle(
      new Request('http://localhost/media', { method: 'POST', body: form }),
      dependencies(),
    )
    expect(response.status).toBe(415)
    expect(await response.json()).toMatchObject({ code: 'MEDIA_TYPE_NOT_ALLOWED' })
  })

  test('POST /media rejects files over the configured limit', async () => {
    const form = new FormData()
    form.set('file', new File(['12345'], 'large.png', { type: 'image/png' }))
    const response = await handle(
      new Request('http://localhost/media', { method: 'POST', body: form }),
      dependencies({ maxMediaSizeBytes: 4 }),
    )
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ code: 'FILE_TOO_LARGE' })
  })

  test('GET /media validates and forwards the list limit', async () => {
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
    const response = await handle(new Request('http://localhost/media?limit=7'), deps)
    expect(response.status).toBe(200)
    expect(receivedLimit).toBe(7)
    expect(await response.json()).toEqual({ items: [metadata] })

    const invalid = await handle(new Request('http://localhost/media?limit=101'), deps)
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ code: 'INVALID_LIMIT' })
  })

  test('GET /media/:id streams content with safe browser headers', async () => {
    const response = await handle(new Request('http://localhost/media/media-1'), dependencies())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('content-length')).toBe('4')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect(await response.text()).toBe('test')
  })

  test('GET /media/:id returns 404 for missing media', async () => {
    const deps = dependencies({
      media: { create: async () => metadata, get: async () => null, list: async () => [] },
    })
    const response = await handle(new Request('http://localhost/media/missing'), deps)
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'MEDIA_NOT_FOUND' })
  })

  test('GET /media/:id rejects malformed URL encoding', async () => {
    const response = await handle(new Request('http://localhost/media/%E0%A4%A'), dependencies())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_MEDIA_ID' })
  })
})

test('GET /db/hello writes and reads a MongoDB document', async () => {
  const response = await handle(new Request('http://localhost/db/hello'), dependencies())
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ message: 'hello from MongoDB' })
})
