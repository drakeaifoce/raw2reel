import { config } from './config'
import { readiness } from './health'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Ответы этих эндпоинтов кешировать нельзя: /version существует ровно
      // для того, чтобы показать, какой образ развёрнут сейчас, и прокси,
      // отдавший старое значение, обессмысливает проверку деплоя. У /ready
      // та же логика — закешированная готовность хуже отсутствующей.
      'cache-control': 'no-store',
    },
  })

/**
 * Маршрутизация вынесена из index.ts, чтобы тесты могли вызывать её напрямую,
 * не поднимая сервер и не занимая порт.
 */
export async function handle(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url)

  // Проверяет только сам процесс: используется healthcheck'ом контейнера,
  // поэтому не должен зависеть от внешних сервисов.
  if (pathname === '/health') return json({ status: 'ok' })

  // Версия развёрнутого образа. По её смене видно, что деплой доехал.
  if (pathname === '/version') return json({ service: 'backend', version: config.version })

  // Готовность зависимостей: используется деплоем перед переключением трафика.
  if (pathname === '/ready') {
    const result = await readiness()
    return json(result, result.ready ? 200 : 503)
  }

  // Путь в ответе: без него отладка опечатки в URL превращается в угадывание
  return json({ error: 'not found', path: pathname }, 404)
}
