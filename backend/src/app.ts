import { docsResponse } from './docs'
import { config } from './config'
import { readiness } from './health'
import { createDatabaseService, type DatabaseRepository } from './database'
import { createRenderQueue, type RenderQueue } from './queue'
import { createRenderJobService, type RenderJob, type RenderJobRepository } from './render-jobs'
import { createMediaService, type MediaRepository } from './media'
import { contentRange, parseRange, unsatisfiableRange } from './range'
import { createAnalysisService, type AnalysisRecord, type AnalysisRepository } from './analyses'
import { createAuthService } from './auth'
import type { IdentityService, Principal, TokenPair } from './identity'
import { createIdentityService } from './identity-mongo'
import { createRegistrationService } from './registration'

export type AuthenticatedUser = {
  id: string
  // Guest identities added by AVI-343 may not have an email address. A stable
  // server-issued id is the only property required by authorization guards.
  email?: string
  name?: string
  isAnonymous?: boolean | null
  registrationOperationId?: string
}

export type AuthSession = { user: AuthenticatedUser; sessionToken?: string }
export type GuestAuthSession = {
  user: AuthenticatedUser & { isAnonymous: true }
  sessionToken: string
  sessionCookie: string
}
/**
 * Исход попытки создать гостя. Размеченный тип нужен, чтобы отказ лимитера не
 * сливался с прочими сбоями: раньше createGuest возвращал null на любой
 * не-ok, и app.ts отдавал 503 DEPENDENCY_UNAVAILABLE вместо 429. Из-за этого
 * жалобу «сайт не пускает» нельзя было отличить от сломанной зависимости.
 */
export type GuestAuthAttempt =
  | { status: 'created'; session: GuestAuthSession }
  | { status: 'rate-limited'; retryAfterSeconds: number }
  | { status: 'failed' }

export type RegisteredAuthSession = {
  user: AuthenticatedUser & { isAnonymous: false }
  sessionToken: string
  sessionCookie: string
}

export interface AuthService {
  handler(request: Request): Promise<Response>
  getSession(headers: Headers): Promise<AuthSession | null>
  createGuest?(headers: Headers): Promise<GuestAuthAttempt>
  signInEmail?(
    headers: Headers,
    input: { email: string; password: string },
  ): Promise<RegisteredAuthSession | null>
  signUpEmail?(
    headers: Headers,
    input: {
      email: string
      password: string
      name: string
      registrationOperationId: string
    },
  ): Promise<RegisteredAuthSession | null>
  signOut?(headers: Headers): Promise<Response>
}

export type RegistrationInput = {
  email: string
  password: string
  name: string
  mode: 'new' | 'upgrade'
  operationId?: string
  guest?: Principal
  /**
   * Заголовки исходного запроса. Нужны лимитеру Better Auth: без них он не
   * видит адрес и складывает все регистрации в один счётчик на весь мир.
   */
  headers?: Headers
}

export interface RegistrationService {
  /**
   * Persists the registration operation before performing account or ownership
   * effects. Completion and recovery are owned by the AVI-340 integration.
   */
  signUp(input: RegistrationInput): Promise<{
    status: 'completed'
    session: RegisteredAuthSession
    tokens: TokenPair
  }>
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
    | 'registerGuest'
    | 'resumeGuest'
    | 'registerRegistered'
    | 'refresh'
    | 'refreshCsrfToken'
    | 'matchesRefreshCsrf'
    | 'recordActivity'
    | 'revokeAll'
    | 'revokeRefresh'
    | 'claimUpgradeWithAccess'
    | 'claimUpgradeWithRefresh'
    | 'recoverCompletedUpgradeWithAccess'
    | 'recoverCompletedUpgradeWithRefresh'
    | 'authenticateSession'
    | 'revokeSession'
    | 'completeUpgrade'
  >
  registration?: RegistrationService
  identityWebOrigins?: string[]
  renderJobs?: RenderJobRepository
  renderQueue?: RenderQueue
  analyses?: AnalysisRepository
}

/** Предел AI-сервиса: больше шестнадцати персонажей он не примет. */
const MAX_PEOPLE = 16

/**
 * Владелец готовых сэмплов. Это обычные медиа, просто принадлежат не человеку,
 * а служебному имени: так их видно всем, а правило «медиа принадлежит
 * владельцу» остаётся в силе — пользователь берёт себе копию.
 */
const SAMPLES_OWNER = 'samples'

