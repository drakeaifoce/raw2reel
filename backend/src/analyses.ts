/**
 * Разбор исходника: результат шага /v2/prepare.
 *
 * Почему отдельное хранилище, а не поле в задаче: ответ prepare весит до 16 MB
 * (каталог плюс превью в base64), а документ Cosmos ограничен 2 MB. Поэтому
 * сырые байты и картинки лежат в Blob, а в Cosmos — только компактные
 * карточки, которые показывает клиент.
 *
 * Байты ответа храним как есть: на рендере сервис сверяет каталог с отпечатком
 * исходника, и лишний цикл разбор-сборка только создавал бы риск расхождения.
 */
import { Readable } from 'node:stream'
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob'
import { MongoClient, type Collection } from 'mongodb'
import type { Config } from './config'
import { ensureIndexes } from './mongo-indexes'

export type AnalysisStatus = 'queued' | 'preparing' | 'done' | 'failed'

export type AnalysisPerson = {
  id: string
  label: string
  /** Сколько раз персонаж замечен в исходнике: по этому числу идёт автовыбор. */
  observationCount: number
  /** Ключ превью в Blob. Может отсутствовать, если картинка оказалась негодной. */
  thumbnailKey?: string
}

export type AnalysisRecord = {
  id: string
  ownerId: string
  sourceMediaId: string
  status: AnalysisStatus
  people: AnalysisPerson[]
  warnings: string[]
  sourceDuration?: number
  /** Ключ сырого ответа prepare в Blob; появляется вместе со статусом done. */
  preparedKey?: string
  error?: string
  createdAt: string
  updatedAt: string
}

export type NewAnalysis = Pick<AnalysisRecord, 'id' | 'ownerId' | 'sourceMediaId'>

export type StoredThumbnail = { body: ReadableStream<Uint8Array>; size: number }

export interface AnalysisRepository {
  create(input: NewAnalysis): Promise<AnalysisRecord>
  /** Без ownerId не читаем: разбор принадлежит владельцу, как и медиа. */
  get(id: string, ownerId: string): Promise<AnalysisRecord | null>
  /** Берёт разбор в работу. Владелец воркеру заранее неизвестен. */
  claim(id: string): Promise<AnalysisRecord | null>
  /**
   * Готовый разбор того же исходника у того же владельца. Нужен, чтобы не
   * платить за повторный прогон моделей на одном и том же видео.
   */
  latestDone(ownerId: string, sourceMediaId: string): Promise<AnalysisRecord | null>
  /**
   * Незавершённый разбор того же исходника. Нужен при повторной доставке
   * цепочечного рендера: без него каждая попытка создавала новый разбор, и
   * десять попыток оставляли десять брошенных записей.
   */
  latestPending(ownerId: string, sourceMediaId: string): Promise<AnalysisRecord | null>
  /** Принимает сырой ответ prepare: раскладывает его по Blob и пишет карточки. */
  finish(id: string, prepared: Uint8Array): Promise<AnalysisRecord>
  fail(id: string, message: string): Promise<void>
  /** Сырые байты для отправки в /v2/render. */
  readPrepared(record: AnalysisRecord): Promise<Uint8Array>
  readThumbnail(record: AnalysisRecord, personId: string): Promise<StoredThumbnail | null>
}

const THUMBNAIL_PREFIX = 'data:image/jpeg;base64,'

/**
 * Разбор ответа prepare. Проверяем только то, на что опираемся сами: каталог,
 * персонажей и превью. Экспортируется ради тестов — это единственное место,
 * где мы верим чужому JSON.
 */
export function readPeople(prepared: Uint8Array): {
  people: Omit<AnalysisPerson, 'thumbnailKey'>[]
  thumbnails: Map<string, Uint8Array>
  warnings: string[]
  sourceDuration?: number
} {
  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder().decode(prepared))
  } catch {
    throw new Error('AI-сервис вернул не JSON')
  }
  const catalog = (payload as { catalog?: unknown }).catalog
  if (typeof catalog !== 'object' || catalog === null) {
    throw new Error('в ответе prepare нет каталога')
  }
  const raw = (catalog as { people?: unknown }).people
  if (!Array.isArray(raw)) throw new Error('в каталоге нет списка персонажей')
  const images = (payload as { thumbnails?: unknown }).thumbnails
  const byObservation =
    typeof images === 'object' && images !== null ? (images as Record<string, unknown>) : {}

  const people: Omit<AnalysisPerson, 'thumbnailKey'>[] = []
  const thumbnails = new Map<string, Uint8Array>()
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const { id, label, observation_ids: observations } = entry as Record<string, unknown>
    if (typeof id !== 'string' || id.length === 0) continue
    const ids = Array.isArray(observations) ? observations.filter((o) => typeof o === 'string') : []
    people.push({
      id,
      label: typeof label === 'string' && label.length > 0 ? label : id,
      observationCount: ids.length,
    })
    // Берём превью первого наблюдения: по одной картинке на карточку, чтобы
    // ответ клиенту не разрастался до мегабайтов base64.
    const first = ids[0]
    const encoded = typeof first === 'string' ? byObservation[first] : undefined
    if (typeof encoded === 'string' && encoded.startsWith(THUMBNAIL_PREFIX)) {
      try {
        thumbnails.set(id, Buffer.from(encoded.slice(THUMBNAIL_PREFIX.length), 'base64'))
      } catch {
        // Негодная картинка карточку не отменяет: персонаж всё равно выбираем.
      }
    }
  }

  const rawWarnings = (catalog as { warnings?: unknown }).warnings
  const duration = (catalog as { source_duration?: unknown }).source_duration
  return {
    people,
    thumbnails,
    warnings: Array.isArray(rawWarnings)
      ? rawWarnings.filter((w): w is string => typeof w === 'string').slice(0, 100)
      : [],
    ...(typeof duration === 'number' && Number.isFinite(duration)
      ? { sourceDuration: duration }
      : {}),
  }
}

