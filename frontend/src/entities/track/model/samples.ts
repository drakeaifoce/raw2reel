import type { Track } from './types'

/** Audio dropped into `../samples`, bundled as URLs. */
const files = import.meta.glob<string>('../samples/*.{mp3,wav,m4a,aac,ogg,flac}', {
  eager: true,
  query: '?url',
  import: 'default',
})

const BPM = /^(\d{2,3})\s*(bpm)?$/i

/** Reads `Title - Mood - BPM.ext`; mood and BPM are optional and may come in either order. */
export function parseSampleName(path: string): Pick<Track, 'title' | 'mood' | 'bpm'> {
  const name = (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '')
  const [title = name, ...rest] = name.split(' - ').map((part) => part.trim())
  const bpmPart = rest.find((part) => BPM.test(part))
  const mood = rest.find((part) => part !== bpmPart)
  return {
    title,
    mood: mood ?? 'Sample',
    bpm: bpmPart ? Number(BPM.exec(bpmPart)?.[1]) : undefined,
  }
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')

export const SAMPLE_TRACKS: Track[] = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, src]) => {
    const info = parseSampleName(path)
    return { id: `sample-${slug(info.title)}`, ...info, src }
  })
