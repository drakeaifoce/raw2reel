import { describe, expect, test } from 'bun:test'
import type { RegistrationOperationRepository } from '../src/registration'
import { RegistrationOrchestrator } from '../src/registration'

class MemoryOperations implements RegistrationOperationRepository {
  operation: Parameters<RegistrationOperationRepository['start']>[0] | undefined

  async start(operation: Parameters<RegistrationOperationRepository['start']>[0]) {
    this.operation ??= operation
    return this.operation
  }

  async advance(
    operationId: string,
    expected: Parameters<RegistrationOperationRepository['advance']>[1],
    update: Parameters<RegistrationOperationRepository['advance']>[2],
  ) {
    if (!this.operation || this.operation._id !== operationId || this.operation.state !== expected)
      return null
    this.operation = { ...this.operation, ...update }
    return this.operation
  }
}

describe('registration orchestration', () => {
  test('persists the account, transfers only guest media, and completes the upgrade', async () => {
    const operations = new MemoryOperations()
    const events: string[] = []
    const registration = new RegistrationOrchestrator(
      operations,
      {
        signInEmail: async () => null,
        signUpEmail: async () => {
          events.push('account')
          return {
            user: { id: 'registered-c', isAnonymous: false },
            sessionToken: 'registered-session',
            sessionCookie: 'session=registered',
          }
        },
      },
      {
        registerRegistered: async (userId, token) => {
          events.push(`identity:${userId}:${token}`)
          return {} as never
        },
        completeUpgrade: async (userId, operationId) => {
          events.push(`complete:${userId}:${operationId}`)
          return true
        },
      },
      {
        create: async () => ({}) as never,
        get: async () => null,
        list: async () => [],
        transferOwner: async (from, to, operationId) => {
          events.push(`transfer:${from}:${to}:${operationId}`)
          return 2
        },
      },
    )

    await registration.signUp({
      email: 'guest@example.com',
      password: 'Password1!',
      name: 'Guest',
      mode: 'upgrade',
      operationId: 'operation-1',
      guest: { userId: 'guest-a', isAnonymous: true, familyId: 'family-a' },
    })

    expect(events).toEqual([
      'account',
      'identity:registered-c:registered-session',
      'transfer:guest-a:registered-c:operation-1',
      'complete:guest-a:operation-1',
    ])
    expect(operations.operation).toMatchObject({ state: 'completed', guestOwnerId: 'guest-a' })
  })

  test('resumes a failed transfer without creating a second account', async () => {
    const operations = new MemoryOperations()
    let accounts = 0
    let transfers = 0
    const registration = new RegistrationOrchestrator(
      operations,
      {
        signInEmail: async () => null,
        signUpEmail: async () => {
          accounts += 1
          return {
            user: { id: 'registered-c', isAnonymous: false },
            sessionToken: 'registered-session',
            sessionCookie: 'session=registered',
          }
        },
      },
      {
        registerRegistered: async () => ({}) as never,
        completeUpgrade: async () => true,
      },
      {
        create: async () => ({}) as never,
        get: async () => null,
        list: async () => [],
        transferOwner: async () => {
          transfers += 1
          if (transfers === 1) throw new Error('temporary storage failure')
          return 1
        },
      },
    )
    const input = {
      email: 'guest@example.com',
      password: 'Password1!',
      name: 'Guest',
      mode: 'upgrade' as const,
      operationId: 'operation-retry',
      guest: { userId: 'guest-a', isAnonymous: true, familyId: 'family-a' },
    }

    await expect(registration.signUp(input)).rejects.toThrow('temporary storage failure')
    await registration.signUp(input)

    expect(accounts).toBe(1)
    expect(transfers).toBe(2)
    expect(operations.operation?.state).toBe('completed')
  })
})
