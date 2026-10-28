import type { Face } from '@/entities/face/@x/video'

/** Raw footage the reel is cut from — an upload or a bundled sample. */
export type Video = {
  id: string
  title: string
  meta: string
  /** Placeholder poster tint until real thumbnails are available. */
  tone: string
  /** Faces Muse Vision detected in the footage (mocked for now). */
  faces: Face[]
}
