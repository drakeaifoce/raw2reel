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

const FALLBACK_MESSAGE = 'Something went wrong. Try again.'

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
  return FALLBACK_MESSAGE
}

/**
 * Job `error` fields may carry the AI service's raw JSON body; returns its message,
 * or the text itself when it is already plain.
 */
export function jobErrorMessage(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const message = errorMessage(JSON.parse(raw), 200)
    return message === FALLBACK_MESSAGE ? raw : message
  } catch {
    return raw
  }
}
