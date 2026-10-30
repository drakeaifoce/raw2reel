import { useEffect, useState } from 'react'
import { useProjectStore } from '@/entities/project'
import { listMedia, type MediaItem } from '@/shared/api'
import styles from './MediaList.module.css'

export function MediaList() {
  const [items, setItems] = useState<MediaItem[]>()
  const [failed, setFailed] = useState(false)
  // Refetch whenever footage from a fresh upload is selected.
  const uploadedMediaId = useProjectStore((state) => state.video?.mediaId)

  useEffect(() => {
    const controller = new AbortController()
    void listMedia(controller.signal)
      .then(setItems)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setFailed(true)
      })
    return () => controller.abort()
  }, [uploadedMediaId])

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
