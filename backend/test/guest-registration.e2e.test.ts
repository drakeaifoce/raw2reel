import { describe, expect, test } from 'bun:test'
import { handle, type AuthService } from '../src/app'
import { IdentityService, MemoryIdentityStore } from '../src/identity'
import type { MediaMetadata, MediaRepository } from '../src/media'
import { RegistrationOrchestrator, type RegistrationOperationRepository } from '../src/registration'

class MemoryOperations implements RegistrationOperationRepository {
  operation: Parameters<RegistrationOperationRepository['start']>[0] | undefined
  async start(operation: Parameters<RegistrationOperationRepository['start']>[0]) {
    this.operation ??= operation
    return this.operation
  }
  async advance(
    operationId: string,
    expected: Parameters<RegistrationOperationRepository['advance']>[1],
    update: Parameters<RegistrationOperationRepository['advance']>[2],
  ) {
    if (!this.operation || this.operation._id !== operationId || this.operation.state !== expected)
      return null
    this.operation = { ...this.operation, ...update }
    return this.operation
  }
}

describe('guest registration ownership flow', () => {
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
})
