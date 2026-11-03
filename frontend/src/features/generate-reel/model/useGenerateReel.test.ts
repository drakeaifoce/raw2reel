import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useProjectStore } from '@/entities/project'
import { useReelStore } from '@/entities/reel'
import { useGenerateReel } from './useGenerateReel'

const render = vi.fn(() => Promise.resolve())

beforeEach(() => {
  useReelStore.setState({ render })
  useProjectStore.getState().setVideo({
    id: 'upload-media-1',
    mediaId: 'media-1',
    title: 'clip.mp4',
    meta: '',
    tone: '#000',
    faces: [],
  })
})

afterEach(() => {
  vi.clearAllMocks()
  useProjectStore.getState().reset()
})

test('renders the selected people of a finished analysis', () => {
  useProjectStore.setState({ analysis: { status: 'done', id: 'an-1' }, faceIds: ['p-1'] })
  renderHook(() => useGenerateReel()).result.current()

  expect(render).toHaveBeenCalledWith(
    expect.objectContaining({ analysisId: 'an-1', personIds: ['p-1'] }),
  )
})

test('renders the whole frame when face discovery was skipped', () => {
  useProjectStore.getState().skipAnalysis()
  renderHook(() => useGenerateReel()).result.current()

  expect(render).toHaveBeenCalledWith(expect.objectContaining({ sourceMediaId: 'media-1' }))
  expect(render).toHaveBeenCalledWith(
    expect.not.objectContaining({ analysisId: expect.anything() }),
  )
})
