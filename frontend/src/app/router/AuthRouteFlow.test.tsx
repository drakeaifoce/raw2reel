import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { SignInForm } from '@/features/sign-in'
import { SignOutLink } from '@/features/sign-out'
import { authClient } from '@/shared/api'
import { ProtectedRoute } from './ProtectedRoute'

const fetchMock = vi.hoisted(() => {
  const mock = vi.fn()
  vi.stubGlobal('fetch', mock)
  return mock
})

const registeredSession = {
  session: {
    id: 'session-registered',
    userId: 'user-registered',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    token: 'session-token',
  },
  user: {
    id: 'user-registered',
    name: 'Editor',
    email: 'editor@example.com',
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
}

const guestSession = {
  ...registeredSession,
  session: { ...registeredSession.session, id: 'session-guest', userId: 'user-guest' },
  user: {
    ...registeredSession.user,
    id: 'user-guest',
    name: 'Guest',
    email: 'guest@example.invalid',
    isAnonymous: true,
  },
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function renderFlow() {
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <Routes>
        <Route path="/" element={<SignInForm />} />
        <Route
          path="/studio"
          element={
            <ProtectedRoute>
              <p>Studio opened</p>
              <SignOutLink />
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

function resetSession() {
  const session = authClient.$store.atoms.session!
  session.set({
    ...session.get(),
    data: null,
    error: null,
    isPending: false,
    isRefetching: false,
  })
}

describe('identity route flow', () => {
  beforeEach(resetSession)

  afterEach(() => {
    cleanup()
    fetchMock.mockReset()
    resetSession()
  })

  test.each([
    ['registered', registeredSession, 'Sign in'],
    ['guest', guestSession, 'Continue as guest'],
  ])(
    'refreshes the real Better Auth store before opening a %s studio',
    async (_, session, action) => {
      let activeSession: typeof registeredSession | typeof guestSession | null = null
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : 'url' in input ? input.url : input.href
        if (url.includes('/get-session')) return json(activeSession)
        if (url.includes('/identity/web/')) {
          activeSession = session
          return json({ accessToken: 'access-token' }, 201)
        }
        return json({}, 404)
      })

      renderFlow()
      expect(await screen.findByRole('button', { name: action })).toBeDefined()

      if (action === 'Sign in') {
        fireEvent.change(screen.getByLabelText('Email'), {
          target: { value: 'editor@example.com' },
        })
        fireEvent.change(screen.getByLabelText('Password'), {
          target: { value: 'correct-password' },
        })
      }
      fireEvent.click(screen.getByRole('button', { name: action }))

      expect(await screen.findByText('Studio opened')).toBeDefined()
    },
  )

  test('clears the session store on logout before entering with another account', async () => {
    let activeSession: typeof registeredSession | typeof guestSession | null = null
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : 'url' in input ? input.url : input.href
      if (url.includes('/get-session')) return json(activeSession)
      if (url.endsWith('/identity/web/csrf')) return json({ csrfToken: 'csrf-token' })
      if (url.endsWith('/identity/web/logout')) {
        activeSession = null
        return new Response(null, { status: 204 })
      }
      if (url.endsWith('/identity/web/sign-in')) {
        activeSession = registeredSession
        return json({ accessToken: 'registered-access' }, 201)
      }
      if (url.endsWith('/identity/web/guest')) {
        activeSession = guestSession
        return json({ accessToken: 'guest-access' }, 201)
      }
      return json({}, 404)
    })

    renderFlow()
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'editor@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Studio opened')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('button', { name: 'Continue as guest' })).toBeDefined()
    expect(authClient.$store.atoms.session!.get().data).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Continue as guest' }))
    expect(await screen.findByText('Studio opened')).toBeDefined()
    expect(authClient.$store.atoms.session!.get().data?.user.id).toBe('user-guest')
  })
})