const defaultRenderJobs = createRenderJobService(config)
// Очередь подключается лениво: соединение асинхронное, а на уровне модуля
// ждать его нельзя. Тесты подставляют свою через renderQueue.
let queueConnection: Promise<RenderQueue | undefined> | undefined
const defaultRenderQueue = () => (queueConnection ??= createRenderQueue(config))

const defaultAuth = createAuthService(config)
const defaultMedia = createMediaService(config)
const defaultIdentity = createIdentityService(config)
const defaultDependencies: AppDependencies = {
  auth: defaultAuth,
  media: defaultMedia,
  database: createDatabaseService(config),
  allowedMediaTypes: config.mediaAllowedTypes,
  maxMediaSizeBytes: config.maxMediaSizeBytes,
  identity: defaultIdentity,
  registration: createRegistrationService(config, defaultAuth, defaultIdentity, defaultMedia),
  identityWebOrigins: config.betterAuthTrustedOrigins,
  renderJobs: defaultRenderJobs,
  analyses: createAnalysisService(config),
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
            : code === 'RATE_LIMITED'
              ? 'too many requests'
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
const clearRefreshCookie = `${refreshCookieName}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
const isEmptyJson = async (request: Request) => {
  if (request.headers.get('content-type')?.split(';', 1)[0] !== 'application/json') return false
  try {
    const body: unknown = await request.json()
    return typeof body === 'object' && body !== null && Object.keys(body).length === 0
  } catch {
    return false
  }
}
const readCredentials = async (request: Request) => {
  if (request.headers.get('content-type')?.split(';', 1)[0] !== 'application/json') return
  try {
    const body: unknown = await request.json()
    if (typeof body !== 'object' || body === null) return
    const value = body as Record<string, unknown>
    if (Object.keys(value).sort().join(',') !== 'email,password') return
    if (
      typeof value.email !== 'string' ||
      !value.email ||
      typeof value.password !== 'string' ||
      !value.password
    )
      return
    return { email: value.email, password: value.password }
  } catch {
    return
  }
}
const isAllowedType = (type: string, allowed: string[]) =>
  allowed.some((pattern) =>
    pattern.endsWith('/*') ? type.startsWith(pattern.slice(0, -1)) : type === pattern,
  )

const publicMedia = ({
  id,
  name,
  type,
  size,
  createdAt,
}: Awaited<ReturnType<MediaRepository['create']>>) => ({ id, name, type, size, createdAt })

/**
 * Отдаёт файл из хранилища, поддерживая перемотку. Без Accept-Ranges браузер
 * даже не пробует запросить кусок и тянет видео целиком, прежде чем пустить
 * пользователя на нужную секунду.
 *
 * Общая для /media/{id} и содержимого сэмпла: тела ответов должны совпадать,
 * иначе плеер поведёт себя по-разному на своём и на готовом файле.
 */
async function streamMedia(
  request: Request,
  media: MediaRepository,
  id: string,
  ownerId: string,
  cacheControl: string,
  notFound: () => Response,
): Promise<Response> {
  const head = await media.get(id, ownerId)
  if (!head) return notFound()
  const size = head.metadata.size
  const wanted = parseRange(request.headers.get('range'), size)

  const headers: Record<string, string> = {
    'content-type': head.metadata.type,
    'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(head.metadata.name)}`,
    'cache-control': cacheControl,
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
  }

  if (wanted.kind === 'unsatisfiable') {
    await head.body.cancel()
    // Молча отдать файл целиком нельзя: плеер решит, что перемотка удалась,
    // и покажет не то место.
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'content-range': unsatisfiableRange(size) },
    })
  }

  if (wanted.kind === 'full') {
    return new Response(head.body, {
      headers: { ...headers, 'content-length': String(size) },
    })
  }

  // Первый запрос открыл поток на весь файл — он больше не нужен.
  await head.body.cancel()
  const part = await media.get(id, ownerId, wanted.range)
  if (!part) return notFound()
  const { start, end } = wanted.range
  return new Response(part.body, {
    status: 206,
    headers: {
      ...headers,
      'content-length': String(end - start + 1),
      'content-range': contentRange(wanted.range, size),
    },
  })
}

const publicJob = ({
  id,
  status,
  duration,
  captions,
  musicMediaId,
  analysisId,
  personIds,
  resultMediaId,
  error: failure,
  createdAt,
  updatedAt,
}: RenderJob) => ({
  id,
  status,
  duration,
  captions,
  ...(musicMediaId ? { musicMediaId } : {}),
  ...(analysisId ? { analysisId } : {}),
  ...(personIds ? { personIds } : {}),
  ...(resultMediaId ? { resultMediaId } : {}),
  ...(failure ? { error: failure } : {}),
  createdAt,
  updatedAt,
})

