import clsx from 'clsx'
import { buttonVariants } from '@/shared/ui/button'
import { DownloadIcon } from '@/shared/ui/icon'

const FILE_NAME = 'raw2reel_edit.mp4'

type DownloadReelButtonProps = {
  /** URL of the finished reel. */
  href?: string
  className?: string
}

export function DownloadReelButton({ href, className }: DownloadReelButtonProps) {
  return (
    <a
      href={href}
      download={FILE_NAME}
      className={clsx(buttonVariants({ variant: 'primary', size: 'lg' }), className)}
    >
      <DownloadIcon size={18} />
      Download MP4
    </a>
  )
}
