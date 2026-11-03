import { renderHook } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { useMissingRequirement, useWaitingOnService } from './selectors'
import { useProjectStore } from './store'

afterEach(() => useProjectStore.getState().reset())

const video = { id: 'v1', title: 'clip.mp4', mediaId: 'm1', faces: [] }

const requirement = () => ({
  message: renderHook(useMissingRequirement).result.current,
  waiting: renderHook(useWaitingOnService).result.current,
})

test('waits on the service only while it is the blocking step', () => {
  useProjectStore.setState({ video, analysis: { status: 'running' } } as never)
  expect(requirement()).toEqual({ message: 'Still finding people in your footage.', waiting: true })

  // A failed analysis is the user's to fix, even while a sample is still uploading.
  useProjectStore.setState({
    analysis: { status: 'failed', message: 'No people found in this video.' },
    trackId: 'sample-night',
    samples: { 'sample-night': { status: 'uploading' } },
  })
  expect(requirement()).toEqual({
    message: 'Face detection failed. Retry or replace it.',
    waiting: false,
  })

  useProjectStore.getState().skipAnalysis()
  expect(requirement()).toEqual({ message: 'Preparing the soundtrack…', waiting: true })
})
