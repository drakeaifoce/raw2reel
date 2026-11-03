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
  /**
   * Заголовки нужны лимитеру Better Auth: по ним он определяет адрес. Проверяем
   * оба вызова — и саму регистрацию, и восстановительный вход: раньше второй
   * звался с пустыми Headers, то есть мимо адреса так же, как первый.
   */
  test('hands client headers to both the sign-up and the recovery sign-in', async () => {
    const seen: Record<string, string | null> = {}
    const registration = new RegistrationOrchestrator(
      new MemoryOperations(),
      {
        signUpEmail: async (headers) => {
          seen.signUp = headers.get('x-forwarded-for')
          return null
        },
        signInEmail: async (headers) => {
          seen.signIn = headers.get('x-forwarded-for')
          return {
            user: {
              id: 'registered-c',
              isAnonymous: false as const,
              registrationOperationId: 'op-headers',
            },
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
        transferOwner: async () => 0,
      },
    )

    await registration.signUp({
      email: 'new@example.com',
      password: 'Password1!',
      name: 'Editor',
      mode: 'new',
      operationId: 'op-headers',
      headers: new Headers({ 'x-forwarded-for': '203.0.113.9' }),
    })

    expect(seen).toEqual({ signUp: '203.0.113.9', signIn: '203.0.113.9' })
  })

  test('persists the account, transfers only guest media, and completes the upgrade', async () => {
    const operations = new MemoryOperations()
    const events: string[] = []
    const registration = new RegistrationOrchestrator(
      operations,
      {
        signInEmail: async () => ({
          user: { id: 'registered-c', isAnonymous: false },
          sessionToken: 'registered-session-recovered',
          sessionCookie: 'session=registered-recovered',
        }),
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
        signInEmail: async () => ({
          user: { id: 'registered-c', isAnonymous: false },
          sessionToken: 'registered-session-recovered',
          sessionCookie: 'session=registered-recovered',
        }),
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

  test('never adopts a pre-existing account when account creation is rejected', async () => {
    const operations = new MemoryOperations()
    let signIns = 0
    let transfers = 0
    const registration = new RegistrationOrchestrator(
      operations,
      {
        signUpEmail: async () => null,
        signInEmail: async () => {
          signIns += 1
          return {
            user: { id: 'preexisting-c', isAnonymous: false },
            sessionToken: 'existing-session',
            sessionCookie: 'session=existing',
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
          return 1
        },
      },
    )

    await expect(
      registration.signUp({
        email: 'existing@example.com',
        password: 'Password1!',
        name: 'Guest',
        mode: 'upgrade',
        operationId: 'operation-existing',
        guest: { userId: 'guest-a', isAnonymous: true, familyId: 'family-a' },
      }),
    ).rejects.toThrow('registration account creation failed')

    expect(signIns).toBe(1)
    expect(transfers).toBe(0)
    expect(operations.operation?.state).toBe('started')
  })

  test('does not transfer after account creation if recording its owner fails', async () => {
    const operations = new MemoryOperations()
    const advance = operations.advance.bind(operations)
    let failAccountWrite = true
    operations.advance = async (operationId, expected, update) => {
      if (expected === 'started' && failAccountWrite) {
        failAccountWrite = false
        throw new Error('operation write failed')
      }
      return advance(operationId, expected, update)
    }
    let transfers = 0
    let signUps = 0
    const registration = new RegistrationOrchestrator(
      operations,
      {
        signUpEmail: async () => {
          signUps += 1
          return signUps === 1
            ? {
                user: {
                  id: 'new-c',
                  isAnonymous: false,
                  registrationOperationId: 'operation-write-failure',
                },
                sessionToken: 'new-session',
                sessionCookie: 'session=new',
              }
            : null
        },
        signInEmail: async () => ({
          user: {
            id: 'new-c',
            isAnonymous: false,
            registrationOperationId: 'operation-write-failure',
          },
          sessionToken: 'recovered-session',
          sessionCookie: 'session=recovered',
        }),
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
          return 1
        },
      },
    )

    const input = {
      email: 'new@example.com',
      password: 'Password1!',
      name: 'Guest',
      mode: 'upgrade' as const,
      operationId: 'operation-write-failure',
      guest: { userId: 'guest-a', isAnonymous: true, familyId: 'family-a' },
    }
    await expect(registration.signUp(input)).rejects.toThrow('operation write failed')
    expect(transfers).toBe(0)
    await registration.signUp(input)
    expect(transfers).toBe(1)
    expect(operations.operation?.state).toBe('completed')
  })

  test('recovers completion after the guest was invalidated but the final write failed', async () => {
    const operations = new MemoryOperations()
    const advance = operations.advance.bind(operations)
    let failFinalWrite = true
    operations.advance = async (operationId, expected, update) => {
      if (expected === 'completion-recorded' && failFinalWrite) {
        failFinalWrite = false
        throw new Error('final operation write failed')
      }
      return advance(operationId, expected, update)
    }
    let completions = 0
    const registration = new RegistrationOrchestrator(
      operations,
      {
        signUpEmail: async () => ({
          user: { id: 'registered-c', isAnonymous: false },
          sessionToken: 'registered-session',
          sessionCookie: 'session=registered',
        }),
        signInEmail: async () => ({
          user: { id: 'registered-c', isAnonymous: false },
          sessionToken: 'recovered-session',
          sessionCookie: 'session=recovered',
        }),
      },
      {
        registerRegistered: async () => ({}) as never,
        completeUpgrade: async () => {
          completions += 1
          return true
        },
      },
      {
        create: async () => ({}) as never,
        get: async () => null,
        list: async () => [],
        transferOwner: async () => 1,
      },
    )
    const input = {
      email: 'guest@example.com',
      password: 'Password1!',
      name: 'Guest',
      mode: 'upgrade' as const,
      operationId: 'operation-final-write',
      guest: { userId: 'guest-a', isAnonymous: true, familyId: 'family-a' },
    }

    await expect(registration.signUp(input)).rejects.toThrow('final operation write failed')
    expect(operations.operation?.state).toBe('completion-recorded')
    await registration.signUp(input)

    expect(completions).toBe(2)
    expect(operations.operation?.state).toBe('completed')
  })
})
