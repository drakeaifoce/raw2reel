import clsx from 'clsx'
import type { ButtonHTMLAttributes } from 'react'
import { buttonVariants, type ButtonVariantProps } from './buttonVariants'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & ButtonVariantProps

export function Button({
  variant,
  size,
  fullWidth,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx(buttonVariants({ variant, size, fullWidth }), className)}
      {...props}
    />
  )
}
