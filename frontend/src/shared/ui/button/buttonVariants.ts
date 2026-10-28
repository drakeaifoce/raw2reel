import clsx from 'clsx'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

export type ButtonVariantProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
}

/** Class names for button-looking elements, e.g. router links styled as buttons. */
export function buttonVariants({
  variant = 'secondary',
  size = 'sm',
  fullWidth = false,
}: ButtonVariantProps = {}) {
  return clsx(styles.button, styles[variant], styles[size], fullWidth && styles.fullWidth)
}
