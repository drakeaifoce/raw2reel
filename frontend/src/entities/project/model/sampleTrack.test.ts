import { afterEach, expect, test, vi } from 'vitest'
import type { MediaItem } from '@/shared/api'
import { prepareSampleTrack } from './sampleTrack'
import { selectTrack } from './selectors'
import { useProjectStore } from './store'

const api = vi.hoisted(() => ({
  uploadMedia: vi.fn(),
  listSamples: vi.fn<() => Promise<MediaItem[]>>(() => Promise.reject(new Error('offline'))),
  takeSample: vi.fn(),
}))

vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api')>()),
  ...api,
}))

vi.mock('@/entities/track/@x/project', () => ({
  findTrack: (id: string | null) => (id === sample.id ? sample : undefined),
}))

const sample = {
  id: 'sample-night',
  title: 'Night',
  mood: 'Sample',
  src: '/assets/night.mp3',
  fileName: 'Artist - Night.mp3',
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  api.listSamples.mockImplementation(() => Promise.reject(new Error('offline')))
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

test('takes a sample from the backend catalog instead of uploading it', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  api.listSamples.mockResolvedValue([
    { id: 'catalog-1', name: 'Artist - Night.mp3', type: 'audio/mpeg', size: 1, createdAt: '' },
  ])
  api.takeSample.mockResolvedValue({ id: 'copy-1' })
  useProjectStore.getState().selectTrack(sample.id)

  await prepareSampleTrack(sample)

  expect(api.takeSample).toHaveBeenCalledWith('catalog-1')
  expect(api.uploadMedia).not.toHaveBeenCalled()
  expect(fetchMock).not.toHaveBeenCalled()
  expect(selectTrack(useProjectStore.getState())?.mediaId).toBe('copy-1')
})
