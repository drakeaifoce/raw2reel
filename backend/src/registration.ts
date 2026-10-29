import { MongoClient, type Collection } from 'mongodb'
import type { AuthService, RegistrationInput, RegistrationService } from './app'
import type { Config } from './config'
import type { IdentityService } from './identity'
import type { MediaRepository } from './media'

type RegistrationOperation = {
  _id: string
  mode: 'new' | 'upgrade'
  email: string
  name: string
  guestOwnerId?: string
  registeredOwnerId?: string
  state: 'started' | 'account-created' | 'media-transferred' | 'completed'
  createdAt: string
  updatedAt: string
}

export interface RegistrationOperationRepository {
  start(operation: RegistrationOperation): Promise<RegistrationOperation>
  advance(
    operationId: string,
    expected: RegistrationOperation['state'],
    update: Partial<RegistrationOperation>,
  ): Promise<RegistrationOperation | null>
}

export class MongoRegistrationOperationRepository implements RegistrationOperationRepository {
  constructor(private readonly operations: Collection<RegistrationOperation>) {}

  async start(operation: RegistrationOperation) {
    const existing = await this.operations.findOne({ _id: operation._id })
    if (existing) return existing
    await this.operations.insertOne(operation)
    return operation
  }

  advance(
    operationId: string,
    expected: RegistrationOperation['state'],
    update: Partial<RegistrationOperation>,
  ) {
    return this.operations.findOneAndUpdate(
      { _id: operationId, state: expected },
      { $set: { ...update, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after' },
    )
  }
}

export class RegistrationOrchestrator implements RegistrationService {
  constructor(
    private readonly operations: RegistrationOperationRepository,
    private readonly auth: Pick<AuthService, 'signUpEmail' | 'signInEmail'>,
    private readonly identity: Pick<IdentityService, 'registerRegistered' | 'completeUpgrade'>,
    private readonly media: MediaRepository,
  ) {}

  async signUp(input: RegistrationInput): Promise<{ status: 'accepted' }> {
    const operationId = input.operationId ?? crypto.randomUUID()
    const now = new Date().toISOString()
    let operation = await this.operations.start({
      _id: operationId,
      mode: input.mode,
      email: input.email,
      name: input.name,
      guestOwnerId: input.guest?.userId,
      state: 'started',
      createdAt: now,
      updatedAt: now,
    })

    if (operation.state === 'started') {
      const credentials = { email: input.email, password: input.password }
      const created = await this.auth.signUpEmail?.({
        email: input.email,
        password: input.password,
        name: input.name,
      })
      // A process may stop after Better Auth commits the account but before the
      // operation advances. Verifying the same credentials makes that boundary
      // recoverable without persisting a password in the operation document.
      const account = created ?? (await this.auth.signInEmail?.(new Headers(), credentials))
      if (!account) throw new Error('registration account creation failed')
      await this.identity.registerRegistered(account.user.id, account.sessionToken)
      operation =
        (await this.operations.advance(operationId, 'started', {
          state: 'account-created',
          registeredOwnerId: account.user.id,
        })) ?? operation
    }

    if (operation.state === 'account-created') {
      if (operation.mode === 'upgrade') {
        if (!operation.guestOwnerId || !operation.registeredOwnerId || !this.media.transferOwner) {
          throw new Error('registration ownership transfer is unavailable')
        }
        await this.media.transferOwner(
          operation.guestOwnerId,
          operation.registeredOwnerId,
          operationId,
        )
      }
      operation =
        (await this.operations.advance(operationId, 'account-created', {
          state: 'media-transferred',
        })) ?? operation
    }

    if (operation.state === 'media-transferred') {
      if (
        operation.mode === 'upgrade' &&
        operation.guestOwnerId &&
        !(await this.identity.completeUpgrade(operation.guestOwnerId, operationId))
      ) {
        throw new Error('registration identity transition failed')
      }
      await this.operations.advance(operationId, 'media-transferred', { state: 'completed' })
    }
    return { status: 'accepted' }
  }
}

export function createRegistrationService(
  config: Config,
  auth: AuthService | undefined,
  identity: IdentityService | undefined,
  media: MediaRepository | undefined,
): RegistrationService | undefined {
  if (!config.mongoUrl || !auth?.signUpEmail || !auth.signInEmail || !identity || !media) {
    return undefined
  }
  const operations = new MongoClient(config.mongoUrl)
    .db(config.mongoDb)
    .collection<RegistrationOperation>('registrationOperations')
  return new RegistrationOrchestrator(
    new MongoRegistrationOperationRepository(operations),
    auth,
    identity,
    media,
  )
}
