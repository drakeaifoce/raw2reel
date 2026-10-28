import type { Track } from './types'

export const TRACKS: Track[] = [
  { id: 'phonk-drive', title: 'Phonk drive', mood: 'Hard-hitting', bpm: 140 },
  { id: 'sunny-pop', title: 'Sunny pop', mood: 'Upbeat', bpm: 118 },
  { id: 'lofi-evening', title: 'Lo-fi evening', mood: 'Chill', bpm: 86 },
]

export function findTrack(id: string | null): Track | undefined {
  return TRACKS.find((track) => track.id === id)
}
