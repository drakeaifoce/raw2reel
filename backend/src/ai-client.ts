/**
 * Клиент AI-сервиса: POST /v1/render.
 *
 * Тело собирается потоком, а не через FormData с буфером: видео допускается до
 * 150 MB, а у контейнера лимит памяти меньше, чем понадобилось бы на пару
 * таких буферов. Поэтому multipart пишется вручную и отдаётся как
 * ReadableStream.
 */
import type { Config } from './config'

export type RenderSource = {
  name: string
  type: string
  body: ReadableStream<Uint8Array>
}

export type RenderInput = {
  video: RenderSource
  music?: RenderSource
  duration: number
  captions: boolean
}

export type RenderOutcome =
  /** Готовый mp4 потоком — его сразу можно писать в Blob. */
  | { status: 'rendered'; body: ReadableStream<Uint8Array> }
  /** Занят другим рендером: в сервисе один слот. Повторить позже. */
  | { status: 'busy'; retryAfterSeconds: number }
  /** Негодное медиа или параметры — повторять бессмысленно. */
  | { status: 'rejected'; detail: string }
  /** Сервис или Meta недоступны, либо токен не принят — повторить. */
  | { status: 'unavailable'; detail: string }

export interface AiClient {
  render(input: RenderInput): Promise<RenderOutcome>
  ping(): Promise<void>
}

/**
 * Имя файла приходит от пользователя и попадает в заголовок multipart.
 * Кавычки и переводы строк оттуда надо убрать, иначе можно подделать границы
 * части и подсунуть лишние заголовки.
 */
const safeFilename = (name: string) => name.replace(/[\r\n"\\]/g, '_').slice(0, 120) || 'upload'

const streamOf = (iterator: AsyncIterator<Uint8Array>) =>
  new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await iterator.next()
      if (done) controller.close()
      else controller.enqueue(value)
    },
  })

async function* multipart(
  boundary: string,
  input: RenderInput,
): AsyncGenerator<Uint8Array, void, unknown> {
  const encoder = new TextEncoder()
  const fields: Record<string, string> = {
    duration: String(input.duration),
    captions: input.captions ? 'true' : 'false',
    subject_ids: '[]',
  }
  for (const [name, value] of Object.entries(fields)) {
    yield encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    )
  }
  const files: [string, RenderSource][] = [['video', input.video]]
  if (input.music) files.push(['music', input.music])
  for (const [name, source] of files) {
    yield encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${safeFilename(
        source.name,
      )}"\r\nContent-Type: ${source.type || 'application/octet-stream'}\r\n\r\n`,
    )
    const reader = source.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) yield value
    }
    yield encoder.encode('\r\n')
  }
  yield encoder.encode(`--${boundary}--\r\n`)
}

export class HttpAiClient implements AiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async render(input: RenderInput): Promise<RenderOutcome> {
    const boundary = `----raw2reel${crypto.randomUUID().replace(/-/g, '')}`
    let response: Response
    try {
      response = await fetch(new URL('/v1/render', this.baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        body: streamOf(multipart(boundary, input)[Symbol.asyncIterator]()),
        // Обязательно при потоковом теле: иначе запрос не отправится.
        duplex: 'half',
      } as RequestInit & { duplex: 'half' })
    } catch (error) {
      return {
        status: 'unavailable',
        detail: error instanceof Error ? error.message : String(error),
      }
    }

    if (response.ok && response.body) return { status: 'rendered', body: response.body }

    const detail = await response.text().catch(() => '')
    if (response.status === 429) {
      const header = Number(response.headers.get('retry-after'))
      return {
        status: 'busy',
        retryAfterSeconds: Number.isFinite(header) && header > 0 ? header : 10,
      }
    }
    // 413 и 422 — про присланное медиа, повтор ничего не изменит.
    if (response.status === 413 || response.status === 422) {
      return { status: 'rejected', detail: detail.slice(0, 500) }
    }
    // Остальное, включая 401 и 503 model_unconfigured, — наша неполадка или
    // чужая недоступность: повторяем, и после нескольких попыток задача
    // честно становится failed.
    return { status: 'unavailable', detail: `HTTP ${response.status} ${detail.slice(0, 300)}` }
  }

  async ping(): Promise<void> {
    const response = await fetch(new URL('/health', this.baseUrl))
    if (!response.ok) throw new Error(`AI-сервис ответил ${response.status}`)
  }
}

export function createAiClient(config: Config): AiClient | undefined {
  if (!config.aiServiceUrl || !config.aiServiceToken) return undefined
  return new HttpAiClient(config.aiServiceUrl, config.aiServiceToken)
}
