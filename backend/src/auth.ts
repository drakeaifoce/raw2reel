import { mongodbAdapter } from '@better-auth/mongo-adapter'
import { betterAuth } from 'better-auth/minimal'
import { anonymous, openAPI } from 'better-auth/plugins'
import type { BetterAuthOptions } from 'better-auth'
import { MongoClient } from 'mongodb'
import type { AuthService } from './app'
import type { Config } from './config'

export function createAuthService(config: Config): AuthService | undefined {
  if (!config.mongoUrl || !config.betterAuthSecret || !config.betterAuthUrl) return undefined
  if (config.betterAuthSecret.length < 32) return undefined

  const baseUrl = new URL(config.betterAuthUrl)
  const mongo = new MongoClient(config.mongoUrl)
  return createAuthServiceWithDatabase(
    mongodbAdapter(mongo.db(config.mongoDb), {
      // Cosmos DB supports transactions only inside one unsharded collection,
      // while signup writes multiple Better Auth collections.
      transaction: false,
    }),
    {
      baseUrl: baseUrl.origin,
      secret: config.betterAuthSecret,
      trustedOrigins: config.betterAuthTrustedOrigins,
    },
  )
}

type AuthServiceOptions = {
  baseUrl: string
  secret: string
  trustedOrigins?: string[]
  /** Enable the schema generator only in offline documentation tooling. */
  documentation?: boolean
}

