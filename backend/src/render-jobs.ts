/**
 * Состояние задач рендера. Отдельно от очереди намеренно: очередь отвечает за
 * доставку, а здесь лежит то, что можно показать пользователю и что должно
 * пережить перезапуск воркера.
 */
import { MongoClient, type Collection } from 'mongodb'
import type { Config } from './config'
import { ensureIndexes } from './mongo-indexes'

export type RenderJobStatus = 'queued' | 'rendering' | 'done' | 'failed'

/**
 * Что делает задача. Оба вида идут через одну очередь намеренно: в AI-сервисе
 * замок на prepare и render общий, поэтому вторая очередь только спорила бы с
 * первой за один и тот же слот.
 */
export type RenderJobKind = 'prepare' | 'render'

export type RenderJob = {
  id: string
  ownerId: string
  /** Вид работы. У записей, созданных до появления prepare, его нет. */
  kind?: RenderJobKind
  sourceMediaId: string
  musicMediaId?: string
  /** Разбор исходника: для prepare — что заполнить, для render — что взять. */
  analysisId?: string
  /** Выбранные персонажи. Пусто — воркер выберет сам по числу появлений. */
  personIds?: string[]
  /** Параметры рендера. У разбора их нет: он от них не зависит. */
  duration?: number
  captions?: boolean
  status: RenderJobStatus
  resultMediaId?: string
  error?: string
  attempts: number
  createdAt: string
  updatedAt: string
}

export type NewRenderJob = Omit<
  RenderJob,
  'status' | 'attempts' | 'createdAt' | 'updatedAt' | 'resultMediaId' | 'error'
>

export interface RenderJobRepository {
  create(job: NewRenderJob): Promise<RenderJob>
  /** Без ownerId не читаем: задача принадлежит владельцу, как и медиа. */
  get(id: string, ownerId: string): Promise<RenderJob | null>
  /**
   * Берёт задачу в работу. Владелец воркеру заранее неизвестен — у него есть
   * только идентификатор. Возвращает null, если задача уже завершена: это
   * означает повторную доставку, и переделывать нечего.
   */
  claim(id: string): Promise<RenderJob | null>
  /** Результат есть только у рендера; у prepare он лежит в записи разбора. */
  finish(id: string, resultMediaId?: string): Promise<void>
  fail(id: string, message: string): Promise<void>
  requeue(id: string): Promise<void>
  /**
   * Задачи, которые давно не двигались. Нужны для восстановления: сообщение
   * могло уйти из очереди, а запись остаться незакрытой — например, ack
   * прошёл, а обновление не записалось, или воркер убит между вызовами.
   * Такая задача иначе висит в rendering навсегда и выглядит для
   * пользователя бесконечной загрузкой.
   */
  stale(before: string, limit: number): Promise<RenderJob[]>
}

export class RenderJobService implements RenderJobRepository {
  private readonly indexesReady: Promise<unknown>

  constructor(private readonly collection: Collection<RenderJob>) {
    this.indexesReady = ensureIndexes([
      collection.createIndex({ id: 1 }, { name: 'render_job_id', unique: true }),
      collection.createIndex({ ownerId: 1, createdAt: -1 }, { name: 'render_job_owner_created' }),
    ])
  }

  async create(job: NewRenderJob): Promise<RenderJob> {
    await this.indexesReady
    const now = new Date().toISOString()
    const record: RenderJob = {
      ...job,
      status: 'queued',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    }
    await this.collection.insertOne({ ...record })
    return record
  }

  async get(id: string, ownerId: string): Promise<RenderJob | null> {
    await this.indexesReady
    return this.collection.findOne({ id, ownerId }, { projection: { _id: 0 } })
  }

  async claim(id: string): Promise<RenderJob | null> {
    await this.indexesReady
    // Фильтр по статусу обязателен: без него повторная доставка переводила бы
    // уже готовую задачу назад в rendering и мы рендерили бы её снова.
    const result = await this.collection.findOneAndUpdate(
      { id, status: { $in: ['queued', 'rendering'] } },
      { $set: { status: 'rendering', updatedAt: new Date().toISOString() }, $inc: { attempts: 1 } },
      { returnDocument: 'after', projection: { _id: 0 } },
    )
    return result ?? null
  }

  async finish(id: string, resultMediaId?: string): Promise<void> {
    await this.collection.updateOne(
      { id },
      {
        $set: {
          status: 'done',
          updatedAt: new Date().toISOString(),
          ...(resultMediaId ? { resultMediaId } : {}),
        },
        $unset: { error: '' },
      },
    )
  }

  async fail(id: string, message: string): Promise<void> {
    await this.collection.updateOne(
      { id },
      { $set: { status: 'failed', error: message, updatedAt: new Date().toISOString() } },
    )
  }

  async stale(before: string, limit: number): Promise<RenderJob[]> {
    await this.indexesReady
    return this.collection
      .find(
        { status: { $in: ['queued', 'rendering'] }, updatedAt: { $lt: before } },
        { projection: { _id: 0 } },
      )
      .limit(limit)
      .toArray()
  }

  /** Возврат в очередь: статус снова queued, счётчик попыток сохраняется. */
  async requeue(id: string): Promise<void> {
    await this.collection.updateOne(
      { id },
      { $set: { status: 'queued', updatedAt: new Date().toISOString() } },
    )
  }
}

export function createRenderJobService(config: Config): RenderJobService | undefined {
  if (!config.mongoUrl) return undefined
  const client = new MongoClient(config.mongoUrl)
  return new RenderJobService(client.db(config.mongoDb).collection<RenderJob>('renderJobs'))
}
