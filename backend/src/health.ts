import { BlobServiceClient } from '@azure/storage-blob'
import { MongoClient } from 'mongodb'
import { createAiClient } from './ai-client'
import { config } from './config'
import { pingQueue } from './queue'

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
    // Именно операция с базой, а не ping: в Cosmos ping отвечает через шлюз и
    // проходит даже с недействительным ключом, то есть молчит ровно в том
    // случае, для которого проверка и нужна. Проверено.
    await client.db(config.mongoDb).listCollections().toArray()
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

async function checkQueue(): Promise<{ state: DependencyState; detail?: string }> {
  if (!config.natsUrl) return { state: 'unconfigured' }
  try {
    await pingQueue(config.natsUrl)
    return { state: 'ok' }
  } catch (error) {
    return { state: 'error', detail: error instanceof Error ? error.message : String(error) }
  }
}

async function checkAiService(): Promise<{ state: DependencyState; detail?: string }> {
  const client = createAiClient(config)
  if (!client) return { state: 'unconfigured' }
  try {
    await client.ping()
    return { state: 'ok' }
  } catch (error) {
    return { state: 'error', detail: error instanceof Error ? error.message : String(error) }
  }
}

export async function readiness(): Promise<Readiness> {
  const [mongo, blob, queue, ai] = await Promise.all([
    checkMongo(),
    checkBlob(),
    checkQueue(),
    checkAiService(),
  ])
  const dependencies = { mongo, blob, queue, ai }
  // Ненастроенная зависимость не делает сервис неготовым: на этом этапе
  // Cosmos ещё не создан, и деплой не должен из-за этого откатываться.
  const ready = Object.values(dependencies).every((d) => d.state !== 'error')
  return { ready, dependencies }
}
