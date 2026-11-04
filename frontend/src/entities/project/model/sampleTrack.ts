import type { Track } from '@/entities/track/@x/project'
import {
  MediaUploadError,
  listSamples,
  takeSample,
  uploadMedia,
  type MediaItem,
} from '@/shared/api'
import { useProjectStore } from './store'

const AUDIO_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
}

let catalog: Promise<MediaItem[]> | undefined

/** The backend sample catalog, fetched once; a failed fetch is retried next time. */
function sampleCatalog() {
  catalog ??= listSamples().catch((error: unknown) => {
    catalog = undefined
    throw error
  })
  return catalog
}

/** Media id of the server's copy of a bundled sample, if the catalog has one. */
async function takeFromCatalog(track: Track): Promise<string | undefined> {
  if (!track.fileName) return undefined
  const samples = await sampleCatalog().catch(() => [])
  const match = samples.find((item) => item.name === track.fileName)
  if (!match) return undefined
  return (await takeSample(match.id)).id
}

/**
 * Gets a picked sample into the user's media so the renderer can mix it in: taken
 * from the backend catalog when it is there, otherwise uploaded from the bundle.
 * Ready and in-flight samples are not repeated.
 */
export async function prepareSampleTrack(track: Track) {
  const { src } = track
  if (!src) return
  const { samples, setSampleUpload } = useProjectStore.getState()
  const current = samples[track.id]
  if (current?.status === 'ready' || current?.status === 'uploading') return

  setSampleUpload(track.id, { status: 'uploading' })
  try {
    // Copying on the server keeps the file out of the browser; the bundle is the fallback.
    const taken = await takeFromCatalog(track).catch(() => undefined)
    if (taken) {
      setSampleUpload(track.id, { status: 'ready', mediaId: taken })
      return
    }
    const response = await fetch(src)
    if (!response.ok) throw new Error('sample request failed')
    const blob = await response.blob()
    const extension = src.split('?')[0]?.split('.').pop()?.toLowerCase() ?? 'mp3'
    // The media API only takes audio/*, and dev servers may serve samples untyped.
    const type = blob.type.startsWith('audio/')
      ? blob.type
      : (AUDIO_TYPES[extension] ?? 'audio/mpeg')
    const file = new File([blob], `${track.title}.${extension}`, { type })
    const media = await uploadMedia(file)
    setSampleUpload(track.id, { status: 'ready', mediaId: media.id })
  } catch (error) {
    const message =
      error instanceof MediaUploadError ? error.message : 'The soundtrack did not load. Try again.'
    setSampleUpload(track.id, { status: 'failed', message })
  }
}
