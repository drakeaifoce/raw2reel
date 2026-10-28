import type { ReactNode, SVGProps } from 'react'

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  size?: number
}

type IconConfig = {
  viewBox?: string
  /** Stroke-based icons inherit `currentColor` as stroke, filled ones as fill. */
  variant?: 'stroke' | 'fill'
  strokeWidth?: number
}

export function createIcon(displayName: string, paths: ReactNode, config: IconConfig = {}) {
  const { viewBox = '0 0 24 24', variant = 'stroke', strokeWidth = 2 } = config

  function Icon({ size = 16, ...props }: IconProps) {
    const paint =
      variant === 'stroke'
        ? {
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth,
            strokeLinecap: 'round' as const,
            strokeLinejoin: 'round' as const,
          }
        : { fill: 'currentColor' }

    return (
      <svg width={size} height={size} viewBox={viewBox} aria-hidden="true" {...paint} {...props}>
        {paths}
      </svg>
    )
  }

  Icon.displayName = displayName
  return Icon
}
