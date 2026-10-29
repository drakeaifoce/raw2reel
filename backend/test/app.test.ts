import { describe, expect, test } from 'bun:test'
import { handle, type AppDependencies } from '../src/app'
import { config } from '../src/config'
import { IdentityService, MemoryIdentityStore } from '../src/identity'

const get = (path: string) => handle(new Request(`http://localhost${path}`))

const authenticated = (overrides: Partial<AppDependencies> = {}): AppDependencies => ({
  auth: {
    handler: async () => new Response('auth response'),
    getSession: async () => ({ user: { id: 'user-1', email: 'editor@example.com' } }),
  },
  ...overrides,
})

describe('маршруты', () => {
  test('/health отвечает всегда и не зависит от зависимостей', async () => {
    const response = await get('/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  test('/version отдаёт версию образа', async () => {
    const response = await get('/version')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ service: 'backend', version: config.version })
  })

  test('без GIT_SHA версия это dev', () => {
    // В образе значение приходит из --build-arg GIT_SHA; локально его нет
    expect(config.version).toBe(process.env.GIT_SHA ?? 'dev')
  })

  test('ответы закрыты от кеширования', async () => {
    for (const path of ['/health', '/version', '/ready']) {
      const response = await get(path)
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  })

  test('неизвестный путь это 404 с указанием пути', async () => {
    const response = await get('/no-such-path')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not found', path: '/no-such-path' })
  })

  test('передаёт публичный /api/auth путь в Better Auth после strip_prefix Caddy', async () => {
    let delegatedPath = ''
    const response = await handle(
      new Request('https://raw2reel.studio/auth/sign-in/email', { method: 'POST' }),
      authenticated({
        auth: {
          handler: async (request) => {
            delegatedPath = new URL(request.url).pathname
            return new Response('ok')
          },
          getSession: async () => null,
        },
      }),
    )

    expect(response.status).toBe(200)
    expect(delegatedPath).toBe('/api/auth/sign-in/email')
  })

  test('защищённый маршрут отклоняет отсутствующую и поддельную identity', async () => {
    const response = await handle(
      new Request('http://localhost/db/hello', { headers: { 'x-user-id': 'forged-user' } }),
      authenticated({
        auth: {
          handler: async () => new Response('unused'),
          getSession: async () => null,
        },
        database: { hello: async () => ({ message: 'must not run' }) },
      }),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: 'authentication required',
      code: 'UNAUTHORIZED',
    })
  })

  test('защищённый маршрут доверяет серверной сессии', async () => {
    const response = await handle(
      new Request('http://localhost/db/hello'),
      authenticated({ database: { hello: async () => ({ message: 'hello from MongoDB' }) } }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ message: 'hello from MongoDB' })
  })

  test('путь отдаётся как пришёл, то есть процентно-кодированным', async () => {
    // URL.pathname не декодирует, и ответ это не скрывает: в логах отладки
    // важнее видеть ровно то, что прислал клиент.
    const response = await get('/нет-такого')
    const body = (await response.json()) as { path: string }
    expect(body.path).toBe('/%D0%BD%D0%B5%D1%82-%D1%82%D0%B0%D0%BA%D0%BE%D0%B3%D0%BE')
    expect(decodeURIComponent(body.path)).toBe('/нет-такого')
  })
})

describe('/ready', () => {
  test('без настроенных зависимостей отвечает 200', async () => {
    const response = await get('/ready')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ready: boolean }
    expect(body.ready).toBe(true)
  })
})

