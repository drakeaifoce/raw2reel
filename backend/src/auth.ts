import { mongodbAdapter } from '@better-auth/mongo-adapter'
import { betterAuth } from 'better-auth/minimal'
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
      },
    },
  })

  return {
    handler: (request) => auth.handler(request),
    getSession: async (headers) => auth.api.getSession({ headers }),
  }
}
