import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { routes } from '@/shared/config'
import { authClient } from '@/shared/api'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) return <main aria-busy="true">Checking your session…</main>
  if (!session) return <Navigate to={routes.login} replace />
  return children
}