describe('/identity/api transport boundary', () => {
  const identityFixture = async () => {
    const identity = new IdentityService(new MemoryIdentityStore(), {
      randomToken: (() => {
        let sequence = 0
        return () => `credential-${++sequence}-${'x'.repeat(40)}`
      })(),
    })
    return { identity, pair: await identity.registerGuest('guest-1') }
  }

  test('rotates API refresh credentials without accepting browser transport', async () => {
    const { identity, pair } = await identityFixture()
    const response = await handle(
      new Request('http://localhost/identity/api/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: pair.refreshToken }),
      }),
      { identity },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
    const body = (await response.json()) as { refreshToken: string }
    expect(body.refreshToken).not.toBe(pair.refreshToken)

    for (const headers of [{ origin: 'https://raw2reel.studio' }, { cookie: 'session=x' }]) {
      const requestHeaders = new Headers({ 'content-type': 'application/json' })
      if (headers.origin) requestHeaders.set('origin', headers.origin)
      if (headers.cookie) requestHeaders.set('cookie', headers.cookie)
      const rejected = await handle(
        new Request('http://localhost/identity/api/refresh', {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify({ refreshToken: body.refreshToken }),
        }),
        { identity },
      )
      expect(rejected.status).toBe(headers.origin ? 403 : 400)
    }
  })

  test('requires access bearer for activity and revoke-all', async () => {
    const { identity, pair } = await identityFixture()
    const activity = await handle(
      new Request('http://localhost/identity/activity', {
        method: 'POST',
        headers: { authorization: `Bearer ${pair.accessToken}` },
      }),
      { identity },
    )
    expect(activity.status).toBe(204)

    const revoked = await handle(
      new Request('http://localhost/identity/revoke-all', {
        method: 'POST',
        headers: { authorization: `Bearer ${pair.accessToken}` },
      }),
      { identity },
    )
    expect(revoked.status).toBe(204)

    const afterRevoke = await handle(
      new Request('http://localhost/identity/activity', {
        method: 'POST',
        headers: { authorization: `Bearer ${pair.accessToken}` },
      }),
      { identity },
    )
    expect(afterRevoke.status).toBe(401)
  })
})

describe('/identity guest entry', () => {
  const guestAuth = (existing = false) => ({
    handler: async () => new Response('unused'),
    getSession: async () =>
      existing ? { user: { id: 'existing-guest', isAnonymous: true } } : null,
    createGuest: async () => ({
      user: { id: 'guest-issued', isAnonymous: true as const },
      sessionToken: 'better-auth-session-secret',
      sessionCookie: 'better-auth.session_token=opaque; HttpOnly; SameSite=Lax; Path=/',
    }),
  })

  test('issues an API pair from a server-created anonymous Better Auth session', async () => {
    const identity = new IdentityService(new MemoryIdentityStore())
    const response = await handle(
      new Request('http://localhost/identity/api/guest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      { auth: guestAuth(), identity },
    )

    expect(response.status).toBe(201)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await response.json()).toMatchObject({
      tokenType: 'Bearer',
      user: { id: 'guest-issued', isAnonymous: true },
    })
  })

  test('uses HttpOnly refresh transport for web and rejects an existing session', async () => {
    const origin = 'https://raw2reel.studio'
    const identity = new IdentityService(new MemoryIdentityStore())
    const response = await handle(
      new Request('http://localhost/identity/web/guest', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: '{}',
      }),
      { auth: guestAuth(), identity, identityWebOrigins: [origin] },
    )

    expect(response.status).toBe(201)
    expect(response.headers.get('set-cookie')).toContain('__Host-r2r-refresh=')
    expect(await response.json()).toMatchObject({
      refreshTransport: 'cookie',
      user: { id: 'guest-issued', isAnonymous: true },
    })

    const conflict = await handle(
      new Request('http://localhost/identity/web/guest', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: '{}',
      }),
      { auth: guestAuth(true), identity, identityWebOrigins: [origin] },
    )
    expect(conflict.status).toBe(409)
  })
})

