import { mongodbAdapter } from '@better-auth/mongo-adapter'
import { betterAuth } from 'better-auth/minimal'
import { MongoClient } from 'mongodb'
import type { AuthService } from './app'
import type { Config } from './config'

export function createAuthService(config: Config): AuthService | undefined {
  if (!config.mongoUrl || !config.betterAuthSecret || !config.betterAuthUrl) return undefined
  if (config.betterAuthSecret.length < 32) return undefined

  const baseUrl = new URL(config.betterAuthUrl)
  const mongo = new MongoClient(config.mongoUrl)
  const auth = betterAuth({
    appName: 'Raw2Reel',
    database: mongodbAdapter(mongo.db(config.mongoDb), {
      // Cosmos DB supports transactions only inside one unsharded collection,
      // while signup writes multiple Better Auth collections.
      transaction: false,
    }),
    secret: config.betterAuthSecret,
    baseURL: baseUrl.origin,
    basePath: '/api/auth',
    trustedOrigins: [baseUrl.origin, ...config.betterAuthTrustedOrigins],
    emailAndPassword: { enabled: true },
    advanced: {
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
