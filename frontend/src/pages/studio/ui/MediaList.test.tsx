import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { MediaList } from './MediaList'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MediaList', () => {
  test('uses the session-scoped endpoint and renders returned media', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'media-1',
              name: 'clip.mp4',
              type: 'video/mp4',
              size: 4,
              createdAt: '2026-10-29T00:00:00.000Z',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetch)
    render(<MediaList />)
    expect(screen.getByRole('status').textContent).toContain('Loading')
    expect((await screen.findByRole('link', { name: 'clip.mp4' })).getAttribute('href')).toBe(
      '/api/media/media-1',
    )
    expect(fetch).toHaveBeenCalledWith('/api/media?limit=20', {
      credentials: 'include',
      signal: expect.any(AbortSignal),
    })
  })

  test('shows an empty state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    render(<MediaList />)
    expect(await screen.findByText('Your uploads will appear here.')).toBeDefined()
  })

  test('fails closed on malformed media metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ items: [{ id: 'media-1', name: 'missing fields' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    render(<MediaList />)
    expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded')
    expect(screen.queryByRole('link')).toBeNull()
  })
})
