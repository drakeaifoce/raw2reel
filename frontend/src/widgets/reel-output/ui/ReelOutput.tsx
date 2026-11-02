import { useReelStore } from '@/entities/reel'
import { FailedState } from './FailedState'
import { GeneratingState } from './GeneratingState'
import { IdleState } from './IdleState'
import { ResultState } from './ResultState'
import styles from './ReelOutput.module.css'

/** Right column of the studio: placeholder, live progress or the finished reel. */
export function ReelOutput() {
  const stage = useReelStore((state) => state.stage)

  return (
    <section aria-label="Output" aria-live="polite" className={styles.panel}>
      {stage === 'idle' && <IdleState />}
      {stage === 'generating' && <GeneratingState />}
      {stage === 'done' && <ResultState />}
      {stage === 'failed' && <FailedState />}
    </section>
  )
}
