import { useEffect, useRef } from 'react'
import { useReelStore } from '@/entities/reel'
import { FailedState } from './FailedState'
import { GeneratingState } from './GeneratingState'
import { IdleState } from './IdleState'
import { ResultState } from './ResultState'
import styles from './ReelOutput.module.css'

/** Right column of the studio: placeholder, live progress or the finished reel. */
export function ReelOutput() {
  const stage = useReelStore((state) => state.stage)
  const panelRef = useRef<HTMLElement>(null)
  const shownStage = useRef(stage)

  // On a phone the output sits below the form, so bring each new stage into view.
  useEffect(() => {
    if (shownStage.current === stage) return
    shownStage.current = stage
    const panel = panelRef.current
    if (!panel || stage === 'idle') return
    const { top } = panel.getBoundingClientRect()
    if (top > window.innerHeight * 0.5 || top < 0) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [stage])

  return (
    <section ref={panelRef} aria-label="Output" aria-live="polite" className={styles.panel}>
      {stage === 'idle' && <IdleState />}
      {stage === 'generating' && <GeneratingState />}
      {stage === 'done' && <ResultState />}
      {stage === 'failed' && <FailedState />}
    </section>
  )
}
