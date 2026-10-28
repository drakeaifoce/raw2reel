import { config } from './config'
import { readiness } from './health'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })

const server = Bun.serve({
  port: config.port,
  hostname: '0.0.0.0',
  async fetch(request) {
    const { pathname } = new URL(request.url)

    // Проверяет только сам процесс: используется healthcheck'ом контейнера,
    // поэтому не должен зависеть от внешних сервисов.
    if (pathname === '/health') return json({ status: 'ok' })

    // Проверяет зависимости: используется деплоем перед переключением трафика.
    if (pathname === '/ready') {
      const result = await readiness()
      return json(result, result.ready ? 200 : 503)
    }

    return json({ error: 'not found' }, 404)
  },
})

console.log(`backend слушает http://${server.hostname}:${server.port}`)
