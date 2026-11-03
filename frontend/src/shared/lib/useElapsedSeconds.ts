import { useEffect, useState } from 'react'

/** Whole seconds since the component mounted, ticking once a second. */
export function useElapsedSeconds(): number {
  const [startedAt] = useState(() => Date.now())
  const [now, setNow] = useState(startedAt)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  return Math.floor((now - startedAt) / 1000)
}

/** `65` → `1:05`. */
export const formatElapsed = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
