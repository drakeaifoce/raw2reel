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

type Owner = {
  userId: string
  kind: 'guest' | 'registered'
  state: 'active' | 'upgrading' | 'deleting' | 'deleted'
  lastActiveAt: number
  credentialEpoch: number
}

type AccessCredential = { hash: string; expiresAt: number }
type Family = {
  familyId: string
  userId: string
  credentialEpoch: number
  refreshHash: string
  usedRefreshHashes: Set<string>
  absoluteExpiresAt: number
  revokedAt?: number
  access: AccessCredential[]
}

export class MemoryIdentityStore {
  readonly owners = new Map<string, Owner>()
  readonly families = new Map<string, Family>()
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

export class IdentityService {
  private readonly now: () => Date
  private readonly randomToken: () => string
  private readonly accessLifetimeMs: number
  private readonly refreshLifetimeMs: number

  constructor(
    private readonly store: MemoryIdentityStore,
    options: IdentityOptions = {},
  ) {
    this.now = options.now ?? (() => new Date())
    this.randomToken = options.randomToken ?? defaultRandomToken
    this.accessLifetimeMs = options.accessLifetimeMs ?? 15 * 60 * 1000
    this.refreshLifetimeMs = options.refreshLifetimeMs ?? 30 * 24 * 60 * 60 * 1000
  }

  async registerGuest(userId: string): Promise<TokenPair> {
    if (this.store.owners.has(userId)) throw new Error('identity already exists')
    const now = this.now().getTime()
    this.store.owners.set(userId, {
      userId,
      kind: 'guest',
      state: 'active',
      lastActiveAt: now,
      credentialEpoch: 0,
    })
    return this.createFamily(userId, 0, now)
  }

  async authenticateAccess(accessToken: string): Promise<Principal | null> {
    const hash = await hashCredential(accessToken)
    const now = this.now().getTime()
    for (const family of this.store.families.values()) {
      const owner = this.store.owners.get(family.userId)
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
    for (const family of this.store.families.values()) {
      if (family.usedRefreshHashes.has(hash)) {
        family.revokedAt = now
        return null
      }
      if (family.refreshHash !== hash) continue
      const owner = this.store.owners.get(family.userId)
      if (
        family.revokedAt !== undefined ||
        family.absoluteExpiresAt <= now ||
        owner?.state !== 'active' ||
        owner.credentialEpoch !== family.credentialEpoch
      ) {
        return null
      }
      family.usedRefreshHashes.add(hash)
      return this.rotate(family, owner, now)
    }
    return null
  }

  async recordActivity(accessToken: string): Promise<boolean> {
    const principal = await this.authenticateAccess(accessToken)
    if (!principal) return false
    const owner = this.store.owners.get(principal.userId)
    if (!owner || owner.state !== 'active') return false
    owner.lastActiveAt = this.now().getTime()
    return true
  }

  async revokeAll(accessToken: string): Promise<boolean> {
    const principal = await this.authenticateAccess(accessToken)
    if (!principal) return false
    const now = this.now().getTime()
    const owner = this.store.owners.get(principal.userId)!
    owner.credentialEpoch += 1
    for (const family of this.store.families.values()) {
      if (family.userId === owner.userId) family.revokedAt = now
    }
    return true
  }

  async isCleanupCandidate(userId: string): Promise<boolean> {
    const owner = this.store.owners.get(userId)
    return Boolean(
      owner?.kind === 'guest' &&
      owner.state === 'active' &&
      owner.lastActiveAt < this.now().getTime() - 24 * 60 * 60 * 1000,
    )
  }

  private async createFamily(userId: string, credentialEpoch: number, now: number) {
    const family: Family = {
      familyId: this.randomToken(),
      userId,
      credentialEpoch,
      refreshHash: '',
      usedRefreshHashes: new Set(),
      absoluteExpiresAt: now + this.refreshLifetimeMs,
      access: [],
    }
    this.store.families.set(family.familyId, family)
    return this.rotate(family, this.store.owners.get(userId)!, now)
  }

  private async rotate(family: Family, owner: Owner, now: number): Promise<TokenPair> {
    const accessToken = this.randomToken()
    const refreshToken = this.randomToken()
    family.refreshHash = await hashCredential(refreshToken)
    family.access.push({
      hash: await hashCredential(accessToken),
      expiresAt: now + this.accessLifetimeMs,
    })
    family.access = family.access.filter((credential) => credential.expiresAt > now)
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
