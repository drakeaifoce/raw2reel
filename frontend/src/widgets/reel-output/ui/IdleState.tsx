import { PhoneVideoIcon } from '@/shared/ui/icon'
import { PhoneFrame } from '@/shared/ui/phone-frame'
import styles from './IdleState.module.css'

export function IdleState() {
  return (
    <div className={styles.idle}>
      <PhoneFrame placeholder className={styles.frame}>
        <PhoneVideoIcon size={40} />
        <span className={styles.frameLabel}>9:16 preview</span>
      </PhoneFrame>
      <div className={styles.copy}>
        <h2 className={styles.title}>Your reel will appear here</h2>
        <p className={styles.text}>Add footage, pick faces and a track, then hit Generate.</p>
      </div>
    </div>
  )
}