/**
 * Карточки персонажей для клиента. Превью отдаём ссылкой, а не base64: в
 * ответе prepare их до 256 штук, и вкладывать их в JSON значило бы гонять
 * мегабайты на каждый опрос состояния.
 */
const publicAnalysis = (record: AnalysisRecord) => ({
  id: record.id,
  sourceMediaId: record.sourceMediaId,
  status: record.status,
  people: record.people.map((person) => ({
    id: person.id,
    label: person.label,
    observationCount: person.observationCount,
    ...(person.thumbnailKey
      ? {
          thumbnailUrl: `/analyses/${record.id}/people/${encodeURIComponent(person.id)}/thumbnail`,
        }
      : {}),
  })),
  ...(record.sourceDuration !== undefined ? { sourceDuration: record.sourceDuration } : {}),
  ...(record.warnings.length > 0 ? { warnings: record.warnings } : {}),
  ...(record.error ? { error: record.error } : {}),
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
})

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
  headers: Headers,
  body: SignUpBody,
  guest?: { operationId: string; principal: Principal },
  web = false,
) => {
  const result = await registration.signUp({
    ...body,
    headers,
    ...(guest ? { operationId: guest.operationId, guest: guest.principal } : {}),
  })
  const response = json(
    {
      status: result.status,
      ...(guest ? { operationId: guest.operationId } : {}),
      ...(web ? webTokenBody(result.tokens) : result.tokens),
    },
    200,
  )
  if (web) {
    response.headers.append('set-cookie', result.session.sessionCookie)
    response.headers.append(
      'set-cookie',
      refreshCookie(result.tokens.refreshToken, result.tokens.refreshExpiresAt),
    )
  }
  return response
}

