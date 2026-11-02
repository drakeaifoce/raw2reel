import { useEffect, useState } from 'react'
import { useProjectStore } from '@/entities/project'
import { useReelStore } from '@/entities/reel'
import { listMedia, type MediaItem } from '@/shared/api'
import styles from './MediaList.module.css'

export function MediaList() {
  const [items, setItems] = useState<MediaItem[]>()
  const [failed, setFailed] = useState(false)
  // Refetch whenever new media lands: uploaded footage or track, or a finished render.
  const footageId = useProjectStore((state) => state.video?.mediaId)
  const trackId = useProjectStore((state) => state.customTrack?.mediaId)
  const reelId = useReelStore((state) => state.resultMediaId)

  useEffect(() => {
    const controller = new AbortController()
    void listMedia(controller.signal)
      .then(setItems)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setFailed(true)
      })
    return () => controller.abort()
  }, [footageId, trackId, reelId])

  return (
    <section className={styles.panel} aria-labelledby="media-title">
      <h2 id="media-title" className={styles.title}>
        Your media
      </h2>
      {failed ? (
        <p role="alert" className={styles.message}>
          Media could not be loaded. Refresh to try again.
        </p>
      ) : items === undefined ? (
        <output className={styles.message}>Loading your media…</output>
      ) : items.length === 0 ? (
        <p className={styles.message}>Your uploads will appear here.</p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id} className={styles.item}>
              <a href={`/api/media/${encodeURIComponent(item.id)}`} className={styles.link}>
                {item.name}
              </a>
              <span className={styles.meta}>{item.type}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
