import { describe, expect, test } from 'bun:test'
import { handle } from '../src/app'
import { config } from '../src/config'

const get = (path: string) => handle(new Request(`http://localhost${path}`))

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
