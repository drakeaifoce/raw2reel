import { describe, expect, test } from 'bun:test'
import { IdentityService, MemoryIdentityStore } from '../src/identity'

const hour = 60 * 60 * 1000

const fixture = () => {
  let now = Date.parse('2026-10-29T00:00:00.000Z')
  const service = new IdentityService(new MemoryIdentityStore(), {
    now: () => new Date(now),
    randomToken: (() => {
      let sequence = 0
      return () => `credential-${++sequence}-${'x'.repeat(40)}`
    })(),
    accessLifetimeMs: 15 * 60 * 1000,
    refreshLifetimeMs: 30 * 24 * hour,
  })
  return { service, advance: (milliseconds: number) => (now += milliseconds) }
}

describe('guest identity credentials', () => {
  test('issues isolated pairs and derives the principal only from access credentials', async () => {
    const { service } = fixture()
    const first = await service.registerGuest('guest-a')
    const second = await service.registerGuest('guest-b')

    expect(first.accessToken).not.toBe(second.accessToken)
    expect(first.refreshToken).not.toBe(second.refreshToken)
    expect(await service.authenticateAccess(first.accessToken)).toEqual({
      userId: 'guest-a',
      isAnonymous: true,
      familyId: first.familyId,
    })
    expect(await service.authenticateAccess('forged')).toBeNull()
    expect(await service.authenticateAccess(first.refreshToken)).toBeNull()
  })

  test('rotates refresh credentials and revokes the family when an old token is reused', async () => {
    const { service } = fixture()
    const original = await service.registerGuest('guest-a')
    const rotated = await service.refresh(original.refreshToken)

    expect(rotated).not.toBeNull()
    expect(rotated!.refreshToken).not.toBe(original.refreshToken)
    expect(await service.refresh(original.refreshToken)).toBeNull()
    expect(await service.authenticateAccess(rotated!.accessToken)).toBeNull()
    expect(await service.refresh(rotated!.refreshToken)).toBeNull()
  })

  test('uses strict inactivity boundary and refresh does not count as activity', async () => {
    const { service, advance } = fixture()
    const pair = await service.registerGuest('guest-a')

    advance(24 * hour)
    expect(await service.isCleanupCandidate('guest-a')).toBe(false)
    const rotated = await service.refresh(pair.refreshToken)
    expect(rotated).not.toBeNull()
    advance(1)
    expect(await service.isCleanupCandidate('guest-a')).toBe(true)

    expect(await service.recordActivity(rotated!.accessToken)).toBe(true)
    expect(await service.isCleanupCandidate('guest-a')).toBe(false)
  })

  test('expired and revoked credentials fail without revealing an identity', async () => {
    const { service, advance } = fixture()
    const pair = await service.registerGuest('guest-a')
    advance(15 * 60 * 1000)
    expect(await service.authenticateAccess(pair.accessToken)).toBeNull()

    const current = await service.refresh(pair.refreshToken)
    expect(current).not.toBeNull()
    expect(await service.revokeAll(current!.accessToken)).toBe(true)
    expect(await service.authenticateAccess(current!.accessToken)).toBeNull()
    expect(await service.refresh(current!.refreshToken)).toBeNull()
  })

  test('claims a guest upgrade once and invalidates every old credential', async () => {
    const store = new MemoryIdentityStore()
    const service = new IdentityService(store, {
      randomToken: (() => {
        let sequence = 0
        return () => `upgrade-${++sequence}-${'x'.repeat(40)}`
      })(),
    })
    const pair = await service.registerGuest('guest-upgrade')

    const claimed = await service.claimUpgradeWithAccess(pair.accessToken)
    expect(claimed).toMatchObject({
      status: 'claimed',
      principal: { userId: 'guest-upgrade', isAnonymous: true, familyId: pair.familyId },
    })
    expect(claimed.status === 'claimed' && claimed.operationId).toBeString()
    expect(await service.authenticateAccess(pair.accessToken)).toBeNull()
    expect(await service.refresh(pair.refreshToken)).toBeNull()
    expect(await service.claimUpgradeWithAccess(pair.accessToken)).toEqual({ status: 'invalid' })
  })

  test('claims refresh continuity without rotating it and rejects registered identities', async () => {
    const store = new MemoryIdentityStore()
    const service = new IdentityService(store, {
      randomToken: (() => {
        let sequence = 0
        return () => `upgrade-refresh-${++sequence}-${'x'.repeat(40)}`
      })(),
    })
    const pair = await service.registerGuest('guest-refresh-upgrade')

    expect(await service.claimUpgradeWithRefresh(pair.refreshToken)).toMatchObject({
      status: 'claimed',
      principal: { userId: 'guest-refresh-upgrade', familyId: pair.familyId },
    })

    const registeredPair = await service.registerGuest('registered-user')
    store.owners.get('registered-user')!.kind = 'registered'
    expect(await service.claimUpgradeWithAccess(registeredPair.accessToken)).toEqual({
      status: 'transition',
    })
  })
})
