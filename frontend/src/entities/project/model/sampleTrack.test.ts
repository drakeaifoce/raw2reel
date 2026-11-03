import { afterEach, expect, test, vi } from 'vitest'
import { prepareSampleTrack } from './sampleTrack'
import { selectTrack } from './selectors'
import { useProjectStore } from './store'

const api = vi.hoisted(() => ({ uploadMedia: vi.fn() }))

vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api')>()),
  ...api,
}))

vi.mock('@/entities/track/@x/project', () => ({
  findTrack: (id: string | null) => (id === sample.id ? sample : undefined),
}))

const sample = { id: 'sample-night', title: 'Night', mood: 'Sample', src: '/assets/night.mp3' }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  useProjectStore.getState().reset()
})

test('uploads a picked sample once and hands its media to the render', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(new Blob(['id3'])))),
  )
  api.uploadMedia.mockResolvedValue({ id: 'media-9' })
  useProjectStore.getState().selectTrack(sample.id)

  await prepareSampleTrack(sample)
  await prepareSampleTrack(sample)

  expect(api.uploadMedia).toHaveBeenCalledOnce()
  const file = api.uploadMedia.mock.calls[0]?.[0] as File
  expect([file.name, file.type]).toEqual(['Night.mp3', 'audio/mpeg'])
  expect(selectTrack(useProjectStore.getState())?.mediaId).toBe('media-9')
})

test('reports a failed sample upload so the user can retry', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(null, { status: 404 }))),
  )

  await prepareSampleTrack(sample)

  expect(useProjectStore.getState().samples[sample.id]?.status).toBe('failed')
})
