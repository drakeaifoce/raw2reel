import { config } from './config'
import { readiness } from './health'
import { createDatabaseService, type DatabaseRepository } from './database'
import { createMediaService, type MediaRepository } from './media'
import { createAuthService } from './auth'

export type AuthenticatedUser = {
  id: string
  email: string
  name?: string
}

export type AuthSession = { user: AuthenticatedUser }

export interface AuthService {
  handler(request: Request): Promise<Response>
  getSession(headers: Headers): Promise<AuthSession | null>
}

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
export type AppDependencies = {
  auth?: AuthService
  media?: MediaRepository
  database?: DatabaseRepository
  allowedMediaTypes?: string[]
  maxMediaSizeBytes?: number
}

const defaultDependencies: AppDependencies = {
  auth: createAuthService(config),
  media: createMediaService(config),
  database: createDatabaseService(config),
  allowedMediaTypes: config.mediaAllowedTypes,
  maxMediaSizeBytes: config.maxMediaSizeBytes,
}

const error = (message: string, code: string, status: number) =>
  json({ error: message, code }, status)
const isAllowedType = (type: string, allowed: string[]) =>
  allowed.some((pattern) =>
    pattern.endsWith('/*') ? type.startsWith(pattern.slice(0, -1)) : type === pattern,
  )

export async function requireSession(
  request: Request,
  auth: AuthService | undefined,
): Promise<AuthSession | Response> {
  if (!auth) return error('authentication is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
  const session = await auth.getSession(request.headers)
  return session ?? error('authentication required', 'UNAUTHORIZED', 401)
}

export async function handle(
  request: Request,
  dependencies: AppDependencies = defaultDependencies,
): Promise<Response> {
  const url = new URL(request.url)
  const { pathname } = url

  if (pathname === '/auth' || pathname.startsWith('/auth/')) {
    if (!dependencies.auth)
      return error('authentication is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    const publicUrl = new URL(request.url)
    publicUrl.pathname = `/api${pathname}`
    return dependencies.auth.handler(new Request(publicUrl.toString(), request))
  }

  if (pathname === '/media' || pathname.startsWith('/media/') || pathname === '/db/hello') {
    const session = await requireSession(request, dependencies.auth)
    if (session instanceof Response) return session
  }

  if (pathname === '/media' && request.method === 'POST') {
    if (!dependencies.media)
      return error('media storage is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    const contentLength = Number(request.headers.get('content-length') ?? 0)
    const maxSize = dependencies.maxMediaSizeBytes ?? config.maxMediaSizeBytes
    if (contentLength > maxSize + 1024 * 1024)
      return error('file is too large', 'FILE_TOO_LARGE', 413)
    let form
    try {
      form = await request.formData()
    } catch {
      return error('multipart/form-data body is required', 'INVALID_MULTIPART', 400)
    }
    const file = form.get('file')
    if (!(file instanceof File)) return error('file field is required', 'FILE_REQUIRED', 400)
    if (file.size > maxSize) return error('file is too large', 'FILE_TOO_LARGE', 413)
    const allowed = dependencies.allowedMediaTypes ?? config.mediaAllowedTypes
    if (!isAllowedType(file.type, allowed)) {
      return error('media type is not allowed', 'MEDIA_TYPE_NOT_ALLOWED', 415)
    }
    return json(await dependencies.media.create(file), 201)
  }

  if (pathname === '/media' && request.method === 'GET') {
    if (!dependencies.media)
      return error('media storage is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    const rawLimit = url.searchParams.get('limit') ?? '20'
    const limit = Number(rawLimit)
    if (!/^\d+$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return error('limit must be an integer from 1 to 100', 'INVALID_LIMIT', 400)
    }
    return json({ items: await dependencies.media.list(limit) })
  }

  const mediaMatch = pathname.match(/^\/media\/([^/]+)$/)
  if (mediaMatch && request.method === 'GET') {
    if (!dependencies.media)
      return error('media storage is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    let id: string
    try {
      id = decodeURIComponent(mediaMatch[1]!)
    } catch {
      return error('media id has invalid URL encoding', 'INVALID_MEDIA_ID', 400)
    }
    const stored = await dependencies.media.get(id)
    if (!stored) return error('media was not found', 'MEDIA_NOT_FOUND', 404)
    return new Response(stored.body, {
      headers: {
        'content-type': stored.metadata.type,
        'content-length': String(stored.metadata.size),
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(stored.metadata.name)}`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    })
  }

  if (pathname === '/db/hello' && request.method === 'GET') {
    if (!dependencies.database)
      return error('database is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    return json(await dependencies.database.hello())
  }

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
