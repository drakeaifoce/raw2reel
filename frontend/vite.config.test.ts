import { describe, expect, test } from 'vitest'
import { rewriteApiPath } from './vite.proxy.js'

describe('development API proxy', () => {
  test('exposes the same auth path as production Caddy', () => {
    expect(rewriteApiPath('/api/auth/get-session')).toBe('/auth/get-session')
    expect(rewriteApiPath('/api/media?limit=10')).toBe('/media?limit=10')
  })
})
