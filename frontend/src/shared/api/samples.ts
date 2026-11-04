import { isMediaItem, type MediaItem } from './media'
import { ApiError, requestJson } from './request'

/** Media the service account offers to everyone: sample footage and soundtracks. */
export async function listSamples(signal?: AbortSignal): Promise<MediaItem[]> {
  const body = await requestJson<{ items?: unknown }>('/samples?limit=100', { signal })
  if (!Array.isArray(body.items) || !body.items.every(isMediaItem)) {
    throw new ApiError('Could not load the samples. Try again.', 200)
  }
  return body.items
}

/** Copies a sample into the user's media on the server, so nothing goes through the browser. */
export async function takeSample(id: string): Promise<MediaItem> {
  const media = await requestJson<unknown>(`/samples/${encodeURIComponent(id)}`, {
    method: 'POST',
  })
  if (!isMediaItem(media)) throw new ApiError('Could not open this sample. Try again.', 201)
  return media
}

/** Streams a sample with seeking, for previews before it is taken. */
export const sampleContentUrl = (id: string) => `/api/samples/${encodeURIComponent(id)}/content`
