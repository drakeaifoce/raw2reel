export type Principal = { userId: string; isAnonymous: boolean; familyId: string }

export type TokenPair = {
  accessToken: string
  refreshToken: string
  familyId: string
  expiresIn: number
  refreshExpiresAt: string
  tokenType: 'Bearer'
  user: { id: string; isAnonymous: boolean }
}

export type IdentityOwner = {
  userId: string
  kind: 'guest' | 'registered'
  state: 'active' | 'upgrading' | 'deleting' | 'deleted'
  lastActiveAt: number
  credentialEpoch: number
}

export type IdentityAccess = { hash: string; expiresAt: number }
export type IdentityFamily = {
  familyId: string
  userId: string
  credentialEpoch: number
  refreshHash: string
  usedRefreshHashes: Set<string>
  absoluteExpiresAt: number
  revokedAt?: number
  access: IdentityAccess[]
}

export type CreateIdentity = { owner: IdentityOwner; family: IdentityFamily }

export interface IdentityRepository {
  create(input: CreateIdentity): Promise<void>
  findAccess(
    hash: string,
    now: number,
  ): Promise<{ owner: IdentityOwner; family: IdentityFamily } | null>
  findRefresh(
    hash: string,
  ): Promise<{ owner: IdentityOwner; family: IdentityFamily; reused: boolean } | null>
  rotate(
    family: IdentityFamily,
    currentHash: string,
    nextHash: string,
    access: IdentityAccess,
  ): Promise<IdentityFamily | null>
  revokeReuse(familyId: string, hash: string, now: number): Promise<boolean>
  touch(userId: string, now: number): Promise<boolean>
  revokeAll(userId: string, epoch: number, now: number): Promise<boolean>
  findOwner(userId: string): Promise<IdentityOwner | null>
}

export class MemoryIdentityStore implements IdentityRepository {
  readonly owners = new Map<string, IdentityOwner>()
  readonly families = new Map<string, IdentityFamily>()

  async create({ owner, family }: CreateIdentity) {
    if (this.owners.has(owner.userId)) throw new Error('identity already exists')
    this.owners.set(owner.userId, owner)
    this.families.set(family.familyId, family)
  }

  async findAccess(hash: string, now: number) {
    for (const family of this.families.values()) {
      const owner = this.owners.get(family.userId)
      if (owner && family.access.some((item) => item.hash === hash && item.expiresAt > now))
        return { owner, family }
    }
    return null
  }

  async findRefresh(hash: string) {
    for (const family of this.families.values()) {
      const owner = this.owners.get(family.userId)
      if (!owner) continue
      if (family.usedRefreshHashes.has(hash)) return { owner, family, reused: true }
      if (family.refreshHash === hash) return { owner, family, reused: false }
    }
    return null
  }

  async rotate(
    family: IdentityFamily,
    currentHash: string,
    nextHash: string,
    access: IdentityAccess,
  ) {
    if (family.refreshHash !== currentHash || family.revokedAt !== undefined) return null
    family.usedRefreshHashes.add(currentHash)
    family.refreshHash = nextHash
    family.access.push(access)
    return family
  }

  async revokeReuse(familyId: string, hash: string, now: number) {
    const family = this.families.get(familyId)
    if (!family?.usedRefreshHashes.has(hash) || family.revokedAt !== undefined) return false
    family.revokedAt = now
    return true
  }

  async touch(userId: string, now: number) {
    const owner = this.owners.get(userId)
    if (!owner || owner.state !== 'active') return false
    owner.lastActiveAt = now
    return true
  }

  async revokeAll(userId: string, epoch: number, now: number) {
    const owner = this.owners.get(userId)
    if (!owner || owner.state !== 'active' || owner.credentialEpoch !== epoch) return false
    owner.credentialEpoch += 1
    for (const family of this.families.values())
      if (family.userId === userId) family.revokedAt = now
    return true
  }

  async findOwner(userId: string) {
    return this.owners.get(userId) ?? null
  }
}

type IdentityOptions = {
  now?: () => Date
  randomToken?: () => string
  accessLifetimeMs?: number
  refreshLifetimeMs?: number
}

const defaultRandomToken = () => {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const hashCredential = async (credential: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credential))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const csrfForRefresh = (refreshToken: string) => hashCredential(`r2r-csrf:${refreshToken}`)

const secureEqual = (left: string, right: string) => {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}

export class IdentityService {
  private readonly now: () => Date
  private readonly randomToken: () => string
  private readonly accessLifetimeMs: number
  private readonly refreshLifetimeMs: number

  constructor(
    private readonly store: IdentityRepository,
    options: IdentityOptions = {},
  ) {
    this.now = options.now ?? (() => new Date())
    this.randomToken = options.randomToken ?? defaultRandomToken
    this.accessLifetimeMs = options.accessLifetimeMs ?? 15 * 60 * 1000
    this.refreshLifetimeMs = options.refreshLifetimeMs ?? 30 * 24 * 60 * 60 * 1000
  }

