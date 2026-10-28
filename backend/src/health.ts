import { BlobServiceClient } from '@azure/storage-blob'
import { MongoClient } from 'mongodb'
import { config } from './config'

export type DependencyState = 'ok' | 'unconfigured' | 'error'

export type Readiness = {
  ready: boolean
  dependencies: Record<string, { state: DependencyState; detail?: string }>
}

async function checkMongo(): Promise<{ state: DependencyState; detail?: string }> {
  if (!config.mongoUrl) return { state: 'unconfigured' }
  // Короткий таймаут: /ready опрашивают часто, и висеть на нём нельзя.
  const client = new MongoClient(config.mongoUrl, { serverSelectionTimeoutMS: 3000 })
  try {
    await client.db(config.mongoDb).command({ ping: 1 })
    return { state: 'ok' }
  } catch (error) {
    return { state: 'error', detail: error instanceof Error ? error.message : String(error) }
  } finally {
    await client.close().catch(() => {})
  }
}

async function checkBlob(): Promise<{ state: DependencyState; detail?: string }> {
  if (!config.blobConnectionString) return { state: 'unconfigured' }
  try {
    const service = BlobServiceClient.fromConnectionString(config.blobConnectionString)
    await service.getContainerClient(config.blobContainerUploads).getProperties()
    return { state: 'ok' }
  } catch (error) {
    return { state: 'error', detail: error instanceof Error ? error.message : String(error) }
  }
}

export async function readiness(): Promise<Readiness> {
  const [mongo, blob] = await Promise.all([checkMongo(), checkBlob()])
  const dependencies = { mongo, blob }
  // Ненастроенная зависимость не делает сервис неготовым: на этом этапе
  // Cosmos ещё не создан, и деплой не должен из-за этого откатываться.
  const ready = Object.values(dependencies).every((d) => d.state !== 'error')
  return { ready, dependencies }
}