describe('/identity registered sign-in and logout', () => {
  const origin = 'https://raw2reel.studio'
  const registeredAuth = {
    handler: async () => new Response('unused'),
    getSession: async () => null,
    signInEmail: async () => ({
      user: { id: 'registered-user', isAnonymous: false as const },
      sessionToken: 'better-auth-registered-session',
      sessionCookie: 'better-auth.session_token=registered; HttpOnly; SameSite=Lax; Path=/',
    }),
    signOut: async () => new Response(null, { status: 204 }),
  }

  test('issues registered API credentials without exposing a Better Auth cookie', async () => {
    const identity = new IdentityService(new MemoryIdentityStore())
    const response = await handle(
      new Request('http://localhost/identity/api/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com', password: 'Password1!' }),
      }),
      { auth: registeredAuth, identity },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await response.json()).toMatchObject({
      tokenType: 'Bearer',
      user: { id: 'registered-user', isAnonymous: false },
    })
  })

  test('uses cookie transport for web sign-in and revokes it on CSRF-protected logout', async () => {
    const identity = new IdentityService(new MemoryIdentityStore())
    const signIn = await handle(
      new Request('http://localhost/identity/web/sign-in', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com', password: 'Password1!' }),
      }),
      { auth: registeredAuth, identity, identityWebOrigins: [origin] },
    )
    expect(signIn.status).toBe(200)
    expect(signIn.headers.get('set-cookie')).toContain('__Host-r2r-refresh=')
    const refreshCookie = signIn.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('__Host-r2r-refresh='))!
      .split(';', 1)[0]!
    const refreshToken = refreshCookie.split('=', 2)[1]!
    const csrf = await identity.refreshCsrfToken(refreshToken)

    const logout = await handle(
      new Request('http://localhost/identity/web/logout', {
        method: 'POST',
        headers: {
          origin,
          cookie: `${refreshCookie}; better-auth.session_token=registered`,
          'content-type': 'application/json',
          'x-csrf-token': csrf!,
        },
        body: '{}',
      }),
      { auth: registeredAuth, identity, identityWebOrigins: [origin] },
    )
    expect(logout.status).toBe(204)
    expect(logout.headers.get('set-cookie')).toContain('__Host-r2r-refresh=;')
    expect(await identity.refresh(refreshToken)).toBeNull()
  })

  test('keeps web refresh usable when Better Auth sign-out transiently fails', async () => {
    const identity = new IdentityService(new MemoryIdentityStore())
    const pair = await identity.registerRegistered(
      'registered-user',
      'better-auth-registered-session',
    )
    const csrf = await identity.refreshCsrfToken(pair.refreshToken)
    let attempts = 0
    const auth = {
      ...registeredAuth,
      signOut: async () => new Response(null, { status: ++attempts === 1 ? 503 : 204 }),
    }
    const makeRequest = () =>
      new Request('http://localhost/identity/web/logout', {
        method: 'POST',
        headers: {
          origin,
          cookie: `__Host-r2r-refresh=${pair.refreshToken}`,
          'content-type': 'application/json',
          'x-csrf-token': csrf!,
        },
        body: '{}',
      })

    expect(
      (await handle(makeRequest(), { auth, identity, identityWebOrigins: [origin] })).status,
    ).toBe(503)
    expect(await identity.refreshCsrfToken(pair.refreshToken)).not.toBeNull()
    expect(
      (await handle(makeRequest(), { auth, identity, identityWebOrigins: [origin] })).status,
    ).toBe(204)
    expect(await identity.refresh(pair.refreshToken)).toBeNull()
  })

  test('revokes an API family using only its refresh credential', async () => {
    const identity = new IdentityService(new MemoryIdentityStore())
    const pair = await identity.registerRegistered(
      'registered-user',
      'better-auth-registered-session',
    )
    const response = await handle(
      new Request('http://localhost/identity/api/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: pair.refreshToken }),
      }),
      { identity },
    )
    expect(response.status).toBe(204)
    expect(await identity.refresh(pair.refreshToken)).toBeNull()
  })
})

