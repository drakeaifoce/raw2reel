import { Link } from 'react-router'
import { useProjectStore } from '@/entities/project'
import { useReelStore } from '@/entities/reel'
import { routes } from '@/shared/config'
import styles from './SignOutLink.module.css'

/** Leaves the studio and drops the in-memory edit session. */
export function SignOutLink() {
  const resetProject = useProjectStore((state) => state.reset)
  const resetReel = useReelStore((state) => state.reset)

  return (
    <Link
      to={routes.login}
      className={styles.link}
      onClick={() => {
        resetReel()
        resetProject()
      }}
    >
      Sign out
    </Link>
  )
}
