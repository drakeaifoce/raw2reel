import clsx from 'clsx'
import type { ButtonHTMLAttributes } from 'react'
import { CheckIcon } from '@/shared/ui/icon'
import type { Face } from '../../model/types'
import styles from './FaceTile.module.css'

type FaceTileProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  face: Face
  selected?: boolean
}

/** Toggleable avatar for a detected face. */
export function FaceTile({ face, selected = false, className, ...props }: FaceTileProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={clsx(styles.tile, selected && styles.selected, className)}
      {...props}
    >
      <span className={styles.ring}>
        <span className={styles.avatar} style={{ background: face.tone }}>
          <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="20" cy="15" r="8" fill="var(--color-bg)" fillOpacity=".55" />
            <path d="M4 40c2-9 8.5-14 16-14s14 5 16 14z" fill="var(--color-bg)" fillOpacity=".55" />
          </svg>
        </span>
        {selected && (
          <span className={styles.tick}>
            <CheckIcon size={12} strokeWidth={3.2} />
          </span>
        )}
      </span>
      <span className={styles.label}>{face.label}</span>
      <span className={styles.shots}>{face.shots}</span>
    </button>
  )
}
