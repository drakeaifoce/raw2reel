import { useNavigate } from 'react-router'
import { useState } from 'react'
import { useProjectStore } from '@/entities/project'
import { useReelStore } from '@/entities/reel'
import { routes } from '@/shared/config'
import { authClient } from '@/shared/api'
import styles from './SignOutLink.module.css'

/** Leaves the studio and drops the in-memory edit session. */
export function SignOutLink() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const resetProject = useProjectStore((state) => state.reset)
  const resetReel = useReelStore((state) => state.reset)

  return (
    <span>
      <button
        type="button"
        className={styles.link}
        onClick={async () => {
          setError('')
          try {
            const result = await authClient.signOut()
            if (result.error) {
              setError('Unable to sign out. Try again.')
              return
            }
            resetReel()
            resetProject()
            void navigate(routes.login, { replace: true })
          } catch {
            setError('Unable to sign out. Try again.')
          }
        }}
      >
        Sign out
      </button>
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </span>
  )
}
