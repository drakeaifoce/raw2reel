import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router'
import { routes } from '@/shared/config'
import { authClient, identityClient } from '@/shared/api'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession()
  const isGuest = session?.user.isAnonymous === true
  const [identityState, setIdentityState] = useState<'pending' | 'ready' | 'invalid'>('pending')
  const hasAccessToken = Boolean(identityClient.accessToken())

  useEffect(() => {
    if (!isGuest || hasAccessToken) return
    let active = true
    void identityClient.refresh().then((response) => {
      if (active) setIdentityState(response.ok ? 'ready' : 'invalid')
    })
    return () => {
      active = false
    }
  }, [hasAccessToken, isGuest])

  if (isPending || (isGuest && !hasAccessToken && identityState === 'pending')) {
    return <main aria-busy="true">Checking your session…</main>
  }
  if (!session || (isGuest && identityState === 'invalid')) {
    return <Navigate to={routes.login} replace />
  }
  return children
}