export class AnalysisService implements AnalysisRepository {
  private readonly indexesReady: Promise<unknown>

  constructor(
    private readonly collection: Collection<AnalysisRecord>,
    private readonly container: ContainerClient,
  ) {
    this.indexesReady = ensureIndexes([
      collection.createIndex({ id: 1 }, { name: 'analysis_id', unique: true }),
      collection.createIndex(
        { ownerId: 1, sourceMediaId: 1, createdAt: -1 },
        { name: 'analysis_owner_source' },
      ),
    ])
  }

  private prefix(record: NewAnalysis) {
    return `${encodeURIComponent(record.ownerId)}/${record.id}`
  }

  async create(input: NewAnalysis): Promise<AnalysisRecord> {
    await this.indexesReady
    const now = new Date().toISOString()
    const record: AnalysisRecord = {
      ...input,
      status: 'queued',
      people: [],
      warnings: [],
      createdAt: now,
      updatedAt: now,
    }
    await this.collection.insertOne({ ...record })
    return record
  }

  async get(id: string, ownerId: string): Promise<AnalysisRecord | null> {
    await this.indexesReady
    return this.collection.findOne({ id, ownerId }, { projection: { _id: 0 } })
  }

  async claim(id: string): Promise<AnalysisRecord | null> {
    await this.indexesReady
    // Фильтр по статусу обязателен: без него повторная доставка переводила бы
    // готовый разбор назад в работу и мы платили бы за него второй раз.
    const result = await this.collection.findOneAndUpdate(
      { id, status: { $in: ['queued', 'preparing'] } },
      { $set: { status: 'preparing', updatedAt: new Date().toISOString() } },
      { returnDocument: 'after', projection: { _id: 0 } },
    )
    return result ?? null
  }

  async latestDone(ownerId: string, sourceMediaId: string): Promise<AnalysisRecord | null> {
    await this.indexesReady
    const [found] = await this.collection
      .find({ ownerId, sourceMediaId, status: 'done' }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray()
    return found ?? null
  }

  async latestPending(ownerId: string, sourceMediaId: string): Promise<AnalysisRecord | null> {
    await this.indexesReady
    const [found] = await this.collection
      .find(
        { ownerId, sourceMediaId, status: { $in: ['queued', 'preparing'] } },
        { projection: { _id: 0 } },
      )
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray()
    return found ?? null
  }

  async finish(id: string, prepared: Uint8Array): Promise<AnalysisRecord> {
    await this.indexesReady
    const record = await this.collection.findOne({ id }, { projection: { _id: 0 } })
    if (!record) throw new Error('разбор не найден')
    const { people, thumbnails, warnings, sourceDuration } = readPeople(prepared)

    const prefix = this.prefix(record)
    const preparedKey = `${prefix}/analysis.json`
    await this.container.getBlockBlobClient(preparedKey).uploadData(Buffer.from(prepared), {
      blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' },
    })

    const cards: AnalysisPerson[] = []
    for (const person of people) {
      const image = thumbnails.get(person.id)
      if (!image) {
        cards.push(person)
        continue
      }
      const thumbnailKey = `${prefix}/people/${encodeURIComponent(person.id)}.jpg`
      await this.container
        .getBlockBlobClient(thumbnailKey)
        .uploadData(Buffer.from(image), { blobHTTPHeaders: { blobContentType: 'image/jpeg' } })
      cards.push({ ...person, thumbnailKey })
    }

    const update = {
      status: 'done' as const,
      people: cards,
      warnings,
      preparedKey,
      updatedAt: new Date().toISOString(),
      ...(sourceDuration !== undefined ? { sourceDuration } : {}),
    }
    await this.collection.updateOne({ id }, { $set: update, $unset: { error: '' } })
    return { ...record, ...update }
  }

  async fail(id: string, message: string): Promise<void> {
    await this.collection.updateOne(
      { id },
      { $set: { status: 'failed', error: message, updatedAt: new Date().toISOString() } },
    )
  }

  async readPrepared(record: AnalysisRecord): Promise<Uint8Array> {
    if (!record.preparedKey) throw new Error('разбор ещё не готов')
    const buffer = await this.container.getBlobClient(record.preparedKey).downloadToBuffer()
    return new Uint8Array(buffer)
  }

  async readThumbnail(record: AnalysisRecord, personId: string): Promise<StoredThumbnail | null> {
    const key = record.people.find((person) => person.id === personId)?.thumbnailKey
    if (!key) return null
    const download = await this.container.getBlobClient(key).download()
    if (!download.readableStreamBody) throw new Error('Blob response did not include a stream')
    return {
      body: Readable.toWeb(download.readableStreamBody) as ReadableStream<Uint8Array>,
      size: download.contentLength ?? 0,
    }
  }
}

export function createAnalysisService(config: Config): AnalysisService | undefined {
  if (!config.mongoUrl || !config.blobConnectionString) return undefined
  const mongo = new MongoClient(config.mongoUrl)
  const collection = mongo.db(config.mongoDb).collection<AnalysisRecord>('analyses')
  const container = BlobServiceClient.fromConnectionString(
    config.blobConnectionString,
  ).getContainerClient(config.blobContainerAnalyses)
  return new AnalysisService(collection, container)
}
