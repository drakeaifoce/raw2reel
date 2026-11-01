import { describe, expect, test } from 'bun:test'
import { memoryAdapter, type MemoryDB } from '@better-auth/memory-adapter'
import { createAuthServiceWithDatabase } from '../src/auth'
import { handle, requireSession } from '../src/app'
import { IdentityService, MemoryIdentityStore } from '../src/identity'

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
  test('registered web entry can authorize, reload through refresh, and logout', async () => {
    const db: MemoryDB = { user: [], session: [], account: [], verification: [], rateLimit: [] }
    const auth = createAuthServiceWithDatabase(memoryAdapter(db), config)
    const identity = new IdentityService(new MemoryIdentityStore())
    const dependencies = { auth, identity, identityWebOrigins: [origin] }

    const signup = await auth.handler(
      request('/sign-up/email', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Registered Editor',
          email: 'registered@example.com',
          password: 'Password1!',
        }),
      }),
    )
    const setupCookie = sessionCookie(signup)
    await auth.handler(request('/sign-out', { method: 'POST', headers: { cookie: setupCookie } }))

    const entered = await handle(
      new Request(`${origin}/identity/web/sign-in`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'registered@example.com', password: 'Password1!' }),
      }),
      dependencies,
    )
    expect(entered.status).toBe(200)
    const enteredCookies = entered.headers
      .getSetCookie()
      .map((value) => value.split(';', 1)[0])
      .filter((value): value is string => value !== undefined)
    const authCookie = enteredCookies.find((value) => !value.startsWith('__Host-r2r-refresh='))!
    const refreshCookie = enteredCookies.find((value) => value.startsWith('__Host-r2r-refresh='))!
    const authorized = await requireSession(
      new Request(`${origin}/media`, { headers: { cookie: enteredCookies.join('; ') } }),
      auth,
      identity,
    )
    expect(authorized).not.toBeInstanceOf(Response)

    const csrf = await handle(
      new Request(`${origin}/identity/web/csrf`, {
        method: 'POST',
        headers: { origin, cookie: refreshCookie, 'content-type': 'application/json' },
        body: '{}',
      }),
      dependencies,
    )
    expect(csrf.status).toBe(200)
    const csrfToken = ((await csrf.json()) as { csrfToken: string }).csrfToken
    const refreshed = await handle(
      new Request(`${origin}/identity/web/refresh`, {
        method: 'POST',
        headers: {
          origin,
          cookie: refreshCookie,
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: '{}',
      }),
      dependencies,
    )
    expect(refreshed.status).toBe(200)
    const rotatedRefresh = refreshed.headers.get('set-cookie')!.split(';', 1)[0]!

    const logoutCsrf = await handle(
      new Request(`${origin}/identity/web/csrf`, {
        method: 'POST',
        headers: { origin, cookie: rotatedRefresh, 'content-type': 'application/json' },
        body: '{}',
      }),
      dependencies,
    )
    const logoutCsrfToken = ((await logoutCsrf.json()) as { csrfToken: string }).csrfToken
    const logout = await handle(
      new Request(`${origin}/identity/web/logout`, {
        method: 'POST',
        headers: {
          origin,
          cookie: `${authCookie}; ${rotatedRefresh}`,
          'content-type': 'application/json',
          'x-csrf-token': logoutCsrfToken,
        },
        body: '{}',
      }),
      dependencies,
    )
    expect(logout.status).toBe(204)
    expect(await auth.getSession(new Headers({ cookie: authCookie }))).toBeNull()
  })

  test('routes guest issuance and logout through the identity lifecycle', async () => {
    const db: MemoryDB = { user: [], session: [], account: [], verification: [], rateLimit: [] }
    const auth = createAuthServiceWithDatabase(memoryAdapter(db), config)
    const identity = new IdentityService(new MemoryIdentityStore())

    const rawGuest = await handle(
      new Request(`${origin}/auth/sign-in/anonymous`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: '{}',
      }),
      { auth, identity, identityWebOrigins: [origin] },
    )
    expect(rawGuest.status).toBe(409)

    const issued = await handle(
      new Request(`${origin}/identity/web/guest`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: '{}',
      }),
      { auth, identity, identityWebOrigins: [origin] },
    )
    expect(issued.status).toBe(201)
    const body = (await issued.json()) as { accessToken: string }
    const cookies = issued.headers
      .getSetCookie()
      .map((value) => value.split(';', 1)[0])
      .join('; ')
    expect(await identity.authenticateAccess(body.accessToken)).not.toBeNull()

    const rawLogout = await handle(
      new Request(`${origin}/auth/sign-out`, {
        method: 'POST',
        headers: { origin, cookie: cookies },
      }),
      { auth, identity, identityWebOrigins: [origin] },
    )
    expect(rawLogout.status).toBe(200)
    expect(await identity.authenticateAccess(body.accessToken)).toBeNull()
    expect(await auth.getSession(new Headers({ cookie: cookies }))).toBeNull()
  })

  test('revoke-all invalidates access, refresh, and cookie authorization together', async () => {
    const db: MemoryDB = { user: [], session: [], account: [], verification: [], rateLimit: [] }
    const auth = createAuthServiceWithDatabase(memoryAdapter(db), config)
    const identity = new IdentityService(new MemoryIdentityStore())
    const issued = await handle(
      new Request(`${origin}/identity/web/guest`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: '{}',
      }),
      { auth, identity, identityWebOrigins: [origin] },
    )
    const body = (await issued.json()) as { accessToken: string }
    const setCookies = issued.headers.getSetCookie()
    const cookies = setCookies.map((value) => value.split(';', 1)[0]).join('; ')
    const refreshToken = setCookies
      .find((value) => value.startsWith('__Host-r2r-refresh='))!
      .split(';', 1)[0]!
      .split('=', 2)[1]!

    const revoked = await handle(
      new Request(`${origin}/identity/revoke-all`, {
        method: 'POST',
        headers: { authorization: `Bearer ${body.accessToken}` },
      }),
      { auth, identity },
    )
    expect(revoked.status).toBe(204)
    expect(await identity.authenticateAccess(body.accessToken)).toBeNull()
    expect(await identity.refresh(refreshToken)).toBeNull()
    expect(
      await requireSession(
        new Request(`${origin}/media`, { headers: { cookie: cookies } }),
        auth,
        identity,
      ),
    ).toBeInstanceOf(Response)
  })

  test('creates a server-verifiable guest session for first-party token binding', async () => {
    const db: MemoryDB = { user: [], session: [], account: [], verification: [], rateLimit: [] }
    const auth = createAuthServiceWithDatabase(memoryAdapter(db), config)

    const attempt = await auth.createGuest?.(
      new Headers({ origin, 'x-forwarded-for': '192.0.2.1' }),
    )

    expect(attempt).toMatchObject({ status: 'created' })
    const issued = attempt?.status === 'created' ? attempt.session : undefined
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
    // Better Auth 1.7.14 keeps the route but rejects it when deletion is
    // disabled. The security contract is fail-closed, not route absence.
    expect(deletion.status).toBe(400)
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
