import { mediaUrl, sampleContentUrl } from '@/shared/api'
import { formatBytes } from '@/shared/lib'
import type { Video } from './types'

export const SAMPLE_VIDEOS: Video[] = [
  {
    id: 'sample-skate',
    title: 'Street skate session',
    meta: 'Sample · 3 min raw · 1080p',
    tone: '#2C3B58',
    faces: [
      { id: 'a', label: 'Person 1', shots: 'in 41 shots', tone: '#8FA8D9' },
      { id: 'b', label: 'Person 2', shots: 'in 23 shots', tone: '#D9A98F' },
      { id: 'c', label: 'Person 3', shots: 'in 6 shots', tone: '#A8D98F' },
    ],
  },
  {
    id: 'sample-cafe',
    title: 'Café vlog with friends',
    meta: 'Sample · 5 min raw · 4K',
    tone: '#4A3326',
    faces: [
      { id: 'a', label: 'Person 1', shots: 'in 58 shots', tone: '#E0B48A' },
      { id: 'b', label: 'Person 2', shots: 'in 37 shots', tone: '#C9A0D9' },
      { id: 'c', label: 'Person 3', shots: 'in 19 shots', tone: '#8FD9C9' },
      { id: 'd', label: 'Person 4', shots: 'in 4 shots', tone: '#D98F9E' },
    ],
  },
  {
    id: 'sample-gym',
    title: 'Gym day montage',
    meta: 'Sample · 2 min raw · 1080p',
    tone: '#24443A',
    faces: [
      { id: 'a', label: 'Person 1', shots: 'in 33 shots', tone: '#9ED98F' },
      { id: 'b', label: 'Person 2', shots: 'in 12 shots', tone: '#D9C98F' },
    ],
  },
]

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