export async function requireSession(
  request: Request,
  auth: AuthService | undefined,
  identity?: AppDependencies['identity'],
): Promise<AuthSession | Response> {
  if (!auth) return error('authentication is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
  const session = await auth.getSession(request.headers)
  if (!session) return error('authentication required', 'UNAUTHORIZED', 401)
  if (
    identity &&
    (!session.sessionToken ||
      !(await identity.authenticateSession(session.user.id, session.sessionToken)))
  ) {
    return error('authentication required', 'UNAUTHORIZED', 401)
  }
  return session
}

async function requireMediaPrincipal(
  request: Request,
  auth: AuthService | undefined,
  identity: AppDependencies['identity'],
): Promise<{ userId: string } | Response> {
  if (request.headers.has('authorization')) {
    if (request.headers.has('cookie')) {
      return error('choose one authentication transport', 'INVALID_REQUEST', 400)
    }
    const token = bearerToken(request)
    if (!token) return error('authentication required', 'UNAUTHORIZED', 401)
    if (!identity) return error('identity service is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    const principal = await identity.authenticateAccess(token)
    return principal ?? error('authentication required', 'UNAUTHORIZED', 401)
  }

  const session = await requireSession(request, auth, identity)
  return session instanceof Response ? session : { userId: session.user.id }
}

export async function handle(
  request: Request,
  dependencies: AppDependencies = defaultDependencies,
): Promise<Response> {
  const url = new URL(request.url)
  const { pathname } = url
  const documentation = docsResponse(request)
  if (documentation) return documentation

  if (pathname === '/auth' || pathname.startsWith('/auth/')) {
    if (!dependencies.auth)
      return error('authentication is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    if (pathname === '/auth/sign-in/anonymous') {
      return error('use the identity guest endpoint', 'IDENTITY_REQUIRED', 409)
    }
    if (pathname === '/auth/sign-out' && request.method === 'POST') {
      const session = await dependencies.auth.getSession(request.headers)
      if (!session?.sessionToken || !dependencies.identity) {
        return error('identity session is required', 'UNAUTHORIZED', 401)
      }
      const authResponse = dependencies.auth.signOut
        ? await dependencies.auth.signOut(request.headers)
        : await dependencies.auth.handler(request)
      if (!authResponse.ok) return authResponse
      await dependencies.identity.revokeSession(session.user.id, session.sessionToken)
      return authResponse
    }
    const publicUrl = new URL(request.url)
    publicUrl.pathname = `/api${pathname}`
    return dependencies.auth.handler(new Request(publicUrl.toString(), request))
  }

  if (pathname.startsWith('/identity/') && !dependencies.identity) {
    return error('identity service is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
  }

  if (
    (pathname === '/identity/api/guest' || pathname === '/identity/web/guest') &&
    request.method === 'POST'
  ) {
    const isWeb = pathname === '/identity/web/guest'
    if (!dependencies.auth) {
      return error('authentication is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    }
    if (isWeb) {
      if (!allowedWebOrigin(request, dependencies.identityWebOrigins)) {
        return identityError('ORIGIN_REJECTED', 403)
      }
      if (request.headers.has('authorization')) return identityError('INVALID_REQUEST', 400)
      const current = await dependencies.auth.getSession(request.headers)
      if (current) {
        if (!(await isEmptyJson(request))) return identityError('INVALID_REQUEST', 400)
        // Сессия жива, а токенов у клиента нет — после перезагрузки страницы он
        // их не помнит. Отдаём новую пару тому же гостю: отказ был тупиком, из
        // которого выходили чисткой cookie, а это новый гость и потерянные
        // загрузки. Настоящую учётную запись в гостя не превращаем.
        const resumed =
          current.user.isAnonymous && current.sessionToken && dependencies.identity
            ? await dependencies.identity.resumeGuest(current.user.id, current.sessionToken)
            : null
        if (!resumed) return identityError('SESSION_EXISTS', 409)
        const response = json(webTokenBody(resumed), 200)
        response.headers.append(
          'set-cookie',
          refreshCookie(resumed.refreshToken, resumed.refreshExpiresAt),
        )
        return response
      }
    } else {
      const rejected = rejectApiBrowserTransport(request)
      if (rejected) return rejected
    }
    if (!(await isEmptyJson(request))) return identityError('INVALID_REQUEST', 400)

    if (!dependencies.auth.createGuest) {
      return error('guest authentication is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    }
    const attempt = await dependencies.auth.createGuest(request.headers)
    if (attempt.status === 'rate-limited') {
      const response = identityError('RATE_LIMITED', 429)
      response.headers.set('retry-after', String(attempt.retryAfterSeconds))
      return response
    }
    if (attempt.status !== 'created' || !attempt.session.user.isAnonymous) {
      return error('guest session could not be created', 'DEPENDENCY_UNAVAILABLE', 503)
    }
    const guest = attempt.session
    const pair = await dependencies.identity!.registerGuest(guest.user.id, guest.sessionToken)
    if (!isWeb) return json(pair, 201)

    const response = json(webTokenBody(pair), 201)
    response.headers.append('set-cookie', guest.sessionCookie)
    response.headers.append('set-cookie', refreshCookie(pair.refreshToken, pair.refreshExpiresAt))
    return response
  }

  if (
    (pathname === '/identity/api/sign-in' || pathname === '/identity/web/sign-in') &&
    request.method === 'POST'
  ) {
    const isWeb = pathname === '/identity/web/sign-in'
    if (!dependencies.auth?.signInEmail) {
      return error('authentication is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    }
    if (isWeb) {
      if (!allowedWebOrigin(request, dependencies.identityWebOrigins)) {
        return identityError('ORIGIN_REJECTED', 403)
      }
      if (request.headers.has('authorization')) return identityError('INVALID_REQUEST', 400)
    } else {
      const rejected = rejectApiBrowserTransport(request)
      if (rejected) return rejected
    }
    const credentials = await readCredentials(request)
    if (!credentials) return identityError('INVALID_REQUEST', 400)
    const signedIn = await dependencies.auth.signInEmail(request.headers, credentials)
    if (!signedIn || signedIn.user.isAnonymous) return identityError('INVALID_CREDENTIAL', 401)
    const pair = await dependencies.identity!.registerRegistered(
      signedIn.user.id,
      signedIn.sessionToken,
    )
    if (!isWeb) return json(pair)
    const response = json(webTokenBody(pair))
    response.headers.append('set-cookie', signedIn.sessionCookie)
    response.headers.append('set-cookie', refreshCookie(pair.refreshToken, pair.refreshExpiresAt))
    return response
  }

  if (
    (pathname === '/identity/api/logout' || pathname === '/identity/web/logout') &&
    request.method === 'POST'
  ) {
    const isWeb = pathname === '/identity/web/logout'
    let token: string | undefined
    if (isWeb) {
      if (!allowedWebOrigin(request, dependencies.identityWebOrigins)) {
        return identityError('ORIGIN_REJECTED', 403)
      }
      if (!(await isEmptyJson(request))) return identityError('INVALID_REQUEST', 400)
      token = readRefreshCookie(request)
      const csrf = request.headers.get('x-csrf-token')
      if (!token || !csrf || !(await dependencies.identity!.matchesRefreshCsrf(token, csrf))) {
        return identityError('CSRF_REJECTED', 403)
      }
    } else {
      const rejected = rejectApiBrowserTransport(request)
      if (rejected) return rejected
      if (request.headers.get('content-type')?.split(';', 1)[0] !== 'application/json') {
        return identityError('INVALID_REQUEST', 400)
      }
      try {
        const body = (await request.json()) as Record<string, unknown>
        if (Object.keys(body).length !== 1 || typeof body.refreshToken !== 'string') {
          return identityError('INVALID_REQUEST', 400)
        }
        token = body.refreshToken
      } catch {
        return identityError('INVALID_REQUEST', 400)
      }
    }
    if (!isWeb) {
      return (await dependencies.identity!.revokeRefresh(token))
        ? new Response(null, { status: 204 })
        : identityError('INVALID_CREDENTIAL', 401)
    }
    const authResponse = dependencies.auth?.signOut
      ? await dependencies.auth.signOut(request.headers)
      : undefined
    if (authResponse && !authResponse.ok) {
      return error('authentication sign-out failed', 'DEPENDENCY_UNAVAILABLE', 503)
    }
    if (!(await dependencies.identity!.revokeRefresh(token))) {
      return identityError('INVALID_CREDENTIAL', 401)
    }
    const response = new Response(null, { status: 204 })
    for (const cookie of authResponse?.headers.getSetCookie() ?? []) {
      response.headers.append('set-cookie', cookie)
    }
    response.headers.append('set-cookie', clearRefreshCookie)
    return response
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
      return acceptRegistration(dependencies.registration, request.headers, body, undefined, isWeb)
    }

    if (isWeb) {
      const refreshToken = readRefreshCookie(request)
      const csrfToken = request.headers.get('x-csrf-token')
      if (!refreshToken || !csrfToken) return identityError('CSRF_REJECTED', 403)
      if (!(await dependencies.identity!.matchesRefreshCsrf(refreshToken, csrfToken))) {
        return identityError('CSRF_REJECTED', 403)
      }
      let claim = await dependencies.identity!.claimUpgradeWithRefresh(refreshToken)
      if (claim.status === 'invalid') {
        claim = await dependencies.identity!.recoverCompletedUpgradeWithRefresh(refreshToken)
      }
      if (claim.status !== 'claimed') {
        return claim.status === 'invalid'
          ? identityError('INVALID_CREDENTIAL', 401)
          : identityError('ACCOUNT_TRANSITION', 409)
      }
      return acceptRegistration(
        dependencies.registration,
        request.headers,
        body,
        { operationId: claim.operationId, principal: claim.principal },
        true,
      )
    }

    const accessToken = bearerToken(request)
    if (!accessToken) return identityError('INVALID_CREDENTIAL', 401)
    let claim = await dependencies.identity!.claimUpgradeWithAccess(accessToken)
    if (claim.status === 'invalid') {
      claim = await dependencies.identity!.recoverCompletedUpgradeWithAccess(accessToken)
    }
    if (claim.status !== 'claimed') {
      return claim.status === 'invalid'
        ? identityError('INVALID_CREDENTIAL', 401)
        : identityError('ACCOUNT_TRANSITION', 409)
    }
    return acceptRegistration(dependencies.registration, request.headers, body, {
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

  if (pathname === '/identity/web/csrf' && request.method === 'POST') {
    if (!allowedWebOrigin(request, dependencies.identityWebOrigins)) {
      return identityError('ORIGIN_REJECTED', 403)
    }
    if (!(await isEmptyJson(request))) return identityError('INVALID_REQUEST', 400)
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

  let mediaPrincipal: { userId: string } | undefined
  if (
    pathname === '/media' ||
    pathname.startsWith('/media/') ||
    pathname === '/renders' ||
    pathname.startsWith('/renders/') ||
    pathname === '/analyses' ||
    pathname.startsWith('/analyses/') ||
    pathname === '/samples' ||
    pathname.startsWith('/samples/')
  ) {
    const principal = await requireMediaPrincipal(request, dependencies.auth, dependencies.identity)
    if (principal instanceof Response) return principal
    mediaPrincipal = principal
  }

  if (pathname === '/db/hello') {
    const session = await requireSession(request, dependencies.auth, dependencies.identity)
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
    return json(publicMedia(await dependencies.media.create(file, mediaPrincipal!.userId)), 201)
  }

  if (pathname === '/media' && request.method === 'GET') {
    if (!dependencies.media)
      return error('media storage is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    const rawLimit = url.searchParams.get('limit') ?? '20'
    const limit = Number(rawLimit)
    if (!/^\d+$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return error('limit must be an integer from 1 to 100', 'INVALID_LIMIT', 400)
    }
    return json({
      items: (await dependencies.media.list(limit, mediaPrincipal!.userId)).map(publicMedia),
    })
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
    return streamMedia(request, dependencies.media, id, mediaPrincipal!.userId, 'no-store', () =>
      error('media was not found', 'MEDIA_NOT_FOUND', 404),
    )
  }

  if (pathname === '/samples' && request.method === 'GET') {
    if (!dependencies.media)
      return error('media storage is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    const rawLimit = url.searchParams.get('limit') ?? '20'
    const limit = Number(rawLimit)
    if (!/^\d+$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return error('limit must be an integer from 1 to 100', 'INVALID_LIMIT', 400)
    }
    return json({ items: (await dependencies.media.list(limit, SAMPLES_OWNER)).map(publicMedia) })
  }

  // Содержимое сэмпла: нужно, чтобы трек можно было послушать, а видео
  // посмотреть ДО выбора. /media/{id} для этого не годится — он привязан к
  // владельцу, а сэмпл принадлежит служебному.
  const sampleContentMatch = pathname.match(/^\/samples\/([^/]+)\/content$/)
  if (sampleContentMatch && request.method === 'GET') {
    if (!dependencies.media)
      return error('media storage is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    let id: string
    try {
      id = decodeURIComponent(sampleContentMatch[1]!)
    } catch {
      return error('sample id has invalid URL encoding', 'INVALID_SAMPLE_ID', 400)
    }
    // Кеш надолго: файлы неизменяемы, у каждого свой идентификатор. Именно
    // private — ручка за авторизацией, и полагаться на «сэмплы у всех
    // одинаковые» ради промежуточных кешей не стоит.
    return streamMedia(
      request,
      dependencies.media,
      id,
      SAMPLES_OWNER,
      'private, max-age=86400, immutable',
      () => error('sample was not found', 'SAMPLE_NOT_FOUND', 404),
    )
  }

  const sampleMatch = pathname.match(/^\/samples\/([^/]+)$/)
  if (sampleMatch && request.method === 'POST') {
    if (!dependencies.media?.copy)
      return error('media storage is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    let id: string
    try {
      id = decodeURIComponent(sampleMatch[1]!)
    } catch {
      return error('sample id has invalid URL encoding', 'INVALID_SAMPLE_ID', 400)
    }
    // Копия, а не ссылка: дальше по цепочке разбор и рендер проверяют
    // владельца, и делать для сэмплов исключение из этой проверки не стоит.
    const copied = await dependencies.media.copy(id, SAMPLES_OWNER, mediaPrincipal!.userId)
    if (!copied) return error('sample was not found', 'SAMPLE_NOT_FOUND', 404)
    return json(publicMedia(copied), 201)
  }

  if (pathname === '/analyses' && request.method === 'POST') {
    if (!dependencies.media)
      return error('media storage is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    if (!dependencies.analyses)
      return error('analysis storage is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    if (!dependencies.renderJobs)
      return error('render jobs are not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    const queue = dependencies.renderQueue ?? (await defaultRenderQueue())
    if (!queue) return error('render queue is not configured', 'DEPENDENCY_UNAVAILABLE', 503)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return error('JSON body is required', 'INVALID_REQUEST', 400)
    }
    if (typeof body !== 'object' || body === null) {
      return error('JSON body is required', 'INVALID_REQUEST', 400)
    }
    const sourceMediaId = (body as Record<string, unknown>).sourceMediaId
    if (typeof sourceMediaId !== 'string' || sourceMediaId.length === 0) {
      return error('sourceMediaId is required', 'INVALID_REQUEST', 400)
    }

    // Проверяем медиа здесь, а не в воркере: иначе разбор гарантированно
    // провалится через минуту вместо честного 404 сразу.
    const source = await dependencies.media.get(sourceMediaId, mediaPrincipal!.userId)
    if (!source) return error('source media was not found', 'MEDIA_NOT_FOUND', 404)
    await source.body.cancel()

    const analysis = await dependencies.analyses.create({
      id: crypto.randomUUID(),
      ownerId: mediaPrincipal!.userId,
      sourceMediaId,
    })
    const job = await dependencies.renderJobs.create({
      id: crypto.randomUUID(),
      ownerId: mediaPrincipal!.userId,
      kind: 'prepare',
      sourceMediaId,
      analysisId: analysis.id,
    })
    try {
      await queue.publish(job.id)
    } catch (failure) {
      // Записи уже есть, но в очередь не попали — помечаем провалившимися,
      // иначе разбор навсегда остался бы в queued и выглядел как ожидающий.
      const detail =
        failure instanceof Error ? failure.message : 'не удалось поставить задачу в очередь'
      await dependencies.renderJobs.fail(job.id, detail)
      await dependencies.analyses.fail(analysis.id, detail)
      return error('render queue is unavailable', 'DEPENDENCY_UNAVAILABLE', 503)
    }
    const response = json(publicAnalysis(analysis), 202)
    response.headers.set('location', `/analyses/${analysis.id}`)
    return response
  }

  const thumbnailMatch = pathname.match(/^\/analyses\/([^/]+)\/people\/([^/]+)\/thumbnail$/)
  if (thumbnailMatch && request.method === 'GET') {
    if (!dependencies.analyses)
      return error('analysis storage is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    let id: string
    let personId: string
    try {
      id = decodeURIComponent(thumbnailMatch[1]!)
      personId = decodeURIComponent(thumbnailMatch[2]!)
    } catch {
      return error('analysis id has invalid URL encoding', 'INVALID_ANALYSIS_ID', 400)
    }
    const record = await dependencies.analyses.get(id, mediaPrincipal!.userId)
    if (!record) return error('analysis was not found', 'ANALYSIS_NOT_FOUND', 404)
    const thumbnail = await dependencies.analyses.readThumbnail(record, personId)
    if (!thumbnail) return error('thumbnail was not found', 'THUMBNAIL_NOT_FOUND', 404)
    return new Response(thumbnail.body, {
      headers: {
        'content-type': 'image/jpeg',
        ...(thumbnail.size > 0 ? { 'content-length': String(thumbnail.size) } : {}),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    })
  }

  const analysisMatch = pathname.match(/^\/analyses\/([^/]+)$/)
  if (analysisMatch && request.method === 'GET') {
    if (!dependencies.analyses)
      return error('analysis storage is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    let id: string
    try {
      id = decodeURIComponent(analysisMatch[1]!)
    } catch {
      return error('analysis id has invalid URL encoding', 'INVALID_ANALYSIS_ID', 400)
    }
    const record = await dependencies.analyses.get(id, mediaPrincipal!.userId)
    if (!record) return error('analysis was not found', 'ANALYSIS_NOT_FOUND', 404)
    return json(publicAnalysis(record))
  }

  if (pathname === '/renders' && request.method === 'POST') {
    if (!dependencies.media)
      return error('media storage is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    if (!dependencies.renderJobs)
      return error('render jobs are not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    const queue = dependencies.renderQueue ?? (await defaultRenderQueue())
    if (!queue) return error('render queue is not configured', 'DEPENDENCY_UNAVAILABLE', 503)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return error('JSON body is required', 'INVALID_REQUEST', 400)
    }
    if (typeof body !== 'object' || body === null) {
      return error('JSON body is required', 'INVALID_REQUEST', 400)
    }
    const input = body as Record<string, unknown>
    // Рендеру нужен разбор исходника. Клиент либо присылает готовый
    // analysisId и выбранных персонажей, либо только sourceMediaId — тогда
    // воркер разберёт видео сам и выберет персонажей по числу появлений.
    const analysisId = input.analysisId
    if (analysisId !== undefined && (typeof analysisId !== 'string' || analysisId.length === 0)) {
      return error('analysisId must be a non-empty string', 'INVALID_REQUEST', 400)
    }
    const requestedSource = input.sourceMediaId
    if (
      requestedSource !== undefined &&
      (typeof requestedSource !== 'string' || requestedSource.length === 0)
    ) {
      return error('sourceMediaId must be a non-empty string', 'INVALID_REQUEST', 400)
    }
    if ((analysisId === undefined) === (requestedSource === undefined)) {
      return error('provide either analysisId or sourceMediaId', 'INVALID_REQUEST', 400)
    }
    const personIds = input.personIds
    if (
      personIds !== undefined &&
      (!Array.isArray(personIds) ||
        personIds.some((person) => typeof person !== 'string' || person.length === 0))
    ) {
      return error('personIds must be an array of non-empty strings', 'INVALID_REQUEST', 400)
    }
    if (personIds !== undefined && analysisId === undefined) {
      // Проверить идентификаторы можно только по каталогу, а его ещё нет.
      return error('personIds require analysisId', 'INVALID_REQUEST', 400)
    }
    const musicMediaId = input.musicMediaId
    if (musicMediaId !== undefined && typeof musicMediaId !== 'string') {
      return error('musicMediaId must be a string', 'INVALID_REQUEST', 400)
    }
    const maxDuration = config.renderMaxDurationSeconds
    const duration = input.duration === undefined ? 27 : Number(input.duration)
    if (!Number.isFinite(duration) || duration <= 0 || duration > maxDuration) {
      return error(`duration must be between 0 and ${maxDuration}`, 'INVALID_REQUEST', 400)
    }
    const captions = input.captions === undefined ? true : input.captions
    if (typeof captions !== 'boolean') {
      return error('captions must be a boolean', 'INVALID_REQUEST', 400)
    }

    let sourceMediaId: string
    let chosen: string[] | undefined
    if (typeof analysisId === 'string') {
      if (!dependencies.analyses)
        return error('analysis storage is not configured', 'DEPENDENCY_UNAVAILABLE', 503)
      const analysis = await dependencies.analyses.get(analysisId, mediaPrincipal!.userId)
      if (!analysis) return error('analysis was not found', 'ANALYSIS_NOT_FOUND', 404)
      if (analysis.status !== 'done') {
        return error(`analysis is not ready (${analysis.status})`, 'ANALYSIS_NOT_READY', 409)
      }
      if (analysis.people.length === 0) {
        // Пустой person_ids AI-сервис не принимает, поэтому говорим прямо.
        return error('no people were found in the source', 'ANALYSIS_HAS_NO_PEOPLE', 409)
      }
      if (personIds !== undefined) {
        const ids = personIds as string[]
        const known = new Set(analysis.people.map((person) => person.id))
        if (
          ids.length === 0 ||
          ids.length > MAX_PEOPLE ||
          new Set(ids).size !== ids.length ||
          ids.some((id) => !known.has(id))
        ) {
          return error(
            `personIds must be 1..${MAX_PEOPLE} unique ids from the analysis`,
            'INVALID_REQUEST',
            400,
          )
        }
        chosen = ids
      }
      // Исходник берём из разбора: сервис сверяет каталог с отпечатком видео.
      sourceMediaId = analysis.sourceMediaId
    } else {
      sourceMediaId = requestedSource as string
      // Проверяем медиа здесь, а не в воркере: иначе задача гарантированно
      // провалится через минуту вместо честного 404 сразу.
      const source = await dependencies.media.get(sourceMediaId, mediaPrincipal!.userId)
      if (!source) return error('source media was not found', 'MEDIA_NOT_FOUND', 404)
      await source.body.cancel()
    }
    if (typeof musicMediaId === 'string') {
      const music = await dependencies.media.get(musicMediaId, mediaPrincipal!.userId)
      if (!music) return error('music media was not found', 'MEDIA_NOT_FOUND', 404)
      await music.body.cancel()
    }

    const job = await dependencies.renderJobs.create({
      id: crypto.randomUUID(),
      ownerId: mediaPrincipal!.userId,
      kind: 'render',
      sourceMediaId,
      ...(typeof musicMediaId === 'string' ? { musicMediaId } : {}),
      ...(typeof analysisId === 'string' ? { analysisId } : {}),
      ...(chosen ? { personIds: chosen } : {}),
      duration,
      captions,
    })
    try {
      await queue.publish(job.id)
    } catch (failure) {
      // Запись уже есть, но в очередь не попала — помечаем провалившейся, иначе
      // она навсегда осталась бы в queued и выглядела как зависшая.
      await dependencies.renderJobs.fail(
        job.id,
        failure instanceof Error ? failure.message : 'не удалось поставить задачу в очередь',
      )
      return error('render queue is unavailable', 'DEPENDENCY_UNAVAILABLE', 503)
    }
    const response = json(publicJob(job), 202)
    response.headers.set('location', `/renders/${job.id}`)
    return response
  }

  const renderMatch = pathname.match(/^\/renders\/([^/]+)$/)
  if (renderMatch && request.method === 'GET') {
    if (!dependencies.renderJobs)
      return error('render jobs are not configured', 'DEPENDENCY_UNAVAILABLE', 503)
    let id: string
    try {
      id = decodeURIComponent(renderMatch[1]!)
    } catch {
      return error('render id has invalid URL encoding', 'INVALID_RENDER_ID', 400)
    }
    const job = await dependencies.renderJobs.get(id, mediaPrincipal!.userId)
    if (!job) return error('render job was not found', 'RENDER_NOT_FOUND', 404)
    return json(publicJob(job))
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
