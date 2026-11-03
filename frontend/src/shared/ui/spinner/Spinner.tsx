import styles from './Spinner.module.css'

/** Indeterminate loader for waits on a service; inherits the text color. */
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span className={styles.spinner} style={{ width: size, height: size }} aria-hidden="true" />
  )
}
