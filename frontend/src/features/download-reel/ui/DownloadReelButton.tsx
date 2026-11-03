import clsx from 'clsx'
import { useState } from 'react'
import { Button, buttonVariants } from '@/shared/ui/button'
import { DownloadIcon } from '@/shared/ui/icon'

const FILE_NAME = 'raw2reel_edit.mp4'

type DownloadReelButtonProps = {
  /** URL of the finished reel; without it the button is a mock for sample footage. */
  href?: string
  className?: string
}

export function DownloadReelButton({ href, className }: DownloadReelButtonProps) {
  const [saved, setSaved] = useState(false)

  if (href) {
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

  return (
    <Button variant="primary" size="lg" className={className} onClick={() => setSaved(true)}>
      <DownloadIcon size={18} />
      {saved ? `Saved · ${FILE_NAME}` : 'Download MP4'}
    </Button>
  )
}
