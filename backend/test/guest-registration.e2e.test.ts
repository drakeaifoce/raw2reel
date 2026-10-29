import { describe, expect, test } from 'bun:test'
import { memoryAdapter, type MemoryDB } from '@better-auth/memory-adapter'
import { createAuthServiceWithDatabase } from '../src/auth'
import { handle, type AuthService } from '../src/app'
import { IdentityService, MemoryIdentityStore } from '../src/identity'
import type { MediaMetadata, MediaRepository } from '../src/media'
import { RegistrationOrchestrator, type RegistrationOperationRepository } from '../src/registration'

class MemoryOperations implements RegistrationOperationRepository {
  operation: Parameters<RegistrationOperationRepository['start']>[0] | undefined
  failFinalWriteOnce = false
  async start(operation: Parameters<RegistrationOperationRepository['start']>[0]) {
    this.operation ??= operation
    return this.operation
  }
  async advance(
    operationId: string,
    expected: Parameters<RegistrationOperationRepository['advance']>[1],
    update: Parameters<RegistrationOperationRepository['advance']>[2],
  ) {
    if (expected === 'completion-recorded' && this.failFinalWriteOnce) {
      this.failFinalWriteOnce = false
      throw new Error('final operation write failed')
    }
    if (!this.operation || this.operation._id !== operationId || this.operation.state !== expected)
      return null
    this.operation = { ...this.operation, ...update }
    return this.operation
  }
}

