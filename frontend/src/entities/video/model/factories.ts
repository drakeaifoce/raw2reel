import { mediaUrl, sampleContentUrl } from '@/shared/api'
import { formatBytes } from '@/shared/lib'
import type { Video } from './types'

type StoredMedia = { id: string; name: string; size: number }

const UPLOAD_TONE = '#33313B'

/** `Beach day.mp4` → `Beach day`. */
const titleOf = (name: string) => name.replace(/\.[^.]+$/, '') || name

/** Wraps stored media as footage; face discovery fills in the faces later. */
export function createUploadedVideo(
  media: StoredMedia,
  origin: 'upload' | 'sample' = 'upload',
): Video {
  return {
    id: `upload-${media.id}`,
    mediaId: media.id,
    title: origin === 'sample' ? titleOf(media.name) : media.name,
    meta: `${origin === 'sample' ? 'Sample' : 'Your upload'} · ${formatBytes(media.size)}`,
    previewUrl: mediaUrl(media.id),
    tone: UPLOAD_TONE,
    faces: [],
  }
}

/** A server sample offered before it is taken; it has no media of the user's yet. */
export function createSampleVideo(sample: StoredMedia): Video {
  return {
    id: `sample-${sample.id}`,
    title: titleOf(sample.name),
    meta: `Sample · ${formatBytes(sample.size)}`,
    previewUrl: sampleContentUrl(sample.id),
    tone: UPLOAD_TONE,
    faces: [],
  }
}
