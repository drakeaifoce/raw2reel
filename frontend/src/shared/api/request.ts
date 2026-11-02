export class ApiError extends Error {
  /** HTTP status, or `0` for network failures. */
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Same-origin JSON call authenticated by the session cookie (never mixed with a bearer). */
export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...init.headers },
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('Network error. Check your connection and try again.', 0)
  }
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) throw new ApiError(errorMessage(body, response.status), response.status)
  return body as T
}

function errorMessage(body: unknown, status: number) {
  if (status === 401) return 'Your session expired. Sign in again.'
  if (typeof body === 'object' && body !== null) {
    const { error } = body as { error?: unknown }
    if (typeof error === 'string') return error
    if (typeof error === 'object' && error !== null) {
      const { message } = error as { message?: unknown }
      if (typeof message === 'string') return message
    }
  }
  return 'Something went wrong. Try again.'
}
