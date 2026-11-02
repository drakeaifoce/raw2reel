import { useId } from 'react'
import { useMissingRequirement } from '@/entities/project'
import { useReelStore } from '@/entities/reel'
import { Button } from '@/shared/ui/button'
import { SparklesIcon } from '@/shared/ui/icon'
import { useGenerateReel } from '../model/useGenerateReel'
import styles from './GenerateReelButton.module.css'

export function GenerateReelButton() {
  const missing = useMissingRequirement()
  const stage = useReelStore((state) => state.stage)
  const generate = useGenerateReel()
  const hintId = useId()

  const hint = missing ?? (stage === 'generating' ? 'Editing in progress…' : null)
  const label =
    stage === 'done' ? 'Generate again' : stage === 'failed' ? 'Try again' : 'Generate reel'

  return (
    <div className={styles.wrapper}>
      <Button
        variant="primary"
        size="xl"
        fullWidth
        disabled={hint !== null}
        aria-describedby={hint ? hintId : undefined}
        onClick={generate}
      >
        {hint === null && <SparklesIcon size={18} />}
        {label}
      </Button>
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  )
}
