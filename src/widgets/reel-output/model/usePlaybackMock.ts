import { useEffect, useState } from 'react'

const TICK_MS = 100
const STEP_PERCENT = 0.6

/** Fakes video playback progress (0–100) until a real player is wired in. */
export function usePlaybackMock(initialPosition = 0) {
  const [playRequested, setPlayRequested] = useState(false)
  const [position, setPosition] = useState(initialPosition)

  const ended = position >= 100
  const playing = playRequested && !ended

  useEffect(() => {
    if (!playing) return

    const timer = setInterval(() => {
      setPosition((current) => Math.min(100, current + STEP_PERCENT))
    }, TICK_MS)

    return () => clearInterval(timer)
  }, [playing])

  const toggle = () => {
    if (ended) {
      setPosition(0)
      setPlayRequested(true)
      return
    }
    setPlayRequested(!playing)
  }

  return { playing, position, toggle }
}
