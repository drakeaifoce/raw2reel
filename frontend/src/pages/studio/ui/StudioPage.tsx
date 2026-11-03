import { useEffect } from 'react'
import { resumeAnalysis } from '@/entities/project'
import { useReelStore } from '@/entities/reel'
import { SignOutLink } from '@/features/sign-out'
import { Chip } from '@/shared/ui/chip'
import { UserIcon } from '@/shared/ui/icon'
import { AppHeader } from '@/widgets/app-header'
import { EditSetup } from '@/widgets/edit-setup'
import { ReelOutput } from '@/widgets/reel-output'
import styles from './StudioPage.module.css'
import { authClient } from '@/shared/api'
import { MediaList } from './MediaList'

export function StudioPage() {
  const { data: session } = authClient.useSession()

  // Jobs take minutes; after a reload, keep following the ones still in flight.
  useEffect(() => {
    void resumeAnalysis()
    void useReelStore.getState().resume()
  }, [])

  return (
    <div className={styles.page}>
      <AppHeader
        section="Studio"
        aside={
          <>
            <Chip className={styles.guest}>
              <UserIcon size={14} />
              {session?.user.isAnonymous ? 'Guest session' : (session?.user.email ?? 'Account')}
            </Chip>
            <SignOutLink />
          </>
        }
      />
      <main className={styles.main}>
        <EditSetup />
        <ReelOutput />
        <MediaList />
      </main>
    </div>
  )
}
