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
  const result = session.get()
  if (result.error) throw result.error
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
      accessToken = body.accessToken
      await synchronizeSession()
    }
  }
  return response
}

export const identityClient = {
  signIn: (credentials: { email: string; password: string }) =>
    identityRequest('/api/identity/web/sign-in', {
      method: 'POST',
      body: JSON.stringify(credentials),
    }).then(rememberAccess),
  signUp: (input: { email: string; password: string; name: string }) =>
    identityRequest('/api/identity/web/sign-up', {
      method: 'POST',
      body: JSON.stringify({ ...input, mode: 'new' }),
    }),
  startGuest: () =>
    identityRequest('/api/identity/web/guest', { method: 'POST', body: '{}' }).then(rememberAccess),
  async refresh() {
    const csrf = await identityRequest('/api/identity/web/csrf', { method: 'POST', body: '{}' })
    if (!csrf.ok) return csrf
    const { csrfToken } = (await csrf.json()) as { csrfToken: string }
    return identityRequest('/api/identity/web/refresh', {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
      body: '{}',
    }).then(rememberAccess)
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
