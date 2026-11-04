import { expect, test } from 'vitest'
import { jobErrorMessage } from './request'

test('unwraps the AI service JSON error body', () => {
  expect(
    jobErrorMessage(
      '{"error":{"code":"model_request","message":"Meta Model API rejected the media or request."}}',
    ),
  ).toBe('The AI service could not read this video. Try another clip.')
})

test('explains backend notes instead of showing them', () => {
  expect(jobErrorMessage('исчерпаны попытки (10): HTTP 500 Internal Server Error')).toBe(
    'The AI service is busy right now. Try again in a minute.',
  )
  expect(jobErrorMessage('исходное видео не найдено или недоступно')).toBe(
    'The source video is no longer available. Upload it again.',
  )
  expect(jobErrorMessage('ответ prepare непригоден: scenes')).toBe(
    'Something went wrong while editing. Try again.',
  )
  expect(jobErrorMessage('{"status":"bad"}')).toBe('Something went wrong while editing. Try again.')
})

test('keeps plain English error text as is', () => {
  expect(jobErrorMessage('No people found in this video.')).toBe('No people found in this video.')
  expect(jobErrorMessage(undefined)).toBeUndefined()
})
