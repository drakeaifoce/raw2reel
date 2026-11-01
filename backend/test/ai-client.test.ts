import { afterEach, describe, expect, test } from 'bun:test'
import { HttpAiClient } from '../src/ai-client'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

type Sent = { url: string; authorization: string | null; body: string }

/**
 * Подменяем fetch и смотрим, что ушло в сеть. Проверяем именно это, потому что
 * сломался в своё время не код, а контракт: имена полей и адрес маршрута.
 */
const intercept = (response: Response) => {
  const sent: Sent[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    const body = init?.body ? await new Response(init.body).text() : ''
    const headers = new Headers(init?.headers)
    sent.push({ url, authorization: headers.get('authorization'), body })
    return response.clone()
  }) as typeof fetch
  return sent
}

const videoSource = () => ({
  name: 'clip.mp4',
  type: 'video/mp4',
  body: new Blob(['video-bytes']).stream() as ReadableStream<Uint8Array>,
})

// Отрицательный просмотр назад нужен, чтобы не поймать filename="...".
const fieldNames = (body: string) =>
  [...body.matchAll(/(?<!file)name="([^"]+)"/g)].map((match) => match[1]!)

const client = new HttpAiClient('http://ai:8000', 'token-123')

describe('prepare', () => {
  test('шлёт ровно одно поле video на /v2/prepare: лишнее сервис отвергает', async () => {
    const sent = intercept(new Response('{"catalog":{}}', { status: 200 }))
    const outcome = await client.prepare({ video: videoSource() })

    expect(outcome.status).toBe('prepared')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.url).toBe('http://ai:8000/v2/prepare')
    expect(sent[0]!.authorization).toBe('Bearer token-123')
    expect(fieldNames(sent[0]!.body)).toEqual(['video'])
    expect(sent[0]!.body).toContain('filename="clip.mp4"')
    expect(sent[0]!.body).toContain('video-bytes')
  })

  test('кавычки и переводы строк в имени файла не ломают границы частей', async () => {
    const sent = intercept(new Response('{}', { status: 200 }))
    await client.prepare({
      video: {
        name: 'evil"\r\nContent-Disposition: form-data; name="duration',
        type: 'video/mp4',
        body: new Blob(['x']).stream() as ReadableStream<Uint8Array>,
      },
    })
    // Подделать второе поле не удалось: имя осталось единственным.
    expect(fieldNames(sent[0]!.body)).toEqual(['video'])
  })
})

describe('render', () => {
  const input = {
    analysis: new TextEncoder().encode('{"catalog":{"people":[]}}'),
    personIds: ['p1', 'p3'],
    duration: 20,
    captions: false,
  }

  test('шлёт закрытый набор полей на /v2/render', async () => {
    const sent = intercept(new Response('mp4', { status: 200 }))
    const outcome = await client.render({ video: videoSource(), ...input })

    expect(outcome.status).toBe('rendered')
    expect(sent[0]!.url).toBe('http://ai:8000/v2/render')
    // Разбор на стороне сервиса ограничен max_files=2 и max_fields=4, поэтому
    // набор должен быть ровно таким.
    expect(fieldNames(sent[0]!.body)).toEqual([
      'analysis',
      'person_ids',
      'duration',
      'captions',
      'video',
    ])
    expect(sent[0]!.body).toContain('{"catalog":{"people":[]}}')
    expect(sent[0]!.body).toContain('["p1","p3"]')
    expect(sent[0]!.body).toContain('20')
    expect(sent[0]!.body).toContain('false')
  })

  test('музыка добавляется вторым файлом, когда она есть', async () => {
    const sent = intercept(new Response('mp4', { status: 200 }))
    await client.render({
      video: videoSource(),
      music: {
        name: 'track.mp3',
        type: 'audio/mpeg',
        body: new Blob(['music']).stream() as ReadableStream<Uint8Array>,
      },
      ...input,
    })
    expect(fieldNames(sent[0]!.body)).toEqual([
      'analysis',
      'person_ids',
      'duration',
      'captions',
      'video',
      'music',
    ])
  })

  test('занятый слот — это busy с паузой из Retry-After, а не провал', async () => {
    intercept(new Response('busy', { status: 429, headers: { 'retry-after': '42' } }))
    const outcome = await client.render({ video: videoSource(), ...input })
    expect(outcome).toMatchObject({ status: 'busy', retryAfterSeconds: 42 })
  })

  test('422 и 413 — отказ без повтора, остальное повторяемо', async () => {
    for (const status of [413, 422]) {
      intercept(new Response('нельзя', { status }))
      expect((await client.render({ video: videoSource(), ...input })).status).toBe('rejected')
    }
    for (const status of [401, 502, 503]) {
      intercept(new Response('позже', { status }))
      expect((await client.render({ video: videoSource(), ...input })).status).toBe('unavailable')
    }
  })

  test('model_request терминален, хотя приходит с кодом 502', async () => {
    // Сервис отдаёт 502 и на «Meta отвергла байты», и на «Meta недоступна».
    // Различать их можно только по коду в теле, иначе задача десять раз
    // повторяет заведомо отвергнутый запрос.
    intercept(
      new Response(JSON.stringify({ error: { code: 'model_request', message: 'rejected' } }), {
        status: 502,
      }),
    )
    expect((await client.render({ video: videoSource(), ...input })).status).toBe('rejected')

    intercept(
      new Response(JSON.stringify({ error: { code: 'model_busy', message: 'later' } }), {
        status: 502,
      }),
    )
    expect((await client.render({ video: videoSource(), ...input })).status).toBe('unavailable')

    intercept(new Response('шлюз сломался', { status: 502 }))
    expect((await client.render({ video: videoSource(), ...input })).status).toBe('unavailable')
  })

  test('сетевой сбой не бросает исключение, а возвращает unavailable', async () => {
    globalThis.fetch = (async () => {
      throw new Error('соединение разорвано')
    }) as unknown as typeof fetch
    const outcome = await client.render({ video: videoSource(), ...input })
    expect(outcome).toMatchObject({ status: 'unavailable', detail: 'соединение разорвано' })
  })
})
