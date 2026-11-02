import clsx from 'clsx'
import { useState } from 'react'
import { mediaUrl } from '@/shared/api'
import { Button, buttonVariants } from '@/shared/ui/button'
import { DownloadIcon } from '@/shared/ui/icon'

const FILE_NAME = 'raw2reel_edit.mp4'

type DownloadReelButtonProps = {
  /** Stored reel to download; without it the button is a mock for sample footage. */
  mediaId?: string
  className?: string
}

export function DownloadReelButton({ mediaId, className }: DownloadReelButtonProps) {
  const [saved, setSaved] = useState(false)

  if (mediaId) {
    return (
      <a
        href={mediaUrl(mediaId)}
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
