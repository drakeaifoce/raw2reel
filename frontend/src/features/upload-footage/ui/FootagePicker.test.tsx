import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useProjectStore } from '@/entities/project'
import { FootagePicker } from './FootagePicker'

const mocks = vi.hoisted(() => ({
  uploadMedia: vi.fn(),
  listSamples: vi.fn(),
  takeSample: vi.fn(),
  createAnalysis: vi.fn(() => new Promise(() => undefined)),
}))

vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api')>()),
  ...mocks,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useProjectStore.getState().reset()
})

const pickFile = (file: File) => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
  fireEvent.change(input, { target: { files: [file] } })
}

test('uploads the picked video and selects the stored media as footage', async () => {
  let reportProgress: (fraction: number) => void = () => undefined
  let finish: (media: unknown) => void = () => undefined
  mocks.uploadMedia.mockImplementation(
    (_file: File, options: { onProgress: (fraction: number) => void }) => {
      reportProgress = options.onProgress
      return new Promise((resolve) => (finish = resolve))
    },
  )
  render(<FootagePicker />)

  const file = new File(['clip'], 'clip.mp4', { type: 'video/mp4' })
  pickFile(file)
  expect(mocks.uploadMedia).toHaveBeenCalledWith(file, expect.anything())
  reportProgress(0.4)
  expect(await screen.findByText('Uploading · 40%')).toBeTruthy()

  finish({ id: 'media-1', name: 'clip.mp4', type: 'video/mp4', size: 2048, createdAt: '' })
  expect(await screen.findByText('Your upload · 2.0 KB')).toBeTruthy()
  expect(useProjectStore.getState().video?.mediaId).toBe('media-1')
})

test('rejects non-video files without uploading', async () => {
  render(<FootagePicker />)
  pickFile(new File(['x'], 'notes.txt', { type: 'text/plain' }))
  expect((await screen.findByRole('alert')).textContent).toContain('not supported')
  expect(mocks.uploadMedia).not.toHaveBeenCalled()
})

test('shows the server error and keeps the dropzone available', async () => {
  const { MediaUploadError } = await import('@/shared/api')
  mocks.uploadMedia.mockRejectedValue(new MediaUploadError('This file is larger than 100 MB.', 413))
  render(<FootagePicker />)
  pickFile(new File(['clip'], 'clip.mp4', { type: 'video/mp4' }))
  expect((await screen.findByRole('alert')).textContent).toBe('This file is larger than 100 MB.')
  expect(screen.getByText('Drop one video or browse')).toBeTruthy()
})

const media = (id: string, name: string, type: string) => ({
  id,
  name,
  type,
  size: 90 * 1024 * 1024,
  createdAt: '',
})

test('takes a server sample video without uploading it from the browser', async () => {
  mocks.listSamples.mockResolvedValue([
    media('track-1', 'BANE.mp3', 'audio/mpeg'),
    media('sample-1', 'Beach day.mp4', 'video/mp4'),
  ])
  mocks.takeSample.mockResolvedValue(media('copy-1', 'Beach day.mp4', 'video/mp4'))
  render(<FootagePicker />)

  fireEvent.click(screen.getByRole('button', { name: /use a sample video/i }))
  // Soundtracks share the catalog but are not footage.
  expect(screen.queryByText('BANE')).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: /beach day/i }))

  expect(await screen.findByRole('button', { name: 'Replace' })).toBeTruthy()
  expect(mocks.takeSample).toHaveBeenCalledWith('sample-1')
  expect(mocks.uploadMedia).not.toHaveBeenCalled()
  expect(useProjectStore.getState().video?.mediaId).toBe('copy-1')
  expect(mocks.createAnalysis).toHaveBeenCalledWith('copy-1')
})

test('offers the demo samples while the catalog has no videos', async () => {
  mocks.listSamples.mockResolvedValue([media('track-1', 'BANE.mp3', 'audio/mpeg')])
  render(<FootagePicker />)

  fireEvent.click(screen.getByRole('button', { name: /use a sample video/i }))
  expect(await screen.findByText('Street skate session')).toBeTruthy()
})
