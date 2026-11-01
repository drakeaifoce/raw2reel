import { describe, expect, test } from 'bun:test'
import { ensureIndexes } from '../src/mongo-indexes'

const withCode = (code: number) => Object.assign(new Error(`mongo ${code}`), { code })

describe('ensureIndexes', () => {
  test('проглатывает «уже существует» от Cosmos: 48, 85 и 86', async () => {
    for (const code of [48, 85, 86]) {
      await expect(ensureIndexes([Promise.reject(withCode(code))])).resolves.toBeDefined()
    }
  })

  test('любую другую ошибку пропускает наружу', async () => {
    await expect(ensureIndexes([Promise.reject(withCode(13))])).rejects.toThrow('mongo 13')
    await expect(ensureIndexes([Promise.reject(new Error('сеть недоступна'))])).rejects.toThrow(
      'сеть недоступна',
    )
  })

  test('успешные задачи не ломает', async () => {
    await expect(ensureIndexes([Promise.resolve('ok')])).resolves.toBeDefined()
  })
})
