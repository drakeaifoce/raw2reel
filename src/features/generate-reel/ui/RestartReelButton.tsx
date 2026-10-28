import { useReelStore } from '@/entities/reel'
import { Button } from '@/shared/ui/button'
import { RestartIcon } from '@/shared/ui/icon'

/** Discards the generated reel but keeps the edit setup for another try. */
export function RestartReelButton({ className }: { className?: string }) {
  const reset = useReelStore((state) => state.reset)

  return (
    <Button size="lg" className={className} onClick={reset}>
      <RestartIcon size={17} />
      Restart
    </Button>
  )
}
