import clsx from 'clsx'
import { CheckIcon } from '@/shared/ui/icon'
import { PulseDot } from '@/shared/ui/pulse-dot'
import { VisuallyHidden } from '@/shared/ui/visually-hidden'
import type { PipelineStep, PipelineStepStatus } from '../../model/types'
import styles from './PipelineStepItem.module.css'

const statusLabel: Record<PipelineStepStatus, string> = {
  todo: 'Pending',
  active: 'In progress',
  done: 'Done',
}

type PipelineStepItemProps = {
  step: PipelineStep
  status: PipelineStepStatus
}

export function PipelineStepItem({ step, status }: PipelineStepItemProps) {
  return (
    <li className={clsx(styles.step, styles[status])}>
      <span className={styles.marker}>
        {status === 'done' && <CheckIcon size={16} />}
        {status === 'active' && <PulseDot size={10} />}
        {status === 'todo' && <span className={styles.pending} />}
      </span>
      <span>
        <VisuallyHidden>{statusLabel[status]}: </VisuallyHidden>
        <strong className={styles.agent}>{step.agent}</strong> — {step.text}
      </span>
    </li>
  )
}
