export type MediaItem = {
  id: string
  name: string
  type: string
  size: number
  createdAt: string
}

export async function listMedia(signal?: AbortSignal): Promise<MediaItem[]> {
  const response = await fetch('/api/media?limit=20', { credentials: 'include', signal })
  if (!response.ok) throw new Error('media request failed')
  const body = (await response.json()) as { items?: unknown }
  if (!Array.isArray(body.items) || !body.items.every(isMediaItem)) {
    throw new Error('invalid media response')
  }
  return body.items
}

function isMediaItem(item: unknown): item is MediaItem {
  if (typeof item !== 'object' || item === null) return false
  const value = item as Record<string, unknown>
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    typeof value.size === 'number' &&
    typeof value.createdAt === 'string'
  )
}

/** Mirrors the backend limit so oversized files fail before any bytes are sent. */
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024

export class MediaUploadError extends Error {
  /** HTTP status, or `0` for network failures. */
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'MediaUploadError'
    this.status = status
  }
}

const UPLOAD_ERROR_MESSAGES: Record<number, string> = {
  401: 'Your session expired. Sign in again to upload.',
  413: 'This file is larger than 100 MB.',
  415: 'This file type is not supported. Upload a video.',
  503: 'Uploads are temporarily unavailable. Try again later.',
}

type UploadOptions = {
  /** Fraction of the request body sent so far, from 0 to 1. */
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/** Uploads one file as multipart. Uses XHR because fetch cannot report upload progress. */
export function uploadMedia(file: File, { onProgress, signal }: UploadOptions = {}) {
  return new Promise<MediaItem>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const request = new XMLHttpRequest()
    const abort = () => request.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const settle = () => signal?.removeEventListener('abort', abort)

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total)
    })
    request.addEventListener('load', () => {
      settle()
      if (request.status !== 201) {
        const message = UPLOAD_ERROR_MESSAGES[request.status] ?? 'Upload failed. Try again.'
        reject(new MediaUploadError(message, request.status))
        return
      }
      const body = parseJson(request.responseText)
      if (!isMediaItem(body)) {
        reject(new MediaUploadError('Upload failed. Try again.', request.status))
        return
      }
      resolve(body)
    })
    request.addEventListener('error', () => {
      settle()
      reject(new MediaUploadError('Network error. Check your connection and try again.', 0))
    })
    request.addEventListener('abort', () => {
      settle()
      reject(signal?.reason ?? new DOMException('Upload aborted', 'AbortError'))
    })

    const body = new FormData()
    body.append('file', file)
    request.open('POST', '/api/media')
    request.withCredentials = true
    request.send(body)
  })
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
