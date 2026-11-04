import type { Face } from '@/entities/face/@x/video'

/** Raw footage the reel is cut from — an upload, a server sample or a demo sample. */
export type Video = {
  id: string
  /** Backend media id for stored footage; demo samples have none. */
  mediaId?: string
  title: string
  meta: string
  /** Streamable source for the thumbnail, when the footage is stored. */
  previewUrl?: string
  /** Placeholder poster tint until real thumbnails are available. */
  tone: string
  /** Faces found in the footage; mocked for samples. */
  faces: Face[]
}
