import { createBrowserRouter, Navigate } from 'react-router'
import { LoginPage } from '@/pages/login'
import { StudioPage } from '@/pages/studio'
import { routes } from '@/shared/config'

export const router = createBrowserRouter([
  { path: routes.login, element: <LoginPage /> },
  { path: routes.studio, element: <StudioPage /> },
  { path: '*', element: <Navigate to={routes.login} replace /> },
])
