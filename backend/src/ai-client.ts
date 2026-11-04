/**
 * Клиент AI-сервиса: POST /v2/prepare и POST /v2/render.
 *
 * Работа разделена на два шага намеренно, это контракт сервиса: prepare по
 * видео собирает каталог персонажей с превью, render по этому каталогу и
 * выбранным персонажам собирает ролик. Одношагового /v1/render больше нет.
 *
 * Тело собирается потоком, а не через FormData с буфером: видео допускается до
 * 150 MB, а у контейнера лимит памяти меньше, чем понадобилось бы на пару
 * таких буферов. Поэтому multipart пишется вручную и отдаётся как
 * ReadableStream.
 */
import type { Config } from './config'

export type MediaSource = {
  name: string
  type: string
  body: ReadableStream<Uint8Array>
}

export type PrepareInput = { video: MediaSource }

export type RenderInput = {
  video: MediaSource
  /**
   * Сырые байты ответа prepare. Именно байты, а не разобранный объект: сервис
   * сверяет каталог с отпечатком исходника, и лишний цикл разбор-сборка только
   * создавал бы риск расхождения.
   */
  analysis: Uint8Array
  /** От 1 до 16 идентификаторов из каталога; пустой список сервис не примет. */
  personIds: string[]
  music?: MediaSource
  duration: number
  captions: boolean
}

/** Общие неудачи: одинаковы для обоих маршрутов, различать их незачем. */
export type AiFailure =
  /** Занят другой работой: в сервисе один слот на prepare и render. Позже. */
  | { status: 'busy'; retryAfterSeconds: number }
  /** Негодное медиа, каталог или параметры — повторять бессмысленно. */
  | { status: 'rejected'; detail: string }
  /** Сервис или Meta недоступны, либо токен не принят — повторить. */
  | { status: 'unavailable'; detail: string }

export type PrepareOutcome =
  /** JSON с catalog, thumbnails и calls — его целиком хранит бэкенд. */
  { status: 'prepared'; body: ReadableStream<Uint8Array> } | AiFailure

export type RenderOutcome =
  /** Готовый mp4 потоком — его сразу можно писать в Blob. */
  { status: 'rendered'; body: ReadableStream<Uint8Array> } | AiFailure

export interface AiClient {
  prepare(input: PrepareInput): Promise<PrepareOutcome>
  render(input: RenderInput): Promise<RenderOutcome>
  ping(): Promise<void>
}

/**
 * Предел на один запрос. Нужен: без него зависшее соединение держало бы
 * единственный слот сервиса бесконечно, и очередь стояла бы вся.
 */
const REQUEST_TIMEOUT_MS = 30 * 60_000

/**
 * Имя файла приходит от пользователя и попадает в заголовок multipart.
 * Кавычки и переводы строк оттуда надо убрать, иначе можно подделать границы
 * части и подсунуть лишние заголовки.
 */
const safeFilename = (name: string) => name.replace(/[\r\n"\\]/g, '_').slice(0, 120) || 'upload'

/** Часть тела: текстовое поле или файл. Файл отличает filename в заголовке. */
type Part =
  | { kind: 'field'; name: string; value: string | Uint8Array }
  | { kind: 'file'; name: string; source: MediaSource }

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
  parts: Part[],
): AsyncGenerator<Uint8Array, void, unknown> {
  const encoder = new TextEncoder()
  for (const part of parts) {
    if (part.kind === 'field') {
      yield encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n`,
      )
      yield typeof part.value === 'string' ? encoder.encode(part.value) : part.value
      yield encoder.encode('\r\n')
      continue
    }
    yield encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${safeFilename(
        part.source.name,
      )}"\r\nContent-Type: ${part.source.type || 'application/octet-stream'}\r\n\r\n`,
    )
    const reader = part.source.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) yield value
    }
    yield encoder.encode('\r\n')
  }
  yield encoder.encode(`--${boundary}--\r\n`)
}

