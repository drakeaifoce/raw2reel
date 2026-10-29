import { MongoClient, type Collection } from 'mongodb'
import type { Config } from './config'

type HelloDocument = { _id: string; message: string; touchedAt: string }
export interface DatabaseRepository {
  hello(): Promise<{ message: string }>
}

export class DatabaseService implements DatabaseRepository {
  constructor(private readonly collection: Collection<HelloDocument>) {}

  async hello(): Promise<{ message: string }> {
    const message = 'hello from MongoDB'
    await this.collection.updateOne(
      { _id: 'hello' },
      { $set: { message, touchedAt: new Date().toISOString() } },
      { upsert: true },
    )
    const document = await this.collection.findOne({ _id: 'hello' })
    if (!document) throw new Error('MongoDB hello document was not found after upsert')
    return { message: document.message }
  }
}

export function createDatabaseService(config: Config): DatabaseService | undefined {
  if (!config.mongoUrl) return undefined
  const mongo = new MongoClient(config.mongoUrl)
  return new DatabaseService(mongo.db(config.mongoDb).collection<HelloDocument>('examples'))
}
