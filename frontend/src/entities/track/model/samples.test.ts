import { expect, test } from 'vitest'
import { parseSampleName } from './samples'

test('reads title, mood and tempo from the file name', () => {
  expect(parseSampleName('../samples/Phonk drive - Hard-hitting - 140.mp3')).toEqual({
    title: 'Phonk drive',
    mood: 'Hard-hitting',
    bpm: 140,
  })
  expect(parseSampleName('../samples/Sunny pop - 118bpm - Upbeat.wav')).toEqual({
    title: 'Sunny pop',
    mood: 'Upbeat',
    bpm: 118,
  })
})

test('falls back when mood and tempo are missing', () => {
  expect(parseSampleName('../samples/Night ride.m4a')).toEqual({
    title: 'Night ride',
    mood: 'Sample',
    bpm: undefined,
  })
})
