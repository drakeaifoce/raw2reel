import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { SignInForm } from '@/features/sign-in'
import { SignOutLink } from '@/features/sign-out'
import { authClient, identityClient } from '@/shared/api'
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('identity route flow', () => {
  beforeEach(resetSession)

  afterEach(() => {
    cleanup()
    fetchMock.mockReset()
    resetSession()
  })

  test('retries guest registration after a temporary failure and synchronizes the registered session', async () => {
    let signupAttempts = 0
    let csrfRequests = 0
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : 'url' in input ? input.url : input.href
      if (url.endsWith('/identity/web/csrf')) {
        csrfRequests += 1
        return json({ csrfToken: `csrf-${csrfRequests}` })
      }
      if (url.endsWith('/identity/web/sign-up')) {
        signupAttempts += 1
        return signupAttempts === 1
          ? json({ error: 'temporary transfer failure' }, 503)
          : json({ accessToken: 'registered-access' })
      }
      if (url.includes('/get-session')) return json(registeredSession)
      return json({}, 404)
    })

    const input = {
      email: 'new@example.com',
      password: 'Password1!',
      name: 'Editor',
      upgrade: true,
    }
    expect((await identityClient.signUp(input)).status).toBe(503)
    expect((await identityClient.signUp(input)).status).toBe(200)

    expect(csrfRequests).toBe(2)
    expect(signupAttempts).toBe(2)
    expect(identityClient.accessToken()).toBe('registered-access')
    expect(authClient.$store.atoms.session!.get().data?.user.id).toBe('user-registered')
  })

  // A guest who fills in the registration form holds a live session, and the backend answers
  // mode=new with 409 for exactly that. Reported from production on 02.11.2026: the form only
  // showed a generic failure, so a guest could never register at all.
  test('registers a live guest as a transition when a new account is refused', async () => {
    const bodies: string[] = []
    const csrfHeaders: (string | undefined)[] = []
    let csrfRequests = 0
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : 'url' in input ? input.url : input.href
      if (url.endsWith('/identity/web/csrf')) {
        csrfRequests += 1
        return json({ csrfToken: 'csrf-token' })
      }
      if (url.endsWith('/identity/web/sign-up')) {
        bodies.push(String(init?.body))
        csrfHeaders.push((init?.headers as Record<string, string> | undefined)?.['x-csrf-token'])
        return bodies.length === 1
          ? json({ error: { code: 'ACCOUNT_TRANSITION' } }, 409)
          : json({}, 201)
      }
      return json({}, 404)
    })

    const response = await identityClient.signUp({
      email: 'new@example.com',
      password: 'Password1!',
      name: 'Editor',
    })

    expect(response.status).toBe(201)
    expect(bodies).toHaveLength(2)
    expect(JSON.parse(bodies[0]!).mode).toBe('new')
    expect(JSON.parse(bodies[1]!).mode).toBe('upgrade')
    // The transition is CSRF-protected, and the first attempt must not spend a token on it.
    expect(csrfRequests).toBe(1)
    expect(csrfHeaders[0]).toBeUndefined()
    expect(csrfHeaders[1]).toBe('csrf-token')
  })

  test('does not retry a sign-up that failed for any other reason', async () => {
    let signupAttempts = 0
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : 'url' in input ? input.url : input.href
      if (url.endsWith('/identity/web/sign-up')) {
        signupAttempts += 1
        return json({ error: 'dependency unavailable' }, 503)
      }
      return json({}, 404)
    })

    const response = await identityClient.signUp({
      email: 'new@example.com',
      password: 'Password1!',
      name: 'Editor',
    })

    expect(response.status).toBe(503)
    expect(signupAttempts).toBe(1)
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

  test('does not let an older session refetch restore an account after logout', async () => {
    const oldSessionResponse = deferred<Response>()
    let sessionReads = 0
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : 'url' in input ? input.url : input.href
      if (url.includes('/get-session')) {
        sessionReads += 1
        return sessionReads === 1 ? oldSessionResponse.promise : json(null)
      }
      if (url.endsWith('/identity/web/csrf')) return json({ csrfToken: 'csrf-token' })
      if (url.endsWith('/identity/web/logout')) return new Response(null, { status: 204 })
      return json({}, 404)
    })
    authClient.$store.atoms.session!.set({
      ...authClient.$store.atoms.session!.get(),
      data: registeredSession,
      isPending: false,
    })

    const olderRefetch = authClient.$store.atoms.session!.get().refetch()
    await vi.waitFor(() => expect(sessionReads).toBe(1))
    const logout = await identityClient.signOut()
    expect(logout.ok).toBe(true)

    oldSessionResponse.resolve(json(registeredSession))
    await olderRefetch
    expect(authClient.$store.atoms.session!.get().data).toBeNull()
  })

  test('does not let an older null session overwrite a later guest entry', async () => {
    const oldSessionResponse = deferred<Response>()
    let sessionReads = 0
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : 'url' in input ? input.url : input.href
      if (url.includes('/get-session')) {
        sessionReads += 1
        return sessionReads === 1 ? oldSessionResponse.promise : json(guestSession)
      }
      if (url.endsWith('/identity/web/guest')) {
        return json({ accessToken: 'guest-access' }, 201)
      }
      return json({}, 404)
    })

    const olderRefetch = authClient.$store.atoms.session!.get().refetch()
    await vi.waitFor(() => expect(sessionReads).toBe(1))
    const guestEntry = await identityClient.startGuest()
    expect(guestEntry.ok).toBe(true)

    oldSessionResponse.resolve(json(null))
    await olderRefetch
    expect(authClient.$store.atoms.session!.get().data?.user.id).toBe('user-guest')
  })

  test('waits for a replacement session refetch before completing guest entry', async () => {
    const entrySessionResponse = deferred<Response>()
    const replacementSessionResponse = deferred<Response>()
    let sessionReads = 0
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : 'url' in input ? input.url : input.href
      if (url.includes('/get-session')) {
        sessionReads += 1
        return sessionReads === 1
          ? entrySessionResponse.promise
          : replacementSessionResponse.promise
      }
      if (url.endsWith('/identity/web/guest')) {
        return json({ accessToken: 'guest-access' }, 201)
      }
      return json({}, 404)
    })
    authClient.$store.atoms.session!.set({
      ...authClient.$store.atoms.session!.get(),
      data: registeredSession,
      isPending: false,
    })

    let entrySettled = false
    const guestEntry = identityClient.startGuest().finally(() => {
      entrySettled = true
    })
    await vi.waitFor(() => expect(sessionReads).toBe(1))
    const replacementRefetch = authClient.$store.atoms.session!.get().refetch()
    await vi.waitFor(() => expect(sessionReads).toBe(2))

    entrySessionResponse.resolve(json(guestSession))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(entrySettled).toBe(false)
    expect(authClient.$store.atoms.session!.get().data?.user.id).toBe('user-registered')

    replacementSessionResponse.resolve(json(guestSession))
    await replacementRefetch
    expect((await guestEntry).ok).toBe(true)
    expect(authClient.$store.atoms.session!.get().data?.user.id).toBe('user-guest')
  })

  test('fails guest entry when its replacement session refetch fails', async () => {
    const entrySessionResponse = deferred<Response>()
    const replacementSessionResponse = deferred<Response>()
    let sessionReads = 0
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : 'url' in input ? input.url : input.href
      if (url.includes('/get-session')) {
        sessionReads += 1
        return sessionReads === 1
          ? entrySessionResponse.promise
          : replacementSessionResponse.promise
      }
      if (url.endsWith('/identity/web/guest')) {
        return json({ accessToken: 'guest-access' }, 201)
      }
      return json({}, 404)
    })
    authClient.$store.atoms.session!.set({
      ...authClient.$store.atoms.session!.get(),
      data: registeredSession,
      isPending: false,
    })

    const guestEntry = identityClient.startGuest()
    await vi.waitFor(() => expect(sessionReads).toBe(1))
    const replacementRefetch = authClient.$store.atoms.session!.get().refetch()
    await vi.waitFor(() => expect(sessionReads).toBe(2))
    entrySessionResponse.resolve(json(guestSession))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(authClient.$store.atoms.session!.get().error).toBeNull()
    replacementSessionResponse.resolve(json({ message: 'unavailable' }, 503))

    await replacementRefetch
    await expect(guestEntry).rejects.toBeDefined()
    expect(authClient.$store.atoms.session!.get().data?.user.id).toBe('user-registered')
  })

  test('clears local authentication when the session read fails after successful logout', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : 'url' in input ? input.url : input.href
      if (url.includes('/get-session')) return json({ message: 'unavailable' }, 503)
      if (url.endsWith('/identity/web/csrf')) return json({ csrfToken: 'csrf-token' })
      if (url.endsWith('/identity/web/logout')) return new Response(null, { status: 204 })
      return json({}, 404)
    })
    authClient.$store.atoms.session!.set({
      ...authClient.$store.atoms.session!.get(),
      data: registeredSession,
      isPending: false,
    })

    const logout = await identityClient.signOut()

    expect(logout.ok).toBe(true)
    expect(identityClient.accessToken()).toBeUndefined()
    expect(authClient.$store.atoms.session!.get().data).toBeNull()
  })
})
