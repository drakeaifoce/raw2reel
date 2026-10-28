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

  test('неизвестный путь это 404', async () => {
    const response = await get('/нет-такого')
    expect(response.status).toBe(404)
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
