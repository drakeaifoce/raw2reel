import { createAuthClient } from 'better-auth/react'
import { anonymousClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({ plugins: [anonymousClient()] })

const identityRequest = (path: string, init: RequestInit = {}) =>
  fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init.headers },
  })

let accessToken: string | undefined

const synchronizeSession = async () => {
  const session = authClient.$store.atoms.session!
  await session.get().refetch()
  const result = await new Promise<ReturnType<typeof session.get>>((resolve) => {
    const settle = (state: ReturnType<typeof session.get>) => {
      if (!state.isRefetching) {
        unsubscribe()
        resolve(state)
      }
    }
    const unsubscribe = session.listen(settle)
    settle(session.get())
  })
  if (result.error) throw result.error
  if (!result.data) throw new Error('Session synchronization did not return an authenticated user')
}

const clearSession = async () => {
  const session = authClient.$store.atoms.session!
  session.set({
    ...session.get(),
    data: null,
    error: null,
    isPending: false,
    isRefetching: false,
  })
  await session.get().refetch()
}

const rememberAccess = async (response: Response) => {
  if (response.ok) {
    const body = (await response.clone().json()) as { accessToken?: unknown }
    if (typeof body.accessToken === 'string') {
      accessToken = undefined
      await synchronizeSession()
      accessToken = body.accessToken
    }
  }
  return response
}

let pendingRefresh: Promise<Response> | undefined

const refreshAccess = async () => {
  const csrf = await identityRequest('/api/identity/web/csrf', { method: 'POST', body: '{}' })
  if (!csrf.ok) return csrf
  const { csrfToken } = (await csrf.json()) as { csrfToken: string }
  return identityRequest('/api/identity/web/refresh', {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
    body: '{}',
  }).then(rememberAccess)
}

export const identityClient = {
  signIn: (credentials: { email: string; password: string }) =>
    identityRequest('/api/identity/web/sign-in', {
      method: 'POST',
      body: JSON.stringify(credentials),
    }).then(rememberAccess),
  async signUp(input: { email: string; password: string; name: string; upgrade?: boolean }) {
    const attempt = async (upgrade: boolean) => {
      let csrfToken: string | undefined
      if (upgrade) {
        const csrf = await identityRequest('/api/identity/web/csrf', { method: 'POST', body: '{}' })
        if (!csrf.ok) return csrf
        csrfToken = ((await csrf.json()) as { csrfToken: string }).csrfToken
      }
      return identityRequest('/api/identity/web/sign-up', {
        method: 'POST',
        headers: csrfToken ? { 'x-csrf-token': csrfToken } : undefined,
        body: JSON.stringify({
          email: input.email,
          password: input.password,
          name: input.name,
          mode: upgrade ? 'upgrade' : 'new',
        }),
      })
    }
    const response = await attempt(input.upgrade === true)
    // Only a live session answers mode=new with 409, so the status alone identifies it. Retrying
    // as a transition keeps the guest's uploads with the new account; without it the form just
    // reports a generic failure and a guest can never register at all.
    if (response.status === 409 && !input.upgrade) return attempt(true).then(rememberAccess)
    return rememberAccess(response)
  },
  startGuest: () =>
    identityRequest('/api/identity/web/guest', { method: 'POST', body: '{}' }).then(rememberAccess),
  refresh() {
    // Refresh tokens are single-use: a second concurrent call would replay the same cookie and
    // revoke the whole family, so every caller shares the in-flight request.
    pendingRefresh ??= refreshAccess().finally(() => {
      pendingRefresh = undefined
    })
    return pendingRefresh
  },
  accessToken: () => accessToken,
  async signOut() {
    const csrf = await identityRequest('/api/identity/web/csrf', { method: 'POST', body: '{}' })
    if (!csrf.ok) return csrf
    const { csrfToken } = (await csrf.json()) as { csrfToken: string }
    const response = await identityRequest('/api/identity/web/logout', {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
      body: '{}',
    })
    if (response.ok) {
      accessToken = undefined
      await clearSession()
    }
    return response
  },
}
