import { expect, test } from 'vitest'
import { parseSampleName } from './samples'

test('reads artist and title of a released track and drops bracketed tags', () => {
  expect(parseSampleName('../samples/Emin Nilsen - BANE [NCS Release].mp3')).toEqual({
    title: 'BANE',
    artist: 'Emin Nilsen',
    mood: 'Sample',
    bpm: undefined,
  })
})

test('takes an optional tempo part', () => {
  expect(parseSampleName('../samples/X972, sk3tch01 - Montagem Toma - 130bpm.mp3')).toEqual({
    title: 'Montagem Toma',
    artist: 'X972, sk3tch01',
    mood: 'Sample',
    bpm: 130,
  })
})

test('uses the whole name as the title when there is no artist', () => {
  expect(parseSampleName('../samples/Night ride.m4a')).toEqual({
    title: 'Night ride',
    artist: undefined,
    mood: 'Sample',
    bpm: undefined,
  })
})