describe('/identity/web refresh transport', () => {
  const origin = 'https://raw2reel.studio'
  const identityFixture = async () => {
    const identity = new IdentityService(new MemoryIdentityStore(), {
      randomToken: (() => {
        let sequence = 0
        return () => `web-credential-${++sequence}-${'x'.repeat(40)}`
      })(),
    })
    return { identity, pair: await identity.registerGuest('guest-web') }
  }

  test('bootstraps family-bound CSRF and rotates an HttpOnly refresh cookie', async () => {
    const { identity, pair } = await identityFixture()
    const dependencies = { identity, identityWebOrigins: [origin] }
    const cookie = `__Host-r2r-refresh=${pair.refreshToken}`

    const bootstrap = await handle(
      new Request('http://localhost/identity/web/csrf', {
        method: 'POST',
        headers: { cookie, origin, 'content-type': 'application/json' },
        body: '{}',
      }),
      dependencies,
    )
    expect(bootstrap.status).toBe(200)
    const { csrfToken } = (await bootstrap.json()) as { csrfToken: string }
    expect(csrfToken).toBeString()

    const refreshed = await handle(
      new Request('http://localhost/identity/web/refresh', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
          origin,
          'x-csrf-token': csrfToken,
        },
        body: '{}',
      }),
      dependencies,
    )
    expect(refreshed.status).toBe(200)
    expect(refreshed.headers.get('cache-control')).toBe('no-store')
    expect(refreshed.headers.get('set-cookie')).toContain('__Host-r2r-refresh=web-credential-')
    expect(refreshed.headers.get('set-cookie')).toContain('HttpOnly')
    expect(refreshed.headers.get('set-cookie')).toContain('Secure')
    expect(refreshed.headers.get('set-cookie')).toContain('SameSite=Lax')
    expect(refreshed.headers.get('set-cookie')).toContain('Path=/')
    expect(refreshed.headers.get('set-cookie')).not.toContain('Domain=')
    const body = (await refreshed.json()) as Record<string, unknown>
    expect(body.refreshToken).toBeUndefined()
    expect(body.refreshTransport).toBe('cookie')
    expect(body.accessToken).toBeString()

    const replay = await handle(
      new Request('http://localhost/identity/web/refresh', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
          origin,
          'x-csrf-token': csrfToken,
        },
        body: '{}',
      }),
      dependencies,
    )
    expect(replay.status).toBe(401)

    const rotatedCookie = refreshed.headers.get('set-cookie')!.split(';', 1)[0]!
    const revokedFamily = await handle(
      new Request('http://localhost/identity/web/csrf', {
        method: 'POST',
        headers: { cookie: rotatedCookie, origin, 'content-type': 'application/json' },
        body: '{}',
      }),
      dependencies,
    )
    expect(revokedFamily.status).toBe(401)
  })

  test('rejects browser-style GET bootstrap without relying on an Origin header', async () => {
    const { identity, pair } = await identityFixture()
    const response = await handle(
      new Request('http://localhost/identity/web/csrf', {
        headers: { cookie: `__Host-r2r-refresh=${pair.refreshToken}` },
      }),
      { identity, identityWebOrigins: [origin] },
    )
    expect(response.status).toBe(404)
  })

  test('rejects missing or untrusted origin, invalid CSRF, and malformed web bodies', async () => {
    const { identity, pair } = await identityFixture()
    const dependencies = { identity, identityWebOrigins: [origin] }
    const cookie = `__Host-r2r-refresh=${pair.refreshToken}`
    const attempts: { headers: Record<string, string>; body: string }[] = [
      { headers: { cookie, 'content-type': 'application/json' }, body: '{}' },
      {
        headers: { cookie, origin: 'https://evil.example', 'content-type': 'application/json' },
        body: '{}',
      },
      {
        headers: { cookie, origin, 'content-type': 'application/json', 'x-csrf-token': 'wrong' },
        body: '{}',
      },
      {
        headers: { cookie, origin, 'content-type': 'application/json', 'x-csrf-token': 'wrong' },
        body: '{"unexpected":true}',
      },
    ]

    for (const attempt of attempts) {
      const response = await handle(
        new Request('http://localhost/identity/web/refresh', {
          method: 'POST',
          headers: attempt.headers,
          body: attempt.body,
        }),
        dependencies,
      )
      expect(response.status).toBe(attempt === attempts[3] ? 400 : 403)
      expect(response.headers.get('set-cookie')).toBeNull()
    }
  })
})

