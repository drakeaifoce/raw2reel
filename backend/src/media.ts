import { Readable } from 'node:stream'
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob'
import { MongoClient, type Collection } from 'mongodb'
import type { Config } from './config'
import { ensureIndexes } from './mongo-indexes'
import type { ByteRange } from './range'

export type MediaMetadata = {
  id: string
  ownerId: string
  name: string
  type: string
  size: number
  blobKey: string
  createdAt: string
  ownershipOperationId?: string
}

export type StoredMedia = {
  metadata: MediaMetadata
  body: ReadableStream<Uint8Array>
  /**
   * Какой отрезок реально отдан. Есть только у частичного чтения — маршрут
   * строит по нему Content-Range, а не вычисляет границы заново.
   */
  range?: ByteRange
}

export interface MediaRepository {
  create(file: File, ownerId: string): Promise<MediaMetadata>
  /**
   * `range` запрашивает часть файла: нужен для перемотки в плеере, иначе
   * браузер тянет видео целиком, прежде чем отдать перемотку пользователю.
   */
  get(id: string, ownerId: string, range?: ByteRange): Promise<StoredMedia | null>
  list(limit: number, ownerId: string): Promise<MediaMetadata[]>
  /**
   * Копия чужой записи себе. Нужна сэмплам: они принадлежат служебному
   * владельцу, а разбор и рендер проверяют владельца, и делать для сэмплов
   * исключение из этой проверки не стоит.
   */
  copy?(id: string, fromOwnerId: string, toOwnerId: string): Promise<MediaMetadata | null>
  transferOwner?(fromOwnerId: string, toOwnerId: string, operationId: string): Promise<number>
}

export class MediaService implements MediaRepository {
  private readonly indexesReady: Promise<unknown>

  constructor(
    private readonly collection: Collection<MediaMetadata>,
    private readonly container: ContainerClient,
  ) {
    this.indexesReady = ensureIndexes([
      collection.createIndex({ ownerId: 1, id: 1 }, { name: 'media_owner_id', unique: true }),
      collection.createIndex({ ownerId: 1, createdAt: -1 }, { name: 'media_owner_created_at' }),
    ])
  }

  async create(file: File, ownerId: string): Promise<MediaMetadata> {
    await this.indexesReady
    const id = crypto.randomUUID()
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, '_') || 'media'
    const metadata: MediaMetadata = {
      id,
      ownerId,
      name: file.name,
      type: file.type,
      size: file.size,
      blobKey: `${encodeURIComponent(ownerId)}/${id}/${safeName}`,
      createdAt: new Date().toISOString(),
    }
    const blob = this.container.getBlockBlobClient(metadata.blobKey)
    await blob.uploadData(await file.arrayBuffer(), {
      blobHTTPHeaders: { blobContentType: metadata.type },
    })
    try {
      await this.collection.insertOne(metadata)
    } catch (error) {
      await blob.deleteIfExists().catch(() => undefined)
      throw error
    }
    return metadata
  }

  async get(id: string, ownerId: string, range?: ByteRange): Promise<StoredMedia | null> {
    await this.indexesReady
    const metadata = await this.collection.findOne({ id, ownerId }, { projection: { _id: 0 } })
    if (!metadata) return null
    // Границы в HTTP включительные, в SDK — смещение и количество байт.
    const download = await this.container
      .getBlobClient(metadata.blobKey)
      .download(range?.start ?? 0, range ? range.end - range.start + 1 : undefined)
    if (!download.readableStreamBody) throw new Error('Blob response did not include a stream')
    return {
      metadata,
      body: Readable.toWeb(download.readableStreamBody) as ReadableStream<Uint8Array>,
      ...(range ? { range } : {}),
    }
  }

  async copy(id: string, fromOwnerId: string, toOwnerId: string): Promise<MediaMetadata | null> {
    await this.indexesReady
    const source = await this.collection.findOne(
      { id, ownerId: fromOwnerId },
      { projection: { _id: 0 } },
    )
    if (!source) return null

    const copyId = crypto.randomUUID()
    const safeName = source.name.replace(/[^\p{L}\p{N}._-]+/gu, '_') || 'media'
    const metadata: MediaMetadata = {
      id: copyId,
      ownerId: toOwnerId,
      name: source.name,
      type: source.type,
      size: source.size,
      blobKey: `${encodeURIComponent(toOwnerId)}/${copyId}/${safeName}`,
      createdAt: new Date().toISOString(),
    }

    // Потоком, а не через буфер: сэмплом может оказаться видео на сотню
    // мегабайт, а у контейнера бэкенда памяти 384 MB.
    const download = await this.container.getBlobClient(source.blobKey).download()
    if (!download.readableStreamBody) throw new Error('Blob response did not include a stream')
    const target = this.container.getBlockBlobClient(metadata.blobKey)
    // Приведение намеренное: SDK объявляет поток как NodeJS.ReadableStream,
    // а принимает Readable — это один и тот же объект, выше в get() он же.
    await target.uploadStream(download.readableStreamBody as Readable, 4 * 1024 * 1024, 4, {
      blobHTTPHeaders: { blobContentType: metadata.type },
    })
    try {
      await this.collection.insertOne({ ...metadata })
    } catch (error) {
      await target.deleteIfExists().catch(() => undefined)
      throw error
    }
    return metadata
  }

  async list(limit: number, ownerId: string): Promise<MediaMetadata[]> {
    await this.indexesReady
    return this.collection
      .find({ ownerId }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray()
  }

  async transferOwner(
    fromOwnerId: string,
    toOwnerId: string,
    operationId: string,
  ): Promise<number> {
    await this.indexesReady
    const result = await this.collection.updateMany(
      {
        ownerId: fromOwnerId,
        $or: [{ ownershipOperationId: { $exists: false } }, { ownershipOperationId: operationId }],
      },
      { $set: { ownerId: toOwnerId, ownershipOperationId: operationId } },
    )
    return result.modifiedCount
  }
}

export function createMediaService(config: Config): MediaService | undefined {
  if (!config.mongoUrl || !config.blobConnectionString) return undefined
  const mongo = new MongoClient(config.mongoUrl)
  const collection = mongo.db(config.mongoDb).collection<MediaMetadata>('media')
  const container = BlobServiceClient.fromConnectionString(
    config.blobConnectionString,
  ).getContainerClient(config.blobContainerUploads)
  return new MediaService(collection, container)
}
