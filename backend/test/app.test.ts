import { describe, expect, test } from 'bun:test'
import { handle, type AppDependencies } from '../src/app'
import { config } from '../src/config'

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
