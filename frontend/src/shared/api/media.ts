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
