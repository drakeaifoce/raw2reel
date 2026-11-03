import type { Face } from '@/entities/face/@x/video'

/** Raw footage the reel is cut from — an upload or a bundled sample. */
export type Video = {
  id: string
  /** Backend media id for uploaded footage; samples have none. */
  mediaId?: string
  title: string
  meta: string
  /** Placeholder poster tint until real thumbnails are available. */
  tone: string
  /** Faces found in the footage; mocked for samples. */
  faces: Face[]
}
