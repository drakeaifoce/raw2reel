import { SignOutLink } from '@/features/sign-out'
import { Chip } from '@/shared/ui/chip'
import { UserIcon } from '@/shared/ui/icon'
import { AppHeader } from '@/widgets/app-header'
import { EditSetup } from '@/widgets/edit-setup'
import { ReelOutput } from '@/widgets/reel-output'
import styles from './StudioPage.module.css'
import { authClient } from '@/shared/api'
import { MediaList } from './MediaList'
import { GuestRegistration } from './GuestRegistration'

export function StudioPage() {
  const { data: session } = authClient.useSession()
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
        <GuestRegistration />
        <EditSetup />
        <ReelOutput />
        <MediaList />
      </main>
    </div>
  )
}
