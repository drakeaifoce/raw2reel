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
        method: 'GET',
        headers: { cookie, origin },
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
        method: 'GET',
        headers: { cookie: rotatedCookie, origin },
      }),
      dependencies,
    )
    expect(revokedFamily.status).toBe(401)
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
