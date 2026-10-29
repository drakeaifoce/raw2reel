import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ProtectedRoute } from './ProtectedRoute'

const session = vi.hoisted(() => ({ value: null as unknown, pending: false }))

vi.mock('@/shared/api', () => ({
  authClient: {
    useSession: () => ({ data: session.value, isPending: session.pending }),
  },
}))

afterEach(() => cleanup())

test('redirects a guest away from the studio', () => {
  session.value = null
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <Routes>
        <Route path="/" element={<p>Login page</p>} />
        <Route
          path="/studio"
          element={
            <ProtectedRoute>
              <p>Private studio</p>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  )

  expect(screen.getByText('Login page')).toBeDefined()
  expect(screen.queryByText('Private studio')).toBeNull()
})

test('renders the studio for a restored session', () => {
  session.value = { user: { id: 'user-1', email: 'editor@example.com' } }
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <ProtectedRoute>
        <p>Private studio</p>
      </ProtectedRoute>
    </MemoryRouter>,
  )

  expect(screen.getByText('Private studio')).toBeDefined()
})
