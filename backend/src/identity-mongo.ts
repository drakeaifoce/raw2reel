import { MongoClient, type Collection } from 'mongodb'
import type { Config } from './config'
import { IdentityService } from './identity'
import type {
  CreateIdentity,
  IdentityAccess,
  IdentityFamily,
  IdentityOwner,
  IdentityRepository,
} from './identity'

export function createIdentityService(config: Config): IdentityService | undefined {
  if (!config.mongoUrl) return undefined
  const database = new MongoClient(config.mongoUrl).db(config.mongoDb)
  return new IdentityService(
    new MongoIdentityRepository(
      database.collection<IdentityOwnerDocument>('identityOwners'),
      database.collection<IdentityFamilyDocument>('identityFamilies'),
    ),
  )
}

export type IdentityAccessDocument = { hash: string; expiresAt: number }

export type IdentityOwnerDocument = {
  _id: string
  kind: 'guest' | 'registered'
  state: 'active' | 'upgrading' | 'deleting' | 'deleted'
  lastActiveAt: number
  credentialEpoch: number
  upgradeOperationId?: string
}

export type IdentityFamilyDocument = {
  _id: string
  userId: string
  credentialEpoch: number
  sessionBindingHash: string
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
  sessionBindingHash: string
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
export class MongoIdentityRepository implements IdentityRepository {
  constructor(
    private readonly owners: Collection<IdentityOwnerDocument>,
    private readonly families: Collection<IdentityFamilyDocument>,
  ) {}

  async create({ owner, family }: CreateIdentity): Promise<void> {
    await this.owners.insertOne({
      _id: owner.userId,
      kind: owner.kind,
      state: owner.state,
      lastActiveAt: owner.lastActiveAt,
      credentialEpoch: owner.credentialEpoch,
    })
    try {
      await this.createFamily(family)
    } catch (error) {
      await this.owners.deleteOne({
        _id: owner.userId,
        credentialEpoch: owner.credentialEpoch,
        state: owner.state,
      })
      throw error
    }
  }

  async createFamily(family: IdentityFamily): Promise<void> {
    await this.families.insertOne({
      _id: family.familyId,
      userId: family.userId,
      credentialEpoch: family.credentialEpoch,
      sessionBindingHash: family.sessionBindingHash,
      generation: family.usedRefreshHashes.size,
      currentRefreshHash: family.refreshHash,
      usedRefreshHashes: [...family.usedRefreshHashes],
      absoluteExpiresAt: family.absoluteExpiresAt,
      access: family.access,
    })
  }

  async findAccess(hash: string, now: number) {
    const family = await this.families.findOne({
      access: { $elemMatch: { hash, expiresAt: { $gt: now } } },
    })
    return family ? this.withOwner(family, false) : null
  }

  async findRefresh(hash: string) {
    const family = await this.families.findOne({
      $or: [{ currentRefreshHash: hash }, { usedRefreshHashes: hash }],
    })
    return family ? this.withOwner(family, family.usedRefreshHashes.includes(hash)) : null
  }

  async rotate(
    family: IdentityFamily,
    currentHash: string,
    nextHash: string,
    access: IdentityAccess,
  ) {
    const rotated = await this.rotateRefresh({
      generation: this.toDocumentGeneration(family),
      currentRefreshHash: currentHash,
      nextRefreshHash: nextHash,
      nextAccess: access,
    })
    return rotated ? this.toFamily(rotated) : null
  }

  revokeReuse(_familyId: string, hash: string, now: number) {
    return this.revokeForRefreshReuse(hash, now)
  }

  async revokeFamily(familyId: string, hash: string, now: number) {
    return (
      (await this.families.findOneAndUpdate(
        { _id: familyId, currentRefreshHash: hash, revokedAt: { $exists: false } },
        { $set: { revokedAt: now } },
        { returnDocument: 'after' },
      )) !== null
    )
  }

  async touch(userId: string, now: number) {
    return (
      (await this.owners.findOneAndUpdate(
        { _id: userId, state: 'active' },
        { $set: { lastActiveAt: now } },
        { returnDocument: 'after' },
      )) !== null
    )
  }

  async revokeAll(userId: string, epoch: number, now: number) {
    const owner = await this.compareAndIncrementCredentialEpoch(userId, epoch)
    if (!owner) return false
    await this.families.updateMany(
      { userId, credentialEpoch: epoch, revokedAt: { $exists: false } },
      { $set: { revokedAt: now } },
    )
    return true
  }

  async claimUpgrade(userId: string, epoch: number, operationId: string) {
    return (
      (await this.owners.findOneAndUpdate(
        { _id: userId, kind: 'guest', state: 'active', credentialEpoch: epoch },
        { $set: { state: 'upgrading', upgradeOperationId: operationId } },
        { returnDocument: 'after' },
      )) !== null
    )
  }

  async findOwner(userId: string): Promise<IdentityOwner | null> {
    const owner = await this.owners.findOne({ _id: userId })
    return owner ? this.toOwner(owner) : null
  }

  async findSession(hash: string) {
    const family = await this.families.findOne({ sessionBindingHash: hash })
    return family ? this.withOwner(family, false) : null
  }

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
        sessionBindingHash: input.sessionBindingHash,
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

  private async withOwner(family: IdentityFamilyDocument, reused: boolean) {
    const owner = await this.owners.findOne({ _id: family.userId })
    return owner ? { owner: this.toOwner(owner), family: this.toFamily(family), reused } : null
  }

  private toOwner(owner: IdentityOwnerDocument): IdentityOwner {
    return { ...owner, userId: owner._id }
  }

  private toFamily(family: IdentityFamilyDocument): IdentityFamily {
    return {
      familyId: family._id,
      userId: family.userId,
      credentialEpoch: family.credentialEpoch,
      sessionBindingHash: family.sessionBindingHash,
      refreshHash: family.currentRefreshHash,
      usedRefreshHashes: new Set(family.usedRefreshHashes),
      absoluteExpiresAt: family.absoluteExpiresAt,
      revokedAt: family.revokedAt,
      access: family.access,
    }
  }

  private toDocumentGeneration(family: IdentityFamily) {
    return family.usedRefreshHashes.size
  }
}
