import { useState } from 'react'
import { Button } from '@/shared/ui/button'
import { DownloadIcon } from '@/shared/ui/icon'

const FILE_NAME = 'raw2reel_edit.mp4'

/** Mock download: flips to a "saved" state until export is implemented. */
export function DownloadReelButton({ className }: { className?: string }) {
  const [saved, setSaved] = useState(false)

  return (
    <Button variant="primary" size="lg" className={className} onClick={() => setSaved(true)}>
      <DownloadIcon size={18} />
      {saved ? `Saved · ${FILE_NAME}` : 'Download MP4'}
    </Button>
  )
}
