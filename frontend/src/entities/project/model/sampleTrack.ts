import type { Track } from '@/entities/track/@x/project'
import { MediaUploadError, uploadMedia } from '@/shared/api'
import { useProjectStore } from './store'

const AUDIO_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
}

/**
 * Uploads a bundled sample to the user's media the first time it is picked, so the
 * renderer can mix it in. Ready and in-flight uploads are not repeated.
 */
export async function prepareSampleTrack(track: Track) {
  const { src } = track
  if (!src) return
  const { samples, setSampleUpload } = useProjectStore.getState()
  const current = samples[track.id]
  if (current?.status === 'ready' || current?.status === 'uploading') return

  setSampleUpload(track.id, { status: 'uploading' })
  try {
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
