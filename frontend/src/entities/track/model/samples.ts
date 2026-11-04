import type { Track } from './types'

/** Audio dropped into `../samples`, bundled as URLs. */
const files = import.meta.glob<string>('../samples/*.{mp3,wav,m4a,aac,ogg,flac}', {
  eager: true,
  query: '?url',
  import: 'default',
})

const BPM = /^(\d{2,3})\s*(bpm)?$/i

/**
 * Reads `Artist - Title - BPM.ext`, the usual naming of released tracks. Bracketed tags
 * such as `[NCS Release]` are dropped; artist and BPM are optional.
 */
export function parseSampleName(path: string): Pick<Track, 'title' | 'artist' | 'mood' | 'bpm'> {
  const name = (path.split('/').pop() ?? path)
    .replace(/\.[^.]+$/, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .trim()
  const parts = name.split(' - ').map((part) => part.trim())
  const bpmPart = parts.find((part) => BPM.test(part))
  const [first = name, second] = parts.filter((part) => part !== bpmPart)
  return {
    title: second ?? first,
    artist: second ? first : undefined,
    mood: 'Sample',
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
    const fileName = path.split('/').pop() ?? path
    return { id: `sample-${slug(info.title)}`, ...info, src, fileName }
  })