/** Код ошибки из тела ответа сервиса: {"error":{"code":"..."}}. */
const errorCode = (body: string): string | undefined => {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown } }
    const code = parsed.error?.code
    return typeof code === 'string' ? code : undefined
  } catch {
    return undefined
  }
}

export class HttpAiClient implements AiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  /** Общая отправка: успех отдаёт сам ответ, неудачу — размеченный исход. */
  private async send(path: string, parts: Part[]): Promise<Response | AiFailure> {
    const boundary = `----raw2reel${crypto.randomUUID().replace(/-/g, '')}`
    let response: Response
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        body: streamOf(multipart(boundary, parts)[Symbol.asyncIterator]()),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        // У Bun свой предел fetch в 300 секунд, и AbortSignal его НЕ
        // отменяет. Из-за него любой рендер длиннее пяти минут обрывался с
        // «The operation timed out», хотя AI-сервис продолжал работу и
        // успешно заканчивал: 04.11 воркер отвалился на 5:04, сервис отдал
        // 200 на 10:23, а готовый ролик было уже некому принять. С выходом
        // к Meta через Индию рендеры идут 7-11 минут, то есть падали почти
        // всегда. Ограничение остаётся за AbortSignal выше.
        timeout: false,
        // Обязательно при потоковом теле: иначе запрос не отправится.
        duplex: 'half',
      } as RequestInit & { duplex: 'half'; timeout: false })
    } catch (error) {
      return {
        status: 'unavailable',
        detail: error instanceof Error ? error.message : String(error),
      }
    }

    if (response.ok && response.body) return response

    const detail = await response.text().catch(() => '')
    if (response.status === 429) {
      const header = Number(response.headers.get('retry-after'))
      return {
        status: 'busy',
        retryAfterSeconds: Number.isFinite(header) && header > 0 ? header : 10,
      }
    }
    // 413 и 422 — про присланное медиа, каталог или параметры: повтор ничего
    // не изменит. Сюда же попадает face_catalog_limit.
    if (response.status === 413 || response.status === 422) {
      return { status: 'rejected', detail: detail.slice(0, 500) }
    }
    // model_request сервис отдаёт с кодом 502, но смысл у него терминальный:
    // Meta отвергла именно эти байты или сам запрос. Повторять их бессмысленно,
    // а стоит это десяти платных вызовов на каждую задачу — наступали.
    if (errorCode(detail) === 'model_request') {
      return { status: 'rejected', detail: detail.slice(0, 500) }
    }
    // Остальное, включая 401, 502 и 503 model_unconfigured, — наша неполадка
    // или чужая недоступность: повторяем, и после нескольких попыток задача
    // честно становится failed.
    return { status: 'unavailable', detail: `HTTP ${response.status} ${detail.slice(0, 300)}` }
  }

  async prepare(input: PrepareInput): Promise<PrepareOutcome> {
    // Ровно одно поле: любое лишнее сервис отвергает с 422.
    const outcome = await this.send('/v2/prepare', [
      { kind: 'file', name: 'video', source: input.video },
    ])
    return outcome instanceof Response ? { status: 'prepared', body: outcome.body! } : outcome
  }

  async render(input: RenderInput): Promise<RenderOutcome> {
    // Набор полей закрыт разбором на стороне сервиса (max_files=2,
    // max_fields=4), поэтому лишнего здесь быть не должно.
    const parts: Part[] = [
      { kind: 'field', name: 'analysis', value: input.analysis },
      { kind: 'field', name: 'person_ids', value: JSON.stringify(input.personIds) },
      { kind: 'field', name: 'duration', value: String(input.duration) },
      { kind: 'field', name: 'captions', value: input.captions ? 'true' : 'false' },
      { kind: 'file', name: 'video', source: input.video },
    ]
    if (input.music) parts.push({ kind: 'file', name: 'music', source: input.music })
    const outcome = await this.send('/v2/render', parts)
    return outcome instanceof Response ? { status: 'rendered', body: outcome.body! } : outcome
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
