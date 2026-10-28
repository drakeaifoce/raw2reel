import { createIcon } from './createIcon'

export const ArrowRightIcon = createIcon('ArrowRightIcon', <path d="M5 12h14M13 6l6 6-6 6" />, {
  strokeWidth: 2.2,
})

export const UploadIcon = createIcon(
  'UploadIcon',
  <>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
  </>,
  { strokeWidth: 1.8 },
)

export const VideoIcon = createIcon(
  'VideoIcon',
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M10 9.5v5l4.5-2.5z" />
  </>,
)

export const PhoneVideoIcon = createIcon(
  'PhoneVideoIcon',
  <>
    <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
    <path d="M10.5 9.5v5l4-2.5z" />
  </>,
  { strokeWidth: 1.5 },
)

export const UserIcon = createIcon(
  'UserIcon',
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
  </>,
)

export const CheckIcon = createIcon('CheckIcon', <path d="M5 12.5l4.5 4.5L19 7.5" />, {
  strokeWidth: 2.6,
})

export const SparklesIcon = createIcon(
  'SparklesIcon',
  <>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
  </>,
  { strokeWidth: 2.2 },
)

export const DownloadIcon = createIcon(
  'DownloadIcon',
  <>
    <path d="M12 4v11M7 10l5 5 5-5" />
    <path d="M5 20h14" />
  </>,
  { strokeWidth: 2.2 },
)

export const RestartIcon = createIcon(
  'RestartIcon',
  <>
    <path d="M4 12a8 8 0 1 0 2.4-5.7" />
    <path d="M4 4v4.5h4.5" />
  </>,
  { strokeWidth: 2.2 },
)

export const PlayIcon = createIcon('PlayIcon', <path d="M8 5v14l11-7z" />, { variant: 'fill' })

export const PauseIcon = createIcon(
  'PauseIcon',
  <>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </>,
  { variant: 'fill' },
)
