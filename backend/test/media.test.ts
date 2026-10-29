import { describe, expect, test } from 'bun:test'
import { handle, type AppDependencies } from '../src/app'
import { MediaService, type MediaMetadata, type StoredMedia } from '../src/media'

const metadata: MediaMetadata = {
  id: 'media-1',
  ownerId: 'user-1',
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
    let receivedOwner = ''
    const form = new FormData()
    form.set('file', new File(['test'], 'clip.mp4', { type: 'video/mp4' }))
    form.set('ownerId', 'attacker-selected')

    const response = await handle(
      new Request('http://localhost/media', { method: 'POST', body: form }),
      dependencies({
        media: {
          create: async (_file, ownerId) => {
            receivedOwner = ownerId
            return metadata
          },
          get: async () => null,
          list: async () => [],
        },
      }),
    )

    expect(response.status).toBe(201)
    expect(receivedOwner).toBe('user-1')
    expect(await response.json()).toEqual({
      id: metadata.id,
      name: metadata.name,
      type: metadata.type,
      size: metadata.size,
      createdAt: metadata.createdAt,
    })
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
        list: async (limit, ownerId) => {
          receivedLimit = limit
          expect(ownerId).toBe('user-1')
          return [metadata]
        },
      },
    })
    const response = await handle(new Request('http://localhost/media?limit=7'), deps)
    expect(response.status).toBe(200)
    expect(receivedLimit).toBe(7)
    expect(await response.json()).toEqual({
      items: [
        {
          id: metadata.id,
          name: metadata.name,
          type: metadata.type,
          size: metadata.size,
          createdAt: metadata.createdAt,
        },
      ],
    })

    const invalid = await handle(new Request('http://localhost/media?limit=101'), deps)
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ code: 'INVALID_LIMIT' })
  })

  test('GET /media/:id streams content with safe browser headers', async () => {
    let receivedOwner = ''
    const response = await handle(
      new Request('http://localhost/media/media-1'),
      dependencies({
        media: {
          create: async () => metadata,
          get: async (_id, ownerId) => {
            receivedOwner = ownerId
            return { metadata, body: new Blob(['test']).stream() }
          },
          list: async () => [],
        },
      }),
    )
    expect(response.status).toBe(200)
    expect(receivedOwner).toBe('user-1')
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

  test('accepts a valid API access token and isolates it from another owner', async () => {
    let blobLookups = 0
    const response = await handle(
      new Request('http://localhost/media/media-1', {
        headers: { authorization: 'Bearer owner-b-access' },
      }),
      dependencies({
        auth: undefined,
        identity: {
          authenticateAccess: async () => ({
            userId: 'user-2',
            isAnonymous: true,
            familyId: 'family-2',
          }),
        } as unknown as AppDependencies['identity'],
        media: {
          create: async () => metadata,
          get: async (_id, ownerId) => {
            expect(ownerId).toBe('user-2')
            blobLookups += 1
            return null
          },
          list: async () => [],
        },
      }),
    )

    expect(response.status).toBe(404)
    expect(blobLookups).toBe(1)
  })

  test('rejects mixed cookie and bearer media credentials before storage access', async () => {
    let storageCalls = 0
    const response = await handle(
      new Request('http://localhost/media', {
        headers: { authorization: 'Bearer access', cookie: 'session=opaque' },
      }),
      dependencies({
        media: {
          create: async () => {
            storageCalls += 1
            return metadata
          },
          get: async () => null,
          list: async () => {
            storageCalls += 1
            return []
          },
        },
      }),
    )

    expect(response.status).toBe(400)
    expect(storageCalls).toBe(0)
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

describe('media repository ownership boundary', () => {
  test('checks owner metadata before performing any Blob lookup', async () => {
    let blobLookups = 0
    const collection = {
      createIndex: async () => 'index',
      findOne: async (filter: unknown) => {
        expect(filter).toEqual({ id: 'media-1', ownerId: 'user-2' })
        return null
      },
    }
    const container = {
      getBlobClient: () => {
        blobLookups += 1
        throw new Error('must not read Blob for foreign or ownerless metadata')
      },
    }
    const repository = new MediaService(collection as never, container as never)

    expect(await repository.get('media-1', 'user-2')).toBeNull()
    expect(blobLookups).toBe(0)
  })

  test('filters lists by owner so legacy ownerless records remain hidden', async () => {
    let filter: unknown
    const cursor = {
      sort: () => cursor,
      limit: () => cursor,
      toArray: async () => [metadata],
    }
    const collection = {
      createIndex: async () => 'index',
      find: (received: unknown) => {
        filter = received
        return cursor
      },
    }
    const repository = new MediaService(collection as never, {} as never)

    expect(await repository.list(20, 'user-1')).toEqual([metadata])
    expect(filter).toEqual({ ownerId: 'user-1' })
  })
})
