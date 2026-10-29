import { mongodbAdapter } from '@better-auth/mongo-adapter'
import { betterAuth } from 'better-auth/minimal'
import { anonymous } from 'better-auth/plugins'
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
    ],
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
        '/sign-in/anonymous': { window: 15 * 60, max: 5 },
      },
    },
  })

  return {
    handler: (request) => auth.handler(request),
    getSession: async (headers) => auth.api.getSession({ headers }),
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
      if (!response.ok) return null
      const body = (await response.json()) as {
        token?: unknown
        user?: { id?: unknown; isAnonymous?: unknown }
      }
      const sessionCookie = response.headers.get('set-cookie')
      if (
        typeof body.token !== 'string' ||
        typeof body.user?.id !== 'string' ||
        body.user.isAnonymous !== true ||
        !sessionCookie
      ) {
        return null
      }
      return {
        user: { id: body.user.id, isAnonymous: true },
        sessionToken: body.token,
        sessionCookie,
      }
    },
  }
}
