import styles from './PulseDot.module.css'

export function PulseDot({ size = 8 }: { size?: number }) {
  return <span className={styles.dot} style={{ width: size, height: size }} aria-hidden="true" />
}