  async registerGuest(userId: string): Promise<TokenPair> {
    const now = this.now().getTime()
    const owner: IdentityOwner = {
      userId,
      kind: 'guest',
      state: 'active',
      lastActiveAt: now,
      credentialEpoch: 0,
    }
    const created = await this.newFamily(owner, now)
    await this.store.create({ owner, family: created.family })
    return created.pair
  }

  async authenticateAccess(accessToken: string): Promise<Principal | null> {
    const hash = await hashCredential(accessToken)
    const now = this.now().getTime()
    const found = await this.store.findAccess(hash, now)
    if (found) {
      const { owner, family } = found
      if (
        family.revokedAt === undefined &&
        family.absoluteExpiresAt > now &&
        owner?.state === 'active' &&
        owner.credentialEpoch === family.credentialEpoch &&
        family.access.some((credential) => credential.hash === hash && credential.expiresAt > now)
      ) {
        return {
          userId: owner.userId,
          isAnonymous: owner.kind === 'guest',
          familyId: family.familyId,
        }
      }
    }
    return null
  }

  async refresh(refreshToken: string): Promise<TokenPair | null> {
    const hash = await hashCredential(refreshToken)
    const now = this.now().getTime()
    const found = await this.store.findRefresh(hash)
    if (found) {
      const { owner, family, reused } = found
      if (reused) {
        await this.store.revokeReuse(family.familyId, hash, now)
        return null
      }
      if (
        family.revokedAt !== undefined ||
        family.absoluteExpiresAt <= now ||
        owner?.state !== 'active' ||
        owner.credentialEpoch !== family.credentialEpoch
      ) {
        return null
      }
      return this.rotate(family, owner, hash, now)
    }
    return null
  }

  async refreshCsrfToken(refreshToken: string): Promise<string | null> {
    const hash = await hashCredential(refreshToken)
    const found = await this.store.findRefresh(hash)
    const now = this.now().getTime()
    if (
      !found ||
      found.reused ||
      found.family.revokedAt !== undefined ||
      found.family.absoluteExpiresAt <= now ||
      found.owner.state !== 'active' ||
      found.owner.credentialEpoch !== found.family.credentialEpoch
    ) {
      return null
    }
    return csrfForRefresh(refreshToken)
  }

  async matchesRefreshCsrf(refreshToken: string, csrfToken: string): Promise<boolean> {
    return secureEqual(await csrfForRefresh(refreshToken), csrfToken)
  }

  async recordActivity(accessToken: string): Promise<boolean> {
    const principal = await this.authenticateAccess(accessToken)
    if (!principal) return false
    return this.store.touch(principal.userId, this.now().getTime())
  }

  async revokeAll(accessToken: string): Promise<boolean> {
    const principal = await this.authenticateAccess(accessToken)
    if (!principal) return false
    const now = this.now().getTime()
    const found = await this.store.findAccess(await hashCredential(accessToken), now)
    if (!found) return false
    return this.store.revokeAll(principal.userId, found.owner.credentialEpoch, now)
  }

  async isCleanupCandidate(userId: string): Promise<boolean> {
    const owner = await this.store.findOwner(userId)
    return Boolean(
      owner?.kind === 'guest' &&
      owner.state === 'active' &&
      owner.lastActiveAt < this.now().getTime() - 24 * 60 * 60 * 1000,
    )
  }

  private async newFamily(owner: IdentityOwner, now: number) {
    const accessToken = this.randomToken()
    const refreshToken = this.randomToken()
    const family: IdentityFamily = {
      familyId: this.randomToken(),
      userId: owner.userId,
      credentialEpoch: owner.credentialEpoch,
      refreshHash: await hashCredential(refreshToken),
      usedRefreshHashes: new Set(),
      absoluteExpiresAt: now + this.refreshLifetimeMs,
      access: [{ hash: await hashCredential(accessToken), expiresAt: now + this.accessLifetimeMs }],
    }
    return { family, pair: this.pair(accessToken, refreshToken, family, owner) }
  }

  private async rotate(
    family: IdentityFamily,
    owner: IdentityOwner,
    currentHash: string,
    now: number,
  ): Promise<TokenPair | null> {
    const accessToken = this.randomToken()
    const refreshToken = this.randomToken()
    const nextHash = await hashCredential(refreshToken)
    const access = {
      hash: await hashCredential(accessToken),
      expiresAt: now + this.accessLifetimeMs,
    }
    const rotated = await this.store.rotate(family, currentHash, nextHash, access)
    if (!rotated) {
      await this.store.revokeReuse(family.familyId, currentHash, now)
      return null
    }
    return this.pair(accessToken, refreshToken, rotated, owner)
  }

  private pair(
    accessToken: string,
    refreshToken: string,
    family: IdentityFamily,
    owner: IdentityOwner,
  ): TokenPair {
    return {
      accessToken,
      refreshToken,
      familyId: family.familyId,
      expiresIn: Math.floor(this.accessLifetimeMs / 1000),
      refreshExpiresAt: new Date(family.absoluteExpiresAt).toISOString(),
      tokenType: 'Bearer',
      user: { id: owner.userId, isAnonymous: owner.kind === 'guest' },
    }
  }
}
