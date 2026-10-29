import { config } from './config'
import { readiness } from './health'
import { createDatabaseService, type DatabaseRepository } from './database'
import { createMediaService, type MediaRepository } from './media'
import { createAuthService } from './auth'
import type { IdentityService, Principal, TokenPair } from './identity'
import { createIdentityService } from './identity-mongo'

export type AuthenticatedUser = {
  id: string
  // Guest identities added by AVI-343 may not have an email address. A stable
  // server-issued id is the only property required by authorization guards.
  email?: string
  name?: string
  isAnonymous?: boolean | null
}

export type AuthSession = { user: AuthenticatedUser }

export interface AuthService {
  handler(request: Request): Promise<Response>
  getSession(headers: Headers): Promise<AuthSession | null>
}

export type RegistrationInput = {
  email: string
  password: string
  name: string
  mode: 'new' | 'upgrade'
  operationId?: string
  guest?: Principal
}

export interface RegistrationService {
  /**
   * Persists the registration operation before performing account or ownership
   * effects. Completion and recovery are owned by the AVI-340 integration.
   */
  signUp(input: RegistrationInput): Promise<{ status: 'accepted' }>
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
  identity?: Pick<
    IdentityService,
    | 'authenticateAccess'
    | 'refresh'
    | 'refreshCsrfToken'
    | 'matchesRefreshCsrf'
    | 'recordActivity'
    | 'revokeAll'
    | 'claimUpgradeWithAccess'
    | 'claimUpgradeWithRefresh'
  >
  registration?: RegistrationService
  identityWebOrigins?: string[]
}

const defaultDependencies: AppDependencies = {
  auth: createAuthService(config),
  media: createMediaService(config),
  database: createDatabaseService(config),
  allowedMediaTypes: config.mediaAllowedTypes,
  maxMediaSizeBytes: config.maxMediaSizeBytes,
  identity: createIdentityService(config),
  identityWebOrigins: config.betterAuthTrustedOrigins,
}

const error = (message: string, code: string, status: number) =>
  json({ error: message, code }, status)
const identityError = (code: string, status: number) =>
  json(
    {
      error: {
        code,
        message:
          code === 'INVALID_REQUEST'
            ? 'invalid request'
            : code === 'ORIGIN_REJECTED'
              ? 'origin rejected'
              : code === 'CSRF_REJECTED'
                ? 'csrf rejected'
                : 'invalid credential',
      },
    },
    status,
  )
