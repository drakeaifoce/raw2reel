import { describe, expect, test } from 'bun:test'
import {
  MongoIdentityRepository,
  type IdentityFamilyDocument,
  type IdentityOwnerDocument,
} from '../src/identity-mongo'

type Filter<T> = Record<string, unknown>
type Update<T> = Record<string, Record<string, unknown>>

class FakeCollection<T extends { _id: string }> {
  readonly documents = new Map<string, T>()

  async insertOne(document: T) {
    if (this.documents.has(document._id)) throw new Error('duplicate key')
    this.documents.set(document._id, structuredClone(document))
    return { acknowledged: true, insertedId: document._id }
  }

  async findOneAndUpdate(filter: Filter<T>, update: Update<T>) {
    const document = [...this.documents.values()].find((candidate) => matches(candidate, filter))
    if (!document) return null
    const next = structuredClone(document) as Record<string, unknown>
    for (const [key, value] of Object.entries(update.$set ?? {})) next[key] = value
    for (const [key, value] of Object.entries(update.$inc ?? {})) {
      next[key] = Number(next[key]) + Number(value)
    }
    for (const [key, value] of Object.entries(update.$push ?? {})) {
      next[key] = [...((next[key] as unknown[]) ?? []), value]
    }
    this.documents.set(document._id, next as T)
    return structuredClone(next) as T
  }

  async deleteOne(filter: Filter<T>) {
    const document = [...this.documents.values()].find((candidate) => matches(candidate, filter))
    if (!document) return { acknowledged: true, deletedCount: 0 }
    this.documents.delete(document._id)
    return { acknowledged: true, deletedCount: 1 }
  }
}

const matches = (document: Record<string, unknown>, filter: Filter<unknown>) =>
  Object.entries(filter).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '$exists' in expected) {
      return (document[key] !== undefined) === (expected as { $exists: boolean }).$exists
    }
    if (key === 'usedRefreshHashes' && expected && typeof expected === 'object') {
      return !(document.usedRefreshHashes as string[]).includes((expected as { $ne: string }).$ne)
    }
    if (key === 'usedRefreshHashes' && typeof expected === 'string') {
      return (document.usedRefreshHashes as string[]).includes(expected)
    }
    if (expected === null) return document[key] === undefined || document[key] === null
    return document[key] === expected
  })

describe('Mongo identity repository', () => {
  test('allows only one refresh rotation for the current generation', async () => {
    const owners = new FakeCollection<IdentityOwnerDocument>()
    const families = new FakeCollection<IdentityFamilyDocument>()
    const repository = new MongoIdentityRepository(owners as never, families as never)
    await repository.createGuestOwner({
      userId: 'guest-a',
      now: 1_000,
      familyId: 'family-a',
      refreshHash: 'refresh-1',
      absoluteExpiresAt: 99_000,
      access: [],
    })

    const results = await Promise.all([
      repository.rotateRefresh({
        generation: 0,
        currentRefreshHash: 'refresh-1',
        nextRefreshHash: 'refresh-2a',
        nextAccess: { hash: 'access-2a', expiresAt: 2_000 },
      }),
      repository.rotateRefresh({
        generation: 0,
        currentRefreshHash: 'refresh-1',
        nextRefreshHash: 'refresh-2b',
        nextAccess: { hash: 'access-2b', expiresAt: 2_000 },
      }),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(results.find(Boolean)?.generation).toBe(1)
  })

  test('revokes the family only when a previously used refresh is replayed', async () => {
    const owners = new FakeCollection<IdentityOwnerDocument>()
    const families = new FakeCollection<IdentityFamilyDocument>()
    const repository = new MongoIdentityRepository(owners as never, families as never)
    await repository.createGuestOwner({
      userId: 'guest-a',
      now: 1_000,
      familyId: 'family-a',
      refreshHash: 'refresh-1',
      absoluteExpiresAt: 99_000,
      access: [],
    })
    await repository.rotateRefresh({
      generation: 0,
      currentRefreshHash: 'refresh-1',
      nextRefreshHash: 'refresh-2',
      nextAccess: { hash: 'access-2', expiresAt: 2_000 },
    })

    expect(await repository.revokeForRefreshReuse('unknown', 1_500)).toBe(false)
    expect(await repository.revokeForRefreshReuse('refresh-1', 1_500)).toBe(true)
    expect(families.documents.get('family-a')?.revokedAt).toBe(1_500)
  })

  test('increments an owner epoch with compare-and-swap', async () => {
    const owners = new FakeCollection<IdentityOwnerDocument>()
    const families = new FakeCollection<IdentityFamilyDocument>()
    const repository = new MongoIdentityRepository(owners as never, families as never)
    await repository.createGuestOwner({
      userId: 'guest-a',
      now: 1_000,
      familyId: 'family-a',
      refreshHash: 'refresh-1',
      absoluteExpiresAt: 99_000,
      access: [],
    })

    expect(await repository.compareAndIncrementCredentialEpoch('guest-a', 0)).toMatchObject({
      credentialEpoch: 1,
    })
    expect(await repository.compareAndIncrementCredentialEpoch('guest-a', 0)).toBeNull()
  })

  test('claims an active guest upgrade exactly once with a durable operation id', async () => {
    const owners = new FakeCollection<IdentityOwnerDocument>()
    const families = new FakeCollection<IdentityFamilyDocument>()
    const repository = new MongoIdentityRepository(owners as never, families as never)
    await repository.createGuestOwner({
      userId: 'guest-a',
      now: 1_000,
      familyId: 'family-a',
      refreshHash: 'refresh-1',
      absoluteExpiresAt: 99_000,
      access: [],
    })

    const claims = await Promise.all([
      repository.claimUpgrade('guest-a', 0, 'operation-a'),
      repository.claimUpgrade('guest-a', 0, 'operation-b'),
    ])

    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(owners.documents.get('guest-a')).toMatchObject({
      state: 'upgrading',
      upgradeOperationId: claims[0] ? 'operation-a' : 'operation-b',
    })
  })
})
