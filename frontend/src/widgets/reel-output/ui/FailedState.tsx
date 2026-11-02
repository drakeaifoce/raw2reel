import { useReelStore } from '@/entities/reel'
import { RestartReelButton } from '@/features/generate-reel'
import { PhoneVideoIcon } from '@/shared/ui/icon'
import { PhoneFrame } from '@/shared/ui/phone-frame'
import styles from './IdleState.module.css'

export function FailedState() {
  const error = useReelStore((state) => state.error)

  return (
    <div className={styles.idle}>
      <PhoneFrame placeholder className={styles.frame}>
        <PhoneVideoIcon size={40} />
      </PhoneFrame>
      <div className={styles.copy} role="alert">
        <h2 className={styles.title}>The reel could not be rendered</h2>
        <p className={styles.text}>{error ?? 'Something went wrong.'}</p>
      </div>
      <RestartReelButton />
    </div>
  )
}
