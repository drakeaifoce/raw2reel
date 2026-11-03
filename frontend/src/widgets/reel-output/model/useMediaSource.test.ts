import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useMediaSource } from './useMediaSource'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('serves the buffered reel from an object URL and revokes it on unmount', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(new Blob(['mp4'])))),
  )
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:reel')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

  const { result, unmount } = renderHook(() => useMediaSource('reel-1'))
  expect(result.current).toEqual({ src: '', loading: true })
  await waitFor(() => expect(result.current).toEqual({ src: 'blob:reel', loading: false }))

  unmount()
  expect(revoke).toHaveBeenCalledWith('blob:reel')
})

test('falls back to the streaming URL when the download fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(null, { status: 500 }))),
  )

  const { result } = renderHook(() => useMediaSource('reel-1'))
  await waitFor(() => expect(result.current).toEqual({ src: '/api/media/reel-1', loading: false }))
})
