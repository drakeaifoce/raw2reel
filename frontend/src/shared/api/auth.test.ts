import { afterEach, expect, test, vi } from 'vitest'
import { identityClient } from './auth'

afterEach(() => vi.unstubAllGlobals())

test('shares one in-flight refresh so a single-use token is never replayed', async () => {
  const fetch = vi.fn((url: string) =>
    Promise.resolve(
      new Response(JSON.stringify(url.endsWith('/csrf') ? { csrfToken: 'csrf' } : {}), {
        status: url.endsWith('/csrf') ? 200 : 401,
      }),
    ),
  )
  vi.stubGlobal('fetch', fetch)

  const [first, second] = await Promise.all([identityClient.refresh(), identityClient.refresh()])

  expect(first).toBe(second)
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/web/refresh'))).toHaveLength(1)

  await identityClient.refresh()
  expect(fetch.mock.calls.filter(([url]) => url.endsWith('/web/refresh'))).toHaveLength(2)
})
