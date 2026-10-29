import type { Collection } from 'mongodb'

export type IdentityAccessDocument = { hash: string; expiresAt: number }

export type IdentityOwnerDocument = {
  _id: string
  kind: 'guest' | 'registered'
  state: 'active' | 'upgrading' | 'deleting' | 'deleted'
  lastActiveAt: number
  credentialEpoch: number
}

export type IdentityFamilyDocument = {
  _id: string
  userId: string
  credentialEpoch: number
  generation: number
  currentRefreshHash: string
  usedRefreshHashes: string[]
  absoluteExpiresAt: number
  revokedAt?: number
  access: IdentityAccessDocument[]
}

type CreateGuestOwner = {
  userId: string
  now: number
  familyId: string
  refreshHash: string
  absoluteExpiresAt: number
  access: IdentityAccessDocument[]
}

type RotateRefresh = {
  generation: number
  currentRefreshHash: string
  nextRefreshHash: string
  nextAccess: IdentityAccessDocument
}

/**
 * Durable identity persistence uses single-document compare-and-swap operations.
 * Cosmos Mongo deployments cannot be assumed to support cross-document
 * transactions, so callers must treat owner/family creation as recoverable.
 */
export class MongoIdentityRepository {
  constructor(
    private readonly owners: Collection<IdentityOwnerDocument>,
    private readonly families: Collection<IdentityFamilyDocument>,
  ) {}

  async createGuestOwner(input: CreateGuestOwner): Promise<void> {
    await this.owners.insertOne({
      _id: input.userId,
      kind: 'guest',
      state: 'active',
      lastActiveAt: input.now,
      credentialEpoch: 0,
    })
    try {
      await this.families.insertOne({
        _id: input.familyId,
        userId: input.userId,
        credentialEpoch: 0,
        generation: 0,
        currentRefreshHash: input.refreshHash,
        usedRefreshHashes: [],
        absoluteExpiresAt: input.absoluteExpiresAt,
        access: input.access,
      })
    } catch (error) {
      await this.owners.deleteOne({ _id: input.userId, credentialEpoch: 0, state: 'active' })
      throw error
    }
  }

  rotateRefresh(input: RotateRefresh): Promise<IdentityFamilyDocument | null> {
    return this.families.findOneAndUpdate(
      {
        generation: input.generation,
        currentRefreshHash: input.currentRefreshHash,
        revokedAt: { $exists: false },
      },
      {
        $set: { currentRefreshHash: input.nextRefreshHash },
        $inc: { generation: 1 },
        $push: {
          usedRefreshHashes: input.currentRefreshHash,
          access: input.nextAccess,
        },
      },
      { returnDocument: 'after' },
    )
  }

  async revokeForRefreshReuse(refreshHash: string, revokedAt: number): Promise<boolean> {
    const family = await this.families.findOneAndUpdate(
      { usedRefreshHashes: refreshHash, revokedAt: { $exists: false } },
      { $set: { revokedAt } },
      { returnDocument: 'after' },
    )
    return family !== null
  }

  compareAndIncrementCredentialEpoch(
    userId: string,
    expectedEpoch: number,
  ): Promise<IdentityOwnerDocument | null> {
    return this.owners.findOneAndUpdate(
      { _id: userId, state: 'active', credentialEpoch: expectedEpoch },
      { $inc: { credentialEpoch: 1 } },
      { returnDocument: 'after' },
    )
  }
}