export function createAuthServiceWithDatabase(
  database: BetterAuthOptions['database'],
  options: AuthServiceOptions,
): AuthService {
  const baseUrl = new URL(options.baseUrl)
  const auth = betterAuth({
    appName: 'Raw2Reel',
    database,
    secret: options.secret,
    baseURL: baseUrl.origin,
    basePath: '/api/auth',
    trustedOrigins: [baseUrl.origin, ...(options.trustedOrigins ?? [])],
    emailAndPassword: { enabled: true },
    user: {
      additionalFields: {
        registrationOperationId: { type: 'string', required: false, input: true },
      },
    },
    plugins: [
      anonymous({
        // Guest lifecycle is owned by the explicit, fenced cleanup process.
        // Linking or logging out must never delete an identity implicitly.
        disableDeleteAnonymousUser: true,
        onLinkAccount: async () => {
          // Ownership transfer is deliberately handled by the guarded upgrade
          // operation. Better Auth's implicit link callback has no owner fence.
          throw new Error('implicit anonymous account linking is disabled')
        },
      }),
      ...(options.documentation ? [openAPI({ disableDefaultReference: true })] : []),
    ] as const,
    advanced: {
      // Keep origin validation enabled in test environments as well, so the
      // integration suite exercises the same CSRF boundary as production.
      disableOriginCheck: false,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: baseUrl.protocol === 'https:',
        sameSite: 'lax',
        path: '/',
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      customRules: {
        '/sign-in/email': { window: 15 * 60, max: 10 },
        '/sign-up/email': { window: 15 * 60, max: 10 },
        // Точка входа на сайт: гость создаётся при первом заходе, поэтому окно
        // здесь минутное, а не как у входа по почте. С прежними 5 на 15 минут
        // пользователь выключал себе сайт пятью перезагрузками страницы, причём
        // отказ доходил до браузера как 503, а не как 429.
        '/sign-in/anonymous': { window: 60, max: 20 },
      },
    },
  })

  return {
    handler: (request) => auth.handler(request),
    getSession: async (headers) => {
      const result = await auth.api.getSession({ headers })
      return result
        ? {
            user: {
              id: result.user.id,
              email: result.user.email,
              name: result.user.name,
              isAnonymous: result.user.isAnonymous,
              ...(typeof result.user.registrationOperationId === 'string'
                ? { registrationOperationId: result.user.registrationOperationId }
                : {}),
            },
            sessionToken: (result.session as { token?: string }).token,
          }
        : null
    },
    createGuest: async (headers) => {
      const requestHeaders = new Headers(headers)
      requestHeaders.set('content-type', 'application/json')
      const response = await auth.handler(
        new Request(new URL('/api/auth/sign-in/anonymous', baseUrl.origin).toString(), {
          method: 'POST',
          headers: requestHeaders,
          body: '{}',
        }),
      )
      // Отказ лимитера отличаем от прочих сбоев: иначе он доходит до клиента
      // как 503 «недоступная зависимость», и понять, что надо просто подождать,
      // невозможно ни пользователю, ни тому, кто разбирает жалобу.
      if (response.status === 429) {
        const header = Number(response.headers.get('retry-after'))
        return {
          status: 'rate-limited',
          retryAfterSeconds: Number.isFinite(header) && header > 0 ? header : 60,
        }
      }
      if (!response.ok) return { status: 'failed' }
      const body = (await response.json()) as {
        token?: unknown
        user?: { id?: unknown; isAnonymous?: unknown; registrationOperationId?: unknown }
      }
      const sessionCookie = response.headers.get('set-cookie')
      if (
        typeof body.token !== 'string' ||
        typeof body.user?.id !== 'string' ||
        body.user.isAnonymous !== true ||
        !sessionCookie
      ) {
        return { status: 'failed' }
      }
      return {
        status: 'created',
        session: {
          user: { id: body.user.id, isAnonymous: true },
          sessionToken: body.token,
          sessionCookie,
        },
      }
    },
    signInEmail: async (headers, input) => {
      const requestHeaders = new Headers(headers)
      requestHeaders.set('content-type', 'application/json')
      const response = await auth.handler(
        new Request(new URL('/api/auth/sign-in/email', baseUrl.origin).toString(), {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(input),
        }),
      )
      if (!response.ok) return null
      const body = (await response.json()) as {
        token?: unknown
        user?: { id?: unknown; isAnonymous?: unknown; registrationOperationId?: unknown }
      }
      const sessionCookie = response.headers.get('set-cookie')
      if (
        typeof body.token !== 'string' ||
        typeof body.user?.id !== 'string' ||
        body.user.isAnonymous === true ||
        !sessionCookie
      ) {
        return null
      }
      return {
        user: {
          id: body.user.id,
          isAnonymous: false,
          ...(typeof body.user.registrationOperationId === 'string'
            ? { registrationOperationId: body.user.registrationOperationId }
            : {}),
        },
        sessionToken: body.token,
        sessionCookie,
      }
    },
    signUpEmail: async (input) => {
      // ИЗВЕСТНОЕ СЛЕДСТВИЕ: клиентские заголовки сюда не доходят, потому что
      // RegistrationService зовёт signUpEmail без них. Без X-Forwarded-For
      // лимитер не определяет адрес и складывает ВСЕ регистрации в один
      // счётчик `no-trusted-ip` — десять на 15 минут на весь мир. Такой ключ
      // наблюдался в базе 01.11.2026. Починка требует протащить заголовки
      // через RegistrationService.register и acceptRegistration — отдельная
      // правка, здесь не делается.
      const response = await auth.handler(
        new Request(new URL('/api/auth/sign-up/email', baseUrl.origin).toString(), {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: baseUrl.origin },
          body: JSON.stringify(input),
        }),
      )
      if (!response.ok) return null
      const body = (await response.json()) as {
        token?: unknown
        user?: { id?: unknown; registrationOperationId?: unknown }
      }
      const sessionCookie = response.headers.get('set-cookie')
      if (typeof body.token !== 'string' || typeof body.user?.id !== 'string' || !sessionCookie) {
        return null
      }
      return {
        user: {
          id: body.user.id,
          isAnonymous: false,
          ...(typeof body.user.registrationOperationId === 'string'
            ? { registrationOperationId: body.user.registrationOperationId }
            : {}),
        },
        sessionToken: body.token,
        sessionCookie,
      }
    },
    signOut: (headers) =>
      auth.handler(
        new Request(new URL('/api/auth/sign-out', baseUrl.origin).toString(), {
          method: 'POST',
          headers,
        }),
      ),
  }
}