describe('/identity sign-up transport', () => {
  const origin = 'https://raw2reel.studio'
  const credentials = {
    email: 'guest@example.com',
    password: 'Password1!',
    name: 'Guest Editor',
    mode: 'upgrade' as const,
  }
  const completedRegistration = () => ({
    status: 'completed' as const,
    session: {
      user: { id: 'registered-signup', isAnonymous: false as const },
      sessionToken: 'registered-session',
      sessionCookie: 'better-auth.session_token=registered; HttpOnly; Path=/',
    },
    tokens: {
      accessToken: 'registered-access',
      refreshToken: 'registered-refresh',
      familyId: 'registered-family',
      expiresIn: 900,
      refreshExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      tokenType: 'Bearer' as const,
      user: { id: 'registered-signup', isAnonymous: false },
    },
  })

  const identityFixture = async () => {
    const identity = new IdentityService(new MemoryIdentityStore(), {
      randomToken: (() => {
        let sequence = 0
        return () => `signup-credential-${++sequence}-${'x'.repeat(40)}`
      })(),
    })
    return { identity, pair: await identity.registerGuest('guest-signup') }
  }

  test('claims an API guest upgrade before invoking durable registration', async () => {
    const { identity, pair } = await identityFixture()
    let received: Record<string, unknown> | undefined
    const response = await handle(
      new Request('http://localhost/identity/api/sign-up', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${pair.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(credentials),
      }),
      {
        identity,
        registration: {
          signUp: async (input) => {
            received = input
            return completedRegistration()
          },
        },
      },
    )

    expect(response.status).toBe(200)
    expect(received).toMatchObject({
      email: credentials.email,
      name: credentials.name,
      mode: 'upgrade',
      guest: { userId: 'guest-signup', familyId: pair.familyId },
    })
    expect(received?.password).toBe(credentials.password)
    expect(received?.operationId).toBeString()
    expect(await identity.authenticateAccess(pair.accessToken)).toBeNull()
  })

  test('uses HttpOnly refresh continuity, exact Origin and CSRF for web upgrade', async () => {
    const { identity, pair } = await identityFixture()
    const cookie = `__Host-r2r-refresh=${pair.refreshToken}`
    const csrf = await identity.refreshCsrfToken(pair.refreshToken)
    let received: Record<string, unknown> | undefined
    const response = await handle(
      new Request('http://localhost/identity/web/sign-up', {
        method: 'POST',
        headers: {
          cookie,
          origin,
          'content-type': 'application/json',
          'x-csrf-token': csrf!,
        },
        body: JSON.stringify(credentials),
      }),
      {
        identity,
        identityWebOrigins: [origin],
        registration: {
          signUp: async (input) => {
            received = input
            return completedRegistration()
          },
        },
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.getSetCookie()).toHaveLength(2)
    expect(received).toMatchObject({
      mode: 'upgrade',
      guest: { userId: 'guest-signup', familyId: pair.familyId },
    })
  })

  test('retries a claimed web upgrade with the same protected guest credential', async () => {
    const { identity, pair } = await identityFixture()
    const cookie = `__Host-r2r-refresh=${pair.refreshToken}`
    const csrf = await identity.refreshCsrfToken(pair.refreshToken)
    let attempts = 0
    let operationId: string | undefined
    const registration = {
      signUp: async (
        input: Parameters<NonNullable<AppDependencies['registration']>['signUp']>[0],
      ) => {
        attempts += 1
        operationId ??= input.operationId
        expect(input.operationId).toBe(operationId)
        if (attempts === 1) throw new Error('temporary transfer failure')
        return completedRegistration()
      },
    }
    const request = () =>
      new Request('http://localhost/identity/web/sign-up', {
        method: 'POST',
        headers: {
          cookie,
          origin,
          'content-type': 'application/json',
          'x-csrf-token': csrf!,
        },
        body: JSON.stringify(credentials),
      })

    await expect(
      handle(request(), { identity, identityWebOrigins: [origin], registration }),
    ).rejects.toThrow('temporary transfer failure')
    const csrfRecovery = await handle(
      new Request('http://localhost/identity/web/csrf', {
        method: 'POST',
        headers: { cookie, origin, 'content-type': 'application/json' },
        body: '{}',
      }),
      { identity, identityWebOrigins: [origin] },
    )
    expect(csrfRecovery.status).toBe(200)

    const recovered = await handle(request(), {
      identity,
      identityWebOrigins: [origin],
      registration,
    })
    expect(recovered.status).toBe(200)
    expect(attempts).toBe(2)
  })

  test('recovers the exact web upgrade after its guest identity was invalidated', async () => {
    const { identity, pair } = await identityFixture()
    const cookie = `__Host-r2r-refresh=${pair.refreshToken}`
    const csrf = await identity.refreshCsrfToken(pair.refreshToken)
    let operationId: string | undefined
    let attempts = 0
    const registration = {
      signUp: async (
        input: Parameters<NonNullable<AppDependencies['registration']>['signUp']>[0],
      ) => {
        attempts += 1
        operationId ??= input.operationId
        expect(input.operationId).toBe(operationId)
        expect(input.guest?.userId).toBe('guest-signup')
        if (attempts === 1) {
          expect(await identity.completeUpgrade(input.guest!.userId, input.operationId!)).toBe(true)
          throw new Error('final operation write failed')
        }
        return completedRegistration()
      },
    }
    const request = () =>
      new Request('http://localhost/identity/web/sign-up', {
        method: 'POST',
        headers: {
          cookie,
          origin,
          'content-type': 'application/json',
          'x-csrf-token': csrf!,
        },
        body: JSON.stringify(credentials),
      })

    await expect(
      handle(request(), { identity, identityWebOrigins: [origin], registration }),
    ).rejects.toThrow('final operation write failed')
    expect(await identity.authenticateAccess(pair.accessToken)).toBeNull()

    const recovered = await handle(request(), {
      identity,
      identityWebOrigins: [origin],
      registration,
    })
    expect(recovered.status).toBe(200)
    expect(recovered.headers.getSetCookie()).toHaveLength(2)
    expect(attempts).toBe(2)
  })

  test('recovers the exact API upgrade without restoring guest media authority', async () => {
    const { identity, pair } = await identityFixture()
    let operationId: string | undefined
    let attempts = 0
    const registration = {
      signUp: async (
        input: Parameters<NonNullable<AppDependencies['registration']>['signUp']>[0],
      ) => {
        attempts += 1
        operationId ??= input.operationId
        expect(input.operationId).toBe(operationId)
        if (attempts === 1) {
          expect(await identity.completeUpgrade(input.guest!.userId, input.operationId!)).toBe(true)
          throw new Error('lost completed response')
        }
        return completedRegistration()
      },
    }
    const request = () =>
      new Request('http://localhost/identity/api/sign-up', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${pair.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(credentials),
      })

    await expect(handle(request(), { identity, registration })).rejects.toThrow(
      'lost completed response',
    )
    expect(await identity.authenticateAccess(pair.accessToken)).toBeNull()
    expect((await handle(request(), { identity, registration })).status).toBe(200)
    expect(await identity.authenticateAccess(pair.accessToken)).toBeNull()
    expect(attempts).toBe(2)
  })

  test('rejects ambiguous transport and client-controlled identity before registration', async () => {
    const { identity, pair } = await identityFixture()
    let calls = 0
    const registration = {
      signUp: async () => {
        calls += 1
        return completedRegistration()
      },
    }
    const attempts = [
      new Request('http://localhost/identity/api/sign-up', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify(credentials),
      }),
      new Request('http://localhost/identity/api/sign-up', {
        method: 'POST',
        headers: {
          cookie: `__Host-r2r-refresh=${pair.refreshToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(credentials),
      }),
      new Request('http://localhost/identity/api/sign-up', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${pair.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ...credentials, ownerId: 'attacker-selected' }),
      }),
    ]

    expect((await handle(attempts[0]!, { identity, registration })).status).toBe(403)
    expect((await handle(attempts[1]!, { identity, registration })).status).toBe(400)
    expect((await handle(attempts[2]!, { identity, registration })).status).toBe(400)
    expect(calls).toBe(0)
  })

  test('fails closed when registration orchestration is unavailable', async () => {
    const { identity, pair } = await identityFixture()
    const response = await handle(
      new Request('http://localhost/identity/api/sign-up', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${pair.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(credentials),
      }),
      { identity },
    )

    expect(response.status).toBe(503)
  })
})
