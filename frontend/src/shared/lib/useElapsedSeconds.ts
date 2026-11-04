import { useEffect, useState } from 'react'

/** Whole seconds since `since` (epoch ms), or since mount, ticking once a second. */
export function useElapsedSeconds(since?: number): number {
  const [mountedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const startedAt = since ?? mountedAt

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  return Math.max(0, Math.floor((now - startedAt) / 1000))
}

/** `65` → `1:05`. */
export const formatElapsed = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