describe('guest registration ownership flow', () => {
  test('ordinary web signup returns HTTP 200 with an authenticated session and access token', async () => {
    const origin = 'http://localhost:5173'
    const db: MemoryDB = { user: [], session: [], account: [], verification: [], rateLimit: [] }
    const auth = createAuthServiceWithDatabase(memoryAdapter(db), {
      baseUrl: origin,
      secret: 'test-only-secret-with-at-least-32-characters',
      trustedOrigins: [origin],
    })
    const identity = new IdentityService(new MemoryIdentityStore())
    const unused = async (): Promise<never> => {
      throw new Error('ordinary signup must not access media')
    }
    const media: MediaRepository = {
      create: unused,
      list: unused,
      get: unused,
      transferOwner: unused,
    }
    const registration = new RegistrationOrchestrator(new MemoryOperations(), auth, identity, media)
    const response = await handle(
      new Request(`${origin}/identity/web/sign-up`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Editor',
          email: 'ordinary@example.com',
          password: 'Password1!',
          mode: 'new',
        }),
      }),
      { auth, identity, registration, identityWebOrigins: [origin] },
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      status: string
      accessToken: string
      refreshToken?: string
    }
    expect(body.status).toBe('completed')
    expect(body.refreshToken).toBeUndefined()
    const principal = await identity.authenticateAccess(body.accessToken)
    expect(principal).not.toBeNull()
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';', 1)[0])
      .join('; ')
    const session = await auth.getSession(new Headers({ cookie }))
    expect(session?.user.id).toBe(principal?.userId)
    expect(session?.user.isAnonymous).toBe(false)
  })

  test('keeps uploaded media for the new account and hides it from another owner', async () => {
    const store = new IdentityService(new MemoryIdentityStore())
    const guestSessionToken = 'guest-session-token'
    const guestPair = await store.registerGuest('guest-a', guestSessionToken)
    const records: MediaMetadata[] = []
    const media: MediaRepository = {
      create: async (file, ownerId) => {
        const record = {
          id: 'guest-upload',
          ownerId,
          name: file.name,
          type: file.type,
          size: file.size,
          blobKey: `${ownerId}/guest-upload`,
          createdAt: new Date().toISOString(),
        }
        records.push(record)
        return record
      },
      list: async (_limit, ownerId) => records.filter((record) => record.ownerId === ownerId),
      get: async (id, ownerId) => {
        const record = records.find((item) => item.id === id && item.ownerId === ownerId)
        return record ? { metadata: record, body: new Blob(['guest-video']).stream() } : null
      },
      transferOwner: async (from, to) => {
        let transferred = 0
        for (const record of records) {
          if (record.ownerId === from) {
            record.ownerId = to
            transferred += 1
          }
        }
        return transferred
      },
    }
    let currentUser = {
      id: 'guest-a',
      isAnonymous: true,
      sessionToken: guestSessionToken,
    }
    const auth: AuthService = {
      handler: async () => new Response('unused'),
      getSession: async () => ({
        user: { id: currentUser.id, isAnonymous: currentUser.isAnonymous },
        sessionToken: currentUser.sessionToken,
      }),
      signUpEmail: async () => ({
        user: { id: 'registered-c', isAnonymous: false },
        sessionToken: 'registered-session-token',
        sessionCookie: 'better-auth.session_token=registered; HttpOnly; Path=/',
      }),
      signInEmail: async () => null,
    }
    const registration = new RegistrationOrchestrator(new MemoryOperations(), auth, store, media)

    const upload = new FormData()
    upload.set('file', new File(['guest-video'], 'clip.mp4', { type: 'video/mp4' }))
    expect(
      (
        await handle(new Request('http://localhost/media', { method: 'POST', body: upload }), {
          auth,
          identity: store,
          media,
        })
      ).status,
    ).toBe(201)

    const csrf = await store.refreshCsrfToken(guestPair.refreshToken)
    const signup = await handle(
      new Request('http://localhost/identity/web/sign-up', {
        method: 'POST',
        headers: {
          origin: 'https://raw2reel.studio',
          cookie: `__Host-r2r-refresh=${guestPair.refreshToken}`,
          'content-type': 'application/json',
          'x-csrf-token': csrf!,
        },
        body: JSON.stringify({
          email: 'new@example.com',
          password: 'Password1!',
          name: 'Editor',
          mode: 'upgrade',
        }),
      }),
      {
        auth,
        identity: store,
        media,
        registration,
        identityWebOrigins: ['https://raw2reel.studio'],
      },
    )
    expect(signup.status).toBe(200)

    currentUser = {
      id: 'registered-c',
      isAnonymous: false,
      sessionToken: 'registered-session-token',
    }
    const ownList = await handle(new Request('http://localhost/media'), {
      auth,
      identity: store,
      media,
    })
    expect(await ownList.json()).toMatchObject({ items: [{ id: 'guest-upload' }] })
    expect(
      (
        await handle(new Request('http://localhost/media/guest-upload'), {
          auth,
          identity: store,
          media,
        })
      ).status,
    ).toBe(200)

    const otherPair = await store.registerRegistered('registered-other', 'other-session')
    expect(otherPair.user.id).toBe('registered-other')
    currentUser = { id: 'registered-other', isAnonymous: false, sessionToken: 'other-session' }
    expect(
      (
        await handle(new Request('http://localhost/media/guest-upload'), {
          auth,
          identity: store,
          media,
        })
      ).status,
    ).toBe(404)
  })

  test('recovers final-write failure and a lost response through web transport', async () => {
    const identity = new IdentityService(new MemoryIdentityStore())
    const guestPair = await identity.registerGuest('guest-recovery', 'guest-session')
    const operations = new MemoryOperations()
    operations.failFinalWriteOnce = true
    const records: MediaMetadata[] = [
      {
        id: 'recovery-upload',
        ownerId: 'guest-recovery',
        name: 'clip.mp4',
        type: 'video/mp4',
        size: 11,
        blobKey: 'guest-recovery/recovery-upload',
        createdAt: new Date().toISOString(),
      },
    ]
    const media: MediaRepository = {
      create: async () => ({}) as never,
      list: async (_limit, ownerId) => records.filter((record) => record.ownerId === ownerId),
      get: async (id, ownerId) => {
        const record = records.find((item) => item.id === id && item.ownerId === ownerId)
        return record ? { metadata: record, body: new Blob(['guest-video']).stream() } : null
      },
      transferOwner: async (from, to) => {
        for (const record of records) if (record.ownerId === from) record.ownerId = to
        return 1
      },
    }
    let currentUser = { id: 'registered-recovery', sessionToken: 'registered-session' }
    const registeredSession = {
      user: { id: 'registered-recovery', isAnonymous: false as const },
      sessionToken: 'registered-session',
      sessionCookie: 'better-auth.session_token=registered; HttpOnly; Path=/',
    }
    const auth: AuthService = {
      handler: async () => new Response('unused'),
      getSession: async () => ({
        user: { id: currentUser.id, isAnonymous: false },
        sessionToken: currentUser.sessionToken,
      }),
      signUpEmail: async () => registeredSession,
      signInEmail: async () => registeredSession,
    }
    const registration = new RegistrationOrchestrator(operations, auth, identity, media)
    const origin = 'https://raw2reel.studio'
    const cookie = `__Host-r2r-refresh=${guestPair.refreshToken}`
    const request = (csrfToken: string) =>
      new Request('http://localhost/identity/web/sign-up', {
        method: 'POST',
        headers: {
          origin,
          cookie,
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          email: 'recovery@example.com',
          password: 'Password1!',
          name: 'Recovery Editor',
          mode: 'upgrade',
        }),
      })
    const dependencies = {
      auth,
      identity,
      media,
      registration,
      identityWebOrigins: [origin],
    }

    const initialCsrf = await handle(
      new Request('http://localhost/identity/web/csrf', {
        method: 'POST',
        headers: { origin, cookie, 'content-type': 'application/json' },
        body: '{}',
      }),
      dependencies,
    )
    expect(initialCsrf.status).toBe(200)
    const initialCsrfToken = ((await initialCsrf.json()) as { csrfToken: string }).csrfToken

    await expect(handle(request(initialCsrfToken), dependencies)).rejects.toThrow(
      'final operation write failed',
    )
    expect(operations.operation?.state).toBe('completion-recorded')
    expect(await identity.authenticateAccess(guestPair.accessToken)).toBeNull()

    // A reloaded client does not retain the old CSRF token. It must be able to
    // bootstrap a fresh, recovery-only token with the invalidated guest family.
    const recoveryCsrf = await handle(
      new Request('http://localhost/identity/web/csrf', {
        method: 'POST',
        headers: { origin, cookie, 'content-type': 'application/json' },
        body: '{}',
      }),
      dependencies,
    )
    expect(recoveryCsrf.status).toBe(200)
    const recoveryCsrfToken = ((await recoveryCsrf.json()) as { csrfToken: string }).csrfToken

    const recovered = await handle(request(recoveryCsrfToken), dependencies)
    expect(recovered.status).toBe(200)
    expect(recovered.headers.getSetCookie()).toHaveLength(2)
    expect(operations.operation?.state).toBe('completed')
    expect(await recovered.json()).toMatchObject({
      accessToken: expect.any(String),
      user: { id: 'registered-recovery', isAnonymous: false },
    })

    // A completed request whose response was lost is recoverable with the same
    // operation proof and returns a fresh registered handoff.
    const lostResponseCsrf = await handle(
      new Request('http://localhost/identity/web/csrf', {
        method: 'POST',
        headers: { origin, cookie, 'content-type': 'application/json' },
        body: '{}',
      }),
      dependencies,
    )
    expect(lostResponseCsrf.status).toBe(200)
    const lostResponseCsrfToken = ((await lostResponseCsrf.json()) as { csrfToken: string })
      .csrfToken
    const lostResponseRetry = await handle(request(lostResponseCsrfToken), dependencies)
    expect(lostResponseRetry.status).toBe(200)
    expect(operations.operation?.state).toBe('completed')

    await identity.registerRegistered('registered-foreign', 'foreign-session')
    currentUser = { id: 'registered-foreign', sessionToken: 'foreign-session' }
    expect(
      (await handle(new Request('http://localhost/media/recovery-upload'), dependencies)).status,
    ).toBe(404)
  })
})
