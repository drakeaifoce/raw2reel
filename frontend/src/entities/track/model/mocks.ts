import { SAMPLE_TRACKS } from './samples'
import type { Track } from './types'

/** Shown until real samples are dropped into `../samples`; they carry no audio. */
const PLACEHOLDER_TRACKS: Track[] = [
  { id: 'phonk-drive', title: 'Phonk drive', mood: 'Hard-hitting', bpm: 140 },
  { id: 'sunny-pop', title: 'Sunny pop', mood: 'Upbeat', bpm: 118 },
  { id: 'lofi-evening', title: 'Lo-fi evening', mood: 'Chill', bpm: 86 },
]

export const TRACKS: Track[] = SAMPLE_TRACKS.length > 0 ? SAMPLE_TRACKS : PLACEHOLDER_TRACKS

export function findTrack(id: string | null): Track | undefined {
  return TRACKS.find((track) => track.id === id)
}
