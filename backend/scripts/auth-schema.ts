import type saved from '../src/auth-schema.json'
import { memoryAdapter } from '@better-auth/memory-adapter'
import { createAuthServiceWithDatabase } from '../src/auth'

// Offline generation uses the actual auth configuration, no connection or user data.
export async function authSchema() {
  const auth = createAuthServiceWithDatabase(memoryAdapter({ rateLimit: [] }), {
    baseUrl: 'https://docs.invalid',
    secret: 'offline-schema-generation-placeholder-only',
    documentation: true,
  })
  const response = await auth.handler(
    new Request('https://docs.invalid/api/auth/open-api/generate-schema', {
      headers: { 'x-forwarded-for': '127.0.0.1' },
    }),
  )
  if (!response.ok) throw new Error('auth schema generation failed')
  const schema = (await response.json()) as {
    components: { schemas: typeof saved.schemas }
    paths: { '/get-session': typeof saved.session }
  }
  return {
    schemas: schema.components.schemas,
    session: schema.paths['/get-session'],
  }
}
if (import.meta.main) {
  await Bun.write(
    new URL('../src/auth-schema.json', import.meta.url),
    JSON.stringify(await authSchema(), null, 2) + '\n',
  )
}
