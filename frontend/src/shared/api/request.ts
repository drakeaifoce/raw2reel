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

/** Backend job errors are internal notes; these are what the user can act on. */
const JOB_ERRORS: [RegExp, string][] = [
  [
    /исчерпаны попытки|занят|busy|unavailable|HTTP 5\d\d|timed? ?out/i,
    'The AI service is busy right now. Try again in a minute.',
  ],
  [
    /не найдено|недоступно|source .*not found/i,
    'The source video is no longer available. Upload it again.',
  ],
  [/отверг|rejected the media/i, 'The AI service could not read this video. Try another clip.'],
]

const JOB_FALLBACK = 'Something went wrong while editing. Try again.'

/**
 * Turns a job `error` field into a message for the user. It may carry the AI
 * service's raw JSON body or a backend note in Russian; known causes get a plain
 * explanation and anything else technical a generic one.
 */
export function jobErrorMessage(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  let text = raw
  try {
    const message = errorMessage(JSON.parse(raw), 200)
    if (message !== FALLBACK_MESSAGE) text = message
  } catch {
    // Plain text already.
  }
  const known = JOB_ERRORS.find(([pattern]) => pattern.test(text))
  if (known) return known[1]
  // Leftover backend notes and JSON bodies mean nothing to the user.
  if (/[а-яё{}]/i.test(text)) return JOB_FALLBACK
  return text
}
