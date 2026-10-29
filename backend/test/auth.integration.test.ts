import { describe, expect, test } from 'bun:test'
import { memoryAdapter, type MemoryDB } from '@better-auth/memory-adapter'
import { createAuthServiceWithDatabase } from '../src/auth'

const origin = 'http://localhost:5173'
const config = {
  baseUrl: origin,
  secret: 'test-only-secret-with-at-least-32-characters',
  trustedOrigins: [origin],
}

const request = (path: string, init: RequestInit = {}) =>
  new Request(`${origin}/api/auth${path}`, {
    ...init,
    headers: { origin, 'content-type': 'application/json', ...init.headers },
  })

const sessionCookie = (response: Response) => {
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
  expect(cookie).toBeTruthy()
  return cookie!
}

describe('Better Auth lifecycle', () => {
  test('creates a server-verifiable guest session for first-party token binding', async () => {
    const db: MemoryDB = { user: [], session: [], account: [], verification: [], rateLimit: [] }
    const auth = createAuthServiceWithDatabase(memoryAdapter(db), config)

    const issued = await auth.createGuest?.(new Headers({ origin, 'x-forwarded-for': '192.0.2.1' }))

    expect(issued).toMatchObject({ user: { isAnonymous: true } })
    expect(issued?.sessionToken).toBeString()
    expect(
      await auth.getSession(new Headers({ cookie: issued?.sessionCookie ?? '' })),
    ).toMatchObject({ user: { id: issued?.user.id, isAnonymous: true } })
  })

  test('creates isolated anonymous identities and does not expose destructive deletion', async () => {
    const db: MemoryDB = { user: [], session: [], account: [], verification: [], rateLimit: [] }
    const auth = createAuthServiceWithDatabase(memoryAdapter(db), config)

    const first = await auth.handler(request('/sign-in/anonymous', { method: 'POST', body: '{}' }))
    const second = await auth.handler(request('/sign-in/anonymous', { method: 'POST', body: '{}' }))
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    const firstCookie = sessionCookie(first)
    const secondCookie = sessionCookie(second)
    const firstSession = await auth.getSession(new Headers({ cookie: firstCookie }))
    const secondSession = await auth.getSession(new Headers({ cookie: secondCookie }))
    expect(firstSession?.user).toMatchObject({ isAnonymous: true })
    expect(secondSession?.user).toMatchObject({ isAnonymous: true })
    expect(firstSession?.user.id).not.toBe(secondSession?.user.id)

    const repeated = await auth.handler(
      request('/sign-in/anonymous', {
        method: 'POST',
        body: '{}',
        headers: { cookie: firstCookie },
      }),
    )
    expect(repeated.status).toBeGreaterThanOrEqual(400)
    expect((await auth.getSession(new Headers({ cookie: firstCookie })))?.user.id).toBe(
      firstSession?.user.id,
    )

    const deletion = await auth.handler(
      request('/delete-anonymous-user', {
        method: 'POST',
        body: '{}',
        headers: { cookie: firstCookie },
      }),
    )
    expect(deletion.status).toBe(404)
    expect(await auth.getSession(new Headers({ cookie: firstCookie }))).not.toBeNull()
  })

  test('signup, session restore, logout, invalid credentials and origin protection', async () => {
    const db: MemoryDB = { user: [], session: [], account: [], verification: [], rateLimit: [] }
    const auth = createAuthServiceWithDatabase(memoryAdapter(db), config)

    const signup = await auth.handler(
      request('/sign-up/email', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test Editor',
          email: 'editor@example.com',
          password: 'Password1!',
        }),
      }),
    )
    expect(signup.status).toBe(200)
    const cookie = sessionCookie(signup)
    expect(await auth.getSession(new Headers({ cookie }))).toMatchObject({
      user: { email: 'editor@example.com' },
    })

    const invalid = await auth.handler(
      request('/sign-in/email', {
        method: 'POST',
        body: JSON.stringify({ email: 'editor@example.com', password: 'wrong-password' }),
      }),
    )
    expect(invalid.status).toBe(401)

    const foreignOrigin = await auth.handler(
      new Request(`${origin}/api/auth/sign-out`, {
        method: 'POST',
        headers: { origin: 'https://attacker.example', cookie },
      }),
    )
    expect(foreignOrigin.status).toBe(403)

    const logout = await auth.handler(request('/sign-out', { method: 'POST', headers: { cookie } }))
    expect(logout.status).toBe(200)
    expect(await auth.getSession(new Headers({ cookie }))).toBeNull()

    const signin = await auth.handler(
      request('/sign-in/email', {
        method: 'POST',
        body: JSON.stringify({ email: 'editor@example.com', password: 'Password1!' }),
      }),
    )
    expect(signin.status).toBe(200)
    const signedInCookie = sessionCookie(signin)
    expect(await auth.getSession(new Headers({ cookie: signedInCookie }))).toMatchObject({
      user: { email: 'editor@example.com' },
    })

    for (const session of db.session!) session.expiresAt = new Date(0)
    expect(await auth.getSession(new Headers({ cookie: signedInCookie }))).toBeNull()

    const invalidSession = await auth.getSession(
      new Headers({ cookie: 'better-auth.session_token=invalid-or-expired' }),
    )
    expect(invalidSession).toBeNull()
  })
})
