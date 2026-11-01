import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ProtectedRoute } from './ProtectedRoute'

const session = vi.hoisted(() => ({ value: null as unknown, pending: false }))
const identity = vi.hoisted(() => ({ accessToken: vi.fn(), refresh: vi.fn() }))

vi.mock('@/shared/api', () => ({
  authClient: {
    useSession: () => ({ data: session.value, isPending: session.pending }),
  },
  identityClient: identity,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

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

test('restores identity access before opening a registered studio', async () => {
  session.value = { user: { id: 'user-1', email: 'editor@example.com' } }
  identity.accessToken.mockReturnValue(undefined)
  identity.refresh.mockResolvedValue({ ok: true })
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <ProtectedRoute>
        <p>Private studio</p>
      </ProtectedRoute>
    </MemoryRouter>,
  )

  expect(screen.getByText('Checking your session…')).toBeDefined()
  expect(await screen.findByText('Private studio')).toBeDefined()
  expect(identity.refresh).toHaveBeenCalledOnce()
})

test('restores the identity access token before opening a guest studio', async () => {
  session.value = { user: { id: 'guest-1', isAnonymous: true } }
  identity.accessToken.mockReturnValue(undefined)
  identity.refresh.mockResolvedValue({ ok: true })
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <ProtectedRoute>
        <p>Private studio</p>
      </ProtectedRoute>
    </MemoryRouter>,
  )

  expect(screen.getByText('Checking your session…')).toBeDefined()
  expect(await screen.findByText('Private studio')).toBeDefined()
  expect(identity.refresh).toHaveBeenCalledOnce()
})

test('does not refresh again when the session refetch returns a new object', async () => {
  session.value = { user: { id: 'guest-1', isAnonymous: true } }
  identity.accessToken.mockReturnValue(undefined)
  let finish: (response: { ok: boolean }) => void = () => undefined
  identity.refresh.mockReturnValue(new Promise((resolve) => (finish = resolve)))
  const view = (
    <MemoryRouter initialEntries={['/studio']}>
      <ProtectedRoute>
        <p>Private studio</p>
      </ProtectedRoute>
    </MemoryRouter>
  )
  const { rerender } = render(view)

  // Refresh synchronizes Better Auth, which swaps in an equal but new session object.
  session.value = { user: { id: 'guest-1', isAnonymous: true } }
  rerender(view)
  finish({ ok: true })

  expect(await screen.findByText('Private studio')).toBeDefined()
  expect(identity.refresh).toHaveBeenCalledOnce()
})
