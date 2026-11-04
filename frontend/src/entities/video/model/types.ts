import type { Face } from '@/entities/face/@x/video'

/** Raw footage the reel is cut from: an upload or a server sample. */
export type Video = {
  id: string
  /** Backend media id; absent for a server sample that is not taken yet. */
  mediaId?: string
  title: string
  meta: string
  /** Streamable source for the thumbnail, when the footage is stored. */
  previewUrl?: string
  /** Placeholder poster tint until real thumbnails are available. */
  tone: string
  /** Faces found in the footage. */
  faces: Face[]
}
