import { expect, test } from 'vitest'
import { jobErrorMessage } from './request'

test('unwraps the AI service JSON error body', () => {
  expect(
    jobErrorMessage(
      '{"error":{"code":"model_request","message":"Meta Model API rejected the media or request."}}',
    ),
  ).toBe('Meta Model API rejected the media or request.')
})

test('keeps plain and unknown error text as is', () => {
  expect(jobErrorMessage('Worker crashed')).toBe('Worker crashed')
  expect(jobErrorMessage('{"status":"bad"}')).toBe('{"status":"bad"}')
  expect(jobErrorMessage(undefined)).toBeUndefined()
})
