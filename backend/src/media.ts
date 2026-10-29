import { Readable } from 'node:stream'
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob'
import { MongoClient, type Collection } from 'mongodb'
import type { Config } from './config'

export type MediaMetadata = {
  id: string
  ownerId: string
  name: string
  type: string
  size: number
  blobKey: string
  createdAt: string
}

export type StoredMedia = { metadata: MediaMetadata; body: ReadableStream<Uint8Array> }

export interface MediaRepository {
  create(file: File, ownerId: string): Promise<MediaMetadata>
  get(id: string, ownerId: string): Promise<StoredMedia | null>
  list(limit: number, ownerId: string): Promise<MediaMetadata[]>
}

export class MediaService implements MediaRepository {
  private readonly indexesReady: Promise<unknown>

  constructor(
    private readonly collection: Collection<MediaMetadata>,
    private readonly container: ContainerClient,
  ) {
    this.indexesReady = Promise.all([
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

  async get(id: string, ownerId: string): Promise<StoredMedia | null> {
    await this.indexesReady
    const metadata = await this.collection.findOne({ id, ownerId }, { projection: { _id: 0 } })
    if (!metadata) return null
    const download = await this.container.getBlobClient(metadata.blobKey).download()
    if (!download.readableStreamBody) throw new Error('Blob response did not include a stream')
    return {
      metadata,
      body: Readable.toWeb(download.readableStreamBody) as ReadableStream<Uint8Array>,
    }
  }

  async list(limit: number, ownerId: string): Promise<MediaMetadata[]> {
    await this.indexesReady
    return this.collection
      .find({ ownerId }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray()
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
