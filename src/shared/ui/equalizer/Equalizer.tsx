import styles from './Equalizer.module.css'

const BARS = 4

/** Animated audio bars, used as a "now playing" indicator. */
export function Equalizer() {
  return (
    <span className={styles.equalizer} aria-hidden="true">
      {Array.from({ length: BARS }, (_, i) => (
        <i key={i} className={styles.bar} />
      ))}
    </span>
  )
}