const bearerToken = (request: Request) => {
  const match = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)
  return match?.[1]
}
const rejectApiBrowserTransport = (request: Request) => {
  if (request.headers.has('origin')) return identityError('ORIGIN_REJECTED', 403)
  if (request.headers.has('cookie')) return identityError('INVALID_REQUEST', 400)
}
const refreshCookieName = '__Host-r2r-refresh'
const readRefreshCookie = (request: Request) => {
  const values = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${refreshCookieName}=`))
    .map((value) => value.slice(refreshCookieName.length + 1))
  return values.length === 1 && values[0] ? values[0] : undefined
}
const allowedWebOrigin = (request: Request, origins: string[] | undefined) => {
  const origin = request.headers.get('origin')
  return origin !== null && (origins ?? []).includes(origin)
}
const webTokenBody = ({ refreshToken: _refreshToken, ...pair }: TokenPair) => ({
  ...pair,
  refreshTransport: 'cookie' as const,
})
const refreshCookie = (token: string, expiresAt: string) =>
  `${refreshCookieName}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Expires=${new Date(expiresAt).toUTCString()}`
const isAllowedType = (type: string, allowed: string[]) =>
  allowed.some((pattern) =>
    pattern.endsWith('/*') ? type.startsWith(pattern.slice(0, -1)) : type === pattern,
  )

type SignUpBody = { email: string; password: string; name: string; mode: 'new' | 'upgrade' }

const readSignUpBody = async (request: Request): Promise<SignUpBody | undefined> => {
  if (request.headers.get('content-type')?.split(';', 1)[0] !== 'application/json') return
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return
  }
  if (typeof body !== 'object' || body === null) return
  const value = body as Record<string, unknown>
  const keys = Object.keys(value).sort()
  if (keys.join(',') !== 'email,mode,name,password') return
  if (
    typeof value.email !== 'string' ||
    typeof value.password !== 'string' ||
    typeof value.name !== 'string' ||
    (value.mode !== 'new' && value.mode !== 'upgrade') ||
    value.email.length === 0 ||
    value.password.length === 0 ||
    value.name.length === 0
  ) {
    return
  }
  return value as SignUpBody
}

const acceptRegistration = async (
  registration: RegistrationService,
  body: SignUpBody,
  guest?: { operationId: string; principal: Principal },
) => {
  await registration.signUp({
    ...body,
    ...(guest ? { operationId: guest.operationId, guest: guest.principal } : {}),
  })
  return json(
    {
      status: 'accepted',
      ...(guest ? { operationId: guest.operationId } : {}),
    },
    202,
  )
}

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

  if (pathname.startsWith('/identity/') && !dependencies.identity) {
    return error('identity service is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
  }

  if (
    (pathname === '/identity/api/sign-up' || pathname === '/identity/web/sign-up') &&
    request.method === 'POST'
  ) {
    const isWeb = pathname === '/identity/web/sign-up'
    if (isWeb) {
      if (!allowedWebOrigin(request, dependencies.identityWebOrigins)) {
        return identityError('ORIGIN_REJECTED', 403)
      }
      if (request.headers.has('authorization')) return identityError('INVALID_REQUEST', 400)
    } else {
      const rejected = rejectApiBrowserTransport(request)
      if (rejected) return rejected
    }

    const body = await readSignUpBody(request)
    if (!body) return identityError('INVALID_REQUEST', 400)
    if (!dependencies.registration) {
      return error('registration service is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    }

    if (body.mode === 'new') {
      const credential = isWeb ? readRefreshCookie(request) : bearerToken(request)
      if (credential) {
        const valid = isWeb
          ? Boolean(await dependencies.identity!.refreshCsrfToken(credential))
          : Boolean(await dependencies.identity!.authenticateAccess(credential))
        return identityError(valid ? 'ACCOUNT_TRANSITION' : 'INVALID_CREDENTIAL', valid ? 409 : 401)
      }
      return acceptRegistration(dependencies.registration, body)
    }

    if (isWeb) {
      const refreshToken = readRefreshCookie(request)
      const csrfToken = request.headers.get('x-csrf-token')
      if (!refreshToken || !csrfToken) return identityError('CSRF_REJECTED', 403)
      if (!(await dependencies.identity!.matchesRefreshCsrf(refreshToken, csrfToken))) {
        return identityError('CSRF_REJECTED', 403)
      }
      const claim = await dependencies.identity!.claimUpgradeWithRefresh(refreshToken)
      if (claim.status !== 'claimed') {
        return claim.status === 'invalid'
          ? identityError('INVALID_CREDENTIAL', 401)
          : identityError('ACCOUNT_TRANSITION', 409)
      }
      return acceptRegistration(dependencies.registration, body, {
        operationId: claim.operationId,
        principal: claim.principal,
      })
    }

    const accessToken = bearerToken(request)
    if (!accessToken) return identityError('INVALID_CREDENTIAL', 401)
    const claim = await dependencies.identity!.claimUpgradeWithAccess(accessToken)
    if (claim.status !== 'claimed') {
      return claim.status === 'invalid'
        ? identityError('INVALID_CREDENTIAL', 401)
        : identityError('ACCOUNT_TRANSITION', 409)
    }
    return acceptRegistration(dependencies.registration, body, {
      operationId: claim.operationId,
      principal: claim.principal,
    })
  }

  if (pathname === '/identity/api/refresh' && request.method === 'POST') {
    const rejected = rejectApiBrowserTransport(request)
    if (rejected) return rejected
    if (request.headers.get('content-type')?.split(';', 1)[0] !== 'application/json') {
      return identityError('INVALID_REQUEST', 400)
    }
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return identityError('INVALID_REQUEST', 400)
    }
    if (
      typeof body !== 'object' ||
      body === null ||
      Object.keys(body).length !== 1 ||
      typeof (body as { refreshToken?: unknown }).refreshToken !== 'string'
    ) {
      return identityError('INVALID_REQUEST', 400)
    }
    const pair = await dependencies.identity!.refresh(
      (body as { refreshToken: string }).refreshToken,
    )
    return pair ? json(pair) : identityError('INVALID_CREDENTIAL', 401)
  }

  if (pathname === '/identity/web/csrf' && request.method === 'GET') {
    if (!allowedWebOrigin(request, dependencies.identityWebOrigins)) {
      return identityError('ORIGIN_REJECTED', 403)
    }
    const token = readRefreshCookie(request)
    if (!token) return identityError('INVALID_CREDENTIAL', 401)
    const csrfToken = await dependencies.identity!.refreshCsrfToken(token)
    return csrfToken ? json({ csrfToken }) : identityError('INVALID_CREDENTIAL', 401)
  }

  if (pathname === '/identity/web/refresh' && request.method === 'POST') {
    if (!allowedWebOrigin(request, dependencies.identityWebOrigins)) {
      return identityError('ORIGIN_REJECTED', 403)
    }
    if (request.headers.get('content-type')?.split(';', 1)[0] !== 'application/json') {
      return identityError('INVALID_REQUEST', 400)
    }
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return identityError('INVALID_REQUEST', 400)
    }
    if (typeof body !== 'object' || body === null || Object.keys(body).length !== 0) {
      return identityError('INVALID_REQUEST', 400)
    }
    const token = readRefreshCookie(request)
    const suppliedCsrf = request.headers.get('x-csrf-token')
    if (!token || !suppliedCsrf) return identityError('CSRF_REJECTED', 403)
    if (!(await dependencies.identity!.matchesRefreshCsrf(token, suppliedCsrf))) {
      return identityError('CSRF_REJECTED', 403)
    }
    const pair = await dependencies.identity!.refresh(token)
    if (!pair) return identityError('INVALID_CREDENTIAL', 401)
    const response = json(webTokenBody(pair))
    response.headers.set('set-cookie', refreshCookie(pair.refreshToken, pair.refreshExpiresAt))
    return response
  }

  if (
    (pathname === '/identity/activity' || pathname === '/identity/revoke-all') &&
    request.method === 'POST'
  ) {
    const token = bearerToken(request)
    if (!token) return identityError('INVALID_CREDENTIAL', 401)
    const accepted =
      pathname === '/identity/activity'
        ? await dependencies.identity!.recordActivity(token)
        : await dependencies.identity!.revokeAll(token)
    return accepted ? new Response(null, { status: 204 }) : identityError('INVALID_CREDENTIAL', 401)
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
